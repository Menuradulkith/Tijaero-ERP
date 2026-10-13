"""Pydantic schemas for Attendance and Leaves."""
from __future__ import annotations

from datetime import date, datetime, time
from typing import List, Optional

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
    leave_type: str = Field(..., min_length=1, max_length=30, description="a leave type code (see /hr/leave-types)")
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
    types: List[dict] = []


# ─── Strict inputs ─────────────────────────────────────────────────────────────
from datetime import timedelta  # noqa: E402
from typing import Annotated, Literal  # noqa: E402

from pydantic import StringConstraints, model_validator  # noqa: E402

_Code = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]
_Branch = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
_Mins = Annotated[int, Field(ge=0, le=1440)]
LeaveTime = Literal["FULL DAY", "FULL_DAY", "full_day", "Full Day", "MORNING", "AFTERNOON", "first_half", "second_half", "FIRST HALF", "SECOND HALF"]


def _att_date(v: date) -> date:
    today = date.today()
    if v > today:
        raise ValueError("Attendance cannot be recorded for a future date")
    if v < today - timedelta(days=400):
        raise ValueError("Attendance older than 400 days cannot be recorded here")
    return v


def _times_ok(ci, co):
    if ci and co and co <= ci:
        raise ValueError("Check-out must be after check-in")


class AttendanceCreate(BaseModel):
    employee_id: _Code
    branch_code: _Branch
    date: date
    check_in: Optional[time] = None
    check_out: Optional[time] = None
    leave_mins: _Mins = 0
    absent_mins: _Mins = 0

    _d = field_validator("date")(_att_date)

    @model_validator(mode="after")
    def _t(self):
        _times_ok(self.check_in, self.check_out)
        if self.check_out and not self.check_in:
            raise ValueError("Check-out needs a check-in")
        return self


class AttendanceUpdate(BaseModel):
    check_in: Optional[time] = None
    check_out: Optional[time] = None
    leave_mins: Optional[_Mins] = None
    absent_mins: Optional[_Mins] = None

    @model_validator(mode="after")
    def _t(self):
        _times_ok(self.check_in, self.check_out)
        return self


class AttendanceCheckIn(BaseModel):
    employee_id: _Code
    branch_code: _Branch
    check_in: Optional[time] = None
    date: Optional[date] = None

    @field_validator("date")
    @classmethod
    def _d(cls, v):
        return _att_date(v) if v else v


class AttendanceCheckOut(BaseModel):
    employee_id: _Code
    check_out: Optional[time] = None
    date: Optional[date] = None

    @field_validator("date")
    @classmethod
    def _d(cls, v):
        return _att_date(v) if v else v


_Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
_LeaveCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]


class LeaveCreate(BaseModel):
    employee_id: _Code
    leave_type: _LeaveCode
    from_date: date
    to_date: date
    leave_reason: _Reason
    leave_duration: float = Field(..., gt=0, le=366, description="Number of leave days, supports half day (0.5)")
    leave_time: LeaveTime = "FULL DAY"

    @field_validator("from_date", "to_date")
    @classmethod
    def _window(cls, v):
        today = date.today()
        if v < today - timedelta(days=400) or v > today + timedelta(days=800):
            raise ValueError("Leave date is out of the allowed range")
        return v

    @model_validator(mode="after")
    def _order(self):
        if self.to_date < self.from_date:
            raise ValueError("to_date must be on or after from_date")
        return self


class LeaveUpdate(BaseModel):
    leave_type: Optional[_LeaveCode] = None
    from_date: Optional[date] = None
    to_date: Optional[date] = None
    leave_reason: Optional[_Reason] = None
    leave_duration: Optional[float] = Field(default=None, gt=0, le=366)
    leave_time: Optional[LeaveTime] = None


class LeaveApprove(BaseModel):
    remarks: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=1000)]] = None


class LeaveReject(BaseModel):
    rejection_reason: _Reason
