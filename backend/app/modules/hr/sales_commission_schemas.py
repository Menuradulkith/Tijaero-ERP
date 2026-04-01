"""
Sales Commission Schemas - Scenario 28A
Pydantic schemas for Monthly Branch Sales Summary and Sales Officer Commission
"""
from pydantic import BaseModel
from typing import Optional, List
from decimal import Decimal
from datetime import date

from app.common.base_schemas import TijaeroBaseSchema


# ============================================================================
# Monthly Branch Sales Summary Schemas
# ============================================================================

class MonthlyBranchSalesSummaryBase(BaseModel):
    branch_code: str
    fiscal_year: int
    fiscal_month: int
    month_name: str
    period_start_date: date
    period_end_date: date


class MonthlyBranchSalesSummaryCreate(BaseModel):
    """Request to generate monthly sales summary"""
    fiscal_year: int
    fiscal_month: int
    branch_code: Optional[str] = None  # If None, generate for all branches


class MonthlyBranchSalesSummaryResponse(TijaeroBaseSchema, MonthlyBranchSalesSummaryBase):
    id: int
    total_sales_revenue: Decimal
    total_sales_cost: Decimal
    total_sales_returns: Decimal
    total_discounts: Decimal
    net_sales_revenue: Decimal
    gross_profit: Decimal
    gross_profit_margin: Optional[Decimal] = None
    total_invoices: Optional[int] = None
    status: str
    finalized_by: Optional[int] = None
    finalized_at: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    # Resolved fields
    branch_name: Optional[str] = None
    finalized_by_name: Optional[str] = None


class MonthlyBranchSalesSummaryWithCommissions(MonthlyBranchSalesSummaryResponse):
    """Summary with associated commission records"""
    commissions: List["SalesOfficerCommissionResponse"] = []


class FinalizeSummaryRequest(BaseModel):
    """Request to finalize a sales summary"""
    remarks: Optional[str] = None


# ============================================================================
# Sales Officer Monthly Commission Schemas
# ============================================================================

class SalesOfficerCommissionBase(BaseModel):
    employee_id: int
    branch_code: str
    fiscal_year: int
    fiscal_month: int


class SalesOfficerCommissionResponse(TijaeroBaseSchema):
    id: int
    monthly_sales_summary_id: int
    employee_id: int
    branch_code: str
    fiscal_year: int
    fiscal_month: int
    branch_gross_profit: Decimal
    commission_percentage: Decimal
    total_commission_pool: Decimal
    total_branch_employees: int
    individual_commission_amount: Decimal
    status: str
    approved_by: Optional[int] = None
    approved_at: Optional[str] = None
    paid_in_payroll_id: Optional[int] = None
    remarks: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    # Resolved fields
    employee_name: Optional[str] = None
    branch_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    month_name: Optional[str] = None


class ApproveCommissionRequest(BaseModel):
    """Request to approve commissions"""
    remarks: Optional[str] = None


class RejectCommissionRequest(BaseModel):
    """Request to reject commissions"""
    rejection_reason: str


class BulkApproveCommissionsRequest(BaseModel):
    """Request to bulk approve multiple commissions"""
    commission_ids: List[int]
    remarks: Optional[str] = None


# ============================================================================
# List Filters
# ============================================================================

class SalesSummaryListFilter(BaseModel):
    branch_code: Optional[str] = None
    fiscal_year: Optional[int] = None
    fiscal_month: Optional[int] = None
    status: Optional[str] = None
    skip: int = 0
    limit: int = 100


class SalesCommissionListFilter(BaseModel):
    employee_id: Optional[int] = None
    branch_code: Optional[str] = None
    fiscal_year: Optional[int] = None
    fiscal_month: Optional[int] = None
    status: Optional[str] = None
    monthly_sales_summary_id: Optional[int] = None
    skip: int = 0
    limit: int = 100


# ============================================================================
# Reports / Analytics
# ============================================================================

class BranchCommissionSummary(BaseModel):
    """Aggregated commission data per branch"""
    branch_code: str
    branch_name: Optional[str] = None
    fiscal_year: int
    fiscal_month: int
    month_name: str
    total_gross_profit: Decimal
    commission_percentage: Decimal
    total_commission_pool: Decimal
    total_sales_officers: int
    total_approved: int
    total_pending: int
    total_paid: int


class CommissionDashboardStats(BaseModel):
    """Dashboard statistics for commission overview"""
    total_summaries_pending: int
    total_summaries_finalized: int
    total_commissions_pending: int
    total_commissions_approved: int
    total_commissions_paid: int
    total_pending_amount: Decimal
    total_approved_amount: Decimal
    total_paid_amount: Decimal
    total_pending_amount: Decimal
    total_approved_amount: Decimal
    total_paid_amount: Decimal


# Forward reference update
MonthlyBranchSalesSummaryWithCommissions.model_rebuild()
