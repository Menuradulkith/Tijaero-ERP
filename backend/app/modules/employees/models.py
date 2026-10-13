from app.common.base_models import AuditMixin, TimestampMixin
from app.db.base import Base
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Column,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship


class Employee(Base, AuditMixin):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("accounts_user.id"), unique=True, nullable=False
    )
    employee_id = Column(Text, unique=True, nullable=False)

    # ── Personal ──
    name_with_initials = Column(String(200), nullable=True)
    nic = Column(String(20), nullable=True)
    passport_no = Column(String(30), nullable=True)
    marital_status = Column(String(15), nullable=True)  # single | married | divorced | widowed
    nationality = Column(String(60), nullable=True)
    religion = Column(String(60), nullable=True)
    blood_group = Column(String(5), nullable=True)
    # ── Contact ──
    personal_email = Column(String(255), nullable=True)
    mobile_phone = Column(String(30), nullable=True)
    home_phone = Column(String(30), nullable=True)
    address_line1 = Column(String(200), nullable=True)
    address_line2 = Column(String(200), nullable=True)
    city = Column(String(100), nullable=True)
    district = Column(String(100), nullable=True)
    postal_code = Column(String(20), nullable=True)
    permanent_address = Column(Text, nullable=True)
    # ── Job ──
    department_id = Column(Integer, ForeignKey("hr_departments.id"), nullable=True, index=True)
    designation_id = Column(Integer, ForeignKey("hr_designations.id"), nullable=True)
    employment_type_id = Column(Integer, ForeignKey("hr_employment_types.id"), nullable=True)
    branch_code = Column(String(20), nullable=True, index=True)
    reports_to_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    grade = Column(String(30), nullable=True)
    work_location = Column(String(150), nullable=True)
    shift_id = Column(Integer, ForeignKey("hr_shifts.id"), nullable=True)
    holiday_list_id = Column(Integer, ForeignKey("hr_holiday_lists.id"), nullable=True)
    # active | probation | notice_period | resigned | terminated | retired | inactive
    status = Column(String(20), nullable=False, default="active", server_default="active", index=True)
    date_of_joining = Column(Date, nullable=True)
    probation_end_date = Column(Date, nullable=True)
    confirmation_date = Column(Date, nullable=True)
    contract_end_date = Column(Date, nullable=True)
    notice_period_days = Column(Integer, nullable=True)
    retirement_date = Column(Date, nullable=True)
    # ── Separation ──
    resignation_date = Column(Date, nullable=True)
    last_working_date = Column(Date, nullable=True)
    exit_type = Column(String(20), nullable=True)  # resignation | termination | retirement | end_of_contract | death | other
    exit_reason = Column(Text, nullable=True)
    # ── Bank (sensitive) ──
    bank_name = Column(String(100), nullable=True)
    bank_branch = Column(String(100), nullable=True)
    bank_account_no = Column(String(40), nullable=True)
    bank_account_name = Column(String(150), nullable=True)
    # ── Statutory (sensitive) ──
    epf_no = Column(String(30), nullable=True)
    etf_no = Column(String(30), nullable=True)
    tin_no = Column(String(30), nullable=True)

    department = relationship("HRDepartment", foreign_keys=[department_id], lazy="select", viewonly=True)
    designation_ref = relationship("HRDesignation", foreign_keys=[designation_id], lazy="select", viewonly=True)
    employment_type = relationship("HREmploymentType", foreign_keys=[employment_type_id], lazy="select", viewonly=True)

    user = relationship("User", foreign_keys=[user_id], lazy="select", viewonly=True)
    payrolls = relationship("EmployeePayroll", back_populates="employee", lazy="select")
    salary_profile = relationship(
        "EmployeeSalaryProfile", back_populates="employee", uselist=False, lazy="select"
    )
    salary_deductions = relationship(
        "SalaryDeductions", back_populates="employee", lazy="select", viewonly=True
    )
    reimbursements = relationship(
        "Reimbursements", back_populates="employee", lazy="select", viewonly=True
    )
    leaves = relationship(
        "Leaves", back_populates="employee", lazy="select", viewonly=True
    )
    assets = relationship("EmployeesAssets", back_populates="employee", lazy="select")
    promotions = relationship(
        "EmployeePromotions", back_populates="employee", lazy="select"
    )
    attendance_records = relationship(
        "Attendance", back_populates="employee", lazy="select", viewonly=True
    )


class EmployeePayroll(Base, AuditMixin):
    __tablename__ = "employee_payroll"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    # Payroll period
    payroll_month = Column(Integer, nullable=True)
    payroll_year = Column(Integer, nullable=True)
    payroll_batch_no = Column(String(100), nullable=True, index=True)
    # Income
    basic_salary = Column(Numeric(60, 2), nullable=False)
    add_1_name = Column(String(100))
    add_1_value = Column(Numeric(60, 2))
    add_2_name = Column(String(100))
    add_2_value = Column(Numeric(60, 2))
    add_sales_commision = Column(Numeric(60, 2))
    add_salary_advance = Column(Numeric(60, 2))
    add_reimbursements = Column(Numeric(60, 2))
    add_bonus = Column(Numeric(60, 2), nullable=True)
    # Employee deductions
    less_epf_employee = Column(Numeric(60, 2))
    less_etf_employee = Column(Numeric(60, 2))
    less_stamp_duty = Column(Numeric(60, 2))
    less_late_deductions = Column(Numeric(60, 2))
    less_salary_advance_repayment = Column(Numeric(60, 2))
    less_loan_repayment = Column(Numeric(60, 2), nullable=True)
    less_other_deductions = Column(Numeric(60, 2), nullable=True)
    less_apit = Column(Numeric(60, 2), nullable=True)  # APIT tax deduction
    # Employer contributions
    epf_employer = Column(Numeric(60, 2))
    etf_employer = Column(Numeric(60, 2))
    # Calculated totals
    gross_salary = Column(Numeric(60, 2), nullable=True)
    total_deductions = Column(Numeric(60, 2), nullable=True)
    net_salary = Column(Numeric(60, 2), nullable=True)
    total_employer_cost = Column(Numeric(60, 2), nullable=True)
    # Workflow
    status = Column(String(30), nullable=True, default="draft")
    approved_by = Column(Integer, nullable=True)
    approved_date = Column(TIMESTAMP, nullable=True)
    # Payment
    payment_status = Column(String(30), nullable=True)
    payment_date = Column(Date, nullable=True)
    payment_reference = Column(String(200), nullable=True)
    payment_method = Column(String(50), nullable=True)
    # Statutory
    statutory_payment_status = Column(String(30), nullable=True)
    statutory_payment_date = Column(Date, nullable=True)
    statutory_payment_reference = Column(String(200), nullable=True)
    # Timestamps
    created_at = Column(TIMESTAMP, nullable=True)
    created_by = Column(Integer, nullable=True)

    employee = relationship("Employee", back_populates="payrolls")


class EmployeeSalaryProfile(Base, AuditMixin):
    __tablename__ = "employee_salary_profile"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(
        Text, ForeignKey("employees.employee_id"), unique=True, nullable=False
    )
    basic_salary = Column(Numeric(60, 2), nullable=False)
    add_1_name = Column(String(100))
    add_1_value = Column(Numeric(60, 2))
    add_2_name = Column(String(100))
    add_2_value = Column(Numeric(60, 2))
    # Enhanced fields
    designation = Column(String(200), nullable=True)
    department = Column(String(200), nullable=True)
    effective_from_date = Column(Date, nullable=True)
    benefits = Column(Text, nullable=True)  # JSON or text description

    employee = relationship("Employee", back_populates="salary_profile")


class EmployeePromotions(Base, AuditMixin):
    __tablename__ = "employee_promotions"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    designation = Column(Text, nullable=False)
    appointed_date = Column(Date, nullable=False)
    remark = Column(Text)

    employee = relationship("Employee", back_populates="promotions", lazy="select")


class EmployeesAssets(Base, AuditMixin):
    __tablename__ = "employees_assets"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    asset_id = Column(Integer, ForeignKey("company_assets.id"), nullable=False)
    assign_reason = Column(Text)
    revoke_assignment = Column(Boolean, nullable=False, default=False)

    employee = relationship("Employee", back_populates="assets", lazy="select")
    asset = relationship(
        "CompanyAssets",
        back_populates="employee_assignments",
        lazy="select",
        viewonly=True,
    )
