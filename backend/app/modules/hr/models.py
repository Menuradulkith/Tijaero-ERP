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
