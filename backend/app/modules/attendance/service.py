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
    if att.work_mins and att.work_mins > 0:
        return "present"
    return "absent"


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

    def _calc_minutes(self, check_in: Optional[time], check_out: Optional[time]) -> dict:
        result = {"work_mins": 0, "late_mins": 0, "early_mins": 0, "ot_mins": 0, "full_attended_mins": 0}
        if check_in and check_out:
            ci_mins = check_in.hour * 60 + check_in.minute
            co_mins = check_out.hour * 60 + check_out.minute
            if co_mins > ci_mins:
                worked = co_mins - ci_mins
                result["work_mins"] = worked
                result["full_attended_mins"] = worked
                if worked > self.WORK_DAY_MINUTES:
                    result["ot_mins"] = worked - self.WORK_DAY_MINUTES
        if check_in:
            sched_start = self.SCHEDULED_START.hour * 60 + self.SCHEDULED_START.minute
            ci_mins = check_in.hour * 60 + check_in.minute
            if ci_mins > sched_start + self.LATE_GRACE_MINUTES:
                result["late_mins"] = ci_mins - sched_start
        if check_out:
            sched_end = self.SCHEDULED_END.hour * 60 + self.SCHEDULED_END.minute
            co_mins = check_out.hour * 60 + check_out.minute
            if co_mins < sched_end:
                result["early_mins"] = sched_end - co_mins
        return result

    def check_in(self, data: schemas.AttendanceCheckIn, user_id: int) -> schemas.Attendance:
        self._ensure_employee(data.employee_id)
        day = data.date or tz.today()
        check_in = data.check_in or tz.now().time()
        existing = attendance_repo.get_by_employee_date(self.db, data.employee_id, day)
        if existing:
            if existing.check_in:
                raise HTTPException(status_code=400, detail="Already checked in for today")
            metrics = self._calc_minutes(check_in, existing.check_out)
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
            **self._calc_minutes(check_in, None),
        )
        return _to_attendance_response(self.db, att)

    def check_out(self, data: schemas.AttendanceCheckOut, user_id: int) -> schemas.Attendance:
        day = data.date or tz.today()
        check_out = data.check_out or tz.now().time()
        att = attendance_repo.get_by_employee_date(self.db, data.employee_id, day)
        if not att:
            raise HTTPException(status_code=404, detail="No check-in found for today")
        if not att.check_in:
            raise HTTPException(status_code=400, detail="Cannot check out without checking in")
        metrics = self._calc_minutes(att.check_in, check_out)
        updated = attendance_repo.update(self.db, att, check_out=check_out, **metrics)
        return _to_attendance_response(self.db, updated)

    def create(self, data: schemas.AttendanceCreate) -> schemas.Attendance:
        self._ensure_employee(data.employee_id)
        existing = attendance_repo.get_by_employee_date(self.db, data.employee_id, data.date)
        if existing:
            raise HTTPException(status_code=400, detail="Attendance already recorded for this date")
        weekday = data.weekday or calendar.day_name[data.date.weekday()]
        payload = data.model_dump()
        payload["weekday"] = weekday
        att = attendance_repo.create(self.db, **payload)
        return _to_attendance_response(self.db, att)

    def update(self, attendance_id: int, data: schemas.AttendanceUpdate) -> schemas.Attendance:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        update_data = data.model_dump(exclude_unset=True)
        # If check_in/check_out changed, recalc metrics
        if "check_in" in update_data or "check_out" in update_data:
            ci = update_data.get("check_in", att.check_in)
            co = update_data.get("check_out", att.check_out)
            metrics = self._calc_minutes(ci, co)
            update_data.update(metrics)
        updated = attendance_repo.update(self.db, att, **update_data)
        return _to_attendance_response(self.db, updated)

    def delete(self, attendance_id: int) -> None:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        attendance_repo.delete(self.db, att)

    def get(self, attendance_id: int) -> schemas.Attendance:
        att = attendance_repo.get(self.db, attendance_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attendance not found")
        return _to_attendance_response(self.db, att)

    def list(self, filters: schemas.AttendanceFilter) -> List[schemas.Attendance]:
        rows = attendance_repo.list(
            self.db,
            employee_id=filters.employee_id,
            branch_code=filters.branch_code,
            date_from=filters.date_from,
            date_to=filters.date_to,
            skip=filters.skip,
            limit=filters.limit,
        )
        return [_to_attendance_response(self.db, r) for r in rows]

    def summary(
        self,
        date_from: date,
        date_to: date,
        employee_id: Optional[str] = None,
        branch_code: Optional[str] = None,
    ) -> schemas.AttendanceSummary:
        rows = attendance_repo.list(
            self.db,
            employee_id=employee_id,
            branch_code=branch_code,
            date_from=date_from,
            date_to=date_to,
            skip=0,
            limit=10000,
        )
        total_present = sum(1 for r in rows if (r.work_mins or 0) > 0 and not (r.leave_mins or 0))
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

    def create(self, data: schemas.LeaveCreate, user_id: int) -> schemas.Leave:
        self._ensure_employee(data.employee_id)
        if data.to_date < data.from_date:
            raise HTTPException(status_code=400, detail="to_date must be on or after from_date")

        leave = leave_repo.create(
            self.db,
            employee_id=data.employee_id,
            leave_type=data.leave_type,
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

    def update(self, leave_id: int, data: schemas.LeaveUpdate) -> schemas.Leave:
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        if leave.status not in ("pending", "draft", None):
            raise HTTPException(status_code=400, detail="Cannot edit a processed leave request")
        update_data = data.model_dump(exclude_unset=True)
        leave_repo.update(self.db, leave, **update_data)
        return _to_leave_response(self.db, leave)

    def get(self, leave_id: int) -> schemas.Leave:
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        return _to_leave_response(self.db, leave)

    def list(self, filters: schemas.LeaveFilter) -> List[schemas.Leave]:
        leaves = leave_repo.list(
            self.db,
            employee_id=filters.employee_id,
            leave_type=filters.leave_type,
            date_from=filters.date_from,
            date_to=filters.date_to,
            skip=filters.skip,
            limit=filters.limit,
        )
        if filters.status:
            leaves = [lv for lv in leaves if (lv.status or "pending") == filters.status]
        return [_to_leave_response(self.db, lv) for lv in leaves]

    def approve(self, leave_id: int, data: schemas.LeaveApprove, approver_id: int) -> schemas.Leave:
        # Lock row to prevent concurrent approve/reject race
        from app.modules.attendance.models import Leaves
        self.db.query(Leaves).filter(Leaves.id == leave_id).with_for_update().first()
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        if leave.status != "pending":
            raise HTTPException(status_code=400, detail="Only pending leave can be approved")
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

    def reject(self, leave_id: int, data: schemas.LeaveReject, approver_id: int) -> schemas.Leave:
        # Lock row to prevent concurrent approve/reject race
        from app.modules.attendance.models import Leaves
        self.db.query(Leaves).filter(Leaves.id == leave_id).with_for_update().first()
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
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

    def delete(self, leave_id: int) -> None:
        leave = leave_repo.get(self.db, leave_id)
        if not leave:
            raise HTTPException(status_code=404, detail="Leave not found")
        if leave.status == "approved":
            raise HTTPException(status_code=400, detail="Cannot delete an approved leave")
        leave_repo.delete(self.db, leave)

    def balance(self, employee_id: str, year: Optional[int] = None) -> schemas.LeaveBalance:
        self._ensure_employee(employee_id)
        target_year = year or tz.today().year
        leaves = leave_repo.list_by_employee_year(self.db, employee_id, target_year)
        # Only counted leaves: approved
        used = {"annual": 0.0, "casual": 0.0, "medical": 0.0, "unpaid": 0.0, "other": 0.0}
        for lv in leaves:
            if (lv.status or "pending") != "approved":
                continue
            t = (lv.leave_type or "other").lower()
            if t not in used:
                t = "other"
            used[t] += float(lv.leave_duration or 0)
        return schemas.LeaveBalance(
            employee_id=employee_id,
            employee_name=_resolve_employee_name(self.db, employee_id),
            annual_total=self.DEFAULT_ANNUAL,
            annual_used=used["annual"],
            annual_remaining=max(0, self.DEFAULT_ANNUAL - used["annual"]),
            casual_total=self.DEFAULT_CASUAL,
            casual_used=used["casual"],
            casual_remaining=max(0, self.DEFAULT_CASUAL - used["casual"]),
            medical_total=self.DEFAULT_MEDICAL,
            medical_used=used["medical"],
            medical_remaining=max(0, self.DEFAULT_MEDICAL - used["medical"]),
            year=target_year,
        )
