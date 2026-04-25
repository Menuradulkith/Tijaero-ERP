"""Pydantic schemas for Attendance and Leaves."""
from __future__ import annotations

from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, Field, field_validator

from app.common.base_schemas import TijaeroBaseSchema


# ─── Attendance ────────────────────────────────────────────────────────────────
class AttendanceBase(BaseModel):
    employee_id: str
    branch_code: str
    date: date
    weekday: Optional[str] = None
    check_in: Optional[time] = None
    check_out: Optional[time] = None
    work_mins: int = 0
    ot_mins: int = 0
    full_attended_mins: int = 0
    late_mins: int = 0
    early_mins: int = 0
    absent_mins: int = 0
    leave_mins: int = 0


class AttendanceCreate(AttendanceBase):
    pass


class AttendanceUpdate(BaseModel):
    check_in: Optional[time] = None
    check_out: Optional[time] = None
    work_mins: Optional[int] = None
    ot_mins: Optional[int] = None
    full_attended_mins: Optional[int] = None
    late_mins: Optional[int] = None
    early_mins: Optional[int] = None
    absent_mins: Optional[int] = None
    leave_mins: Optional[int] = None


class AttendanceCheckIn(BaseModel):
    employee_id: str
    branch_code: str
    check_in: Optional[time] = None  # default = now
    date: Optional[date] = None  # default = today


class AttendanceCheckOut(BaseModel):
    employee_id: str
    check_out: Optional[time] = None  # default = now
    date: Optional[date] = None  # default = today


class Attendance(AttendanceBase, TijaeroBaseSchema):
    id: int
    employee_name: Optional[str] = None
    branch_name: Optional[str] = None
    status: Optional[str] = None  # derived: present | late | absent | leave | half_day


class AttendanceFilter(BaseModel):
    employee_id: Optional[str] = None
    branch_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 200


class AttendanceSummary(BaseModel):
    period_from: date
    period_to: date
    total_records: int
    total_present: int
    total_absent: int
    total_late: int
    total_leave: int
    total_work_hours: float
    total_ot_hours: float


# ─── Leaves ────────────────────────────────────────────────────────────────────
class LeaveBase(BaseModel):
    employee_id: str
    leave_type: str = Field(..., description="annual | casual | medical | unpaid | other")
    from_date: date
    to_date: date
    leave_reason: str
    leave_duration: float = Field(..., gt=0, description="Number of leave days, supports half day (0.5)")
    leave_time: str = "FULL DAY"  # FULL DAY | MORNING | AFTERNOON

    @field_validator("to_date")
    @classmethod
    def _check_dates(cls, v, info):
        from_d = info.data.get("from_date")
        if from_d and v < from_d:
            raise ValueError("to_date must be on or after from_date")
        return v


class LeaveCreate(LeaveBase):
    pass


class LeaveUpdate(BaseModel):
    leave_type: Optional[str] = None
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    leave_reason: Optional[str] = None
    leave_duration: Optional[float] = None
    leave_time: Optional[str] = None


class LeaveApprove(BaseModel):
    remarks: Optional[str] = None


class LeaveReject(BaseModel):
    rejection_reason: str


class Leave(LeaveBase, TijaeroBaseSchema):
    id: int
    approval_id: Optional[int] = None
    status: Optional[str] = None  # pending | approved | rejected
    approved_by: Optional[int] = None
    approved_date: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    employee_name: Optional[str] = None
    created_at: Optional[datetime] = None


class LeaveFilter(BaseModel):
    employee_id: Optional[str] = None
    leave_type: Optional[str] = None
    status: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100


class LeaveBalance(BaseModel):
    employee_id: str
    employee_name: Optional[str] = None
    annual_total: int
    annual_used: float
    annual_remaining: float
    casual_total: int
    casual_used: float
    casual_remaining: float
    medical_total: int
    medical_used: float
    medical_remaining: float
    year: int
