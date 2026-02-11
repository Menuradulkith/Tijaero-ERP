"""
Sales Commission API - Scenario 28A
REST endpoints for Monthly Branch Sales Summary and Sales Officer Commission
"""
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional

from app.db.session import get_db
from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.modules.hr import sales_commission_schemas as schemas
from app.modules.hr.sales_commission_service import SalesCommissionService

router = APIRouter(prefix="/sales-commissions", tags=["sales-commissions"])


# =============================================================================
# Monthly Branch Sales Summary Endpoints
# =============================================================================

@router.post("/summaries/generate", response_model=List[schemas.MonthlyBranchSalesSummaryResponse])
def generate_monthly_summary(
    data: schemas.MonthlyBranchSalesSummaryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Step 1: Generate monthly sales summary for branches.
    Calculates revenue, COGS, returns, discounts, net revenue, and gross profit.
    If branch_code is None, generates for all branches.
    """
    service = SalesCommissionService(db)
    return service.generate_monthly_summary(data, current_user.id)


@router.get("/summaries", response_model=List[schemas.MonthlyBranchSalesSummaryResponse])
def list_summaries(
    branch_code: Optional[str] = Query(None),
    fiscal_year: Optional[int] = Query(None),
    fiscal_month: Optional[int] = Query(None, ge=1, le=12),
    status: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all monthly sales summaries with optional filters"""
    service = SalesCommissionService(db)
    filters = schemas.SalesSummaryListFilter(
        branch_code=branch_code,
        fiscal_year=fiscal_year,
        fiscal_month=fiscal_month,
        status=status,
        skip=skip,
        limit=limit,
    )
    return service.list_summaries(filters)


@router.get("/summaries/{summary_id}", response_model=schemas.MonthlyBranchSalesSummaryWithCommissions)
def get_summary(
    summary_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single summary with its associated commissions"""
    service = SalesCommissionService(db)
    return service.get_summary(summary_id)


@router.post("/summaries/{summary_id}/finalize", response_model=schemas.MonthlyBranchSalesSummaryResponse)
def finalize_summary(
    summary_id: int,
    data: schemas.FinalizeSummaryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Step 2: Finance Accountant finalizes the summary after review.
    This enables commission calculation.
    """
    service = SalesCommissionService(db)
    return service.finalize_summary(summary_id, data, current_user.id)


@router.post("/summaries/{summary_id}/calculate-commissions", response_model=List[schemas.SalesOfficerCommissionResponse])
def calculate_commissions(
    summary_id: int,
    commission_percentage: Optional[float] = Query(None, ge=0, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Step 3: Calculate individual commissions for each Sales Officer in the branch.
    Formula: Individual = (Branch Gross Profit × Commission %) ÷ Number of Sales Officers
    
    Only runs if summary is finalized. No commission if branch made a loss.
    """
    service = SalesCommissionService(db)
    from decimal import Decimal
    comm_pct = Decimal(str(commission_percentage)) if commission_percentage else None
    return service.calculate_commissions(summary_id, comm_pct)


# =============================================================================
# Sales Officer Commission Endpoints
# =============================================================================

@router.get("/commissions", response_model=List[schemas.SalesOfficerCommissionResponse])
def list_commissions(
    employee_id: Optional[int] = Query(None),
    branch_code: Optional[str] = Query(None),
    fiscal_year: Optional[int] = Query(None),
    fiscal_month: Optional[int] = Query(None, ge=1, le=12),
    status: Optional[str] = Query(None),
    monthly_sales_summary_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all commission records with optional filters"""
    service = SalesCommissionService(db)
    filters = schemas.SalesCommissionListFilter(
        employee_id=employee_id,
        branch_code=branch_code,
        fiscal_year=fiscal_year,
        fiscal_month=fiscal_month,
        status=status,
        monthly_sales_summary_id=monthly_sales_summary_id,
        skip=skip,
        limit=limit,
    )
    return service.list_commissions(filters)


@router.get("/commissions/{commission_id}", response_model=schemas.SalesOfficerCommissionResponse)
def get_commission(
    commission_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single commission record by ID"""
    service = SalesCommissionService(db)
    return service.get_commission(commission_id)


@router.post("/commissions/{commission_id}/approve", response_model=schemas.SalesOfficerCommissionResponse)
def approve_commission(
    commission_id: int,
    data: schemas.ApproveCommissionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Step 5: Finance Manager approves an individual commission.
    Commission becomes ready for payroll inclusion.
    """
    service = SalesCommissionService(db)
    return service.approve_commission(commission_id, data, current_user.id)


@router.post("/commissions/bulk-approve", response_model=List[schemas.SalesOfficerCommissionResponse])
def bulk_approve_commissions(
    data: schemas.BulkApproveCommissionsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bulk approve multiple commissions at once"""
    service = SalesCommissionService(db)
    return service.bulk_approve_commissions(data, current_user.id)


@router.post("/commissions/{commission_id}/reject", response_model=schemas.SalesOfficerCommissionResponse)
def reject_commission(
    commission_id: int,
    data: schemas.RejectCommissionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Reject a commission with reason"""
    service = SalesCommissionService(db)
    return service.reject_commission(commission_id, data, current_user.id)


# =============================================================================
# Payroll Integration Endpoints
# =============================================================================

@router.get("/payroll-ready", response_model=List[schemas.SalesOfficerCommissionResponse])
def get_commissions_for_payroll(
    fiscal_year: int = Query(...),
    fiscal_month: int = Query(..., ge=1, le=12),
    employee_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Step 6: Get approved commissions ready for payroll.
    Used by Payroll system to include in employee salary.
    """
    service = SalesCommissionService(db)
    return service.get_approved_commissions_for_payroll(fiscal_year, fiscal_month, employee_id)


@router.post("/commissions/{commission_id}/mark-paid", response_model=schemas.SalesOfficerCommissionResponse)
def mark_commission_paid(
    commission_id: int,
    payroll_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark commission as paid and link to payroll record"""
    service = SalesCommissionService(db)
    return service.mark_commission_as_paid(commission_id, payroll_id)


# =============================================================================
# Dashboard / Analytics Endpoints
# =============================================================================

@router.get("/dashboard/stats", response_model=schemas.CommissionDashboardStats)
def get_dashboard_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get overview statistics for commission dashboard"""
    service = SalesCommissionService(db)
    return service.get_dashboard_stats()
