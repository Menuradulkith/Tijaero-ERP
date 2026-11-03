from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, DateTime, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin, AuditMixin


class SalaryDeductions(Base, AuditMixin):
    __tablename__ = "salary_deductions"

    id = Column(Integer, primary_key=True, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    reason = Column(Text, nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    # Enhanced fields for payroll processing
    deduction_period = Column(String(7), nullable=True)  # YYYY-MM
    epf_employee = Column(Numeric(60, 2), nullable=True)
    etf_employee = Column(Numeric(60, 2), nullable=True)
    stamp_duty = Column(Numeric(60, 2), nullable=True)
    late_deductions = Column(Numeric(60, 2), nullable=True)
    salary_advance_repayment = Column(Numeric(60, 2), nullable=True)
    loan_repayment = Column(Numeric(60, 2), nullable=True)
    other_deductions = Column(Numeric(60, 2), nullable=True)
    remarks = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_date = Column(TIMESTAMP, nullable=True)

    # Relationships
    employee = relationship("Employee", back_populates="salary_deductions")
    approval = relationship("Approvals", back_populates="salary_deductions")


class PayrollBatch(Base, AuditMixin):
    """Payroll batch - groups all payroll records for a specific period"""
    __tablename__ = "payroll_batches"

    id = Column(Integer, primary_key=True, index=True)
    batch_no = Column(String(50), unique=True, nullable=False, index=True)
    payroll_month = Column(Integer, nullable=False)
    payroll_year = Column(Integer, nullable=False)
    description = Column(Text, nullable=True)
    # Workflow
    status = Column(String(30), nullable=False, default="draft")
    # Totals
    total_employees = Column(Integer, nullable=True, default=0)
    total_gross_salary = Column(Numeric(60, 2), nullable=True, default=0)
    total_deductions = Column(Numeric(60, 2), nullable=True, default=0)
    total_net_salary = Column(Numeric(60, 2), nullable=True, default=0)
    total_employer_epf = Column(Numeric(60, 2), nullable=True, default=0)
    total_employer_etf = Column(Numeric(60, 2), nullable=True, default=0)
    total_employer_cost = Column(Numeric(60, 2), nullable=True, default=0)
    total_apit = Column(Numeric(60, 2), nullable=True, default=0)
    # Audit
    created_by = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, nullable=True)
    approved_by = Column(Integer, nullable=True)
    approved_date = Column(TIMESTAMP, nullable=True)
    # Payment
    salary_payment_date = Column(Date, nullable=True)
    salary_payment_reference = Column(String(200), nullable=True)
    statutory_payment_date = Column(Date, nullable=True)
    statutory_payment_reference = Column(String(200), nullable=True)
    completed_date = Column(TIMESTAMP, nullable=True)


class Reimbursements(Base, AuditMixin):
    __tablename__ = "reimbursements"

    id = Column(Integer, primary_key=True, index=True)
    reimbursement_no = Column(String(50), unique=True, nullable=False, index=True)
    employee_id = Column(Text, ForeignKey("employees.employee_id"), nullable=False, index=True)
    branch_code = Column(String(20), ForeignKey("branches.branch_code"), nullable=False)
    claim_date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    reimbursement_type = Column(String(50), nullable=False, default="general")
    total_amount = Column(Numeric(15, 2), nullable=False, default=0)
    approved_amount = Column(Numeric(15, 2), nullable=True)
    status = Column(String(30), nullable=False, default="pending")
    # Approval
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)
    approved_date = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    # Finance verification
    verified_by = Column(Integer, nullable=True)
    verified_date = Column(DateTime, nullable=True)
    # Payment
    payment_status = Column(String(30), nullable=True)
    payment_date = Column(DateTime, nullable=True)
    payment_method = Column(String(50), nullable=True)
    payment_reference = Column(String(100), nullable=True)
    paid_amount = Column(Numeric(15, 2), nullable=True)
    remark = Column(Text, nullable=True)
    bill_image_path = Column(Text, nullable=True)

    # Relationships
    employee = relationship("Employee", back_populates="reimbursements")
    branch = relationship("Branch", lazy="select")
    approval = relationship("Approvals", back_populates="reimbursements")
    items = relationship("ReimbursementItem", back_populates="reimbursement", cascade="all, delete-orphan", lazy="select")


class ReimbursementItem(Base, AuditMixin):
    __tablename__ = "reimbursement_items"

    id = Column(Integer, primary_key=True, index=True)
    reimbursement_id = Column(Integer, ForeignKey("reimbursements.id", ondelete="CASCADE"), nullable=False)
    expense_type = Column(String(50), nullable=False)
    item_description = Column(Text, nullable=True)
    amount = Column(Numeric(15, 2), nullable=False, default=0)
    receipt_date = Column(Date, nullable=True)
    receipt_number = Column(String(100), nullable=True)

    # Relationships
    reimbursement = relationship("Reimbursements", back_populates="items")


class HRPayrollSettings(Base, AuditMixin):
    """Company-wide payroll rules (one row). Statutory defaults are Sri Lankan; APIT brackets stay in code."""
    __tablename__ = "hr_payroll_settings"

    id = Column(Integer, primary_key=True, index=True)
    epf_employee_rate = Column(Numeric(5, 2), nullable=False, default=8)
    epf_employer_rate = Column(Numeric(5, 2), nullable=False, default=12)
    etf_rate = Column(Numeric(5, 2), nullable=False, default=3)
    # Overtime: hourly rate = (basic + EPF-liable allowances) / ot_divisor, paid at ot_multiplier
    pay_overtime = Column(Boolean, nullable=False, default=True)
    ot_multiplier = Column(Numeric(4, 2), nullable=False, default=1.5)
    ot_divisor = Column(Integer, nullable=False, default=240)
    # Late minutes from attendance cut at the plain hourly rate
    deduct_late = Column(Boolean, nullable=False, default=False)
    # Stamp duty on the salary receipt when gross pay is above the threshold
    stamp_duty_amount = Column(Numeric(10, 2), nullable=False, default=25)
    stamp_duty_threshold = Column(Numeric(15, 2), nullable=False, default=25000)
    # Payment of Gratuity Act: half a month's salary per completed year after 5 years
    gratuity_enabled = Column(Boolean, nullable=False, default=True)
    employer_epf_no = Column(String(30), nullable=True)
    employer_tin = Column(String(30), nullable=True)


class HREmployeeLoan(Base, AuditMixin):
    """Company loan or salary advance, recovered in monthly instalments through payroll."""
    __tablename__ = "hr_employee_loans"

    id = Column(Integer, primary_key=True, index=True)
    loan_no = Column(String(30), unique=True, nullable=False, index=True)
    employee_pk = Column(Integer, ForeignKey("employees.id"), nullable=False, index=True)
    # loan | advance
    loan_type = Column(String(10), nullable=False, default="loan")
    issue_date = Column(Date, nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    installment_amount = Column(Numeric(15, 2), nullable=False)
    installments = Column(Integer, nullable=False, default=1)
    # First payroll period (YYYY-MM) that recovers an instalment
    start_period = Column(String(7), nullable=False)
    payment_method = Column(String(20), nullable=False, default="bank_transfer")
    # active | settled | cancelled
    status = Column(String(15), nullable=False, default="active", index=True)
    remarks = Column(Text, nullable=True)

    recoveries = relationship("HRLoanRecovery", back_populates="loan", cascade="all, delete-orphan", lazy="select")


class HRLoanRecovery(Base, AuditMixin):
    __tablename__ = "hr_loan_recoveries"

    id = Column(Integer, primary_key=True, index=True)
    loan_id = Column(Integer, ForeignKey("hr_employee_loans.id", ondelete="CASCADE"), nullable=False, index=True)
    period = Column(String(7), nullable=False)
    amount = Column(Numeric(15, 2), nullable=False)
    # Set when withheld from a payroll record; NULL for a cash / bank repayment
    payroll_id = Column(Integer, ForeignKey("employee_payroll.id", ondelete="CASCADE"), nullable=True, index=True)
    payment_date = Column(Date, nullable=True)
    remarks = Column(Text, nullable=True)

    loan = relationship("HREmployeeLoan", back_populates="recoveries")
