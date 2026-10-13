"""Service layer for Attendance and Leaves."""
from __future__ import annotations

import calendar
from datetime import date, datetime, time
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import timezone as tz
from app.modules.common.approval_service import (
    ApprovalType,
    approval_service,
)
from app.modules.employees.models import Employee

LIVE = ("active", "probation", "notice_period")


def _need_branch(actor: Optional[User], branch_code: Optional[str]) -> None:
    """Branch scope: a non-superuser only touches their own branches (no actor = internal call)."""
    if actor is None or actor.is_superuser or not branch_code:
        return
    if branch_code not in [b.branch_code for b in actor.branches]:
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")


def _lock(db: Session, key: str) -> None:
    """Serialise concurrent writes for the same employee/day (released at transaction end)."""
    from sqlalchemy import text

    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": key})


def _branches_of(actor: Optional[User]) -> Optional[List[str]]:
    if actor is None or actor.is_superuser:
        return None
    return [b.branch_code for b in actor.branches]

from . import schemas
from .models import Attendance, Leaves
from .repository import attendance_repo, leave_repo


# ─── helpers ───────────────────────────────────────────────────────────────────
def _resolve_employee_name(db: Session, employee_id: str) -> Optional[str]:
    emp = db.query(Employee).filter(Employee.employee_id == employee_id).first()
    if emp and emp.user:
        return f"{emp.user.first_name} {emp.user.last_name}".strip()
    return employee_id


def _attendance_status(att: Attendance) -> str:
    if att.leave_mins and att.leave_mins > 0:
        return "leave"
    if not att.check_in:
        return "absent"
    if att.late_mins and att.late_mins > 0:
        return "late"
    return "present"   # checked in (still working or finished the day)


def _to_attendance_response(db: Session, att: Attendance) -> schemas.Attendance:
    payload = {
        "id": att.id,
        "employee_id": att.employee_id,
        "branch_code": att.branch_code,
        "date": att.date,
        "weekday": att.weekday,
        "check_in": att.check_in,
        "check_out": att.check_out,
        "work_mins": att.work_mins,
        "ot_mins": att.ot_mins,
        "full_attended_mins": att.full_attended_mins,
        "late_mins": att.late_mins,
        "early_mins": att.early_mins,
        "absent_mins": att.absent_mins,
        "leave_mins": att.leave_mins,
        "employee_name": _resolve_employee_name(db, att.employee_id),
        "branch_name": att.branch_code,
        "status": _attendance_status(att),
    }
    return schemas.Attendance(**payload)


def _to_leave_response(db: Session, lv: Leaves) -> schemas.Leave:
    return schemas.Leave(
        id=lv.id,
        employee_id=lv.employee_id,
        leave_type=lv.leave_type or "other",
        from_date=lv.from_date,
        to_date=lv.to_date,
        leave_reason=lv.leave_reason,
        leave_duration=lv.leave_duration,
        leave_time=lv.leave_time or "FULL DAY",
        approval_id=lv.approval_id,
        status=lv.status or "pending",
        approved_by=lv.approved_by,
        approved_date=lv.approved_date,
        rejection_reason=lv.rejection_reason,
        employee_name=_resolve_employee_name(db, lv.employee_id),
        created_at=lv.created_at,
    )


# ─── Attendance Service ────────────────────────────────────────────────────────
class AttendanceService:
    """Daily attendance: mark, check-in/out, list, summarize."""

    WORK_DAY_MINUTES = 480  # 8 hours
    LATE_GRACE_MINUTES = 10
    SCHEDULED_START = time(9, 0)
    SCHEDULED_END = time(17, 0)

    def __init__(self, db: Session):
        self.db = db

    # ---- creation -----------------------------------------------------------
    def _ensure_employee(self, employee_id: str) -> Employee:
        emp = self.db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not emp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Employee {employee_id} not found",
            )
        return emp

    def _shift_params(self, employee: Optional[Employee]) -> dict:
        """Working hours of the employee's shift (default shift, then the built-in 9-5 as a last resort)."""
        from app.modules.hr_core.models import HRShift

        shift = None
        if employee is not None and employee.shift_id:
            shift = self.db.query(HRShift).filter(HRShift.id == employee.shift_id).first()
        if shift is None:
            shift = self.db.query(HRShift).filter(HRShift.is_default.is_(True), HRShift.active.is_(True)).first()
        if shift is None:
            return {"start": self.SCHEDULED_START, "end": self.SCHEDULED_END, "grace": self.LATE_GRACE_MINUTES, "work": self.WORK_DAY_MINUTES}
        return {"start": shift.start_time, "end": shift.end_time, "grace": shift.grace_minutes, "work": shift.work_minutes}

    def _calc_minutes(self, check_in: Optional[time], check_out: Optional[time], employee: Optional[Employee] = None) -> dict:
        sh = self._shift_params(employee)
        result = {"work_mins": 0, "late_mins": 0, "early_mins": 0, "ot_mins": 0, "full_attended_mins": 0}
        if check_in and check_out:
            ci_mins = check_in.hour * 60 + check_in.minute
            co_mins = check_out.hour * 60 + check_out.minute
            if co_mins > ci_mins:
                worked = co_mins - ci_mins
                result["work_mins"] = worked
                result["full_attended_mins"] = worked
                if worked > sh["work"]:
                    result["ot_mins"] = worked - sh["work"]
        if check_in:
            sched_start = sh["start"].hour * 60 + sh["start"].minute
            ci_mins = check_in.hour * 60 + check_in.minute
            if ci_mins > sched_start + sh["grace"]:
                result["late_mins"] = ci_mins - sched_start
        if check_out:
            sched_end = sh["end"].hour * 60 + sh["end"].minute
            co_mins = check_out.hour * 60 + check_out.minute
            if co_mins < sched_end:
                result["early_mins"] = sched_end - co_mins
        return result

    def check_in(self, data: schemas.AttendanceCheckIn, user_id: int, actor: Optional[User] = None) -> schemas.Attendance:
        emp = self._ensure_employee(data.employee_id)
        if emp.status not in ("active", "probation", "notice_period"):
            raise HTTPException(status_code=400, detail="This employee is no longer in service")
        self._branch_ok(data.branch_code)
        _need_branch(actor, data.branch_code)
        _lock(self.db, f"att-{data.employee_id}-{data.date or tz.today()}")
        if data.check_in and (data.date or tz.today()) == tz.today():
            import datetime as _dt
            if _dt.datetime.combine(tz.today(), data.check_in) > tz.now() + _dt.timedelta(minutes=5):
                raise HTTPException(status_code=400, detail="Check-in time is in the future")
        day = data.date or tz.today()
        check_in = data.check_in or tz.now().time()
        existing = attendance_repo.get_by_employee_date(self.db, data.employee_id, day)
        if existing:
            if existing.check_in:
                raise HTTPException(status_code=400, detail="Already checked in for today")
            metrics = self._calc_minutes(check_in, existing.check_out, emp)
            updated = attendance_repo.update(self.db, existing, check_in=check_in, **metrics)
            return _to_attendance_response(self.db, updated)
        weekday = calendar.day_name[day.weekday()]
        att = attendance_repo.create(
            self.db,
            employee_id=data.employee_id,
            branch_code=data.branch_code,
            date=day,
            weekday=weekday,
            check_in=check_in,
            **self._calc_minutes(check_in, None, emp),
        )
        return _to_attendance_response(self.db, att)

    def check_out(self, data: schemas.AttendanceCheckOut, user_id: int, actor: Optional[User] = None) -> schemas.Attendance:
        emp = self._ensure_employee(data.employee_id)
        day = data.date or tz.today()
        check_out = data.check_out or tz.now().time()
        att = attendance_repo.get_by_employee_date(self.db, data.employee_id, day)
        if not att:
            raise HTTPException(status_code=404, detail="No check-in found for today")
        _need_branch(actor, att.branch_code)
        if att.check_in and check_out <= att.check_in:
            raise HTTPException(status_code=400, detail="Check-out must be after check-in")
        if not att.check_in:
            raise HTTPException(status_code=400, detail="Cannot check out without checking in")
        metrics = self._calc_minutes(att.check_in, check_out, emp)
        updated = attendance_repo.update(self.db, att, check_out=check_out, **metrics)
        return _to_attendance_response(self.db, updated)

    def _branch_ok(self, branch_code: str) -> None:
        from app.auth.models import Branch

        br = self.db.query(Branch).filter(Branch.branch_code == branch_code).first()
        if not br:
            raise HTTPException(status_code=404, detail=f"Branch '{branch_code}' not found")
        if not br.active:
            raise HTTPException(status_code=400, detail=f"Branch '{branch_code}' is inactive")

    def create(self, data: schemas.AttendanceCreate, actor: Optional[User] = None) -> schemas.Attendance:
        emp = self._ensure_employee(data.employee_id)
        if (emp.status or "active") not in LIVE:
            raise HTTPException(status_code=400, detail="This employee is no longer in service")
        if emp.date_of_joining and data.date < emp.date_of_joining:
            raise HTTPException(status_code=400, detail="The date is before the employee joined")
        self._branch_ok(data.branch_code)
        _need_branch(actor, data.branch_code)
        _lock(self.db, f"att-{data.employee_id}-{data.date}")
        existing = attendance_repo.get_by_employee_date(self.db, data.employee_id, data.date)
        if existing:
            raise HTTPException(status_code=400, detail="Attendance already recorded for this date")
        payload = {
            "employee_id": data.employee_id, "branch_code": data.branch_code, "date": data.date,
            "weekday": calendar.day_name[data.date.weekday()], "check_in": data.check_in, "check_out": data.check_out,
            "leave_mins": data.leave_mins, "absent_mins": data.absent_mins,
            **self._calc_minutes(data.check_in, data.check_out, emp),
        }
        att = attendance_repo.create(self.db, **payload)
        return _to_attendance_response(self.db, att)

    def update(self, attendance_id: int, data: schemas.AttendanceUpdate, actor: Optional[User] = None) -> schemas.Attendance:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        _need_branch(actor, att.branch_code)
        update_data = data.model_dump(exclude_unset=True)
        # If check_in/check_out changed, recalc metrics
        if "check_in" in update_data or "check_out" in update_data:
            ci = update_data.get("check_in", att.check_in)
            co = update_data.get("check_out", att.check_out)
            if co and ci and co <= ci:
                raise HTTPException(status_code=400, detail="Check-out must be after check-in")
            if co and not ci:
                raise HTTPException(status_code=400, detail="Check-out needs a check-in")
            metrics = self._calc_minutes(ci, co, att.employee)
            update_data.update(metrics)
        updated = attendance_repo.update(self.db, att, **update_data)
        return _to_attendance_response(self.db, updated)

    def delete(self, attendance_id: int, actor: Optional[User] = None) -> None:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        _need_branch(actor, att.branch_code)
        attendance_repo.delete(self.db, att)

    def get(self, attendance_id: int, actor: Optional[User] = None) -> schemas.Attendance:
        att = attendance_repo.get(self.db, attendance_id)
        if att:
            _need_branch(actor, att.branch_code)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        return _to_attendance_response(self.db, att)

    def list(self, filters: schemas.AttendanceFilter, actor: Optional[User] = None) -> List[schemas.Attendance]:
        if filters.branch_code:
            _need_branch(actor, filters.branch_code)
        rows = attendance_repo.list(
            self.db,
            employee_id=filters.employee_id,
            branch_code=filters.branch_code,
            date_from=filters.date_from,
            date_to=filters.date_to,
            skip=filters.skip,
            limit=filters.limit,
            allowed_branches=_branches_of(actor),
        )
        return [_to_attendance_response(self.db, r) for r in rows]

    def summary(
        self,
        date_from: date,
        date_to: date,
        employee_id: Optional[str] = None,
        branch_code: Optional[str] = None,
        actor: Optional[User] = None,
    ) -> schemas.AttendanceSummary:
        if date_to < date_from or (date_to - date_from).days > 400:
            raise HTTPException(status_code=400, detail="Choose a period of at most 400 days, ending after it starts")
        if branch_code:
            _need_branch(actor, branch_code)
        rows = attendance_repo.list(
            self.db,
            employee_id=employee_id,
            branch_code=branch_code,
            date_from=date_from,
            date_to=date_to,
            skip=0,
            limit=100000,
            allowed_branches=_branches_of(actor),
        )
        total_present = sum(1 for r in rows if r.check_in and not (r.leave_mins or 0))
        total_absent = sum(1 for r in rows if not r.check_in and not (r.leave_mins or 0))
        total_late = sum(1 for r in rows if (r.late_mins or 0) > 0)
        total_leave = sum(1 for r in rows if (r.leave_mins or 0) > 0)
        total_work_mins = sum((r.work_mins or 0) for r in rows)
        total_ot_mins = sum((r.ot_mins or 0) for r in rows)
        return schemas.AttendanceSummary(
            period_from=date_from,
            period_to=date_to,
            total_records=len(rows),
            total_present=total_present,
            total_absent=total_absent,
            total_late=total_late,
            total_leave=total_leave,
            total_work_hours=round(total_work_mins / 60.0, 2),
            total_ot_hours=round(total_ot_mins / 60.0, 2),
        )


# ─── Leaves Service ────────────────────────────────────────────────────────────
class LeaveService:
    DEFAULT_ANNUAL = 14
    DEFAULT_CASUAL = 7
    DEFAULT_MEDICAL = 7

    def __init__(self, db: Session):
        self.db = db

    def _ensure_employee(self, employee_id: str) -> Employee:
        emp = self.db.query(Employee).filter(Employee.employee_id == employee_id).first()
        if not emp:
            raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")
        return emp

    def create(self, data: schemas.LeaveCreate, user_id: int, actor: Optional[User] = None) -> schemas.Leave:
        from app.modules.hr_core.service import LeavePolicyService

        emp = self._ensure_employee(data.employee_id)
        _need_branch(actor, emp.branch_code)
        _lock(self.db, f"leave-{data.employee_id}")
        if data.to_date < data.from_date:
            raise HTTPException(status_code=400, detail="to_date must be on or after from_date")
        # leave type, balance, overlap, half-day, working-day count ... (see LeavePolicyService)
        lt = LeavePolicyService(self.db).validate_application(emp, data.leave_type, data.from_date, data.to_date, data.leave_duration, data.leave_time)

        leave = leave_repo.create(
            self.db,
            employee_id=data.employee_id,
            leave_type=lt.code,
            from_date=data.from_date,
            to_date=data.to_date,
            leave_reason=data.leave_reason,
            leave_duration=data.leave_duration,
            leave_time=data.leave_time,
            status="pending",
            created_by=user_id,
            created_at=tz.now(),
        )
        # Open approval request
        approval = approval_service.create_approval_request(
            db=self.db,
            approval_type=ApprovalType.LEAVE,
            reference_id=leave.id,
            reference_no=f"LV-{leave.id}",
            branch_code="HQ",  # leave is not branch-bound
            requested_by=user_id,
            remarks=f"Leave request: {data.leave_type} ({data.leave_duration}d)",
        )
        leave.approval_id = approval.id
        self.db.commit()
        self.db.refresh(leave)
        return _to_leave_response(self.db, leave)

    def update(self, leave_id: int, data: schemas.LeaveUpdate, actor: Optional[User] = None) -> schemas.Leave:
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        self._scope_leave(leave, actor)
        if leave.status not in ("pending", "draft", None):
            raise HTTPException(status_code=400, detail="Cannot edit a processed leave request")
        update_data = data.model_dump(exclude_unset=True)
        from app.modules.hr_core.service import LeavePolicyService

        merged = {
            "leave_type": update_data.get("leave_type", leave.leave_type), "from_date": update_data.get("from_date", leave.from_date),
            "to_date": update_data.get("to_date", leave.to_date), "leave_duration": update_data.get("leave_duration", leave.leave_duration),
            "leave_time": update_data.get("leave_time", leave.leave_time),
        }
        if merged["to_date"] < merged["from_date"]:
            raise HTTPException(status_code=400, detail="to_date must be on or after from_date")
        emp = self._ensure_employee(leave.employee_id)
        _lock(self.db, f"leave-{leave.employee_id}")
        lt = LeavePolicyService(self.db).validate_application(
            emp, merged["leave_type"], merged["from_date"], merged["to_date"], float(merged["leave_duration"]), merged["leave_time"], ignore_leave_id=leave.id)
        update_data["leave_type"] = lt.code
        leave_repo.update(self.db, leave, **update_data)
        return _to_leave_response(self.db, leave)

    def _scope_leave(self, leave: Leaves, actor: Optional[User]) -> None:
        emp = self.db.query(Employee).filter(Employee.employee_id == leave.employee_id).first()
        _need_branch(actor, emp.branch_code if emp else None)

    def get(self, leave_id: int, actor: Optional[User] = None) -> schemas.Leave:
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        self._scope_leave(leave, actor)
        return _to_leave_response(self.db, leave)

    def list(self, filters: schemas.LeaveFilter, actor: Optional[User] = None) -> List[schemas.Leave]:
        leaves = leave_repo.list(
            self.db,
            employee_id=filters.employee_id,
            leave_type=filters.leave_type,
            date_from=filters.date_from,
            date_to=filters.date_to,
            skip=filters.skip,
            limit=filters.limit,
            status=filters.status,
            allowed_branches=_branches_of(actor),
        )
        return [_to_leave_response(self.db, lv) for lv in leaves]

    def approve(self, leave_id: int, data: schemas.LeaveApprove, approver_id: int, actor: Optional[User] = None) -> schemas.Leave:
        # Lock row to prevent concurrent approve/reject race
        from app.modules.attendance.models import Leaves
        self.db.query(Leaves).filter(Leaves.id == leave_id).with_for_update().first()
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        self._scope_leave(leave, actor)
        if leave.status != "pending":
            raise HTTPException(status_code=400, detail="Only pending leave can be approved")
        applicant = self.db.query(Employee).filter(Employee.employee_id == leave.employee_id).first()
        approver = self.db.query(User).filter(User.id == approver_id).first()
        if applicant and applicant.user_id == approver_id and not (approver and approver.is_superuser):
            raise HTTPException(status_code=400, detail="You cannot approve your own leave request")
        if leave.approval_id:
            approval_service.approve(
                db=self.db,
                approval_id=leave.approval_id,
                approved_by=approver_id,
                remarks=data.remarks,
            )
        leave.status = "approved"
        leave.approved_by = approver_id
        leave.approved_date = tz.now()
        self.db.commit()
        self.db.refresh(leave)
        return _to_leave_response(self.db, leave)

    def reject(self, leave_id: int, data: schemas.LeaveReject, approver_id: int, actor: Optional[User] = None) -> schemas.Leave:
        # Lock row to prevent concurrent approve/reject race
        from app.modules.attendance.models import Leaves
        self.db.query(Leaves).filter(Leaves.id == leave_id).with_for_update().first()
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        self._scope_leave(leave, actor)
        if leave.status != "pending":
            raise HTTPException(status_code=400, detail="Only pending leave can be rejected")
        if leave.approval_id:
            approval_service.reject(
                db=self.db,
                approval_id=leave.approval_id,
                rejected_by=approver_id,
                remarks=data.rejection_reason,
            )
        leave.status = "rejected"
        leave.approved_by = approver_id
        leave.approved_date = tz.now()
        leave.rejection_reason = data.rejection_reason
        self.db.commit()
        self.db.refresh(leave)
        return _to_leave_response(self.db, leave)

    def delete(self, leave_id: int, actor: Optional[User] = None) -> None:
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        self._scope_leave(leave, actor)
        if leave.status == "approved":
            raise HTTPException(status_code=400, detail="Cannot delete an approved leave")
        leave_repo.delete(self.db, leave)

    def balance(self, employee_id: str, year: Optional[int] = None) -> schemas.LeaveBalance:
        from app.modules.hr_core.service import LeavePolicyService

        emp = self._ensure_employee(employee_id)
        target_year = year or tz.today().year
        rows = {b["code"]: b for b in LeavePolicyService(self.db).balances(emp, target_year)}

        def pick(code: str, default_total: int):
            b = rows.get(code)
            if not b:
                return default_total, 0.0, float(default_total)
            return b["total"], b["used"], max(0.0, b["balance"])

        a_t, a_u, a_r = pick("annual", self.DEFAULT_ANNUAL)
        c_t, c_u, c_r = pick("casual", self.DEFAULT_CASUAL)
        m_t, m_u, m_r = pick("medical", self.DEFAULT_MEDICAL)
        return schemas.LeaveBalance(
            employee_id=employee_id,
            employee_name=_resolve_employee_name(self.db, employee_id),
            annual_total=a_t, annual_used=a_u, annual_remaining=a_r,
            casual_total=c_t, casual_used=c_u, casual_remaining=c_r,
            medical_total=m_t, medical_used=m_u, medical_remaining=m_r,
            year=target_year,
            types=list(rows.values()),
        )
