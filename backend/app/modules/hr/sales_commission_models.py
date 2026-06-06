"""
Sales Commission Models - Scenario 28A
Monthly Branch Sales Summary and Sales Officer Commission Calculation
"""
from sqlalchemy import (
    Column, Integer, String, Text, ForeignKey, Date, Numeric, TIMESTAMP,
    UniqueConstraint, Index
)
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.core import timezone as tz
from app.common.base_models import AuditMixin


class MonthlyBranchSalesSummary(Base, AuditMixin):
    """
    Monthly aggregated sales data per branch for commission calculation.
    Stores revenue, costs, returns, discounts, and calculated gross profit.
    """
    __tablename__ = "monthly_branch_sales_summary"

    id = Column(Integer, primary_key=True, index=True)
    branch_code = Column(String(200), ForeignKey("branches.branch_code"), nullable=False)
    fiscal_year = Column(Integer, nullable=False)
    fiscal_month = Column(Integer, nullable=False)  # 1-12
    month_name = Column(String(50), nullable=False)  # 'January 2026'
    period_start_date = Column(Date, nullable=False)
    period_end_date = Column(Date, nullable=False)
    
    # Financials
    total_sales_revenue = Column(Numeric(60, 2), nullable=False, default=0)
    total_sales_cost = Column(Numeric(60, 2), nullable=False, default=0)  # COGS
    total_sales_returns = Column(Numeric(60, 2), nullable=False, default=0)
    total_discounts = Column(Numeric(60, 2), nullable=False, default=0)
    net_sales_revenue = Column(Numeric(60, 2), nullable=False, default=0)  # Revenue - Returns - Discounts
    gross_profit = Column(Numeric(60, 2), nullable=False, default=0)  # Net Revenue - COGS
    gross_profit_margin = Column(Numeric(10, 4), nullable=True)  # (Gross Profit / Net Revenue) * 100
    total_invoices = Column(Integer, nullable=True, default=0)
    
    # Workflow
    status = Column(String(30), nullable=False, default="draft")  # draft, finalized, commission_calculated
    finalized_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    finalized_at = Column(TIMESTAMP, nullable=True)
    
    # Timestamps
    created_at = Column(TIMESTAMP, nullable=True, default=tz.now)
    updated_at = Column(TIMESTAMP, nullable=True, default=tz.now, onupdate=tz.now)
    
    # Unique constraint
    __table_args__ = (
        UniqueConstraint('branch_code', 'fiscal_year', 'fiscal_month', name='monthly_branch_sales_unique'),
        Index('idx_mbs_branch_period', 'branch_code', 'fiscal_year', 'fiscal_month'),
    )
    
    # Relationships
    branch = relationship("Branch", lazy="select")
    finalized_by_user = relationship("User", foreign_keys=[finalized_by], lazy="select")
    commissions = relationship("SalesOfficerMonthlyCommission", back_populates="monthly_summary", lazy="select")


class SalesOfficerMonthlyCommission(Base, AuditMixin):
    """
    Individual commission record for each Sales Officer based on branch profitability.
    Formula: Individual = (Branch Gross Profit × Commission %) ÷ Number of Sales Officers in Branch
    """
    __tablename__ = "sales_officer_monthly_commissions"

    id = Column(Integer, primary_key=True, index=True)
    monthly_sales_summary_id = Column(Integer, ForeignKey("monthly_branch_sales_summary.id"), nullable=False)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    branch_code = Column(String(200), ForeignKey("branches.branch_code"), nullable=False)
    fiscal_year = Column(Integer, nullable=False)
    fiscal_month = Column(Integer, nullable=False)
    
    # Commission calculation fields
    branch_gross_profit = Column(Numeric(60, 2), nullable=False)  # Total branch profit for the month
    commission_percentage = Column(Numeric(5, 2), nullable=False)  # e.g., 2.50 for 2.5%
    total_commission_pool = Column(Numeric(60, 2), nullable=False)  # Branch Profit × Commission %
    total_branch_employees = Column(Integer, nullable=False)  # Number of sales officers in branch
    individual_commission_amount = Column(Numeric(60, 2), nullable=False)  # Pool / Number of Employees
    
    # Workflow
    status = Column(String(30), nullable=False, default="pending")  # pending, approved, paid
    approved_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    approved_at = Column(TIMESTAMP, nullable=True)
    paid_in_payroll_id = Column(Integer, ForeignKey("employee_payroll.id"), nullable=True)
    remarks = Column(Text, nullable=True)
    
    # Timestamps
    created_at = Column(TIMESTAMP, nullable=True, default=tz.now)
    updated_at = Column(TIMESTAMP, nullable=True, default=tz.now, onupdate=tz.now)
    
    # Unique constraint
    __table_args__ = (
        UniqueConstraint('employee_id', 'fiscal_year', 'fiscal_month', name='sales_commission_unique'),
        Index('idx_sales_comm_employee', 'employee_id', 'fiscal_year', 'fiscal_month'),
        Index('idx_sales_comm_branch', 'branch_code', 'fiscal_year', 'fiscal_month'),
    )
    
    # Relationships
    monthly_summary = relationship("MonthlyBranchSalesSummary", back_populates="commissions", lazy="select")
    employee = relationship("Employee", lazy="select")
    branch = relationship("Branch", lazy="select")
    approved_by_user = relationship("User", foreign_keys=[approved_by], lazy="select")
    payroll = relationship("EmployeePayroll", lazy="select")
