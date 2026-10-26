"""Core HR business logic: masters, leave allocation / balances, employee master."""
import uuid
from datetime import date, datetime, timedelta
from math import ceil
from pathlib import Path
from typing import List, Optional

from fastapi import HTTPException, UploadFile, status
from sqlalchemy import and_, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.models import Branch, User
from app.common.audit import log_audit
from app.common.concurrency import ensure_not_stale
from app.core import timezone as tz
from app.core.config import settings
from app.modules.attendance.models import Leaves
from app.modules.employees.models import Employee
from app.modules.hr_core import models as m
from app.modules.hr_core import schemas as s

# employee statuses that still count as "on the payroll"
LIVE_STATUSES = ("active", "probation", "notice_period")

_UNIQUE_MESSAGES = {
    "uq_hr_departments_code_ci": "A department with this code already exists",
    "uq_hr_departments_name_ci": "A department with this name already exists",
    "uq_hr_designations_name_ci": "A designation with this name already exists",
    "uq_hr_employment_types_name_ci": "An employment type with this name already exists",
    "uq_hr_shifts_name_ci": "A shift with this name already exists",
    "uq_hr_shifts_one_default": "Another shift is already the default",
    "uq_hr_holiday_lists_name_ci": "A holiday list with this name already exists",
    "uq_hr_holiday_lists_default_year": "Another holiday list is already the default for this year",
    "uq_hr_holiday_list_date": "This date is already in the holiday list",
    "uq_hr_leave_types_code_ci": "A leave type with this code already exists",
    "uq_hr_leave_types_name_ci": "A leave type with this name already exists",
    "uq_hr_leave_alloc": "An allocation for this employee, leave type and year already exists",
    "uq_employees_nic_ci": "Another employee already has this NIC",
    "uq_employees_passport_ci": "Another employee already has this passport number",
    "uq_employees_epf_ci": "Another employee already has this EPF number",
    "uq_employees_etf_ci": "Another employee already has this ETF number",
    "employees_employee_id_key": "This employee ID is already in use",
    "employees_user_id_key": "This user already has an employee record",
}


def _flush(db: Session) -> None:
    """Flush; a unique-constraint violation that slipped past the pre-checks (a concurrent create)
    becomes a 400 with a clear message."""
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        text = str(getattr(exc, "orig", exc))
        for name, message in _UNIQUE_MESSAGES.items():
            if name in text:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)
        if "foreign key" in text.lower():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A referenced record does not exist")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="The record conflicts with existing data")


def _dup(db: Session, model, column, value: Optional[str], message: str, exclude_id: Optional[int] = None) -> None:
    """Pre-check for a case/space-insensitive duplicate (the unique index still guards races)."""
    v = (value or "").strip().lower()
    if not v:
        return
    q = db.query(model.id).filter(func.lower(func.btrim(column)) == v)
    if exclude_id:
        q = q.filter(model.id != exclude_id)
    if q.first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


def _get(db: Session, model, row_id: int, label: str, lock: bool = False):
    q = db.query(model).filter(model.id == row_id)
    if lock:
        q = q.with_for_update()
    row = q.first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")
    return row


def _stale(row, expected_version: Optional[str], label: str) -> None:
    ensure_not_stale(row.updated_at, None, label, expected_version=expected_version)


def _fields(data, exclude=()):
    return {k: v for k, v in data.model_dump().items() if k not in ("expected_version", *exclude)}


def _like(term: Optional[str]) -> Optional[str]:
    t = (term or "").strip()
    return None if not t else "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def _page(total: int, page: int, size: int) -> dict:
    return {"total": total, "page": page, "size": size, "pages": ceil(total / size) if size else 1}


def _full_name(user: Optional[User]) -> Optional[str]:
    if not user:
        return None
    return " ".join(p for p in (user.first_name, user.middle_name, user.last_name) if p) or user.username


def _live_employee_count(db: Session, column, value) -> int:
    return db.query(func.count(Employee.id)).filter(column == value, Employee.status.in_(LIVE_STATUSES)).scalar() or 0


# ═══════════════════════════ organisation masters ═══════════════════════════
class OrgService:
    def __init__(self, db: Session):
        self.db = db

    # ---- departments ----
    def _dept_out(self, d: m.HRDepartment, counts: dict, names: dict) -> dict:
        return {
            "id": d.id, "code": d.code, "name": d.name, "parent_id": d.parent_id, "parent_name": names.get(d.parent_id),
            "head_employee_id": d.head_employee_id, "head_name": names.get(("emp", d.head_employee_id)),
            "description": d.description, "active": d.active, "employee_count": counts.get(d.id, 0),
            "created_at": d.created_at, "updated_at": d.updated_at,
        }

    def list_departments(self, q: Optional[str] = None, active: Optional[bool] = None) -> List[dict]:
        query = self.db.query(m.HRDepartment)
        if active is not None:
            query = query.filter(m.HRDepartment.active == active)
        pat = _like(q)
        if pat:
            query = query.filter(or_(m.HRDepartment.name.ilike(pat, escape="\\"), m.HRDepartment.code.ilike(pat, escape="\\")))
        rows = query.order_by(func.lower(m.HRDepartment.name), m.HRDepartment.id).all()
        counts = dict(self.db.query(Employee.department_id, func.count(Employee.id))
                      .filter(Employee.department_id.isnot(None), Employee.status.in_(LIVE_STATUSES)).group_by(Employee.department_id).all())
        names = {r.id: r.name for r in self.db.query(m.HRDepartment.id, m.HRDepartment.name).all()}
        head_ids = [r.head_employee_id for r in rows if r.head_employee_id]
        if head_ids:
            for emp, user in self.db.query(Employee, User).join(User, User.id == Employee.user_id).filter(Employee.id.in_(head_ids)).all():
                names[("emp", emp.id)] = _full_name(user)
        return [self._dept_out(r, counts, names) for r in rows]

    def get_department(self, dept_id: int) -> dict:
        row = _get(self.db, m.HRDepartment, dept_id, "Department")
        return next(d for d in self.list_departments() if d["id"] == row.id)

    def _check_dept_refs(self, data: s.DepartmentIn, own_id: Optional[int] = None) -> None:
        if data.parent_id:
            if own_id and data.parent_id == own_id:
                raise HTTPException(status_code=400, detail="A department cannot be its own parent")
            parent = self.db.query(m.HRDepartment).filter(m.HRDepartment.id == data.parent_id).first()
            if not parent:
                raise HTTPException(status_code=404, detail="Parent department not found")
            node, hops = parent, 0
            while node is not None and own_id and hops < 50:
                if node.id == own_id:
                    raise HTTPException(status_code=400, detail="That parent would create a loop in the department tree")
                node = self.db.query(m.HRDepartment).filter(m.HRDepartment.id == node.parent_id).first() if node.parent_id else None
                hops += 1
        if data.head_employee_id and not self.db.query(Employee.id).filter(Employee.id == data.head_employee_id).first():
            raise HTTPException(status_code=404, detail="Department head employee not found")

    def _dept_dups(self, data: s.DepartmentIn, own_id: Optional[int] = None) -> None:
        _dup(self.db, m.HRDepartment, m.HRDepartment.code, data.code, "A department with this code already exists", own_id)
        _dup(self.db, m.HRDepartment, m.HRDepartment.name, data.name, "A department with this name already exists", own_id)

    def create_department(self, data: s.DepartmentIn, user_id: int) -> dict:
        self._check_dept_refs(data)
        self._dept_dups(data)
        row = m.HRDepartment(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_department", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return self.get_department(row.id)

    def update_department(self, dept_id: int, data: s.DepartmentUpdate, user_id: int) -> dict:
        row = _get(self.db, m.HRDepartment, dept_id, "Department", lock=True)
        _stale(row, data.expected_version, "Department")
        self._check_dept_refs(data, own_id=row.id)
        self._dept_dups(data, row.id)
        if row.active and not data.active:
            if _live_employee_count(self.db, Employee.department_id, row.id):
                raise HTTPException(status_code=400, detail="Move the department's employees elsewhere before deactivating it")
            if self.db.query(m.HRDepartment).filter(m.HRDepartment.parent_id == row.id, m.HRDepartment.active.is_(True)).first():
                raise HTTPException(status_code=400, detail="Deactivate or move its sub-departments first")
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_department", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return self.get_department(row.id)

    # ---- designations ----
    def list_designations(self, q: Optional[str] = None, active: Optional[bool] = None, department_id: Optional[int] = None) -> List[dict]:
        query = self.db.query(m.HRDesignation)
        if active is not None:
            query = query.filter(m.HRDesignation.active == active)
        if department_id:
            query = query.filter(or_(m.HRDesignation.department_id == department_id, m.HRDesignation.department_id.is_(None)))
        pat = _like(q)
        if pat:
            query = query.filter(m.HRDesignation.name.ilike(pat, escape="\\"))
        rows = query.order_by(func.lower(m.HRDesignation.name), m.HRDesignation.id).all()
        counts = dict(self.db.query(Employee.designation_id, func.count(Employee.id))
                      .filter(Employee.designation_id.isnot(None), Employee.status.in_(LIVE_STATUSES)).group_by(Employee.designation_id).all())
        dnames = {r.id: r.name for r in self.db.query(m.HRDepartment.id, m.HRDepartment.name).all()}
        return [{"id": r.id, "name": r.name, "department_id": r.department_id, "department_name": dnames.get(r.department_id),
                 "grade": r.grade, "description": r.description, "active": r.active, "employee_count": counts.get(r.id, 0),
                 "created_at": r.created_at, "updated_at": r.updated_at} for r in rows]

    def _check_designation_refs(self, data: s.DesignationIn) -> None:
        if data.department_id and not self.db.query(m.HRDepartment.id).filter(m.HRDepartment.id == data.department_id).first():
            raise HTTPException(status_code=404, detail="Department not found")

    def create_designation(self, data: s.DesignationIn, user_id: int) -> dict:
        self._check_designation_refs(data)
        _dup(self.db, m.HRDesignation, m.HRDesignation.name, data.name, "A designation with this name already exists")
        row = m.HRDesignation(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_designation", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_designations() if d["id"] == row.id)

    def update_designation(self, row_id: int, data: s.DesignationUpdate, user_id: int) -> dict:
        row = _get(self.db, m.HRDesignation, row_id, "Designation", lock=True)
        _stale(row, data.expected_version, "Designation")
        self._check_designation_refs(data)
        _dup(self.db, m.HRDesignation, m.HRDesignation.name, data.name, "A designation with this name already exists", row.id)
        if row.active and not data.active and _live_employee_count(self.db, Employee.designation_id, row.id):
            raise HTTPException(status_code=400, detail="Employees still hold this designation; change theirs before deactivating it")
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_designation", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_designations() if d["id"] == row.id)

    # ---- employment types ----
    def list_employment_types(self, active: Optional[bool] = None) -> List[dict]:
        query = self.db.query(m.HREmploymentType)
        if active is not None:
            query = query.filter(m.HREmploymentType.active == active)
        rows = query.order_by(m.HREmploymentType.id).all()
        counts = dict(self.db.query(Employee.employment_type_id, func.count(Employee.id))
                      .filter(Employee.employment_type_id.isnot(None), Employee.status.in_(LIVE_STATUSES)).group_by(Employee.employment_type_id).all())
        return [{**{c: getattr(r, c) for c in ("id", "name", "description", "default_probation_months", "has_end_date", "epf_etf_applicable", "active", "created_at", "updated_at")},
                 "employee_count": counts.get(r.id, 0)} for r in rows]

    def create_employment_type(self, data: s.EmploymentTypeIn, user_id: int) -> dict:
        _dup(self.db, m.HREmploymentType, m.HREmploymentType.name, data.name, "An employment type with this name already exists")
        row = m.HREmploymentType(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_employment_type", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_employment_types() if d["id"] == row.id)

    def update_employment_type(self, row_id: int, data: s.EmploymentTypeUpdate, user_id: int) -> dict:
        row = _get(self.db, m.HREmploymentType, row_id, "Employment type", lock=True)
        _stale(row, data.expected_version, "Employment type")
        _dup(self.db, m.HREmploymentType, m.HREmploymentType.name, data.name, "An employment type with this name already exists", row.id)
        if row.active and not data.active and _live_employee_count(self.db, Employee.employment_type_id, row.id):
            raise HTTPException(status_code=400, detail="Employees still have this employment type")
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_employment_type", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_employment_types() if d["id"] == row.id)


# ═══════════════════════════ time masters ═══════════════════════════
class TimeService:
    def __init__(self, db: Session):
        self.db = db

    # ---- shifts ----
    def list_shifts(self, active: Optional[bool] = None) -> List[dict]:
        query = self.db.query(m.HRShift)
        if active is not None:
            query = query.filter(m.HRShift.active == active)
        counts = dict(self.db.query(Employee.shift_id, func.count(Employee.id))
                      .filter(Employee.shift_id.isnot(None), Employee.status.in_(LIVE_STATUSES)).group_by(Employee.shift_id).all())
        return [{**{c: getattr(r, c) for c in ("id", "name", "start_time", "end_time", "grace_minutes", "break_minutes", "work_minutes",
                                               "half_day_minutes", "weekly_off_days", "is_default", "active", "created_at", "updated_at")},
                 "employee_count": counts.get(r.id, 0)} for r in query.order_by(m.HRShift.id).all()]

    def _apply_shift(self, row: m.HRShift, data: s.ShiftIn, user_id: int) -> None:
        if data.is_default and not data.active:
            raise HTTPException(status_code=400, detail="The default shift must be active")
        if data.is_default:
            self.db.query(m.HRShift).filter(m.HRShift.id != (row.id or 0), m.HRShift.is_default.is_(True)).update({"is_default": False})
            self.db.flush()
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id

    def create_shift(self, data: s.ShiftIn, user_id: int) -> dict:
        _dup(self.db, m.HRShift, m.HRShift.name, data.name, "A shift with this name already exists")
        row = m.HRShift(created_by=user_id)
        self._apply_shift(row, data, user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_shift", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_shifts() if d["id"] == row.id)

    def update_shift(self, row_id: int, data: s.ShiftUpdate, user_id: int) -> dict:
        row = _get(self.db, m.HRShift, row_id, "Shift", lock=True)
        _stale(row, data.expected_version, "Shift")
        _dup(self.db, m.HRShift, m.HRShift.name, data.name, "A shift with this name already exists", row.id)
        if row.is_default and not data.is_default:
            raise HTTPException(status_code=400, detail="Make another shift the default instead of unsetting this one")
        if row.active and not data.active and _live_employee_count(self.db, Employee.shift_id, row.id):
            raise HTTPException(status_code=400, detail="Employees are assigned to this shift")
        self._apply_shift(row, data, user_id)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_shift", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_shifts() if d["id"] == row.id)

    def default_shift(self) -> Optional[m.HRShift]:
        return self.db.query(m.HRShift).filter(m.HRShift.is_default.is_(True), m.HRShift.active.is_(True)).first()

    # ---- holiday lists ----
    def _list_out(self, r: m.HRHolidayList, hcounts: dict, ecounts: dict) -> dict:
        return {"id": r.id, "name": r.name, "year": r.year, "is_default": r.is_default, "active": r.active,
                "holiday_count": hcounts.get(r.id, 0), "employee_count": ecounts.get(r.id, 0),
                "created_at": r.created_at, "updated_at": r.updated_at}

    def list_holiday_lists(self, year: Optional[int] = None) -> List[dict]:
        query = self.db.query(m.HRHolidayList)
        if year:
            query = query.filter(m.HRHolidayList.year == year)
        hcounts = dict(self.db.query(m.HRHoliday.holiday_list_id, func.count(m.HRHoliday.id)).group_by(m.HRHoliday.holiday_list_id).all())
        ecounts = dict(self.db.query(Employee.holiday_list_id, func.count(Employee.id))
                       .filter(Employee.holiday_list_id.isnot(None), Employee.status.in_(LIVE_STATUSES)).group_by(Employee.holiday_list_id).all())
        return [self._list_out(r, hcounts, ecounts) for r in query.order_by(m.HRHolidayList.year.desc(), m.HRHolidayList.id).all()]

    def _apply_list(self, row: m.HRHolidayList, data: s.HolidayListIn, user_id: int) -> None:
        if data.is_default and not data.active:
            raise HTTPException(status_code=400, detail="The default holiday list must be active")
        if data.is_default:
            self.db.query(m.HRHolidayList).filter(m.HRHolidayList.id != (row.id or 0), m.HRHolidayList.year == data.year,
                                                  m.HRHolidayList.is_default.is_(True)).update({"is_default": False})
            self.db.flush()
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id

    def create_holiday_list(self, data: s.HolidayListIn, user_id: int) -> dict:
        _dup(self.db, m.HRHolidayList, m.HRHolidayList.name, data.name, "A holiday list with this name already exists")
        row = m.HRHolidayList(created_by=user_id)
        self._apply_list(row, data, user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_holiday_list", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_holiday_lists() if d["id"] == row.id)

    def update_holiday_list(self, row_id: int, data: s.HolidayListUpdate, user_id: int) -> dict:
        row = _get(self.db, m.HRHolidayList, row_id, "Holiday list", lock=True)
        _stale(row, data.expected_version, "Holiday list")
        _dup(self.db, m.HRHolidayList, m.HRHolidayList.name, data.name, "A holiday list with this name already exists", row.id)
        if data.year != row.year and self.db.query(m.HRHoliday).filter(m.HRHoliday.holiday_list_id == row.id).first():
            raise HTTPException(status_code=400, detail="The year of a list that already has holidays cannot be changed")
        if row.active and not data.active and _live_employee_count(self.db, Employee.holiday_list_id, row.id):
            raise HTTPException(status_code=400, detail="Employees are assigned to this holiday list")
        self._apply_list(row, data, user_id)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_holiday_list", entity_id=row.id, changes={"name": row.name})
        self.db.commit()
        return next(d for d in self.list_holiday_lists() if d["id"] == row.id)

    def list_holidays(self, list_id: int) -> List[m.HRHoliday]:
        _get(self.db, m.HRHolidayList, list_id, "Holiday list")
        return self.db.query(m.HRHoliday).filter(m.HRHoliday.holiday_list_id == list_id).order_by(m.HRHoliday.holiday_date).all()

    def add_holiday(self, list_id: int, data: s.HolidayIn, user_id: int) -> m.HRHoliday:
        hl = _get(self.db, m.HRHolidayList, list_id, "Holiday list", lock=True)
        if data.holiday_date.year != hl.year:
            raise HTTPException(status_code=400, detail=f"The date must be in {hl.year}, the year of this list")
        if self.db.query(m.HRHoliday.id).filter(m.HRHoliday.holiday_list_id == hl.id, m.HRHoliday.holiday_date == data.holiday_date).first():
            raise HTTPException(status_code=400, detail="This date is already in the holiday list")
        row = m.HRHoliday(holiday_list_id=hl.id, **data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_holiday", entity_id=row.id, changes={"date": str(row.holiday_date), "name": row.name})
        self.db.commit()
        return row

    def update_holiday(self, list_id: int, holiday_id: int, data: s.HolidayIn, user_id: int) -> m.HRHoliday:
        hl = _get(self.db, m.HRHolidayList, list_id, "Holiday list")
        row = self.db.query(m.HRHoliday).filter(m.HRHoliday.id == holiday_id, m.HRHoliday.holiday_list_id == list_id).with_for_update().first()
        if not row:
            raise HTTPException(status_code=404, detail="Holiday not found")
        if data.holiday_date.year != hl.year:
            raise HTTPException(status_code=400, detail=f"The date must be in {hl.year}, the year of this list")
        for k, v in data.model_dump().items():
            setattr(row, k, v)
        row.updated_by = user_id
        _flush(self.db)
        self.db.commit()
        return row

    def delete_holiday(self, list_id: int, holiday_id: int, user_id: int) -> None:
        row = self.db.query(m.HRHoliday).filter(m.HRHoliday.id == holiday_id, m.HRHoliday.holiday_list_id == list_id).first()
        if not row:
            raise HTTPException(status_code=404, detail="Holiday not found")
        log_audit(self.db, user_id=user_id, action="delete", entity_type="hr_holiday", entity_id=row.id, changes={"date": str(row.holiday_date), "name": row.name})
        self.db.delete(row)
        self.db.commit()

    def holiday_dates(self, list_id: Optional[int], start: date, end: date) -> set:
        if not list_id:
            default = self.db.query(m.HRHolidayList.id).filter(m.HRHolidayList.is_default.is_(True), m.HRHolidayList.year == start.year).first()
            list_id = default[0] if default else None
        if not list_id:
            return set()
        rows = self.db.query(m.HRHoliday.holiday_date).filter(m.HRHoliday.holiday_list_id == list_id,
                                                              m.HRHoliday.holiday_date.between(start, end)).all()
        return {r[0] for r in rows}

    def is_non_working(self, employee: Employee, day: date) -> Optional[str]:
        """'weekly_off' / 'holiday' when the employee does not work that day, else None."""
        shift = self.db.query(m.HRShift).filter(m.HRShift.id == employee.shift_id).first() if employee.shift_id else self.default_shift()
        offs = {int(d) for d in (shift.weekly_off_days if shift else "6").split(",") if d != ""}
        if day.weekday() in offs:
            return "weekly_off"
        if day in self.holiday_dates(employee.holiday_list_id, day, day):
            return "holiday"
        return None


# ═══════════════════════════════ leave ═══════════════════════════════
class LeavePolicyService:
    def __init__(self, db: Session):
        self.db = db
        self.time = TimeService(db)

    # ---- leave types ----
    def list_types(self, active: Optional[bool] = None) -> List[m.HRLeaveType]:
        q = self.db.query(m.HRLeaveType)
        if active is not None:
            q = q.filter(m.HRLeaveType.active == active)
        return q.order_by(m.HRLeaveType.id).all()

    def get_type_by_code(self, code: Optional[str]) -> Optional[m.HRLeaveType]:
        c = (code or "").strip().lower()
        return self.db.query(m.HRLeaveType).filter(func.lower(func.btrim(m.HRLeaveType.code)) == c).first() if c else None

    def create_type(self, data: s.LeaveTypeIn, user_id: int) -> m.HRLeaveType:
        _dup(self.db, m.HRLeaveType, m.HRLeaveType.code, data.code, "A leave type with this code already exists")
        _dup(self.db, m.HRLeaveType, m.HRLeaveType.name, data.name, "A leave type with this name already exists")
        row = m.HRLeaveType(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_leave_type", entity_id=row.id, changes={"code": row.code})
        self.db.commit()
        return row

    def update_type(self, row_id: int, data: s.LeaveTypeUpdate, user_id: int) -> m.HRLeaveType:
        row = _get(self.db, m.HRLeaveType, row_id, "Leave type", lock=True)
        _stale(row, data.expected_version, "Leave type")
        _dup(self.db, m.HRLeaveType, m.HRLeaveType.code, data.code, "A leave type with this code already exists", row.id)
        _dup(self.db, m.HRLeaveType, m.HRLeaveType.name, data.name, "A leave type with this name already exists", row.id)
        if data.code != row.code and self.db.query(Leaves.id).filter(func.lower(Leaves.leave_type) == row.code.lower()).first():
            raise HTTPException(status_code=400, detail="Leave has already been taken with this code; the code cannot change")
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_leave_type", entity_id=row.id, changes={"code": row.code})
        self.db.commit()
        return row

    # ---- usage ----
    def _usage(self, employee: Employee, leave_type: m.HRLeaveType, year: int) -> tuple:
        rows = self.db.query(Leaves.status, func.coalesce(func.sum(Leaves.leave_duration), 0)).filter(
            Leaves.employee_id == employee.employee_id,
            func.lower(Leaves.leave_type) == leave_type.code.lower(),
            Leaves.from_date >= date(year, 1, 1), Leaves.from_date <= date(year, 12, 31),
            Leaves.status.in_(("approved", "pending")),
        ).group_by(Leaves.status).all()
        used = sum(float(v) for st, v in rows if st == "approved")
        pending = sum(float(v) for st, v in rows if st == "pending")
        return used, pending

    def balances(self, employee: Employee, year: int) -> List[dict]:
        allocs = {a.leave_type_id: a for a in self.db.query(m.HRLeaveAllocation).filter(
            m.HRLeaveAllocation.employee_pk == employee.id, m.HRLeaveAllocation.year == year).all()}
        out = []
        today = tz.today()
        for lt in self.list_types():
            a = allocs.get(lt.id)
            if not a and not lt.active:
                continue
            if a:
                allocated = a.allocated
            else:
                # no explicit allocation yet: the leave type's yearly entitlement applies (pro-rated for new joiners)
                user = self.db.query(User).filter(User.id == employee.user_id).first()
                allocated = self._entitlement_for(employee, lt, year) if self._eligible(employee, user, lt, year) else 0.0
            carried = a.carried_forward if a else 0.0
            adj = a.adjustment if a else 0.0
            total = allocated + carried + adj
            used, pending = self._usage(employee, lt, year)
            accrued = None
            if lt.accrual == "monthly":
                months = 12 if year < today.year else (today.month if year == today.year else 0)
                accrued = round(allocated * months / 12 + carried + adj, 2)
            available = (accrued if accrued is not None else total)
            out.append({"leave_type_id": lt.id, "code": lt.code, "name": lt.name, "is_paid": lt.is_paid, "entitlement": allocated,
                        "carried_forward": carried, "adjustment": adj, "total": total, "used": used, "pending": pending,
                        "balance": round(available - used - pending, 2), "accrued_to_date": accrued})
        return out

    # ---- allocations ----
    def _alloc_out(self, a: m.HRLeaveAllocation, emp: Employee, user: Optional[User], lt: m.HRLeaveType) -> dict:
        used, pending = self._usage(emp, lt, a.year)
        total = a.allocated + a.carried_forward + a.adjustment
        return {"id": a.id, "employee_pk": a.employee_pk, "employee_id": emp.employee_id, "employee_name": _full_name(user),
                "leave_type_id": lt.id, "leave_type_code": lt.code, "leave_type_name": lt.name, "year": a.year,
                "allocated": a.allocated, "carried_forward": a.carried_forward, "adjustment": a.adjustment, "remarks": a.remarks,
                "total": total, "used": used, "pending": pending, "balance": round(total - used - pending, 2),
                "created_at": a.created_at, "updated_at": a.updated_at}

    def list_allocations(self, year: int, employee_pk: Optional[int] = None, leave_type_id: Optional[int] = None,
                         allowed_branches: Optional[List[str]] = None, page: int = 1, size: int = 50) -> dict:
        q = (self.db.query(m.HRLeaveAllocation, Employee, User, m.HRLeaveType)
             .join(Employee, Employee.id == m.HRLeaveAllocation.employee_pk).join(User, User.id == Employee.user_id)
             .join(m.HRLeaveType, m.HRLeaveType.id == m.HRLeaveAllocation.leave_type_id)
             .filter(m.HRLeaveAllocation.year == year))
        if employee_pk:
            q = q.filter(m.HRLeaveAllocation.employee_pk == employee_pk)
        if leave_type_id:
            q = q.filter(m.HRLeaveAllocation.leave_type_id == leave_type_id)
        if allowed_branches is not None:
            q = q.filter(or_(Employee.branch_code.in_(allowed_branches), Employee.branch_code.is_(None)))
        total = q.count()
        rows = q.order_by(func.lower(User.first_name), Employee.id, m.HRLeaveType.id).offset((page - 1) * size).limit(size).all()
        return {"items": [self._alloc_out(a, e, u, lt) for a, e, u, lt in rows], **_page(total, page, size)}

    def upsert_allocation(self, data: s.LeaveAllocationIn, user_id: int) -> dict:
        emp = _get(self.db, Employee, data.employee_pk, "Employee")
        lt = _get(self.db, m.HRLeaveType, data.leave_type_id, "Leave type")
        row = self.db.query(m.HRLeaveAllocation).filter(
            m.HRLeaveAllocation.employee_pk == emp.id, m.HRLeaveAllocation.leave_type_id == lt.id,
            m.HRLeaveAllocation.year == data.year).with_for_update().first()
        if row:
            raise HTTPException(status_code=400, detail="An allocation for this employee, leave type and year already exists; edit it instead")
        row = m.HRLeaveAllocation(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="create", entity_type="hr_leave_allocation", entity_id=row.id,
                  changes={"employee": emp.employee_id, "type": lt.code, "year": data.year, "allocated": data.allocated})
        self.db.commit()
        user = self.db.query(User).filter(User.id == emp.user_id).first()
        return self._alloc_out(row, emp, user, lt)

    def update_allocation(self, row_id: int, data: s.LeaveAllocationUpdate, user_id: int) -> dict:
        row = _get(self.db, m.HRLeaveAllocation, row_id, "Leave allocation", lock=True)
        _stale(row, data.expected_version, "Leave allocation")
        emp = _get(self.db, Employee, row.employee_pk, "Employee")
        lt = _get(self.db, m.HRLeaveType, row.leave_type_id, "Leave type")
        new_total = data.allocated + data.carried_forward + data.adjustment
        used, pending = self._usage(emp, lt, row.year)
        if new_total + 1e-9 < used and not lt.allow_negative_balance:
            raise HTTPException(status_code=400, detail=f"{used:g} day(s) are already used; the total cannot go below that")
        for k, v in _fields(data).items():
            setattr(row, k, v)
        row.updated_by = user_id
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="update", entity_type="hr_leave_allocation", entity_id=row.id,
                  changes={"allocated": data.allocated, "carried_forward": data.carried_forward, "adjustment": data.adjustment})
        self.db.commit()
        user = self.db.query(User).filter(User.id == emp.user_id).first()
        return self._alloc_out(row, emp, user, lt)

    def _eligible(self, emp: Employee, user: Optional[User], lt: m.HRLeaveType, year: int) -> bool:
        if lt.applicable_gender != "all" and ((user.gender if user else None) or "").lower() != lt.applicable_gender:
            return False
        return True

    def _entitlement_for(self, emp: Employee, lt: m.HRLeaveType, year: int) -> float:
        """Yearly entitlement, pro-rated by whole months for people who joined during the year;
        nothing before the minimum service has been served at the start of the year's end."""
        base = lt.annual_entitlement
        joined = emp.date_of_joining
        if joined and joined.year > year:
            return 0.0
        if lt.min_service_months and joined:
            eligible_from = _add_months(joined, lt.min_service_months)
            if eligible_from > date(year, 12, 31):
                return 0.0
        if joined and joined.year == year and base:
            months = 12 - joined.month + (1 if joined.day == 1 else 0)
            base = round(base * months / 12 * 2) / 2  # to the nearest half day
        return float(base)

    def generate(self, data: s.GenerateAllocationsIn, user_id: int, allowed_branches: Optional[List[str]] = None) -> dict:
        q = self.db.query(Employee, User).join(User, User.id == Employee.user_id).filter(Employee.status.in_(LIVE_STATUSES))
        if data.employee_pk:
            q = q.filter(Employee.id == data.employee_pk)
        if allowed_branches is not None:
            q = q.filter(or_(Employee.branch_code.in_(allowed_branches), Employee.branch_code.is_(None)))
        created = updated = skipped = 0
        types = self.list_types(active=True)
        for emp, user in q.all():
            for lt in types:
                if not lt.annual_entitlement or not self._eligible(emp, user, lt, data.year):
                    continue
                entitlement = self._entitlement_for(emp, lt, data.year)
                carried = 0.0
                if data.carry_forward and lt.carry_forward_max:
                    prev = self.db.query(m.HRLeaveAllocation).filter(
                        m.HRLeaveAllocation.employee_pk == emp.id, m.HRLeaveAllocation.leave_type_id == lt.id,
                        m.HRLeaveAllocation.year == data.year - 1).first()
                    if prev:
                        used, pending = self._usage(emp, lt, data.year - 1)
                        left = prev.allocated + prev.carried_forward + prev.adjustment - used - pending
                        carried = float(max(0.0, min(left, lt.carry_forward_max)))
                row = self.db.query(m.HRLeaveAllocation).filter(
                    m.HRLeaveAllocation.employee_pk == emp.id, m.HRLeaveAllocation.leave_type_id == lt.id,
                    m.HRLeaveAllocation.year == data.year).with_for_update().first()
                if row and not data.overwrite:
                    skipped += 1
                    continue
                if row:
                    row.allocated, row.carried_forward, row.updated_by = entitlement, carried, user_id
                    updated += 1
                else:
                    self.db.add(m.HRLeaveAllocation(employee_pk=emp.id, leave_type_id=lt.id, year=data.year, allocated=entitlement,
                                                    carried_forward=carried, adjustment=0, created_by=user_id, updated_by=user_id))
                    created += 1
        _flush(self.db)
        log_audit(self.db, user_id=user_id, action="generate", entity_type="hr_leave_allocation", entity_id=0,
                  changes={"year": data.year, "created": created, "updated": updated, "skipped": skipped})
        self.db.commit()
        return {"year": data.year, "created": created, "updated": updated, "skipped": skipped}

    # ---- applying for leave ----
    def count_days(self, emp: Employee, lt: m.HRLeaveType, start: date, end: date, half: bool) -> float:
        """Leave days between two dates, skipping weekly offs and holidays (unless the type counts them)."""
        if half:
            return 0.5
        if lt.count_holidays:
            return float((end - start).days + 1)
        days, d = 0, start
        holidays = self.time.holiday_dates(emp.holiday_list_id, start, end) if (end - start).days < 400 else set()
        shift = self.db.query(m.HRShift).filter(m.HRShift.id == emp.shift_id).first() if emp.shift_id else self.time.default_shift()
        offs = {int(x) for x in (shift.weekly_off_days if shift else "6").split(",") if x != ""}
        while d <= end:
            if d.weekday() not in offs and d not in holidays:
                days += 1
            d += timedelta(days=1)
        return float(days)

    def validate_application(self, emp: Employee, leave_type_code: str, start: date, end: date, duration: float,
                             leave_time: str, ignore_leave_id: Optional[int] = None) -> m.HRLeaveType:
        """All leave-policy checks for a new / changed application. Returns the leave type."""
        lt = self.get_type_by_code(leave_type_code)
        if not lt:
            raise HTTPException(status_code=400, detail=f"Unknown leave type '{leave_type_code}'")
        if not lt.active:
            raise HTTPException(status_code=400, detail=f"{lt.name} is not available")
        if emp.status not in LIVE_STATUSES:
            raise HTTPException(status_code=400, detail="This employee is no longer in service")
        user = self.db.query(User).filter(User.id == emp.user_id).first()
        if not self._eligible(emp, user, lt, start.year):
            raise HTTPException(status_code=400, detail=f"{lt.name} does not apply to this employee")
        if lt.min_service_months and emp.date_of_joining and _add_months(emp.date_of_joining, lt.min_service_months) > start:
            raise HTTPException(status_code=400, detail=f"{lt.name} needs {lt.min_service_months} month(s) of service")
        if start.year != end.year:
            raise HTTPException(status_code=400, detail="A leave application cannot span two calendar years; split it")
        half = is_half_day(leave_time)
        if half and not lt.allow_half_day:
            raise HTTPException(status_code=400, detail=f"{lt.name} cannot be taken as a half day")
        if half and start != end:
            raise HTTPException(status_code=400, detail="A half-day leave must be a single date")
        days = self.count_days(emp, lt, start, end, half)
        if days <= 0:
            raise HTTPException(status_code=400, detail="The selected dates are weekly offs or holidays; no leave is needed")
        if abs(duration - days) > 1e-6:
            raise HTTPException(status_code=400, detail=f"Leave days should be {days:g} for these dates (weekly offs and holidays excluded)")
        if lt.max_consecutive_days and days > lt.max_consecutive_days:
            raise HTTPException(status_code=400, detail=f"{lt.name} is limited to {lt.max_consecutive_days:g} consecutive day(s)")
        overlap = self.db.query(Leaves.id).filter(
            Leaves.employee_id == emp.employee_id, Leaves.status.in_(("approved", "pending")),
            Leaves.from_date <= end, Leaves.to_date >= start)
        if ignore_leave_id:
            overlap = overlap.filter(Leaves.id != ignore_leave_id)
        if overlap.first():
            raise HTTPException(status_code=400, detail="This employee already has leave in these dates")
        if lt.annual_entitlement or self.db.query(m.HRLeaveAllocation.id).filter(
                m.HRLeaveAllocation.employee_pk == emp.id, m.HRLeaveAllocation.leave_type_id == lt.id,
                m.HRLeaveAllocation.year == start.year).first():
            if not lt.allow_negative_balance:
                bal = next((b for b in self.balances(emp, start.year) if b["leave_type_id"] == lt.id), None)
                remaining = bal["balance"] if bal else 0.0
                if ignore_leave_id:
                    prior = self.db.query(Leaves).filter(Leaves.id == ignore_leave_id).first()
                    if prior and prior.status in ("approved", "pending") and (prior.leave_type or "").lower() == lt.code.lower() and prior.from_date.year == start.year:
                        remaining += float(prior.leave_duration or 0)
                if days > remaining + 1e-9:
                    raise HTTPException(status_code=400, detail=f"Not enough {lt.name} balance: {remaining:g} day(s) left, {days:g} requested")
        return lt


def is_half_day(leave_time: Optional[str]) -> bool:
    """'FULL DAY' / 'full_day' / 'Full Day' are full days; anything else (first half, morning ...) is a half day."""
    t = (leave_time or "full day").strip().lower().replace("_", " ")
    return t != "full day"


def _add_months(d: date, months: int) -> date:
    y, mth = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, mth + 1
    day = min(d.day, [31, 29 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date(year, month, day)


# ═══════════════════════════ employee master ═══════════════════════════
SENSITIVE_FIELDS = ("bank_name", "bank_branch", "bank_account_no", "bank_account_name", "epf_no", "etf_no", "tin_no", "nic", "passport_no")
USER_FIELDS = ("date_of_birth", "gender")  # live on the user account

ONBOARDING_TEMPLATE = [
    ("Collect signed appointment letter and contract", "HR"), ("Collect NIC, birth certificate and education certificates", "HR"),
    ("Collect bank details and EPF/ETF declaration", "HR / Payroll"), ("Create system user and assign role and branch", "IT"),
    ("Issue company email, phone and access cards", "IT"), ("Assign company assets (laptop, mobile, uniform)", "Admin"),
    ("Orientation and policy briefing", "HR"), ("Introduce to team and reporting manager", "Manager"),
]
OFFBOARDING_TEMPLATE = [
    ("Accept resignation / issue termination letter", "HR"), ("Knowledge transfer and handover of work", "Manager"),
    ("Return company assets", "Admin"), ("Disable system access and email", "IT"),
    ("Clear loans, advances and dues", "Finance"), ("Final settlement: unpaid salary, leave encashment, EPF/ETF forms", "Payroll"),
    ("Exit interview", "HR"), ("Issue service letter / relieving letter", "HR"),
]

_SUBRECORDS = {
    "emergency-contacts": (m.HREmergencyContact, s.EmergencyContactIn),
    "dependents": (m.HRDependent, s.DependentIn),
    "education": (m.HREducation, s.EducationIn),
    "experience": (m.HRExperience, s.ExperienceIn),
    "documents": (m.HRDocument, s.DocumentIn),
    "tasks": (m.HROnboardingTask, s.TaskIn),
}


def _private_root() -> Path:
    root = Path(settings.UPLOAD_DIR).resolve().parent / (Path(settings.UPLOAD_DIR).name + "_private")
    root.mkdir(parents=True, exist_ok=True)
    return root


def _doc_signature_ok(content_type: str, data: bytes) -> bool:
    if content_type == "application/pdf":
        return data.startswith(b"%PDF-")
    if content_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if content_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if content_type == "image/webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


_DOC_EXT = {"application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


class EmployeeService:
    def __init__(self, db: Session):
        self.db = db
        self.time = TimeService(db)

    # ---- access ----
    @staticmethod
    def _branch_ok(user: User, branch_code: Optional[str]) -> bool:
        if user.is_superuser or not branch_code:
            return True
        return branch_code in [b.branch_code for b in user.branches]

    def _get_employee(self, emp_id: int, actor: User, lock: bool = False) -> Employee:
        emp = _get(self.db, Employee, emp_id, "Employee", lock=lock)
        if not self._branch_ok(actor, emp.branch_code):
            raise HTTPException(status_code=403, detail=f"Access denied to branch: {emp.branch_code}")
        return emp

    # ---- reading ----
    def _list_query(self, actor_branches: Optional[List[str]], q=None, department_id=None, designation_id=None, branch_code=None,
                    status_=None, employment_type_id=None):
        query = (self.db.query(Employee, User).join(User, User.id == Employee.user_id))
        if actor_branches is not None:
            query = query.filter(or_(Employee.branch_code.in_(actor_branches), Employee.branch_code.is_(None)))
        if department_id:
            query = query.filter(Employee.department_id == department_id)
        if designation_id:
            query = query.filter(Employee.designation_id == designation_id)
        if employment_type_id:
            query = query.filter(Employee.employment_type_id == employment_type_id)
        if branch_code:
            query = query.filter(Employee.branch_code == branch_code)
        if status_ == "live":
            query = query.filter(Employee.status.in_(LIVE_STATUSES))
        elif status_:
            query = query.filter(Employee.status == status_)
        pat = _like(q)
        if pat:
            query = query.filter(or_(
                Employee.employee_id.ilike(pat, escape="\\"), User.first_name.ilike(pat, escape="\\"), User.last_name.ilike(pat, escape="\\"),
                User.username.ilike(pat, escape="\\"), User.email.ilike(pat, escape="\\"),
                func.concat(User.first_name, " ", User.last_name).ilike(pat, escape="\\"),
            ))
        return query

    _SORTS = {
        "employee_id": lambda: func.lower(Employee.employee_id), "name": lambda: func.lower(User.first_name),
        "status": lambda: Employee.status, "date_of_joining": lambda: Employee.date_of_joining, "department": lambda: Employee.department_id,
    }

    def _names(self):
        return (
            {r.id: r.name for r in self.db.query(m.HRDepartment.id, m.HRDepartment.name).all()},
            {r.id: r.name for r in self.db.query(m.HRDesignation.id, m.HRDesignation.name).all()},
            {r.id: r.name for r in self.db.query(m.HREmploymentType.id, m.HREmploymentType.name).all()},
        )

    def _item(self, emp: Employee, user: User, names, managers: dict) -> dict:
        d, g, t = names
        return {
            "id": emp.id, "user_id": emp.user_id, "employee_id": emp.employee_id, "full_name": _full_name(user), "username": user.username,
            "email": user.email, "phone": user.phone_number, "status": emp.status or "active",
            "department_id": emp.department_id, "department_name": d.get(emp.department_id),
            "designation_id": emp.designation_id, "designation_name": g.get(emp.designation_id),
            "employment_type_id": emp.employment_type_id, "employment_type_name": t.get(emp.employment_type_id),
            "branch_code": emp.branch_code, "date_of_joining": emp.date_of_joining,
            "reports_to_id": emp.reports_to_id, "reports_to_name": managers.get(emp.reports_to_id),
            "profile_picture_path": getattr(user, "profile_picture_path", None),
            "created_at": emp.created_at, "updated_at": emp.updated_at,
        }

    def _managers(self, emps) -> dict:
        ids = {e.reports_to_id for e in emps if e.reports_to_id}
        if not ids:
            return {}
        return {e.id: _full_name(u) for e, u in self.db.query(Employee, User).join(User, User.id == Employee.user_id).filter(Employee.id.in_(ids)).all()}

    def list_paged(self, actor_branches, page: int, size: int, sort_by: Optional[str], order: str, **filters) -> dict:
        query = self._list_query(actor_branches, **filters)
        total = query.count()
        key = self._SORTS.get(sort_by or "", self._SORTS["employee_id"])()
        query = query.order_by(key.desc() if order == "desc" else key.asc(), Employee.id) if sort_by else query.order_by(Employee.id.desc())
        rows = query.offset((page - 1) * size).limit(size).all()
        managers, names = self._managers([e for e, _ in rows]), self._names()
        return {"items": [self._item(e, u, names, managers) for e, u in rows], **_page(total, page, size)}

    def list_all(self, actor_branches, skip: int, limit: int) -> List[dict]:
        rows = self._list_query(actor_branches).order_by(func.lower(Employee.employee_id), Employee.id).offset(skip).limit(limit).all()
        managers, names = self._managers([e for e, _ in rows]), self._names()
        return [self._item(e, u, names, managers) for e, u in rows]

    def detail(self, emp_id: int, actor: User, can_see_sensitive: bool) -> dict:
        emp = self._get_employee(emp_id, actor)
        user = self.db.query(User).filter(User.id == emp.user_id).first()
        names = self._names()
        item = self._item(emp, user, names, self._managers([emp]))
        shift = self.db.query(m.HRShift.name).filter(m.HRShift.id == emp.shift_id).scalar() if emp.shift_id else None
        years = None
        if emp.date_of_joining:
            end = emp.last_working_date or tz.today()
            years = round(max((end - emp.date_of_joining).days, 0) / 365.25, 1)
        out = {**item, "shift_id": emp.shift_id, "shift_name": shift, "service_years": years,
               "date_of_birth": user.birthdate, "gender": user.gender, "sensitive_hidden": not can_see_sensitive,
               "version": emp.updated_at.isoformat() if emp.updated_at else None}
        for f in ("name_with_initials", "marital_status", "nationality", "religion", "blood_group", "personal_email", "mobile_phone",
                  "home_phone", "address_line1", "address_line2", "city", "district", "postal_code", "permanent_address", "grade",
                  "work_location", "holiday_list_id", "probation_end_date", "confirmation_date", "contract_end_date", "notice_period_days",
                  "retirement_date", "resignation_date", "last_working_date", "exit_type", "exit_reason"):
            out[f] = getattr(emp, f)
        if can_see_sensitive:
            for f in SENSITIVE_FIELDS:
                out[f] = getattr(emp, f)
        out["counts"] = {
            "emergency_contacts": self._count(m.HREmergencyContact, emp.id), "dependents": self._count(m.HRDependent, emp.id),
            "education": self._count(m.HREducation, emp.id), "experience": self._count(m.HRExperience, emp.id),
            "documents": self._count(m.HRDocument, emp.id),
            "tasks_open": self.db.query(func.count(m.HROnboardingTask.id)).filter(
                m.HROnboardingTask.employee_pk == emp.id, m.HROnboardingTask.status.in_(("pending", "in_progress"))).scalar() or 0,
        }
        return out

    def _count(self, model, emp_pk: int) -> int:
        return self.db.query(func.count(model.id)).filter(model.employee_pk == emp_pk).scalar() or 0

    # ---- validation of references ----
    def _check_refs(self, data: s.EmployeeProfileFields, actor: User, own: Optional[Employee] = None) -> None:
        for model, field, label in ((m.HRDepartment, "department_id", "Department"), (m.HRDesignation, "designation_id", "Designation"),
                                    (m.HREmploymentType, "employment_type_id", "Employment type"), (m.HRShift, "shift_id", "Shift"),
                                    (m.HRHolidayList, "holiday_list_id", "Holiday list")):
            value = getattr(data, field)
            if value:
                row = self.db.query(model).filter(model.id == value).first()
                if not row:
                    raise HTTPException(status_code=404, detail=f"{label} not found")
                if not row.active and (own is None or getattr(own, field) != value):
                    raise HTTPException(status_code=400, detail=f"{label} '{getattr(row, 'name', value)}' is inactive")
        if data.designation_id and data.department_id:
            des = self.db.query(m.HRDesignation).filter(m.HRDesignation.id == data.designation_id).first()
            if des and des.department_id and des.department_id != data.department_id:
                raise HTTPException(status_code=400, detail="That designation belongs to a different department")
        if data.branch_code:
            br = self.db.query(Branch).filter(Branch.branch_code == data.branch_code).first()
            if not br:
                raise HTTPException(status_code=404, detail=f"Branch '{data.branch_code}' not found")
            if not br.active and (own is None or own.branch_code != data.branch_code):
                raise HTTPException(status_code=400, detail=f"Branch '{data.branch_code}' is inactive")
            if not self._branch_ok(actor, data.branch_code):
                raise HTTPException(status_code=403, detail=f"Access denied to branch: {data.branch_code}")
        if data.reports_to_id:
            mgr = self.db.query(Employee).filter(Employee.id == data.reports_to_id).first()
            if not mgr:
                raise HTTPException(status_code=404, detail="Reporting manager not found")
            if own is not None:
                node, hops = mgr, 0
                while node is not None and hops < 30:
                    if node.id == own.id:
                        raise HTTPException(status_code=400, detail="That reporting line would loop back to this employee")
                    node = self.db.query(Employee).filter(Employee.id == node.reports_to_id).first() if node.reports_to_id else None
                    hops += 1

    def _derive(self, emp: Employee, user: User, creating: bool) -> None:
        """Defaults and cross-field rules, evaluated on what the employee will look like after the change."""
        if emp.employment_type_id:
            et = self.db.query(m.HREmploymentType).filter(m.HREmploymentType.id == emp.employment_type_id).first()
            if et and et.has_end_date and not emp.contract_end_date:
                raise HTTPException(status_code=400, detail=f"{et.name} employees need a contract end date")
            if et and et.default_probation_months and emp.date_of_joining and not emp.probation_end_date and not emp.confirmation_date:
                emp.probation_end_date = _add_months(emp.date_of_joining, et.default_probation_months)
        if not emp.retirement_date and user.birthdate:
            emp.retirement_date = _add_months(user.birthdate, 12 * 60)
        if creating and not emp.shift_id:
            default = self.time.default_shift()
            emp.shift_id = default.id if default else None

    def _status_for_new(self, emp: Employee) -> str:
        if emp.probation_end_date and emp.probation_end_date >= tz.today() and not emp.confirmation_date:
            return "probation"
        return "active"

    # ---- writes ----
    def create(self, data: s.EmployeeCreate, actor: User, can_edit_sensitive: bool) -> dict:
        user = self.db.query(User).filter(User.id == data.user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if self.db.query(Employee.id).filter(Employee.user_id == user.id).first():
            raise HTTPException(status_code=400, detail="This user already has an employee record")
        if self.db.query(Employee.id).filter(func.lower(func.btrim(Employee.employee_id)) == data.employee_id.lower()).first():
            raise HTTPException(status_code=400, detail="This employee ID is already in use")
        self._check_refs(data, actor)
        self._employee_dups(data)
        self._guard_sensitive(data, None, can_edit_sensitive)
        emp = Employee(user_id=user.id, employee_id=data.employee_id, created_by=actor.id, updated_by=actor.id)
        self._assign(emp, data, user)
        emp.date_of_joining = emp.date_of_joining or tz.today()
        self._derive(emp, user, creating=True)
        emp.status = self._status_for_new(emp)
        self.db.add(emp)
        _flush(self.db)
        self._seed_tasks(emp, "onboarding", actor.id)
        log_audit(self.db, user_id=actor.id, action="create", entity_type="employee", entity_id=emp.id, changes={"employee_id": emp.employee_id})
        self.db.commit()
        return self.detail(emp.id, actor, can_edit_sensitive)

    def _assign(self, emp: Employee, data: s.EmployeeProfileFields, user: User, only_set: bool = False) -> None:
        """Copy the submitted fields onto the employee. On update only the fields the client actually
        sent are touched (omitting a field leaves it as it is; sending null clears it)."""
        values = data.model_dump(exclude_unset=True) if only_set else data.model_dump()
        for k, v in values.items():
            if k in ("expected_version",):
                continue
            if k == "date_of_birth":
                user.birthdate = v
            elif k == "gender":
                user.gender = v
            else:
                setattr(emp, k, v)

    def _employee_dups(self, data: s.EmployeeProfileFields, own_id: Optional[int] = None) -> None:
        for col, value, label in ((Employee.nic, data.nic, "NIC"), (Employee.passport_no, data.passport_no, "passport number"),
                                  (Employee.epf_no, data.epf_no, "EPF number"), (Employee.etf_no, data.etf_no, "ETF number")):
            _dup(self.db, Employee, col, value, f"Another employee already has this {label}", own_id)

    def _guard_sensitive(self, data: s.EmployeeProfileFields, emp: Optional[Employee], allowed: bool) -> None:
        if allowed:
            return
        for f in SENSITIVE_FIELDS:
            if emp is not None and f not in data.model_fields_set:
                continue
            new = getattr(data, f)
            old = getattr(emp, f) if emp is not None else None
            if (new or None) != (old or None):
                raise HTTPException(status_code=403, detail="You are not allowed to change bank, statutory or ID details")

    def update(self, emp_id: int, data: s.EmployeeUpdate, actor: User, can_edit_sensitive: bool) -> dict:
        emp = self._get_employee(emp_id, actor, lock=True)
        _stale(emp, data.expected_version, "Employee")
        user = self.db.query(User).filter(User.id == emp.user_id).first()
        if emp.status in ("resigned", "terminated", "retired"):
            raise HTTPException(status_code=400, detail="This employee has left; reinstate them before editing")
        self._check_refs(data, actor, own=emp)
        self._employee_dups(data, emp.id)
        self._guard_sensitive(data, emp, can_edit_sensitive)
        before = {k: getattr(emp, k) for k in ("department_id", "designation_id", "branch_code", "employment_type_id", "reports_to_id")}
        self._assign(emp, data, user, only_set=True)
        emp.date_of_joining = emp.date_of_joining or tz.today()
        self._derive(emp, user, creating=False)
        emp.updated_by = actor.id
        _flush(self.db)
        after = {k: getattr(emp, k) for k in before}
        log_audit(self.db, user_id=actor.id, action="update", entity_type="employee", entity_id=emp.id,
                  changes={k: [before[k], after[k]] for k in before if before[k] != after[k]} or {"profile": "updated"})
        self.db.commit()
        return self.detail(emp.id, actor, can_edit_sensitive)

    def confirm(self, emp_id: int, actor: User, confirmation_date: Optional[date], can_sensitive: bool) -> dict:
        emp = self._get_employee(emp_id, actor, lock=True)
        if emp.status != "probation":
            raise HTTPException(status_code=400, detail="Only an employee on probation can be confirmed")
        emp.confirmation_date = confirmation_date or tz.today()
        if emp.date_of_joining and emp.confirmation_date < emp.date_of_joining:
            raise HTTPException(status_code=400, detail="Confirmation date cannot be before the date of joining")
        emp.status = "active"
        emp.updated_by = actor.id
        log_audit(self.db, user_id=actor.id, action="confirm", entity_type="employee", entity_id=emp.id, changes={"confirmation_date": str(emp.confirmation_date)})
        self.db.commit()
        return self.detail(emp.id, actor, can_sensitive)

    def separate(self, emp_id: int, data: s.EmployeeSeparation, actor: User, can_sensitive: bool) -> dict:
        emp = self._get_employee(emp_id, actor, lock=True)
        _stale(emp, data.expected_version, "Employee")
        if emp.status in ("resigned", "terminated", "retired", "inactive"):
            raise HTTPException(status_code=400, detail=f"This employee is already '{emp.status}'")
        if emp.date_of_joining and data.last_working_date < emp.date_of_joining:
            raise HTTPException(status_code=400, detail="Last working date cannot be before the date of joining")
        status_map = {"resignation": "resigned", "termination": "terminated", "retirement": "retired",
                      "end_of_contract": "terminated", "death": "inactive", "other": "inactive"}
        today = tz.today()
        # a future last working day = serving notice; the status flips once it passes (or now if already past)
        emp.status = "notice_period" if data.last_working_date > today and data.exit_type in ("resignation", "retirement") else status_map[data.exit_type]
        emp.exit_type, emp.exit_reason = data.exit_type, data.exit_reason
        emp.resignation_date = data.resignation_date or (today if data.exit_type == "resignation" else None)
        emp.last_working_date = data.last_working_date
        emp.updated_by = actor.id
        if data.deactivate_user and data.last_working_date <= today:
            user = self.db.query(User).filter(User.id == emp.user_id).first()
            if user and not user.is_superuser:
                user.is_active = False
        self._seed_tasks(emp, "offboarding", actor.id)
        log_audit(self.db, user_id=actor.id, action="separate", entity_type="employee", entity_id=emp.id,
                  changes={"exit_type": data.exit_type, "last_working_date": str(data.last_working_date)})
        self.db.commit()
        return self.detail(emp.id, actor, can_sensitive)

    def reinstate(self, emp_id: int, actor: User, can_sensitive: bool) -> dict:
        emp = self._get_employee(emp_id, actor, lock=True)
        if emp.status not in ("resigned", "terminated", "retired", "inactive", "notice_period"):
            raise HTTPException(status_code=400, detail="This employee is already in service")
        emp.status = "active"
        emp.exit_type = emp.exit_reason = emp.resignation_date = emp.last_working_date = None
        emp.updated_by = actor.id
        log_audit(self.db, user_id=actor.id, action="reinstate", entity_type="employee", entity_id=emp.id, changes={})
        self.db.commit()
        return self.detail(emp.id, actor, can_sensitive)

    # ---- onboarding / offboarding checklists ----
    def _seed_tasks(self, emp: Employee, category: str, user_id: int) -> int:
        if self.db.query(m.HROnboardingTask.id).filter(m.HROnboardingTask.employee_pk == emp.id, m.HROnboardingTask.category == category).first():
            return 0
        template = ONBOARDING_TEMPLATE if category == "onboarding" else OFFBOARDING_TEMPLATE
        anchor = (emp.date_of_joining if category == "onboarding" else emp.last_working_date) or tz.today()
        for i, (title, who) in enumerate(template):
            due = anchor + timedelta(days=7) if category == "onboarding" else anchor
            self.db.add(m.HROnboardingTask(employee_pk=emp.id, category=category, title=title, responsible=who, due_date=due,
                                           status="pending", sort_order=i, created_by=user_id, updated_by=user_id))
        self.db.flush()
        return len(template)

    def apply_template(self, emp_id: int, category: str, actor: User) -> int:
        emp = self._get_employee(emp_id, actor, lock=True)
        n = self._seed_tasks(emp, category, actor.id)
        if not n:
            raise HTTPException(status_code=400, detail=f"This employee already has {category} tasks")
        self.db.commit()
        return n

    # ---- sub-records (generic) ----
    def _sub(self, kind: str):
        if kind not in _SUBRECORDS:
            raise HTTPException(status_code=404, detail="Unknown record type")
        return _SUBRECORDS[kind]

    def sub_list(self, emp_id: int, kind: str, actor: User) -> list:
        model, _ = self._sub(kind)
        self._get_employee(emp_id, actor)
        q = self.db.query(model).filter(model.employee_pk == emp_id)
        if kind == "tasks":
            q = q.order_by(model.category, model.sort_order, model.id)
        elif kind == "documents":
            q = q.order_by(model.expiry_date.asc().nulls_last(), model.id)
        else:
            q = q.order_by(model.id)
        rows = q.all()
        return [self._decorate(kind, r) for r in rows]

    @staticmethod
    def _decorate(kind: str, row):
        if kind == "documents":
            today = tz.today()
            row.expired = bool(row.expiry_date and row.expiry_date < today)
            row.expires_in_days = (row.expiry_date - today).days if row.expiry_date else None
        return row

    def sub_create(self, emp_id: int, kind: str, data, actor: User):
        model, _ = self._sub(kind)
        emp = self._get_employee(emp_id, actor, lock=True)
        if emp.status in ("resigned", "terminated", "retired") and kind not in ("tasks", "documents"):
            raise HTTPException(status_code=400, detail="This employee has left; reinstate them first")
        if kind == "emergency-contacts" and data.is_primary:
            self.db.query(m.HREmergencyContact).filter(m.HREmergencyContact.employee_pk == emp.id).update({"is_primary": False})
        row = model(employee_pk=emp.id, **data.model_dump(), created_by=actor.id, updated_by=actor.id)
        if kind == "tasks" and data.status == "done":
            row.completed_date, row.completed_by = tz.today(), actor.id
        self.db.add(row)
        _flush(self.db)
        log_audit(self.db, user_id=actor.id, action="create", entity_type=f"employee_{kind}", entity_id=row.id, changes={"employee": emp.employee_id})
        self.db.commit()
        return self._decorate(kind, row)

    def _sub_row(self, emp_id: int, kind: str, row_id: int, actor: User, lock=True):
        model, _ = self._sub(kind)
        self._get_employee(emp_id, actor)
        q = self.db.query(model).filter(model.id == row_id, model.employee_pk == emp_id)
        row = (q.with_for_update() if lock else q).first()
        if not row:
            raise HTTPException(status_code=404, detail="Record not found")
        return row

    def sub_update(self, emp_id: int, kind: str, row_id: int, data, actor: User):
        row = self._sub_row(emp_id, kind, row_id, actor)
        if kind == "emergency-contacts" and data.is_primary:
            self.db.query(m.HREmergencyContact).filter(m.HREmergencyContact.employee_pk == emp_id, m.HREmergencyContact.id != row.id).update({"is_primary": False})
        for k, v in data.model_dump().items():
            setattr(row, k, v)
        if kind == "tasks":
            self._task_completion(row, data.status, actor)
        row.updated_by = actor.id
        _flush(self.db)
        log_audit(self.db, user_id=actor.id, action="update", entity_type=f"employee_{kind}", entity_id=row.id, changes={})
        self.db.commit()
        return self._decorate(kind, row)

    @staticmethod
    def _task_completion(row, status_: str, actor: User) -> None:
        if status_ == "done" and not row.completed_date:
            row.completed_date, row.completed_by = tz.today(), actor.id
        elif status_ != "done":
            row.completed_date = row.completed_by = None

    def task_status(self, emp_id: int, task_id: int, status_: str, actor: User):
        row = self._sub_row(emp_id, "tasks", task_id, actor)
        row.status = status_
        self._task_completion(row, status_, actor)
        row.updated_by = actor.id
        self.db.commit()
        return row

    def sub_delete(self, emp_id: int, kind: str, row_id: int, actor: User) -> None:
        row = self._sub_row(emp_id, kind, row_id, actor)
        path = getattr(row, "file_path", None)
        log_audit(self.db, user_id=actor.id, action="delete", entity_type=f"employee_{kind}", entity_id=row.id, changes={})
        self.db.delete(row)
        self.db.commit()
        if path:
            try:
                (_private_root() / path).unlink(missing_ok=True)
            except OSError:
                pass

    # ---- document files (private storage) ----
    def attach_file(self, emp_id: int, doc_id: int, file: UploadFile, actor: User) -> m.HRDocument:
        row = self._sub_row(emp_id, "documents", doc_id, actor)
        ctype = file.content_type or ""
        if ctype not in _DOC_EXT:
            raise HTTPException(status_code=400, detail="Only PDF, PNG, JPEG or WEBP files are accepted")
        data = file.file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")
        if len(data) > settings.MAX_UPLOAD_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"File too large. Maximum size is {settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)} MB")
        if not _doc_signature_ok(ctype, data):
            raise HTTPException(status_code=400, detail="The file content does not match its declared type")
        rel = f"hr_documents/{uuid.uuid4().hex}{_DOC_EXT[ctype]}"
        dest = _private_root() / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)
        old = row.file_path
        row.file_path = rel
        safe = "".join(ch for ch in (file.filename or "document") if ch.isalnum() or ch in "._- ")[:120] or "document"
        row.file_name = safe
        row.updated_by = actor.id
        self.db.commit()
        if old:
            try:
                (_private_root() / old).unlink(missing_ok=True)
            except OSError:
                pass
        return self._decorate("documents", row)

    def document_file(self, emp_id: int, doc_id: int, actor: User) -> tuple:
        row = self._sub_row(emp_id, "documents", doc_id, actor, lock=False)
        if not row.file_path:
            raise HTTPException(status_code=404, detail="No file attached")
        path = (_private_root() / row.file_path).resolve()
        if _private_root().resolve() not in path.parents or not path.is_file():
            raise HTTPException(status_code=404, detail="File not found")
        return path, row.file_name or path.name
