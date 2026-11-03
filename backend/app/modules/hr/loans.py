"""Employee loans and salary advances, recovered in monthly instalments by the payroll run.

Issuing one posts  Dr 1130 Employee Advances / Cr Cash or Bank; payroll then credits 1130 with each
instalment (less_loan_repayment). A cash repayment posts Dr Cash or Bank / Cr 1130."""
import logging
from datetime import timedelta
from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from app.auth.models import User
from app.common.audit import log_audit
from app.core import timezone as tz
from app.modules.employees.models import Employee, EmployeePayroll

from . import inputs
from .models import HREmployeeLoan, HRLoanRecovery

logger = logging.getLogger(__name__)
ZERO = Decimal("0")


def recovered(db: Session, loan: HREmployeeLoan) -> Decimal:
    """Recovered so far: cash repayments plus instalments on payroll records that were not cancelled."""
    total = (db.query(func.coalesce(func.sum(HRLoanRecovery.amount), 0))
             .outerjoin(EmployeePayroll, EmployeePayroll.id == HRLoanRecovery.payroll_id)
             .filter(HRLoanRecovery.loan_id == loan.id,
                     or_(HRLoanRecovery.payroll_id.is_(None), func.coalesce(EmployeePayroll.status, "draft") != "cancelled"))
             .scalar())
    return Decimal(total or 0)


def loan_balance(db: Session, loan: HREmployeeLoan) -> Decimal:
    if loan.status == "cancelled":
        return ZERO
    return max(ZERO, Decimal(loan.amount) - recovered(db, loan))


def refresh_status(db: Session, loan: HREmployeeLoan) -> None:
    if loan.status == "cancelled":
        return
    loan.status = "settled" if loan_balance(db, loan) <= 0 else "active"


def due_for_period(db: Session, employee_pk: int, period: str, leaving: bool) -> List[tuple]:
    """(loan, amount) to withhold in this payroll period: one instalment each, or the whole balance
    when the employee leaves this month."""
    out = []
    loans = (db.query(HREmployeeLoan)
             .filter(HREmployeeLoan.employee_pk == employee_pk, HREmployeeLoan.status == "active", HREmployeeLoan.start_period <= period)
             .order_by(HREmployeeLoan.issue_date, HREmployeeLoan.id).all())
    for loan in loans:
        bal = loan_balance(db, loan)
        if bal <= 0:
            continue
        out.append((loan, bal if leaving else min(Decimal(loan.installment_amount), bal)))
    return out


def dues_for_period(db: Session, leaving_by_pk: Dict[int, bool], period: str) -> Dict[int, List[tuple]]:
    """due_for_period for many employees in two queries: {employee pk: [(loan, amount, balance before)]}."""
    loans = (db.query(HREmployeeLoan)
             .filter(HREmployeeLoan.employee_pk.in_(list(leaving_by_pk)), HREmployeeLoan.status == "active",
                     HREmployeeLoan.start_period <= period)
             .order_by(HREmployeeLoan.issue_date, HREmployeeLoan.id).all())
    if not loans:
        return {}
    done = dict(db.query(HRLoanRecovery.loan_id, func.coalesce(func.sum(HRLoanRecovery.amount), 0))
                .outerjoin(EmployeePayroll, EmployeePayroll.id == HRLoanRecovery.payroll_id)
                .filter(HRLoanRecovery.loan_id.in_([l.id for l in loans]),
                        or_(HRLoanRecovery.payroll_id.is_(None), func.coalesce(EmployeePayroll.status, "draft") != "cancelled"))
                .group_by(HRLoanRecovery.loan_id).all())
    out: Dict[int, List[tuple]] = {}
    for loan in loans:
        bal = max(ZERO, Decimal(loan.amount) - Decimal(done.get(loan.id) or 0))
        if bal <= 0:
            continue
        due = bal if leaving_by_pk[loan.employee_pk] else min(Decimal(loan.installment_amount), bal)
        out.setdefault(loan.employee_pk, []).append((loan, due, bal))
    return out


def release_batch(db: Session, payroll_ids: List[int]) -> None:
    """A cancelled payroll batch gives its instalments back."""
    if not payroll_ids:
        return
    rows = db.query(HRLoanRecovery).filter(HRLoanRecovery.payroll_id.in_(payroll_ids)).all()
    loan_ids = {r.loan_id for r in rows}
    for r in rows:
        db.delete(r)
    db.flush()
    for loan in db.query(HREmployeeLoan).filter(HREmployeeLoan.id.in_(loan_ids)).all() if loan_ids else []:
        refresh_status(db, loan)


class LoanService:
    def __init__(self, db: Session):
        self.db = db

    def _employee(self, pk: int) -> Employee:
        emp = self.db.query(Employee).filter(Employee.id == pk).first()
        if not emp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found")
        return emp

    def _get(self, loan_id: int, lock: bool = False) -> HREmployeeLoan:
        q = self.db.query(HREmployeeLoan).filter(HREmployeeLoan.id == loan_id)
        loan = (q.with_for_update() if lock else q).first()
        if not loan:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Loan not found")
        return loan

    def _next_no(self, loan_type: str) -> str:
        prefix = f"{'LN' if loan_type == 'loan' else 'ADV'}-{tz.today().year}-"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": prefix})
        last = (self.db.query(HREmployeeLoan.loan_no).filter(HREmployeeLoan.loan_no.like(f"{prefix}%"))
                .order_by(HREmployeeLoan.id.desc()).first())
        seq = int(last[0].rsplit("-", 1)[-1]) + 1 if last else 1
        return f"{prefix}{seq:04d}"

    def _out(self, loan: HREmployeeLoan, emp: Optional[Employee] = None, with_recoveries: bool = False) -> dict:
        emp = emp or self.db.query(Employee).filter(Employee.id == loan.employee_pk).first()
        rec = recovered(self.db, loan)
        name = None
        if emp:
            u = emp.user
            name = emp.name_with_initials or (f"{u.first_name or ''} {u.last_name or ''}".strip() if u else None)
        out = {"id": loan.id, "loan_no": loan.loan_no, "employee_pk": loan.employee_pk,
               "employee_id": emp.employee_id if emp else None, "employee_name": name, "loan_type": loan.loan_type,
               "issue_date": loan.issue_date, "amount": loan.amount, "installment_amount": loan.installment_amount,
               "installments": loan.installments, "start_period": loan.start_period, "payment_method": loan.payment_method,
               "status": loan.status, "remarks": loan.remarks, "recovered": rec,
               "balance": ZERO if loan.status == "cancelled" else max(ZERO, Decimal(loan.amount) - rec),
               "created_at": loan.created_at}
        if with_recoveries:
            rows = (self.db.query(HRLoanRecovery, EmployeePayroll)
                    .outerjoin(EmployeePayroll, EmployeePayroll.id == HRLoanRecovery.payroll_id)
                    .filter(HRLoanRecovery.loan_id == loan.id).order_by(HRLoanRecovery.period, HRLoanRecovery.id).all())
            out["recoveries"] = [{"id": r.id, "period": r.period, "amount": r.amount, "payment_date": r.payment_date,
                                  "source": "payroll" if r.payroll_id else "cash",
                                  "payroll_batch_no": p.payroll_batch_no if p else None,
                                  "cancelled": bool(p and p.status == "cancelled"), "remarks": r.remarks} for r, p in rows]
        return out

    def list(self, status_: Optional[str] = None, employee_pk: Optional[int] = None, loan_type: Optional[str] = None,
             branches: Optional[List[str]] = None) -> List[dict]:
        q = self.db.query(HREmployeeLoan, Employee).join(Employee, Employee.id == HREmployeeLoan.employee_pk)
        if branches is not None:
            q = q.filter(or_(Employee.branch_code.in_(branches), Employee.branch_code.is_(None)))
        if status_:
            q = q.filter(HREmployeeLoan.status == status_)
        if employee_pk:
            q = q.filter(HREmployeeLoan.employee_pk == employee_pk)
        if loan_type:
            q = q.filter(HREmployeeLoan.loan_type == loan_type)
        return [self._out(l, e) for l, e in q.order_by(HREmployeeLoan.id.desc()).limit(1000).all()]

    def get(self, loan_id: int) -> dict:
        return self._out(self._get(loan_id), with_recoveries=True)

    def create(self, data: inputs.LoanIn, actor: User) -> dict:
        emp = self._employee(data.employee_pk)
        from app.modules.hr_core.service import in_service
        if not in_service(emp):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This employee is no longer in service")
        # A double submit (same employee, type, amount and issue date within a minute) must not issue - and post - it twice
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"hr-loan-{emp.id}"})
        if self.db.query(HREmployeeLoan.id).filter(
                HREmployeeLoan.employee_pk == emp.id, HREmployeeLoan.loan_type == data.loan_type, HREmployeeLoan.amount == data.amount,
                HREmployeeLoan.issue_date == data.issue_date, HREmployeeLoan.status != "cancelled",
                HREmployeeLoan.created_at >= tz.now() - timedelta(minutes=1)).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This loan was just recorded; check the loan list before adding it again")
        loan = HREmployeeLoan(
            loan_no=self._next_no(data.loan_type), employee_pk=emp.id, loan_type=data.loan_type, issue_date=data.issue_date,
            amount=data.amount, installments=data.installments, installment_amount=data.installment_amount,
            start_period=data.start_period, payment_method=data.payment_method, status="active", remarks=data.remarks,
            created_by=actor.id, updated_by=actor.id)
        self.db.add(loan)
        self.db.flush()
        log_audit(self.db, user_id=actor.id, action="create", entity_type="hr_employee_loan", entity_id=loan.id,
                  changes={"loan_no": loan.loan_no, "employee": emp.employee_id, "amount": str(loan.amount)})
        self.db.commit()
        self._post_gl(loan, "issue", Decimal(loan.amount), loan.issue_date, loan.payment_method, actor.id, emp.branch_code)
        self.db.refresh(loan)
        return self._out(loan, emp, with_recoveries=True)

    def update(self, loan_id: int, data: inputs.LoanUpdate, actor: User) -> dict:
        """Only the recovery plan changes once a loan is issued (instalment, start month, remarks)."""
        loan = self._get(loan_id, lock=True)
        if loan.status != "active":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A {loan.status} loan cannot be changed")
        # the same plan rules as when the loan was issued
        if data.installment_amount > Decimal(loan.amount):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The instalment cannot be more than the loan")
        if data.start_period < loan.issue_date.strftime("%Y-%m"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Recovery cannot start before the month the loan is issued")
        loan.installment_amount, loan.start_period, loan.remarks = data.installment_amount, data.start_period, data.remarks
        bal = loan_balance(self.db, loan)
        loan.installments = max(1, int((bal / Decimal(data.installment_amount)).to_integral_value(rounding="ROUND_CEILING"))) if bal > 0 else loan.installments
        loan.updated_by = actor.id
        log_audit(self.db, user_id=actor.id, action="update", entity_type="hr_employee_loan", entity_id=loan.id,
                  changes={"installment": str(data.installment_amount), "start_period": data.start_period})
        self.db.commit()
        return self.get(loan_id)

    def repay(self, loan_id: int, data: inputs.LoanRepaymentIn, actor: User) -> dict:
        loan = self._get(loan_id, lock=True)
        if loan.status != "active":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"A {loan.status} loan cannot take repayments")
        bal = loan_balance(self.db, loan)
        if data.amount > bal:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Only {bal:,.2f} is still owed on this loan")
        pay_date = data.payment_date or tz.today()
        rec = HRLoanRecovery(loan_id=loan.id, period=pay_date.strftime("%Y-%m"), amount=data.amount, payment_date=pay_date,
                             remarks=data.remarks, created_by=actor.id, updated_by=actor.id)
        self.db.add(rec)
        self.db.flush()
        rec_id = rec.id
        refresh_status(self.db, loan)
        log_audit(self.db, user_id=actor.id, action="repay", entity_type="hr_employee_loan", entity_id=loan.id,
                  changes={"amount": str(data.amount)})
        self.db.commit()
        emp = self.db.query(Employee).filter(Employee.id == loan.employee_pk).first()
        self._post_gl(loan, f"repay-{rec_id}", Decimal(data.amount), pay_date, data.payment_method,
                      actor.id, emp.branch_code if emp else None)
        return self.get(loan_id)

    def cancel(self, loan_id: int, actor: User) -> dict:
        """Cancel a loan entered by mistake: only before anything has been recovered."""
        loan = self._get(loan_id, lock=True)
        if loan.status != "active":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"This loan is already {loan.status}")
        if recovered(self.db, loan) > 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Instalments have already been recovered; record a repayment instead of cancelling")
        if self.db.query(HRLoanRecovery.id).filter(HRLoanRecovery.loan_id == loan.id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A payroll batch still holds an instalment of this loan")
        loan.status, loan.updated_by = "cancelled", actor.id
        log_audit(self.db, user_id=actor.id, action="cancel", entity_type="hr_employee_loan", entity_id=loan.id, changes={})
        self.db.commit()
        emp = self.db.query(Employee).filter(Employee.id == loan.employee_pk).first()
        self._post_gl(loan, "cancel", Decimal(loan.amount), tz.today(), loan.payment_method, actor.id, emp.branch_code if emp else None)
        return self.get(loan_id)

    # ── GL ──
    def _post_gl(self, loan: HREmployeeLoan, event: str, amount: Decimal, when, method: str, user_id: int, branch_code: Optional[str]) -> None:
        """Non-blocking like every other HR posting: a failure is recorded for retry in Finance."""
        from app.modules.finance.gl_posting_service import record_gl_commit_failure
        from app.modules.finance.purchase_expense_payroll_gl import (
            ACCT_BANK_ACCOUNT, ACCT_CASH_ON_HAND, ACCT_EMPLOYEE_ADVANCES, PurchaseExpensePayrollGL)

        cash = ACCT_CASH_ON_HAND if method == "cash" else ACCT_BANK_ACCOUNT
        kind = "salary advance" if loan.loan_type == "advance" else "loan"
        if event == "issue":
            dr, cr, desc = ACCT_EMPLOYEE_ADVANCES, cash, f"Employee {kind} issued {loan.loan_no}"
        elif event == "cancel":
            dr, cr, desc = cash, ACCT_EMPLOYEE_ADVANCES, f"Employee {kind} cancelled {loan.loan_no}"
        else:
            dr, cr, desc = cash, ACCT_EMPLOYEE_ADVANCES, f"Employee {kind} repaid in cash {loan.loan_no}"
        try:
            PurchaseExpensePayrollGL(self.db)._create_je_and_post(
                entry_date=when, description=desc, branch_code=branch_code, user_id=user_id,
                lines=[{"account_code": dr, "debit": amount, "credit": ZERO, "description": desc},
                       {"account_code": cr, "debit": ZERO, "credit": amount, "description": desc}],
                je_prefix="JE-HR", transaction_type="Payroll", reference_type="EmployeeLoan", reference_id=loan.id,
                reference_no=loan.loan_no, marker=f"EmployeeLoan {loan.id} {event}")
            self.db.commit()
        except Exception as err:  # noqa: BLE001 - posting must not undo the loan
            logger.warning("GL posting for loan %s (%s) failed: %s", loan.loan_no, event, err)
            self.db.rollback()
            record_gl_commit_failure(self.db, reference_type="EmployeeLoan", reference_id=loan.id, reference_no=loan.loan_no,
                                     transaction_type="Payroll", description=f"Employee loan GL posting failed ({loan.loan_no} {event})",
                                     error=err, user_id=user_id)
