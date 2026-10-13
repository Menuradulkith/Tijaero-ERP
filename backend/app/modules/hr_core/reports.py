"""HR reports: headcount, birthdays / anniversaries, expiries, leave summary, attrition."""
from datetime import date, timedelta
from typing import List, Optional

from sqlalchemy import extract, func, or_
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import timezone as tz
from app.modules.attendance.models import Leaves
from app.modules.employees.models import Employee
from app.modules.hr_core import models as m
from app.modules.hr_core.service import LIVE_STATUSES, _full_name


def _scope(query, allowed_branches: Optional[List[str]]):
    if allowed_branches is not None:
        query = query.filter(or_(Employee.branch_code.in_(allowed_branches), Employee.branch_code.is_(None)))
    return query


def headcount(db: Session, allowed_branches: Optional[List[str]]) -> dict:
    live = Employee.status.in_(LIVE_STATUSES)

    def grouped(col, names: dict):
        q = _scope(db.query(col, func.count(Employee.id)).filter(live), allowed_branches).group_by(col).all()
        return sorted(({"key": k, "label": names.get(k, "Unassigned") if k is not None else "Unassigned", "count": n} for k, n in q),
                      key=lambda r: -r["count"])

    dept = {r.id: r.name for r in db.query(m.HRDepartment.id, m.HRDepartment.name)}
    etype = {r.id: r.name for r in db.query(m.HREmploymentType.id, m.HREmploymentType.name)}
    desig = {r.id: r.name for r in db.query(m.HRDesignation.id, m.HRDesignation.name)}
    gender = [{"key": g, "label": (g or "Not set").title(), "count": n} for g, n in
              _scope(db.query(User.gender, func.count(Employee.id)).join(Employee, Employee.user_id == User.id).filter(live), allowed_branches).group_by(User.gender).all()]
    status_rows = _scope(db.query(Employee.status, func.count(Employee.id)), allowed_branches).group_by(Employee.status).all()
    total = _scope(db.query(func.count(Employee.id)).filter(live), allowed_branches).scalar() or 0
    return {
        "total": total,
        "by_status": [{"key": k, "label": (k or "").replace("_", " ").title(), "count": n} for k, n in status_rows],
        "by_department": grouped(Employee.department_id, dept),
        "by_designation": grouped(Employee.designation_id, desig),
        "by_employment_type": grouped(Employee.employment_type_id, etype),
        "by_branch": grouped(Employee.branch_code, {k: k for (k,) in db.query(Employee.branch_code).distinct() if k}),
        "by_gender": gender,
    }


def _upcoming(db: Session, allowed_branches, days: int, kind: str) -> List[dict]:
    """People whose birthday / work anniversary falls within the next ``days`` days."""
    today = tz.today()
    horizon = {(today + timedelta(days=i)) for i in range(days + 1)}
    wanted = {(d.month, d.day) for d in horizon}
    col = User.birthdate if kind == "birthday" else Employee.date_of_joining
    q = _scope(db.query(Employee, User).join(User, User.id == Employee.user_id).filter(Employee.status.in_(LIVE_STATUSES), col.isnot(None)), allowed_branches)
    out = []
    for emp, user in q.all():
        d = user.birthdate if kind == "birthday" else emp.date_of_joining
        if (d.month, d.day) not in wanted:
            continue
        nxt = date(today.year, d.month, d.day) if (d.month, d.day) != (2, 29) else date(today.year, 2, 28)
        if nxt < today:
            nxt = date(today.year + 1, nxt.month, nxt.day)
        years = nxt.year - d.year
        if kind == "anniversary" and years <= 0:
            continue
        out.append({"employee_pk": emp.id, "employee_id": emp.employee_id, "name": _full_name(user), "date": nxt.isoformat(),
                    "years": years, "days_to_go": (nxt - today).days, "branch_code": emp.branch_code})
    return sorted(out, key=lambda r: (r["days_to_go"], r["name"] or ""))


def birthdays(db, allowed_branches, days: int = 30):
    return _upcoming(db, allowed_branches, days, "birthday")


def anniversaries(db, allowed_branches, days: int = 30):
    return _upcoming(db, allowed_branches, days, "anniversary")


def expiring(db: Session, allowed_branches, days: int = 60) -> dict:
    today, horizon = tz.today(), tz.today() + timedelta(days=days)
    base = db.query(Employee, User).join(User, User.id == Employee.user_id).filter(Employee.status.in_(LIVE_STATUSES))
    base = _scope(base, allowed_branches)

    def row(emp, user, on, extra=None):
        return {"employee_pk": emp.id, "employee_id": emp.employee_id, "name": _full_name(user), "date": on.isoformat(),
                "days_left": (on - today).days, **(extra or {})}

    contracts = [row(e, u, e.contract_end_date) for e, u in base.filter(Employee.contract_end_date.isnot(None), Employee.contract_end_date <= horizon).order_by(Employee.contract_end_date).all()]
    probation = [row(e, u, e.probation_end_date) for e, u in base.filter(Employee.status == "probation", Employee.probation_end_date.isnot(None),
                                                                           Employee.probation_end_date <= horizon).order_by(Employee.probation_end_date).all()]
    retirements = [row(e, u, e.retirement_date) for e, u in base.filter(Employee.retirement_date.isnot(None), Employee.retirement_date.between(today, today + timedelta(days=days * 6))).order_by(Employee.retirement_date).all()]
    docs_q = (db.query(m.HRDocument, Employee, User).join(Employee, Employee.id == m.HRDocument.employee_pk).join(User, User.id == Employee.user_id)
              .filter(Employee.status.in_(LIVE_STATUSES), m.HRDocument.expiry_date.isnot(None), m.HRDocument.expiry_date <= horizon))
    docs_q = _scope(docs_q, allowed_branches)
    documents = [row(e, u, d.expiry_date, {"doc_type": d.doc_type, "title": d.title}) for d, e, u in docs_q.order_by(m.HRDocument.expiry_date).all()]
    return {"contracts": contracts, "probation": probation, "retirements": retirements, "documents": documents}


def leave_summary(db: Session, allowed_branches, year: int) -> dict:
    types = {t.code.lower(): t for t in db.query(m.HRLeaveType).all()}
    q = (db.query(func.lower(Leaves.leave_type), Leaves.status, func.coalesce(func.sum(Leaves.leave_duration), 0), func.count(Leaves.id))
         .join(Employee, Employee.employee_id == Leaves.employee_id)
         .filter(Leaves.from_date >= date(year, 1, 1), Leaves.from_date <= date(year, 12, 31)))
    q = _scope(q, allowed_branches).group_by(func.lower(Leaves.leave_type), Leaves.status)
    by_type: dict = {}
    for code, st, days, n in q.all():
        row = by_type.setdefault(code or "other", {"code": code, "name": types[code].name if code in types else (code or "other").title(),
                                                   "approved_days": 0.0, "pending_days": 0.0, "rejected_days": 0.0, "applications": 0})
        row["applications"] += n
        key = {"approved": "approved_days", "pending": "pending_days", "rejected": "rejected_days"}.get(st)
        if key:
            row[key] += float(days)
    today = tz.today()
    on_leave_q = (db.query(Employee, User, Leaves).join(User, User.id == Employee.user_id).join(Leaves, Leaves.employee_id == Employee.employee_id)
                  .filter(Leaves.status == "approved", Leaves.from_date <= today, Leaves.to_date >= today))
    on_leave = [{"employee_pk": e.id, "employee_id": e.employee_id, "name": _full_name(u), "leave_type": lv.leave_type,
                 "from_date": lv.from_date.isoformat(), "to_date": lv.to_date.isoformat()} for e, u, lv in _scope(on_leave_q, allowed_branches).all()]
    return {"year": year, "by_type": sorted(by_type.values(), key=lambda r: r["name"]), "on_leave_today": on_leave}


def attrition(db: Session, allowed_branches, year: int) -> dict:
    start, end = date(year, 1, 1), date(year, 12, 31)
    left_q = _scope(db.query(Employee, User).join(User, User.id == Employee.user_id).filter(
        Employee.last_working_date.isnot(None), Employee.last_working_date.between(start, end)), allowed_branches)
    leavers = left_q.all()
    joined = _scope(db.query(func.count(Employee.id)).filter(Employee.date_of_joining.between(start, end)), allowed_branches).scalar() or 0
    live_now = _scope(db.query(func.count(Employee.id)).filter(Employee.status.in_(LIVE_STATUSES)), allowed_branches).scalar() or 0
    opening = max(live_now - joined + len(leavers), 0)
    avg = (opening + live_now) / 2 or 1
    by_type: dict = {}
    for e, _ in leavers:
        by_type[e.exit_type or "other"] = by_type.get(e.exit_type or "other", 0) + 1
    return {"year": year, "joiners": joined, "leavers": len(leavers), "opening_headcount": opening, "closing_headcount": live_now,
            "attrition_rate_percent": round(len(leavers) / avg * 100, 1), "by_exit_type": [{"key": k, "count": v} for k, v in sorted(by_type.items())],
            "leaver_list": [{"employee_pk": e.id, "employee_id": e.employee_id, "name": _full_name(u), "exit_type": e.exit_type,
                             "last_working_date": e.last_working_date.isoformat(), "reason": e.exit_reason} for e, u in leavers]}
