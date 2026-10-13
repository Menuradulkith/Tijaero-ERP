"""Schemas for core HR. Input schemas are strict (bounded, trimmed, blank -> None);
response schemas stay lenient."""
import re
from datetime import date, datetime, time
from typing import Annotated, Generic, List, Literal, Optional, TypeVar

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.common.base_schemas import VersionedSchema

INT4_MAX = 2_147_483_647
T = TypeVar("T")


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


def OptStr(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none)]


class Page(BaseModel, Generic[T]):
    items: List[T]
    total: int
    page: int
    size: int
    pages: int


Id = Annotated[int, Field(ge=1, le=INT4_MAX)]
OptId = Annotated[Optional[int], Field(default=None, ge=1, le=INT4_MAX)]

_PHONE = re.compile(r"^\+?[0-9][0-9 \-()]{5,28}$")
_NIC_OLD = re.compile(r"^[0-9]{9}[VvXx]$")
_NIC_NEW = re.compile(r"^[0-9]{12}$")


def _phone(v):
    v = _blank_to_none(v)
    if v is not None and not _PHONE.match(v):
        raise ValueError("Enter a valid phone number")
    return v


def _nic(v):
    v = _blank_to_none(v)
    if v is not None and not (_NIC_OLD.match(v) or _NIC_NEW.match(v)):
        raise ValueError("NIC must be 9 digits + V/X (old) or 12 digits (new)")
    return v.upper() if v else v


def _past_or_today(v: Optional[date], label: str, min_year: int = 1900):
    if v is not None:
        if v > date.today():
            raise ValueError(f"{label} cannot be in the future")
        if v.year < min_year:
            raise ValueError(f"{label} is too far in the past")
    return v


def _window(v: Optional[date], label: str, back_years: int = 60, fwd_years: int = 30):
    if v is not None:
        today = date.today()
        if v.year < today.year - back_years or v.year > today.year + fwd_years:
            raise ValueError(f"{label} is out of range")
    return v


Phone = Annotated[Optional[str], BeforeValidator(_phone)]
def _req_phone(v):
    r = _phone(v)
    if r is None:
        raise ValueError("Phone is required")
    return r


ReqPhone = Annotated[str, BeforeValidator(_req_phone)]
Nic = Annotated[Optional[str], BeforeValidator(_nic)]


class AuditOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ───────────────────────── organisation masters ─────────────────────────
class DepartmentIn(BaseModel):
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_\-]+$")]
    name: ReqStr(150)
    parent_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    head_employee_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    description: OptStr(1000) = None
    active: bool = True


class DepartmentUpdate(DepartmentIn):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class DepartmentOut(AuditOut, VersionedSchema):
    code: str
    name: str
    parent_id: Optional[int] = None
    parent_name: Optional[str] = None
    head_employee_id: Optional[int] = None
    head_name: Optional[str] = None
    description: Optional[str] = None
    active: bool = True
    employee_count: int = 0


class DesignationIn(BaseModel):
    name: ReqStr(150)
    department_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    grade: OptStr(30) = None
    description: OptStr(1000) = None
    active: bool = True


class DesignationUpdate(DesignationIn):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class DesignationOut(AuditOut, VersionedSchema):
    name: str
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    grade: Optional[str] = None
    description: Optional[str] = None
    active: bool = True
    employee_count: int = 0


class EmploymentTypeIn(BaseModel):
    name: ReqStr(80)
    description: OptStr(1000) = None
    default_probation_months: int = Field(default=0, ge=0, le=24)
    has_end_date: bool = False
    epf_etf_applicable: bool = True
    active: bool = True


class EmploymentTypeUpdate(EmploymentTypeIn):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class EmploymentTypeOut(AuditOut, VersionedSchema):
    name: str
    description: Optional[str] = None
    default_probation_months: int = 0
    has_end_date: bool = False
    epf_etf_applicable: bool = True
    active: bool = True
    employee_count: int = 0


# ───────────────────────────── time masters ─────────────────────────────
class ShiftIn(BaseModel):
    name: ReqStr(80)
    start_time: time
    end_time: time
    grace_minutes: int = Field(default=10, ge=0, le=120)
    break_minutes: int = Field(default=60, ge=0, le=240)
    work_minutes: int = Field(default=480, ge=60, le=960)
    half_day_minutes: int = Field(default=240, ge=30, le=480)
    weekly_off_days: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^([0-6](,[0-6]){0,6})?$")] = "6"
    is_default: bool = False
    active: bool = True

    @model_validator(mode="after")
    def _rules(self):
        if self.end_time <= self.start_time:
            raise ValueError("Shift end time must be after the start time")
        span = (self.end_time.hour * 60 + self.end_time.minute) - (self.start_time.hour * 60 + self.start_time.minute)
        if self.work_minutes > span:
            raise ValueError("Working minutes cannot exceed the shift length")
        if self.half_day_minutes >= self.work_minutes:
            raise ValueError("Half-day minutes must be less than the full-day working minutes")
        days = [int(d) for d in self.weekly_off_days.split(",") if d != ""]
        if len(days) != len(set(days)):
            raise ValueError("Weekly off days repeat")
        return self


class ShiftUpdate(ShiftIn):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class ShiftOut(AuditOut, VersionedSchema):
    name: str
    start_time: time
    end_time: time
    grace_minutes: int
    break_minutes: int
    work_minutes: int
    half_day_minutes: int
    weekly_off_days: str
    is_default: bool = False
    active: bool = True
    employee_count: int = 0


HolidayType = Literal["public", "poya", "mercantile", "bank", "company", "other"]


class HolidayIn(BaseModel):
    holiday_date: date
    name: ReqStr(150)
    holiday_type: HolidayType = "public"


class HolidayOut(AuditOut):
    holiday_list_id: int
    holiday_date: date
    name: str
    holiday_type: str


class HolidayListIn(BaseModel):
    name: ReqStr(120)
    year: int = Field(..., ge=2000, le=2100)
    is_default: bool = False
    active: bool = True


class HolidayListUpdate(HolidayListIn):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class HolidayListOut(AuditOut, VersionedSchema):
    name: str
    year: int
    is_default: bool = False
    active: bool = True
    holiday_count: int = 0
    employee_count: int = 0


# ───────────────────────────────── leave ─────────────────────────────────
class LeaveTypeIn(BaseModel):
    code: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=30, pattern=r"^[A-Za-z0-9_\-]+$")]
    name: ReqStr(80)
    description: OptStr(1000) = None
    annual_entitlement: float = Field(default=0, ge=0, le=366)
    accrual: Literal["none", "monthly"] = "none"
    carry_forward_max: float = Field(default=0, ge=0, le=366)
    is_paid: bool = True
    allow_half_day: bool = True
    allow_negative_balance: bool = False
    max_consecutive_days: Optional[float] = Field(default=None, gt=0, le=366)
    min_service_months: int = Field(default=0, ge=0, le=120)
    applicable_gender: Literal["all", "male", "female"] = "all"
    document_required_after_days: Optional[float] = Field(default=None, gt=0, le=366)
    count_holidays: bool = False
    active: bool = True

    @model_validator(mode="after")
    def _rules(self):
        if self.carry_forward_max > self.annual_entitlement and self.carry_forward_max > 0:
            raise ValueError("Carry-forward limit cannot exceed the yearly entitlement")
        return self


class LeaveTypeUpdate(LeaveTypeIn):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class LeaveTypeOut(AuditOut, VersionedSchema):
    code: str
    name: str
    description: Optional[str] = None
    annual_entitlement: float = 0
    accrual: str = "none"
    carry_forward_max: float = 0
    is_paid: bool = True
    allow_half_day: bool = True
    allow_negative_balance: bool = False
    max_consecutive_days: Optional[float] = None
    min_service_months: int = 0
    applicable_gender: str = "all"
    document_required_after_days: Optional[float] = None
    count_holidays: bool = False
    active: bool = True


class LeaveAllocationIn(BaseModel):
    employee_pk: Id
    leave_type_id: Id
    year: int = Field(..., ge=2000, le=2100)
    allocated: float = Field(..., ge=0, le=366)
    carried_forward: float = Field(default=0, ge=0, le=366)
    adjustment: float = Field(default=0, ge=-366, le=366)
    remarks: OptStr(500) = None


class LeaveAllocationUpdate(BaseModel):
    allocated: float = Field(..., ge=0, le=366)
    carried_forward: float = Field(default=0, ge=0, le=366)
    adjustment: float = Field(default=0, ge=-366, le=366)
    remarks: OptStr(500) = None
    expected_version: Optional[str] = Field(default=None, max_length=40)


class LeaveAllocationOut(AuditOut, VersionedSchema):
    employee_pk: int
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None
    leave_type_id: int
    leave_type_code: Optional[str] = None
    leave_type_name: Optional[str] = None
    year: int
    allocated: float
    carried_forward: float
    adjustment: float
    remarks: Optional[str] = None
    total: float = 0
    used: float = 0
    pending: float = 0
    balance: float = 0


class GenerateAllocationsIn(BaseModel):
    year: int = Field(..., ge=2000, le=2100)
    employee_pk: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    carry_forward: bool = True
    overwrite: bool = False


class LeaveBalanceRow(BaseModel):
    leave_type_id: int
    code: str
    name: str
    is_paid: bool
    entitlement: float
    carried_forward: float
    adjustment: float
    total: float
    used: float
    pending: float
    balance: float
    accrued_to_date: Optional[float] = None


# ───────────────────────── employee sub-records ─────────────────────────
Relationship = ReqStr(50)


class EmergencyContactIn(BaseModel):
    name: ReqStr(150)
    relationship_type: Relationship
    phone: ReqPhone
    alt_phone: Phone = None
    address: OptStr(500) = None
    is_primary: bool = False


class EmergencyContactOut(AuditOut):
    employee_pk: int
    name: str
    relationship_type: str
    phone: str
    alt_phone: Optional[str] = None
    address: Optional[str] = None
    is_primary: bool = False


class DependentIn(BaseModel):
    name: ReqStr(150)
    relationship_type: Relationship
    date_of_birth: Optional[date] = None
    nic: Nic = None
    gender: Optional[Literal["male", "female", "other"]] = None
    is_beneficiary: bool = False
    remarks: OptStr(500) = None

    @field_validator("date_of_birth")
    @classmethod
    def _dob(cls, v):
        return _past_or_today(v, "Date of birth")


class DependentOut(AuditOut):
    employee_pk: int
    name: str
    relationship_type: str
    date_of_birth: Optional[date] = None
    nic: Optional[str] = None
    gender: Optional[str] = None
    is_beneficiary: bool = False
    remarks: Optional[str] = None


EducationLevel = Literal["school", "certificate", "diploma", "bachelor", "master", "doctorate", "professional", "other"]


class EducationIn(BaseModel):
    level: EducationLevel
    qualification: ReqStr(200)
    institution: ReqStr(200)
    field_of_study: OptStr(200) = None
    start_year: Optional[int] = Field(default=None, ge=1940, le=2100)
    end_year: Optional[int] = Field(default=None, ge=1940, le=2100)
    grade: OptStr(50) = None

    @model_validator(mode="after")
    def _years(self):
        if self.start_year and self.end_year and self.end_year < self.start_year:
            raise ValueError("End year cannot be before the start year")
        return self


class EducationOut(AuditOut):
    employee_pk: int
    level: str
    qualification: str
    institution: str
    field_of_study: Optional[str] = None
    start_year: Optional[int] = None
    end_year: Optional[int] = None
    grade: Optional[str] = None


class ExperienceIn(BaseModel):
    company: ReqStr(200)
    designation: ReqStr(150)
    from_date: date
    to_date: Optional[date] = None
    last_salary: Optional[float] = Field(default=None, ge=0, le=9_999_999_999)
    reason_for_leaving: OptStr(1000) = None
    reference_name: OptStr(150) = None
    reference_contact: OptStr(50) = None

    @model_validator(mode="after")
    def _dates(self):
        _past_or_today(self.from_date, "From date")
        if self.to_date:
            _past_or_today(self.to_date, "To date")
            if self.to_date < self.from_date:
                raise ValueError("To date cannot be before the from date")
        return self


class ExperienceOut(AuditOut):
    employee_pk: int
    company: str
    designation: str
    from_date: date
    to_date: Optional[date] = None
    last_salary: Optional[float] = None
    reason_for_leaving: Optional[str] = None
    reference_name: Optional[str] = None
    reference_contact: Optional[str] = None


DocType = Literal["nic", "passport", "driving_license", "contract", "appointment_letter", "certificate", "medical", "police_report", "other"]


class DocumentIn(BaseModel):
    doc_type: DocType
    title: ReqStr(200)
    doc_number: OptStr(100) = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    remarks: OptStr(500) = None

    @model_validator(mode="after")
    def _dates(self):
        _window(self.issue_date, "Issue date", 80, 1)
        _window(self.expiry_date, "Expiry date", 20, 40)
        if self.issue_date and self.expiry_date and self.expiry_date < self.issue_date:
            raise ValueError("Expiry date cannot be before the issue date")
        return self


class DocumentOut(AuditOut):
    employee_pk: int
    doc_type: str
    title: str
    doc_number: Optional[str] = None
    issue_date: Optional[date] = None
    expiry_date: Optional[date] = None
    file_path: Optional[str] = None
    file_name: Optional[str] = None
    remarks: Optional[str] = None
    expired: bool = False
    expires_in_days: Optional[int] = None


TaskCategory = Literal["onboarding", "offboarding"]
TaskStatus = Literal["pending", "in_progress", "done", "skipped"]


class TaskIn(BaseModel):
    category: TaskCategory
    title: ReqStr(200)
    description: OptStr(1000) = None
    responsible: OptStr(100) = None
    due_date: Optional[date] = None
    status: TaskStatus = "pending"
    sort_order: int = Field(default=0, ge=0, le=10000)


class TaskStatusIn(BaseModel):
    status: TaskStatus


class TaskOut(AuditOut):
    employee_pk: int
    category: str
    title: str
    description: Optional[str] = None
    responsible: Optional[str] = None
    due_date: Optional[date] = None
    status: str
    completed_date: Optional[date] = None
    sort_order: int = 0


# ───────────────────────────── employee profile ─────────────────────────────
EmployeeStatus = Literal["active", "probation", "notice_period", "resigned", "terminated", "retired", "inactive"]
MaritalStatus = Literal["single", "married", "divorced", "widowed"]
BloodGroup = Literal["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
ExitType = Literal["resignation", "termination", "retirement", "end_of_contract", "death", "other"]
Gender = Literal["male", "female", "other"]

_EMPLOYEE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_\-/.]{0,49}$")


class EmployeeProfileFields(BaseModel):
    """Everything editable on the employee master except identity (user, employee id)."""

    # personal
    name_with_initials: OptStr(200) = None
    nic: Nic = None
    passport_no: OptStr(30) = None
    marital_status: Optional[MaritalStatus] = None
    nationality: OptStr(60) = None
    religion: OptStr(60) = None
    blood_group: Optional[BloodGroup] = None
    date_of_birth: Optional[date] = None
    gender: Optional[Gender] = None
    # contact
    personal_email: Annotated[Optional[str], BeforeValidator(_blank_to_none), Field(max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")] = None
    mobile_phone: Phone = None
    home_phone: Phone = None
    address_line1: OptStr(200) = None
    address_line2: OptStr(200) = None
    city: OptStr(100) = None
    district: OptStr(100) = None
    postal_code: OptStr(20) = None
    permanent_address: OptStr(500) = None
    # job
    department_id: OptId = None
    designation_id: OptId = None
    employment_type_id: OptId = None
    branch_code: OptStr(20) = None
    reports_to_id: OptId = None
    grade: OptStr(30) = None
    work_location: OptStr(150) = None
    shift_id: OptId = None
    holiday_list_id: OptId = None
    date_of_joining: Optional[date] = None
    probation_end_date: Optional[date] = None
    confirmation_date: Optional[date] = None
    contract_end_date: Optional[date] = None
    notice_period_days: Optional[int] = Field(default=None, ge=0, le=365)
    retirement_date: Optional[date] = None
    # bank (sensitive)
    bank_name: OptStr(100) = None
    bank_branch: OptStr(100) = None
    bank_account_no: Annotated[Optional[str], BeforeValidator(_blank_to_none), Field(max_length=40, pattern=r"^[0-9A-Za-z\-]{4,40}$")] = None
    bank_account_name: OptStr(150) = None
    # statutory (sensitive)
    epf_no: OptStr(30) = None
    etf_no: OptStr(30) = None
    tin_no: OptStr(30) = None

    @model_validator(mode="after")
    def _rules(self):
        _past_or_today(self.date_of_birth, "Date of birth")
        if self.date_of_birth:
            age = (date.today() - self.date_of_birth).days / 365.25
            if age < 14:
                raise ValueError("Employee must be at least 14 years old")
        _window(self.date_of_joining, "Date of joining", 60, 2)
        for v, label in ((self.probation_end_date, "Probation end date"), (self.confirmation_date, "Confirmation date"),
                         (self.contract_end_date, "Contract end date"), (self.retirement_date, "Retirement date")):
            _window(v, label, 60, 60)
        if self.date_of_joining:
            if self.date_of_birth and self.date_of_joining < self.date_of_birth:
                raise ValueError("Date of joining cannot be before the date of birth")
            if self.probation_end_date and self.probation_end_date < self.date_of_joining:
                raise ValueError("Probation end date cannot be before the date of joining")
            if self.confirmation_date and self.confirmation_date < self.date_of_joining:
                raise ValueError("Confirmation date cannot be before the date of joining")
            if self.contract_end_date and self.contract_end_date < self.date_of_joining:
                raise ValueError("Contract end date cannot be before the date of joining")
        return self


class EmployeeCreate(EmployeeProfileFields):
    user_id: Id
    employee_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50)]

    @field_validator("employee_id")
    @classmethod
    def _eid(cls, v):
        if not _EMPLOYEE_ID.match(v):
            raise ValueError("Employee ID may contain letters, numbers, - _ / . only")
        return v


class EmployeeUpdate(EmployeeProfileFields):
    expected_version: Optional[str] = Field(default=None, max_length=40)


class EmployeeSeparation(BaseModel):
    exit_type: ExitType
    resignation_date: Optional[date] = None
    last_working_date: date
    exit_reason: OptStr(2000) = None
    deactivate_user: bool = False
    expected_version: Optional[str] = Field(default=None, max_length=40)

    @model_validator(mode="after")
    def _dates(self):
        _window(self.last_working_date, "Last working date", 2, 2)
        if self.resignation_date and self.resignation_date > self.last_working_date:
            raise ValueError("Resignation date cannot be after the last working day")
        return self


class EmployeeListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    user_id: int
    employee_id: str
    full_name: Optional[str] = None
    username: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    status: str = "active"
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    designation_id: Optional[int] = None
    designation_name: Optional[str] = None
    employment_type_id: Optional[int] = None
    employment_type_name: Optional[str] = None
    branch_code: Optional[str] = None
    date_of_joining: Optional[date] = None
    reports_to_id: Optional[int] = None
    reports_to_name: Optional[str] = None
    profile_picture_path: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class EmployeeDetail(EmployeeListItem, VersionedSchema):
    # personal
    name_with_initials: Optional[str] = None
    nic: Optional[str] = None
    passport_no: Optional[str] = None
    marital_status: Optional[str] = None
    nationality: Optional[str] = None
    religion: Optional[str] = None
    blood_group: Optional[str] = None
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    # contact
    personal_email: Optional[str] = None
    mobile_phone: Optional[str] = None
    home_phone: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    postal_code: Optional[str] = None
    permanent_address: Optional[str] = None
    # job
    grade: Optional[str] = None
    work_location: Optional[str] = None
    shift_id: Optional[int] = None
    shift_name: Optional[str] = None
    holiday_list_id: Optional[int] = None
    probation_end_date: Optional[date] = None
    confirmation_date: Optional[date] = None
    contract_end_date: Optional[date] = None
    notice_period_days: Optional[int] = None
    retirement_date: Optional[date] = None
    service_years: Optional[float] = None
    # separation
    resignation_date: Optional[date] = None
    last_working_date: Optional[date] = None
    exit_type: Optional[str] = None
    exit_reason: Optional[str] = None
    # sensitive (omitted without employee_sensitive:view)
    bank_name: Optional[str] = None
    bank_branch: Optional[str] = None
    bank_account_no: Optional[str] = None
    bank_account_name: Optional[str] = None
    epf_no: Optional[str] = None
    etf_no: Optional[str] = None
    tin_no: Optional[str] = None
    sensitive_hidden: bool = False
    # counts for the tab badges
    counts: dict = {}
