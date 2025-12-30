from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin, AuditMixin

class Employee(Base, TimestampMixin):
    __tablename__ = "employees"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    employee_id = Column(Text, unique=True, nullable=False)
    
    # Relationships - using lazy loading to avoid circular imports
    user = relationship("User", foreign_keys=[user_id], lazy='select', viewonly=True)
    invoices = relationship("Invoice", back_populates="sale_rep", lazy='select', viewonly=True)
    payrolls = relationship("EmployeePayroll", back_populates="employee", lazy='select')
    salary_profile = relationship("EmployeeSalaryProfile", back_populates="employee", uselist=False, lazy='select')
    salary_deductions = relationship("SalaryDeductions", back_populates="employee", lazy='select', viewonly=True)
    reimbursements = relationship("Reimbursements", back_populates="employee", lazy='select', viewonly=True)
    leaves = relationship("Leaves", back_populates="employee", lazy='select', viewonly=True)
    assets = relationship("EmployeesAssets", back_populates="employee", lazy='select')
    promotions = relationship("EmployeePromotions", back_populates="employee", lazy='select')
    attendance_records = relationship("Attendance", back_populates="employee", lazy='select', viewonly=True)

class EmployeePayroll(Base):
    __tablename__ = "employee_payroll"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    basic_salary = Column(Numeric(60, 2), nullable=False)
    add_1_name = Column(String(100))
    add_1_value = Column(Numeric(60, 2))
    add_2_name = Column(String(100))
    add_2_value = Column(Numeric(60, 2))
    add_sales_commision = Column(Numeric(60, 2))
    add_salary_advance = Column(Numeric(60, 2))
    add_reimbursements = Column(Numeric(60, 2))
    less_epf_employee = Column(Numeric(60, 2))
    less_etf_employee = Column(Numeric(60, 2))
    less_stamp_duty = Column(Numeric(60, 2))
    less_late_deductions = Column(Numeric(60, 2))
    epf_employer = Column(Numeric(60, 2))
    etf_employer = Column(Numeric(60, 2))
    less_salary_advance_repayment = Column(Numeric(60, 2))
    
    # Relationships
    employee = relationship("Employee", back_populates="payrolls")

class EmployeeSalaryProfile(Base):
    __tablename__ = "employee_salary_profile"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), unique=True, nullable=False)
    basic_salary = Column(Numeric(60, 2), nullable=False)
    add_1_name = Column(String(100))
    add_1_value = Column(Numeric(60, 2))
    add_2_name = Column(String(100))
    add_2_value = Column(Numeric(60, 2))
    
    # Relationships
    employee = relationship("Employee", back_populates="salary_profile")

class EmployeePromotions(Base):
    __tablename__ = "employee_promotions"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    designation = Column(Text, nullable=False)
    appointed_date = Column(Date, nullable=False)
    remark = Column(Text)
    
    # Relationships
    employee = relationship("Employee", back_populates="promotions", lazy='select')

class EmployeesAssets(Base):
    __tablename__ = "employees_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False)
    asset_id = Column(Integer, ForeignKey("company_assets.id"), nullable=False)
    assign_reason = Column(Text)
    revoke_assignment = Column(Boolean, nullable=False, default=False)
    
    # Relationships
    employee = relationship("Employee", back_populates="assets", lazy='select')
    asset = relationship("CompanyAssets", back_populates="employee_assignments", lazy='select', viewonly=True)
