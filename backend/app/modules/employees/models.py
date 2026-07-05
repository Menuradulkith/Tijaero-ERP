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
