"""Core HR masters and employee sub-records.

Organisation:  departments, designations, employment types
Time:          shifts, holiday lists + holidays
Leave:         leave types, yearly leave allocations
Employee:      emergency contacts, dependents, education, work experience,
               documents, onboarding / offboarding tasks
The employee master itself (``employees``) lives in app.modules.employees.models.
"""
from sqlalchemy import (
    Boolean,
    Column,
    Date,
    Float,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.db.base import Base


# ─────────────────────────────── organisation ───────────────────────────────
class HRDepartment(Base, AuditMixin):
    __tablename__ = "hr_departments"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), nullable=False)
    name = Column(String(150), nullable=False)
    parent_id = Column(Integer, ForeignKey("hr_departments.id"), nullable=True)
    head_employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    description = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True)

    parent = relationship("HRDepartment", remote_side=[id], lazy="select")


class HRDesignation(Base, AuditMixin):
    __tablename__ = "hr_designations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    department_id = Column(Integer, ForeignKey("hr_departments.id"), nullable=True)
    grade = Column(String(30), nullable=True)
    description = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True)

    department = relationship("HRDepartment", lazy="select")


class HREmploymentType(Base, AuditMixin):
    __tablename__ = "hr_employment_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    description = Column(Text, nullable=True)
    # Probation length applied to new employees of this type (months, 0 = none)
    default_probation_months = Column(Integer, nullable=False, default=0)
    # Contract / casual types carry an end date
    has_end_date = Column(Boolean, nullable=False, default=False)
    # Statutory contributions (EPF / ETF) apply to this type
    epf_etf_applicable = Column(Boolean, nullable=False, default=True)
    active = Column(Boolean, nullable=False, default=True)


# ─────────────────────────────────── time ───────────────────────────────────
class HRShift(Base, AuditMixin):
    __tablename__ = "hr_shifts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(80), nullable=False)
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    grace_minutes = Column(Integer, nullable=False, default=10)
    break_minutes = Column(Integer, nullable=False, default=60)
    # Minutes of work in a normal day (overtime counts above this)
    work_minutes = Column(Integer, nullable=False, default=480)
    half_day_minutes = Column(Integer, nullable=False, default=240)
    # Comma separated weekday numbers (Mon=0 .. Sun=6) that are weekly offs
    weekly_off_days = Column(String(20), nullable=False, default="6")
    is_default = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)


class HRHolidayList(Base, AuditMixin):
    __tablename__ = "hr_holiday_lists"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    year = Column(Integer, nullable=False)
    is_default = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)

    holidays = relationship("HRHoliday", back_populates="holiday_list", cascade="all, delete-orphan", lazy="select")


class HRHoliday(Base, AuditMixin):
    __tablename__ = "hr_holidays"
    __table_args__ = (UniqueConstraint("holiday_list_id", "holiday_date", name="uq_hr_holiday_list_date"),)

    id = Column(Integer, primary_key=True, index=True)
    holiday_list_id = Column(Integer, ForeignKey("hr_holiday_lists.id", ondelete="CASCADE"), nullable=False, index=True)
    holiday_date = Column(Date, nullable=False)
    name = Column(String(150), nullable=False)
    # public | poya | mercantile | bank | company | other
    holiday_type = Column(String(20), nullable=False, default="public")

    holiday_list = relationship("HRHolidayList", back_populates="holidays")


# ─────────────────────────────────── leave ──────────────────────────────────
class HRLeaveType(Base, AuditMixin):
    __tablename__ = "hr_leave_types"

    id = Column(Integer, primary_key=True, index=True)
    # Stored on a leave application (leaves.leave_type); lower-case, unique
    code = Column(String(30), nullable=False)
    name = Column(String(80), nullable=False)
    description = Column(Text, nullable=True)
    annual_entitlement = Column(Float, nullable=False, default=0)
    # none = fixed per year | monthly = accrues evenly over the year
    accrual = Column(String(10), nullable=False, default="none")
    carry_forward_max = Column(Float, nullable=False, default=0)
    is_paid = Column(Boolean, nullable=False, default=True)
    allow_half_day = Column(Boolean, nullable=False, default=True)
    # Applications are blocked when the balance would go below zero
    allow_negative_balance = Column(Boolean, nullable=False, default=False)
    max_consecutive_days = Column(Float, nullable=True)
    min_service_months = Column(Integer, nullable=False, default=0)
    # all | male | female
    applicable_gender = Column(String(10), nullable=False, default="all")
    # Sick leave longer than this needs a medical certificate (informational)
    document_required_after_days = Column(Float, nullable=True)
    # Weekly offs / holidays inside the range count as leave days
    count_holidays = Column(Boolean, nullable=False, default=False)
    active = Column(Boolean, nullable=False, default=True)


class HRLeaveAllocation(Base, AuditMixin):
    __tablename__ = "hr_leave_allocations"
    __table_args__ = (UniqueConstraint("employee_pk", "leave_type_id", "year", name="uq_hr_leave_alloc"),)

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    leave_type_id = Column(Integer, ForeignKey("hr_leave_types.id"), nullable=False)
    year = Column(Integer, nullable=False, index=True)
    allocated = Column(Float, nullable=False, default=0)
    carried_forward = Column(Float, nullable=False, default=0)
    adjustment = Column(Float, nullable=False, default=0)
    remarks = Column(Text, nullable=True)

    leave_type = relationship("HRLeaveType", lazy="select")


# ──────────────────────────── employee sub-records ──────────────────────────
class HREmergencyContact(Base, AuditMixin):
    __tablename__ = "hr_emergency_contacts"

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    relationship_type = Column(String(50), nullable=False)
    phone = Column(String(30), nullable=False)
    alt_phone = Column(String(30), nullable=True)
    address = Column(Text, nullable=True)
    is_primary = Column(Boolean, nullable=False, default=False)


class HRDependent(Base, AuditMixin):
    __tablename__ = "hr_dependents"

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(150), nullable=False)
    relationship_type = Column(String(50), nullable=False)
    date_of_birth = Column(Date, nullable=True)
    nic = Column(String(20), nullable=True)
    gender = Column(String(10), nullable=True)
    is_beneficiary = Column(Boolean, nullable=False, default=False)
    remarks = Column(Text, nullable=True)


class HREducation(Base, AuditMixin):
    __tablename__ = "hr_education"

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    # school | certificate | diploma | bachelor | master | doctorate | professional | other
    level = Column(String(30), nullable=False)
    qualification = Column(String(200), nullable=False)
    institution = Column(String(200), nullable=False)
    field_of_study = Column(String(200), nullable=True)
    start_year = Column(Integer, nullable=True)
    end_year = Column(Integer, nullable=True)
    grade = Column(String(50), nullable=True)


class HRExperience(Base, AuditMixin):
    __tablename__ = "hr_experience"

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    company = Column(String(200), nullable=False)
    designation = Column(String(150), nullable=False)
    from_date = Column(Date, nullable=False)
    to_date = Column(Date, nullable=True)
    last_salary = Column(Numeric(18, 2), nullable=True)
    reason_for_leaving = Column(Text, nullable=True)
    reference_name = Column(String(150), nullable=True)
    reference_contact = Column(String(50), nullable=True)


class HRDocument(Base, AuditMixin):
    __tablename__ = "hr_documents"

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    # nic | passport | driving_license | contract | appointment_letter | certificate | medical | police_report | other
    doc_type = Column(String(30), nullable=False)
    title = Column(String(200), nullable=False)
    doc_number = Column(String(100), nullable=True)
    issue_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True, index=True)
    file_path = Column(Text, nullable=True)
    file_name = Column(String(255), nullable=True)
    remarks = Column(Text, nullable=True)


class HROnboardingTask(Base, AuditMixin):
    """Checklist item for joining (onboarding) or leaving (offboarding)."""

    __tablename__ = "hr_onboarding_tasks"

    id = Column(Integer, primary_key=True, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    # onboarding | offboarding
    category = Column(String(15), nullable=False)
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    responsible = Column(String(100), nullable=True)
    due_date = Column(Date, nullable=True)
    # pending | in_progress | done | skipped
    status = Column(String(15), nullable=False, default="pending")
    completed_date = Column(Date, nullable=True)
    completed_by = Column(Integer, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
