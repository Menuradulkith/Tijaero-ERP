"""Service layer for Attendance and Leaves."""
from __future__ import annotations

import calendar
from datetime import date, datetime, time
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import timezone as tz
from app.modules.common.approval_service import (
    ApprovalType,
    approval_service,
)
from app.modules.employees.models import Employee
from app.modules.hr.scope import employee_names

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


def _run_batches(db: Session, start: date, end: date) -> list:
    """Payroll batches (not cancelled) of the months between two dates, oldest first."""
    from app.modules.hr.models import PayrollBatch

    months, d = [], date(start.year, start.month, 1)
    while d <= end:
        months.append(d.year * 100 + d.month)
        d = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    rows = db.query(PayrollBatch).filter(PayrollBatch.status != "cancelled",
                                         (PayrollBatch.payroll_year * 100 + PayrollBatch.payroll_month).in_(months)).all()
    return sorted(rows, key=lambda b: (b.payroll_year, b.payroll_month))


def _payroll_open(db: Session, day: date) -> None:
    """Attendance feeds overtime and late cuts: once a month's payroll has been run, its days are read-only."""
    batch = next(iter(_run_batches(db, day, day)), None)
    if batch:
        raise HTTPException(status_code=400, detail=f"Payroll {batch.batch_no} has already been run for {day.year}-{day.month:02d}; "
                                                    "attendance for that month can no longer change (cancel the batch first)")


def _unpaid(db: Session, leave_type: Optional[str]) -> bool:
    from app.modules.hr_core.models import HRLeaveType

    lt = db.query(HRLeaveType).filter(func.lower(HRLeaveType.code) == (leave_type or "").lower()).first()
    return lt is not None and not lt.is_paid

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


def _to_attendance_response(db: Session, att: Attendance, name: Optional[str] = None) -> schemas.Attendance:
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
        "employee_name": name if name is not None else _resolve_employee_name(db, att.employee_id),
        "branch_name": att.branch_code,
        "status": _attendance_status(att),
    }
    return schemas.Attendance(**payload)


def _to_leave_response(db: Session, lv: Leaves, name: Optional[str] = None) -> schemas.Leave:
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
        employee_name=name if name is not None else _resolve_employee_name(db, lv.employee_id),
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

    @staticmethod
    def _in_service(emp: Employee, day: date) -> None:
        from app.modules.hr_core.service import in_service

        if not in_service(emp):
            raise HTTPException(status_code=400, detail="This employee is no longer in service")
        if emp.last_working_date and day > emp.last_working_date:
            raise HTTPException(status_code=400, detail=f"The employee's last working day was {emp.last_working_date}")

    def _shift_params(self, employee: Optional[Employee]) -> dict:
        """Working hours of the employee's shift (default shift, then the built-in 9-5 as a last resort)."""
        from app.modules.hr_core.models import HRShift

        shift = None
        if employee is not None and employee.shift_id:
            shift = self.db.query(HRShift).filter(HRShift.id == employee.shift_id).first()
        if shift is None:
            shift = self.db.query(HRShift).filter(HRShift.is_default.is_(True), HRShift.active.is_(True)).first()
        if shift is None:
            return {"start": self.SCHEDULED_START, "end": self.SCHEDULED_END, "grace": self.LATE_GRACE_MINUTES, "work": self.WORK_DAY_MINUTES,
                    "break": 60, "half": 240}
        return {"start": shift.start_time, "end": shift.end_time, "grace": shift.grace_minutes, "work": shift.work_minutes,
                "break": shift.break_minutes or 0, "half": shift.half_day_minutes or 0}

    def _calc_minutes(self, check_in: Optional[time], check_out: Optional[time], employee: Optional[Employee] = None,
                      day: Optional[date] = None) -> dict:
        """Worked time is net of the shift break (taken on anything longer than a half day). Overtime is work beyond
        the shift's normal day; on a weekly off or holiday every worked minute is overtime and nobody is late or early."""
        sh = self._shift_params(employee)
        result = {"work_mins": 0, "late_mins": 0, "early_mins": 0, "ot_mins": 0, "full_attended_mins": 0}
        off_day = False
        if employee is not None and day is not None:
            from app.modules.hr_core.service import TimeService
            off_day = TimeService(self.db).is_non_working(employee, day) is not None
        if check_in and check_out:
            ci_mins = check_in.hour * 60 + check_in.minute
            co_mins = check_out.hour * 60 + check_out.minute
            if co_mins > ci_mins:
                span = co_mins - ci_mins
                worked = span - sh["break"] if span > max(sh["half"], sh["break"]) else span
                result["work_mins"] = worked
                result["full_attended_mins"] = span
                shift_span = (sh["end"].hour * 60 + sh["end"].minute) - (sh["start"].hour * 60 + sh["start"].minute)
                normal = min(sh["work"], max(0, shift_span - sh["break"])) or sh["work"]
                if off_day:
                    result["ot_mins"] = worked
                elif worked > normal:
                    result["ot_mins"] = worked - normal
        if off_day:
            return result
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
        self._in_service(emp, data.date or tz.today())
        self._branch_ok(data.branch_code)
        _need_branch(actor, data.branch_code)
        _need_branch(actor, emp.branch_code)   # the employee's own branch too, not just the one on the record
        _lock(self.db, f"att-{data.employee_id}-{data.date or tz.today()}")
        _payroll_open(self.db, data.date or tz.today())
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
            metrics = self._calc_minutes(check_in, existing.check_out, emp, day)
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
            **self._calc_minutes(check_in, None, emp, day),
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
        _payroll_open(self.db, day)
        if att.check_in and check_out <= att.check_in:
            raise HTTPException(status_code=400, detail="Check-out must be after check-in")
        if not att.check_in:
            raise HTTPException(status_code=400, detail="Cannot check out without checking in")
        metrics = self._calc_minutes(att.check_in, check_out, emp, day)
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
        self._in_service(emp, data.date)
        if emp.date_of_joining and data.date < emp.date_of_joining:
            raise HTTPException(status_code=400, detail="The date is before the employee joined")
        self._branch_ok(data.branch_code)
        _need_branch(actor, data.branch_code)
        _need_branch(actor, emp.branch_code)
        _lock(self.db, f"att-{data.employee_id}-{data.date}")
        _payroll_open(self.db, data.date)
        existing = attendance_repo.get_by_employee_date(self.db, data.employee_id, data.date)
        if existing:
            raise HTTPException(status_code=400, detail="Attendance already recorded for this date")
        payload = {
            "employee_id": data.employee_id, "branch_code": data.branch_code, "date": data.date,
            "weekday": calendar.day_name[data.date.weekday()], "check_in": data.check_in, "check_out": data.check_out,
            "leave_mins": data.leave_mins, "absent_mins": data.absent_mins,
            **self._calc_minutes(data.check_in, data.check_out, emp, data.date),
        }
        att = attendance_repo.create(self.db, **payload)
        return _to_attendance_response(self.db, att)

    def update(self, attendance_id: int, data: schemas.AttendanceUpdate, actor: Optional[User] = None) -> schemas.Attendance:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        _need_branch(actor, att.branch_code)
        _payroll_open(self.db, att.date)
        update_data = data.model_dump(exclude_unset=True)
        for k in ("leave_mins", "absent_mins"):
            if k in update_data and update_data[k] is None:
                update_data[k] = 0
        # If check_in/check_out changed, recalc metrics
        if "check_in" in update_data or "check_out" in update_data:
            ci = update_data.get("check_in", att.check_in)
            co = update_data.get("check_out", att.check_out)
            if co and ci and co <= ci:
                raise HTTPException(status_code=400, detail="Check-out must be after check-in")
            if co and not ci:
                raise HTTPException(status_code=400, detail="Check-out needs a check-in")
            metrics = self._calc_minutes(ci, co, att.employee, att.date)
            update_data.update(metrics)
        # set directly: an explicit null clears the time (the repository's update skips None values)
        for k, v in update_data.items():
            setattr(att, k, v)
        self.db.commit()
        self.db.refresh(att)
        return _to_attendance_response(self.db, att)

    def delete(self, attendance_id: int, actor: Optional[User] = None) -> None:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        _need_branch(actor, att.branch_code)
        _payroll_open(self.db, att.date)
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
        names = employee_names(self.db, [r.employee_id for r in rows])   # one query, not two per row
        return [_to_attendance_response(self.db, r, names.get(r.employee_id, r.employee_id)) for r in rows]

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
        from sqlalchemy import case, func

        leave = func.coalesce(Attendance.leave_mins, 0)

        def count_if(cond):
            return func.coalesce(func.sum(case((cond, 1), else_=0)), 0)

        # One aggregate query instead of loading every row of the period into Python.
        total_records, total_present, total_absent, total_late, total_leave, total_work_mins, total_ot_mins = attendance_repo.filtered(
            self.db.query(
                func.count(Attendance.id),
                count_if(Attendance.check_in.isnot(None) & (leave == 0)),
                count_if(Attendance.check_in.is_(None) & (leave == 0)),
                count_if(func.coalesce(Attendance.late_mins, 0) > 0),
                count_if(leave > 0),
                func.coalesce(func.sum(Attendance.work_mins), 0),
                func.coalesce(func.sum(Attendance.ot_mins), 0),
            ),
            employee_id=employee_id,
            branch_code=branch_code,
            date_from=date_from,
            date_to=date_to,
            allowed_branches=_branches_of(actor),
        ).one()
        return schemas.AttendanceSummary(
            period_from=date_from,
            period_to=date_to,
            total_records=total_records,
            total_present=total_present,
            total_absent=total_absent,
            total_late=total_late,
            total_leave=total_leave,
            total_work_hours=round(float(total_work_mins) / 60.0, 2),
            total_ot_hours=round(float(total_ot_mins) / 60.0, 2),
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
        self._nopay_open(lt.code, data.from_date, data.to_date)

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
        self._nopay_open(lt.code, merged["from_date"], merged["to_date"])
        update_data["leave_type"] = lt.code
        leave_repo.update(self.db, leave, **update_data)
        return _to_leave_response(self.db, leave)

    def _nopay_open(self, leave_type: Optional[str], start: date, end: date) -> None:
        """No-pay leave is deducted by the payroll run, so a month that has already been run cannot take more."""
        if not _unpaid(self.db, leave_type):
            return
        batch = next(iter(_run_batches(self.db, start, end)), None)
        if batch:
            raise HTTPException(status_code=400, detail=f"Payroll {batch.batch_no} has already been run for {batch.payroll_year}-{batch.payroll_month:02d}, "
                                                        "so this no-pay leave would never be deducted; cancel the batch first or record a salary deduction")

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
        names = employee_names(self.db, [lv.employee_id for lv in leaves])
        return [_to_leave_response(self.db, lv, names.get(lv.employee_id, lv.employee_id)) for lv in leaves]

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
        self._nopay_open(leave.leave_type, leave.from_date, leave.to_date)
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

    def cancel(self, leave_id: int, data: schemas.LeaveReject, actor: User) -> schemas.Leave:
        """Cancel approved leave (plans changed, or entered wrongly): the days go back to the balance.
        No-pay leave in a month whose payroll has been run cannot be cancelled any more."""
        from app.modules.attendance.models import Leaves
        leave = self.db.query(Leaves).filter(Leaves.id == leave_id).with_for_update().first()
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        self._scope_leave(leave, actor)
        if leave.status != "approved":
            raise HTTPException(status_code=400, detail="Only approved leave can be cancelled; pending leave can be rejected or deleted")
        if _unpaid(self.db, leave.leave_type):
            for batch in _run_batches(self.db, leave.from_date, leave.to_date):
                if leave.approved_date and batch.created_at and leave.approved_date > batch.created_at:
                    continue   # approved after that run, so it was never deducted: cancelling it is fine
                raise HTTPException(status_code=400, detail=f"Payroll {batch.batch_no} for {batch.payroll_year}-{batch.payroll_month:02d} "
                                                            "already deducted this no-pay leave")
        leave.status = "cancelled"
        leave.rejection_reason = f"Cancelled: {data.rejection_reason}"
        from app.common.audit import log_audit
        log_audit(self.db, user_id=actor.id, action="cancel", entity_type="leave", entity_id=leave.id,
                  changes={"reason": data.rejection_reason})
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
        if leave.approval_id and leave.status == "pending":
            # close its approval request too, so it does not stay in the approvers' queue
            from app.modules.common.approval_service import ApprovalStatus
            from app.modules.common.models import Approvals
            approval = self.db.query(Approvals).filter(Approvals.id == leave.approval_id).with_for_update().first()
            if approval and approval.status == ApprovalStatus.PENDING:
                approval.status = ApprovalStatus.CANCELLED
                approval.status_changed_by = actor.id if actor else None
                approval.remark = "Leave request deleted"
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
