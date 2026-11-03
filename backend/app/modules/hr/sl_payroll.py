"""Sri Lankan payroll rules: payroll settings, allowance lines, effective-dated salary revisions,
attendance totals for overtime / late cuts, statutory returns (EPF Form C, ETF R4, APIT schedule),
the bank salary-transfer file and the final settlement (gratuity) on separation."""
import calendar
import csv
import io
from datetime import date
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import User
from app.common.audit import log_audit
from app.core import timezone as tz
from app.modules.attendance.models import Attendance
from app.modules.employees.models import Employee, EmployeePayroll, EmployeeSalaryProfile, EmployeesAssets, SalaryRevision

from . import inputs
from .models import HREmployeeLoan, HRPayrollSettings, PayrollBatch

ZERO = Decimal("0")


def q2(v) -> Decimal:
    return Decimal(v).quantize(Decimal("0.01"))


# ─────────────────────────────── settings ───────────────────────────────
def payroll_settings(db: Session) -> HRPayrollSettings:
    row = db.query(HRPayrollSettings).order_by(HRPayrollSettings.id).first()
    if not row:
        row = HRPayrollSettings(id=1)
        db.add(row)
        db.flush()
    return row


def update_payroll_settings(db: Session, data: inputs.PayrollSettingsIn, user_id: int) -> HRPayrollSettings:
    row = payroll_settings(db)
    changes = {}
    for key, value in data.model_dump().items():
        if getattr(row, key) != value:
            changes[key] = [str(getattr(row, key)), str(value)]
            setattr(row, key, value)
    row.updated_by = user_id
    if changes:
        log_audit(db, user_id=user_id, action="update", entity_type="hr_payroll_settings", entity_id=row.id, changes=changes)
    db.commit()
    db.refresh(row)
    return row


# ─────────────────────────────── allowances ───────────────────────────────
def allowance_list(obj) -> List[dict]:
    """Allowance lines of a salary profile / revision. Profiles saved before allowance lines existed
    still carry the two fixed slots (add_1 / add_2): those count as taxable, not EPF-liable."""
    rows = getattr(obj, "allowances", None)
    if rows:
        return [{"name": r.get("name") or "Allowance", "amount": Decimal(str(r.get("amount") or 0)),
                 "epf_liable": bool(r.get("epf_liable")), "taxable": r.get("taxable", True) is not False} for r in rows]
    out = []
    for n in (1, 2):
        value = getattr(obj, f"add_{n}_value", None)
        if value:
            out.append({"name": getattr(obj, f"add_{n}_name", None) or f"Allowance {n}", "amount": Decimal(str(value)),
                        "epf_liable": False, "taxable": True})
    return out


def allowances_json(items) -> List[dict]:
    return [{"name": a.name, "amount": str(a.amount), "epf_liable": a.epf_liable, "taxable": a.taxable} for a in items or []]


# ─────────────────────────────── salary revisions ───────────────────────────────
def salary_for_period(db: Session, profile: EmployeeSalaryProfile, period_end: date):
    """The salary in force on the last day of the month: the latest revision that started by then,
    else the profile itself (employees set up before revisions existed)."""
    rev = (db.query(SalaryRevision)
           .filter(SalaryRevision.employee_id == profile.employee_id, SalaryRevision.effective_from <= period_end)
           .order_by(SalaryRevision.effective_from.desc()).first())
    return rev or profile


def record_revision(db: Session, employee_id: str, effective_from: date, basic: Decimal, allowances: List[dict],
                    reason: str, remarks: Optional[str], user_id: int) -> SalaryRevision:
    """One revision per employee and start date: saving again on the same date corrects it."""
    row = db.query(SalaryRevision).filter(SalaryRevision.employee_id == employee_id,
                                          SalaryRevision.effective_from == effective_from).with_for_update().first()
    if row is None:
        row = SalaryRevision(employee_id=employee_id, effective_from=effective_from, created_by=user_id)
        db.add(row)
    row.basic_salary, row.allowances, row.reason, row.remarks, row.updated_by = basic, allowances, reason, remarks, user_id
    db.flush()
    return row


def revisions_of(db: Session, employee_id: str) -> List[dict]:
    rows = db.query(SalaryRevision).filter(SalaryRevision.employee_id == employee_id).order_by(SalaryRevision.effective_from.desc()).all()
    out, users = [], {}
    for i, r in enumerate(rows):
        lines = allowance_list(r)
        total = (r.basic_salary or ZERO) + sum((a["amount"] for a in lines), ZERO)
        prev = rows[i + 1] if i + 1 < len(rows) else None
        prev_total = ((prev.basic_salary or ZERO) + sum((a["amount"] for a in allowance_list(prev)), ZERO)) if prev else None
        if r.created_by and r.created_by not in users:
            u = db.query(User).filter(User.id == r.created_by).first()
            users[r.created_by] = f"{u.first_name or ''} {u.last_name or ''}".strip() if u else None
        out.append({"id": r.id, "employee_id": r.employee_id, "effective_from": r.effective_from, "basic_salary": r.basic_salary,
                    "allowances": [{**a, "amount": a["amount"]} for a in lines], "total": total,
                    "change": (total - prev_total) if prev_total is not None else None,
                    "change_percent": (round(float((total - prev_total) / prev_total * 100), 2) if prev_total else None),
                    "reason": r.reason, "remarks": r.remarks, "created_by_name": users.get(r.created_by)})
    return out


# ─────────────────────────────── attendance ───────────────────────────────
def attendance_minutes(db: Session, employee_ids: List[str], start: date, end: date) -> Dict[str, tuple]:
    """employee_id -> (overtime minutes, late minutes) inside the period."""
    if not employee_ids:
        return {}
    rows = (db.query(Attendance.employee_id, func.coalesce(func.sum(Attendance.ot_mins), 0), func.coalesce(func.sum(Attendance.late_mins), 0))
            .filter(Attendance.employee_id.in_(employee_ids), Attendance.date >= start, Attendance.date <= end)
            .group_by(Attendance.employee_id).all())
    return {e: (int(ot or 0), int(late or 0)) for e, ot, late in rows}


# ─────────────────────────────── statutory returns ───────────────────────────────
def _batch(db: Session, batch_id: int) -> PayrollBatch:
    batch = db.query(PayrollBatch).filter(PayrollBatch.id == batch_id).first()
    if not batch:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payroll batch not found")
    if batch.status == "cancelled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This payroll batch was cancelled")
    return batch


def _name(emp: Employee) -> str:
    if emp.name_with_initials:
        return emp.name_with_initials
    u = emp.user
    return f"{u.first_name or ''} {u.last_name or ''}".strip() if u else emp.employee_id


def _epf_base(p: EmployeePayroll) -> Decimal:
    # Records made before epf_earnings existed contributed on basic salary
    if p.epf_earnings is not None:
        return Decimal(p.epf_earnings)
    return Decimal(p.basic_salary or 0)


STATUTORY_KINDS = ("epf", "etf", "apit", "bank")


def statutory_return(db: Session, batch_id: int, kind: str) -> dict:
    """Rows + totals for one return of a payroll batch."""
    batch = _batch(db, batch_id)
    settings = payroll_settings(db)
    records = (db.query(EmployeePayroll, Employee)
               .join(Employee, Employee.employee_id == EmployeePayroll.employee_id)
               .filter(EmployeePayroll.payroll_batch_no == batch.batch_no)
               .order_by(Employee.employee_id).all())
    period = date(batch.payroll_year, batch.payroll_month, 1).strftime("%B %Y")
    rows, warnings = [], []
    for p, e in records:
        base = {"employee_id": e.employee_id, "name": _name(e), "nic": e.nic or ""}
        if kind == "epf":
            ee, er = Decimal(p.less_epf_employee or 0), Decimal(p.epf_employer or 0)
            if not ee and not er:
                continue
            if not e.epf_no:
                warnings.append(f"{e.employee_id}: EPF member number missing")
            rows.append({**base, "member_no": e.epf_no or "", "earnings": _epf_base(p), "employee": ee, "employer": er, "total": ee + er})
        elif kind == "etf":
            amt = Decimal(p.etf_employer or 0)
            if not amt:
                continue
            if not (e.etf_no or e.epf_no):
                warnings.append(f"{e.employee_id}: ETF / EPF member number missing")
            rows.append({**base, "member_no": e.etf_no or e.epf_no or "", "earnings": _epf_base(p), "contribution": amt})
        elif kind == "apit":
            gross = Decimal(p.gross_salary or 0)
            taxable = Decimal(p.taxable_income) if p.taxable_income is not None else gross
            rows.append({**base, "tin": e.tin_no or "", "gross": gross, "taxable": taxable, "apit": Decimal(p.less_apit or 0)})
        elif kind == "bank":
            net = Decimal(p.net_salary or 0)
            if net <= 0:
                continue
            if not e.bank_account_no:
                warnings.append(f"{e.employee_id}: bank account missing - pay by cash or cheque")
            rows.append({**base, "bank": e.bank_name or "", "branch": e.bank_branch or "", "account_no": e.bank_account_no or "",
                         "account_name": e.bank_account_name or _name(e), "amount": net})
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown return")
    money_keys = {"epf": ("earnings", "employee", "employer", "total"), "etf": ("earnings", "contribution"),
                  "apit": ("gross", "taxable", "apit"), "bank": ("amount",)}[kind]
    totals = {k: sum((r[k] for r in rows), ZERO) for k in money_keys}
    titles = {"epf": "EPF Form C - monthly contributions", "etf": "ETF Form R4 - monthly contributions",
              "apit": "APIT monthly schedule", "bank": "Salary bank transfer"}
    return {"kind": kind, "title": titles[kind], "batch_no": batch.batch_no, "period": period,
            "year": batch.payroll_year, "month": batch.payroll_month,
            "employer_epf_no": settings.employer_epf_no, "employer_tin": settings.employer_tin,
            "rows": rows, "totals": totals, "count": len(rows), "warnings": warnings}


def statutory_csv(data: dict) -> str:
    cols = {
        "epf": [("member_no", "Member No"), ("nic", "NIC"), ("name", "Name"), ("earnings", "Total Earnings"),
                ("employee", "Employee 8%"), ("employer", "Employer 12%"), ("total", "Total Contribution")],
        "etf": [("member_no", "Member No"), ("nic", "NIC"), ("name", "Name"), ("earnings", "Total Earnings"), ("contribution", "ETF 3%")],
        "apit": [("employee_id", "Emp No"), ("tin", "TIN"), ("nic", "NIC"), ("name", "Name"), ("gross", "Gross Pay"),
                 ("taxable", "Taxable Income"), ("apit", "APIT Deducted")],
        "bank": [("employee_id", "Emp No"), ("account_name", "Account Name"), ("bank", "Bank"), ("branch", "Branch"),
                 ("account_no", "Account No"), ("amount", "Amount")],
    }[data["kind"]]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([label for _k, label in cols])
    for r in data["rows"]:
        w.writerow([f"{r[k]:.2f}" if isinstance(r[k], Decimal) else r[k] for k, _l in cols])
    w.writerow(["TOTAL"] + ["" for _ in cols[1:-1]] + [f"{data['totals'][cols[-1][0]]:.2f}"])
    return buf.getvalue()


# ─────────────────────────────── final settlement ───────────────────────────────
def _completed_years(start: date, end: date) -> int:
    years = end.year - start.year
    if (end.month, end.day) < (start.month, start.day):
        years -= 1
    return max(0, years)


def final_settlement(db: Session, emp: Employee) -> dict:
    """What is due when someone leaves: gratuity (Payment of Gratuity Act No. 12 of 1983 - half a month's
    salary for each completed year once 5 years are served), loans still owed and assets not returned.
    The last month's pro-rated salary is paid by the normal payroll run."""
    from .loans import loan_balance

    settings = payroll_settings(db)
    end = emp.last_working_date or tz.today()
    joined = emp.date_of_joining
    years = _completed_years(joined, end) if joined else 0
    profile = db.query(EmployeeSalaryProfile).filter(EmployeeSalaryProfile.employee_id == emp.employee_id).first()
    monthly = ZERO
    if profile:
        sal = salary_for_period(db, profile, end)
        monthly = Decimal(sal.basic_salary or 0) + sum((a["amount"] for a in allowance_list(sal) if a["epf_liable"]), ZERO)
    eligible = bool(settings.gratuity_enabled and joined and years >= 5)
    gratuity = q2(monthly / 2 * years) if eligible else ZERO

    loans = []
    for loan in db.query(HREmployeeLoan).filter(HREmployeeLoan.employee_pk == emp.id, HREmployeeLoan.status == "active").all():
        bal = loan_balance(db, loan)
        if bal > 0:
            loans.append({"loan_no": loan.loan_no, "loan_type": loan.loan_type, "balance": bal})
    owed = sum((l["balance"] for l in loans), ZERO)

    assets = []
    for a in db.query(EmployeesAssets).filter(EmployeesAssets.employee_id == emp.employee_id, EmployeesAssets.revoke_assignment.is_(False)).all():
        asset = a.asset
        assets.append({"id": a.id, "asset": f"{asset.inventory_no} - {asset.item}" if asset else f"Asset #{a.asset_id}"})

    last_month = None
    if emp.last_working_date:
        d = emp.last_working_date
        paid = db.query(EmployeePayroll.id).filter(
            EmployeePayroll.employee_id == emp.employee_id, EmployeePayroll.payroll_year == d.year,
            EmployeePayroll.payroll_month == d.month, func.coalesce(EmployeePayroll.status, "draft") != "cancelled").first()
        last_month = {"period": f"{d.year}-{d.month:02d}", "days": d.day, "days_in_month": calendar.monthrange(d.year, d.month)[1],
                      "processed": bool(paid)}

    notes = []
    if not joined:
        notes.append("Date of joining is not set, so service and gratuity cannot be worked out.")
    elif years < 5:
        notes.append(f"{years} completed year(s) of service: gratuity starts after 5 years.")
    if not settings.gratuity_enabled:
        notes.append("Gratuity is switched off in payroll settings (the Act applies to employers with 15 or more workers).")
    if loans:
        notes.append("Loans still owed are recovered in full by the last payroll run; anything left must be settled in cash.")
    if assets:
        notes.append("Company assets are still assigned to this employee.")

    return {"employee_pk": emp.id, "employee_id": emp.employee_id, "name": _name(emp), "status": emp.status,
            "date_of_joining": joined, "last_working_date": emp.last_working_date, "exit_type": emp.exit_type,
            "completed_years": years, "monthly_salary": monthly, "gratuity_eligible": eligible, "gratuity": gratuity,
            "loans": loans, "loans_owed": owed, "unreturned_assets": assets, "last_month": last_month,
            "net_settlement": gratuity - owed, "notes": notes}
