"""Branch scope for HR records that hang off an employee (payroll records, salary profiles and revisions,
deductions, promotions, asset assignments, loans).

A non-superuser only sees and changes records of employees whose home branch they hold (employees with
no branch are visible to everyone, as in the employee list). Payroll
batches stay company-wide (payroll processing is a head-office job); the per-employee rows are scoped.
"""
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Query, Session

from app.auth.models import User
from app.modules.employees.models import Employee


def branches_of(user: Optional[User]) -> Optional[List[str]]:
    """None = no limit (superuser or internal call); otherwise the user's branch codes."""
    if user is None or user.is_superuser:
        return None
    return [b.branch_code for b in user.branches]


def scope(query: Query, column, branches: Optional[List[str]], by: str = "code") -> Query:
    """Limit `query` to rows whose `column` (employee code or employee pk) belongs to `branches`."""
    if branches is None:
        return query
    key = Employee.employee_id if by == "code" else Employee.id
    return query.filter(column.in_(select(key).where(or_(Employee.branch_code.in_(branches), Employee.branch_code.is_(None)))))


def employee_names(db: Session, codes) -> Dict[str, str]:
    """{employee code: "first last"} in one query, for list responses (instead of 2 queries per row)."""
    codes = {c for c in codes if c}
    if not codes:
        return {}
    rows = (db.query(Employee.employee_id, User.first_name, User.last_name)
            .outerjoin(User, User.id == Employee.user_id).filter(Employee.employee_id.in_(codes)).all())
    return {code: (f"{first or ''} {last or ''}".strip() or code) if (first or last) else code for code, first, last in rows}


def need_employee(db: Session, user: Optional[User], *, code: Optional[str] = None, pk: Optional[int] = None) -> None:
    """403 when the employee's branch is outside the user's scope. An unknown employee is left to the
    service (which answers 404)."""
    branches = branches_of(user)
    if branches is None or (code is None and pk is None):
        return
    q = db.query(Employee.branch_code)
    q = q.filter(Employee.employee_id == code) if code is not None else q.filter(Employee.id == pk)
    row = q.first()
    if row is not None and row[0] is not None and row[0] not in branches:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {row[0]}")


def need_row(db: Session, user: Optional[User], model, row_id: int, column, by: str = "code") -> None:
    """need_employee for an existing row, looked up by its id (a missing row is left to the service)."""
    if branches_of(user) is None:
        return
    ref = db.query(column).filter(model.id == row_id).scalar()
    if ref is not None:
        need_employee(db, user, **({"code": ref} if by == "code" else {"pk": ref}))
