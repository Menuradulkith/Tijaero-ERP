"""
Sales Commission Service - Scenario 28A
Service layer for Monthly Branch Sales Summary and Sales Officer Commission Calculation
"""
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from fastapi import HTTPException, status
from typing import List, Optional
from decimal import Decimal
from datetime import datetime, date
import calendar

from app.modules.hr.sales_commission_models import (
    MonthlyBranchSalesSummary,
    SalesOfficerMonthlyCommission,
)
from app.modules.hr import sales_commission_schemas as schemas
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn
from app.modules.products.models import Product
from app.modules.employees.models import Employee, EmployeeSalaryProfile
from app.auth.models import Branch, User


class SalesCommissionService:
    """
    Service for calculating and managing sales officer commissions based on branch profitability.
    
    Workflow:
    1. Generate Monthly Branch Sales Summary (calculates revenue, COGS, profit)
    2. Finance reviews and finalizes summary
    3. System calculates individual commissions for each Sales Officer
    4. Finance Manager approves commissions
    5. Commissions integrated into payroll
    """
    
    # Default commission percentage (can be made configurable via settings table)
    DEFAULT_COMMISSION_PERCENTAGE = Decimal("2.50")  # 2.5%
    
    # Designation that qualifies for sales commission
    SALES_OFFICER_DESIGNATION = "Sales Officer"
    
    def __init__(self, db: Session):
        self.db = db
    
    # =========================================================================
    # Helper Methods
    # =========================================================================
    
    def _get_month_name(self, year: int, month: int) -> str:
        """Return formatted month name like 'January 2026'"""
        return f"{calendar.month_name[month]} {year}"
    
    def _get_period_dates(self, year: int, month: int) -> tuple[date, date]:
        """Return start and end date for a given month"""
        start_date = date(year, month, 1)
        last_day = calendar.monthrange(year, month)[1]
        end_date = date(year, month, last_day)
        return start_date, end_date
    
    def _resolve_user_name(self, user_id: Optional[int]) -> Optional[str]:
        """Resolve user ID to full name"""
        if not user_id:
            return None
        user = self.db.query(User).filter(User.id == user_id).first()
        if user:
            return f"{user.first_name} {user.last_name}".strip()
        return str(user_id)
    
    def _resolve_branch_name(self, branch_code: str) -> Optional[str]:
        """Resolve branch code to branch name"""
        branch = self.db.query(Branch).filter(Branch.branch_code == branch_code).first()
        return branch.branch_name if branch else branch_code
    
    def _resolve_employee_name(self, employee_id: int) -> Optional[str]:
        """Resolve employee ID to full name via user relationship"""
        employee = self.db.query(Employee).filter(Employee.id == employee_id).first()
        if employee and employee.user:
            return f"{employee.user.first_name} {employee.user.last_name}".strip()
        return str(employee_id) if employee else None
    
    def _summary_to_response(self, s: MonthlyBranchSalesSummary) -> schemas.MonthlyBranchSalesSummaryResponse:
        """Convert ORM model to response schema"""
        return schemas.MonthlyBranchSalesSummaryResponse(
            id=s.id,
            branch_code=s.branch_code,
            fiscal_year=s.fiscal_year,
            fiscal_month=s.fiscal_month,
            month_name=s.month_name,
            period_start_date=s.period_start_date,
            period_end_date=s.period_end_date,
            total_sales_revenue=s.total_sales_revenue or Decimal("0"),
            total_sales_cost=s.total_sales_cost or Decimal("0"),
            total_sales_returns=s.total_sales_returns or Decimal("0"),
            total_discounts=s.total_discounts or Decimal("0"),
            net_sales_revenue=s.net_sales_revenue or Decimal("0"),
            gross_profit=s.gross_profit or Decimal("0"),
            gross_profit_margin=s.gross_profit_margin,
            total_invoices=s.total_invoices,
            status=s.status,
            finalized_by=s.finalized_by,
            finalized_at=str(s.finalized_at) if s.finalized_at else None,
            created_at=str(s.created_at) if s.created_at else None,
            updated_at=str(s.updated_at) if s.updated_at else None,
            branch_name=self._resolve_branch_name(s.branch_code),
            finalized_by_name=self._resolve_user_name(s.finalized_by),
        )
    
    def _commission_to_response(self, c: SalesOfficerMonthlyCommission) -> schemas.SalesOfficerCommissionResponse:
        """Convert ORM model to response schema"""
        return schemas.SalesOfficerCommissionResponse(
            id=c.id,
            monthly_sales_summary_id=c.monthly_sales_summary_id,
            employee_id=c.employee_id,
            branch_code=c.branch_code,
            fiscal_year=c.fiscal_year,
            fiscal_month=c.fiscal_month,
            branch_gross_profit=c.branch_gross_profit or Decimal("0"),
            commission_percentage=c.commission_percentage or Decimal("0"),
            total_commission_pool=c.total_commission_pool or Decimal("0"),
            total_branch_employees=c.total_branch_employees or 0,
            individual_commission_amount=c.individual_commission_amount or Decimal("0"),
            status=c.status,
            approved_by=c.approved_by,
            approved_at=str(c.approved_at) if c.approved_at else None,
            paid_in_payroll_id=c.paid_in_payroll_id,
            remarks=c.remarks,
            created_at=str(c.created_at) if c.created_at else None,
            updated_at=str(c.updated_at) if c.updated_at else None,
            employee_name=self._resolve_employee_name(c.employee_id),
            branch_name=self._resolve_branch_name(c.branch_code),
            approved_by_name=self._resolve_user_name(c.approved_by),
            month_name=self._get_month_name(c.fiscal_year, c.fiscal_month),
        )
    
    # =========================================================================
    # Step 1: Generate Monthly Branch Sales Summary
    # =========================================================================
    
    def generate_monthly_summary(
        self, 
        data: schemas.MonthlyBranchSalesSummaryCreate,
        user_id: int
    ) -> List[schemas.MonthlyBranchSalesSummaryResponse]:
        """
        Generate monthly sales summary for one or all branches.
        Calculates: Revenue, COGS, Returns, Discounts, Net Revenue, Gross Profit
        """
        year, month = data.fiscal_year, data.fiscal_month
        start_date, end_date = self._get_period_dates(year, month)
        month_name = self._get_month_name(year, month)
        
        # Get branches to process
        if data.branch_code:
            branches = [data.branch_code]
        else:
            # Get all branches
            branch_records = self.db.query(Branch.branch_code).all()
            branches = [b.branch_code for b in branch_records]
        
        results = []
        
        for branch_code in branches:
            # Check if summary already exists
            existing = self.db.query(MonthlyBranchSalesSummary).filter(
                MonthlyBranchSalesSummary.branch_code == branch_code,
                MonthlyBranchSalesSummary.fiscal_year == year,
                MonthlyBranchSalesSummary.fiscal_month == month,
            ).first()
            
            if existing and existing.status != "draft":
                # Skip if already finalized
                results.append(self._summary_to_response(existing))
                continue
            
            # A. Calculate Total Sales Revenue
            # Query: SUM(invoices.grand_total) WHERE branch and date range
            revenue_query = self.db.query(
                func.coalesce(func.sum(Invoice.grand_total), 0).label("total_revenue"),
                func.count(Invoice.id).label("invoice_count"),
            ).filter(
                Invoice.branch_code == branch_code,
                Invoice.created_date >= start_date,
                Invoice.created_date <= end_date,
                Invoice.status == True,  # Only confirmed invoices
            ).first()
            
            total_sales_revenue = Decimal(str(revenue_query.total_revenue or 0))
            total_invoices = revenue_query.invoice_count or 0
            
            # B. Calculate Total Sales Cost (COGS)
            # Query: SUM(invoice_items.quantity × products.cost_price)
            cogs_query = self.db.query(
                func.coalesce(
                    func.sum(InvoiceItems.quantity * Product.cost_price), 0
                ).label("total_cogs")
            ).join(
                Invoice, InvoiceItems.invoice_id == Invoice.id
            ).join(
                Product, InvoiceItems.product_id == Product.id
            ).filter(
                Invoice.branch_code == branch_code,
                Invoice.created_date >= start_date,
                Invoice.created_date <= end_date,
                Invoice.status == True,
            ).first()
            
            total_sales_cost = Decimal(str(cogs_query.total_cogs or 0))
            
            # C. Calculate Total Sales Returns
            # Query: SUM(sale_return.total_refund) WHERE status = processed/approved
            returns_query = self.db.query(
                func.coalesce(func.sum(SaleReturn.total_refund), 0).label("total_returns")
            ).filter(
                SaleReturn.branch_code == branch_code,
                SaleReturn.added_date >= start_date,
                SaleReturn.added_date <= end_date,
                SaleReturn.status.in_(["approved", "processed"]),
            ).first()
            
            total_sales_returns = Decimal(str(returns_query.total_returns or 0))
            
            # D. Calculate Total Discounts
            # Query: SUM(invoices.discount_amount + invoices.cupon_amount)
            discounts_query = self.db.query(
                func.coalesce(
                    func.sum(Invoice.discount_amount + Invoice.cupon_amount), 0
                ).label("total_discounts")
            ).filter(
                Invoice.branch_code == branch_code,
                Invoice.created_date >= start_date,
                Invoice.created_date <= end_date,
                Invoice.status == True,
            ).first()
            
            total_discounts = Decimal(str(discounts_query.total_discounts or 0))
            
            # E. Calculate Net Sales Revenue
            net_sales_revenue = total_sales_revenue - total_sales_returns - total_discounts
            
            # F. Calculate Gross Profit
            gross_profit = net_sales_revenue - total_sales_cost
            
            # G. Calculate Gross Profit Margin
            gross_profit_margin = None
            if net_sales_revenue > 0:
                gross_profit_margin = (gross_profit / net_sales_revenue) * 100
            
            # Create or update the summary record
            if existing:
                existing.total_sales_revenue = total_sales_revenue
                existing.total_sales_cost = total_sales_cost
                existing.total_sales_returns = total_sales_returns
                existing.total_discounts = total_discounts
                existing.net_sales_revenue = net_sales_revenue
                existing.gross_profit = gross_profit
                existing.gross_profit_margin = gross_profit_margin
                existing.total_invoices = total_invoices
                existing.updated_at = datetime.utcnow()
                summary = existing
            else:
                summary = MonthlyBranchSalesSummary(
                    branch_code=branch_code,
                    fiscal_year=year,
                    fiscal_month=month,
                    month_name=month_name,
                    period_start_date=start_date,
                    period_end_date=end_date,
                    total_sales_revenue=total_sales_revenue,
                    total_sales_cost=total_sales_cost,
                    total_sales_returns=total_sales_returns,
                    total_discounts=total_discounts,
                    net_sales_revenue=net_sales_revenue,
                    gross_profit=gross_profit,
                    gross_profit_margin=gross_profit_margin,
                    total_invoices=total_invoices,
                    status="draft",
                    created_at=datetime.utcnow(),
                )
                self.db.add(summary)
            
            self.db.flush()
            results.append(self._summary_to_response(summary))
        
        self.db.commit()
        return results
    
    # =========================================================================
    # Step 2: Finance Finalizes Summary
    # =========================================================================
    
    def finalize_summary(
        self, 
        summary_id: int, 
        data: schemas.FinalizeSummaryRequest,
        user_id: int
    ) -> schemas.MonthlyBranchSalesSummaryResponse:
        """
        Finance Accountant reviews and finalizes the summary.
        This triggers commission calculation.
        """
        summary = self.db.query(MonthlyBranchSalesSummary).filter(
            MonthlyBranchSalesSummary.id == summary_id
        ).first()
        
        if not summary:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary not found")
        
        if summary.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail=f"Cannot finalize summary in '{summary.status}' status"
            )
        
        # Update status
        summary.status = "finalized"
        summary.finalized_by = user_id
        summary.finalized_at = datetime.utcnow()
        summary.updated_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(summary)
        
        return self._summary_to_response(summary)
    
    # =========================================================================
    # Step 3: Calculate Sales Officer Commissions
    # =========================================================================
    
    def calculate_commissions(
        self, 
        summary_id: int,
        commission_percentage: Optional[Decimal] = None
    ) -> List[schemas.SalesOfficerCommissionResponse]:
        """
        Calculate individual commission for each Sales Officer in the branch.
        Formula: Individual = (Branch Gross Profit × Commission %) ÷ Number of Sales Officers
        
        Only runs if summary is finalized.
        """
        summary = self.db.query(MonthlyBranchSalesSummary).filter(
            MonthlyBranchSalesSummary.id == summary_id
        ).first()
        
        if not summary:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary not found")
        
        if summary.status not in ["finalized", "commission_calculated"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, 
                detail="Summary must be finalized before calculating commissions"
            )
        
        # Check if commissions already exist for this summary
        existing_commissions = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.monthly_sales_summary_id == summary_id
        ).all()
        
        if existing_commissions:
            # Return existing commissions
            return [self._commission_to_response(c) for c in existing_commissions]
        
        # Get branch gross profit
        branch_gross_profit = summary.gross_profit
        
        # No commission if branch made a loss
        if branch_gross_profit <= 0:
            summary.status = "commission_calculated"
            self.db.commit()
            return []
        
        # Get commission percentage
        comm_pct = commission_percentage or self.DEFAULT_COMMISSION_PERCENTAGE
        
        # Calculate total commission pool
        total_commission_pool = branch_gross_profit * (comm_pct / Decimal("100"))
        
        # Find all Sales Officers in this branch
        # Join Employee -> User -> branches (many-to-many)
        # Also check EmployeeSalaryProfile.designation = 'Sales Officer'
        sales_officers = self.db.query(Employee).join(
            EmployeeSalaryProfile,
            Employee.employee_id == EmployeeSalaryProfile.employee_id
        ).join(
            User, Employee.user_id == User.id
        ).filter(
            EmployeeSalaryProfile.designation == self.SALES_OFFICER_DESIGNATION,
            User.is_active == True,
            User.branches.any(Branch.branch_code == summary.branch_code),
        ).all()
        
        if not sales_officers:
            # No sales officers in this branch
            summary.status = "commission_calculated"
            self.db.commit()
            return []
        
        total_officers = len(sales_officers)
        individual_commission = (total_commission_pool / total_officers).quantize(Decimal("0.01"))
        
        results = []
        for emp in sales_officers:
            # Check if commission already exists for this employee/period
            existing = self.db.query(SalesOfficerMonthlyCommission).filter(
                SalesOfficerMonthlyCommission.employee_id == emp.id,
                SalesOfficerMonthlyCommission.fiscal_year == summary.fiscal_year,
                SalesOfficerMonthlyCommission.fiscal_month == summary.fiscal_month,
            ).first()
            
            if existing:
                results.append(self._commission_to_response(existing))
                continue
            
            commission = SalesOfficerMonthlyCommission(
                monthly_sales_summary_id=summary.id,
                employee_id=emp.id,
                branch_code=summary.branch_code,
                fiscal_year=summary.fiscal_year,
                fiscal_month=summary.fiscal_month,
                branch_gross_profit=branch_gross_profit,
                commission_percentage=comm_pct,
                total_commission_pool=total_commission_pool,
                total_branch_employees=total_officers,
                individual_commission_amount=individual_commission,
                status="pending",
                remarks=f"Auto-calculated from {summary.month_name} branch sales",
                created_at=datetime.utcnow(),
            )
            self.db.add(commission)
            self.db.flush()
            results.append(self._commission_to_response(commission))
        
        # Update summary status
        summary.status = "commission_calculated"
        summary.updated_at = datetime.utcnow()
        
        self.db.commit()
        return results
    
    # =========================================================================
    # Step 4 & 5: Approve / Reject Commissions
    # =========================================================================
    
    def approve_commission(
        self, 
        commission_id: int, 
        data: schemas.ApproveCommissionRequest,
        user_id: int
    ) -> schemas.SalesOfficerCommissionResponse:
        """Finance Manager approves an individual commission"""
        commission = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.id == commission_id
        ).first()
        
        if not commission:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commission not found")
        
        if commission.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve commission in '{commission.status}' status"
            )
        
        commission.status = "approved"
        commission.approved_by = user_id
        commission.approved_at = datetime.utcnow()
        if data.remarks:
            commission.remarks = data.remarks
        commission.updated_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(commission)
        return self._commission_to_response(commission)
    
    def bulk_approve_commissions(
        self,
        data: schemas.BulkApproveCommissionsRequest,
        user_id: int
    ) -> List[schemas.SalesOfficerCommissionResponse]:
        """Bulk approve multiple commissions"""
        results = []
        for comm_id in data.commission_ids:
            try:
                req = schemas.ApproveCommissionRequest(remarks=data.remarks)
                result = self.approve_commission(comm_id, req, user_id)
                results.append(result)
            except HTTPException:
                # Skip invalid ones
                continue
        return results
    
    def reject_commission(
        self, 
        commission_id: int, 
        data: schemas.RejectCommissionRequest,
        user_id: int
    ) -> schemas.SalesOfficerCommissionResponse:
        """Finance Manager rejects a commission"""
        commission = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.id == commission_id
        ).first()
        
        if not commission:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commission not found")
        
        if commission.status != "pending":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject commission in '{commission.status}' status"
            )
        
        # Delete the commission record (or mark as rejected)
        commission.status = "rejected"
        commission.remarks = f"Rejected: {data.rejection_reason}"
        commission.updated_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(commission)
        return self._commission_to_response(commission)
    
    # =========================================================================
    # Step 6: Payroll Integration
    # =========================================================================
    
    def get_approved_commissions_for_payroll(
        self, 
        fiscal_year: int, 
        fiscal_month: int,
        employee_id: Optional[int] = None
    ) -> List[schemas.SalesOfficerCommissionResponse]:
        """
        Get approved commissions ready for payroll inclusion.
        Called by PayrollService when generating payroll.
        """
        query = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.fiscal_year == fiscal_year,
            SalesOfficerMonthlyCommission.fiscal_month == fiscal_month,
            SalesOfficerMonthlyCommission.status == "approved",
        )
        
        if employee_id:
            query = query.filter(SalesOfficerMonthlyCommission.employee_id == employee_id)
        
        commissions = query.all()
        return [self._commission_to_response(c) for c in commissions]
    
    def mark_commission_as_paid(
        self, 
        commission_id: int, 
        payroll_id: int
    ) -> schemas.SalesOfficerCommissionResponse:
        """Mark commission as paid and link to payroll record"""
        commission = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.id == commission_id
        ).first()
        
        if not commission:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commission not found")
        
        commission.status = "paid"
        commission.paid_in_payroll_id = payroll_id
        commission.updated_at = datetime.utcnow()
        
        self.db.commit()
        self.db.refresh(commission)
        return self._commission_to_response(commission)
    
    # =========================================================================
    # List / Query Methods
    # =========================================================================
    
    def list_summaries(
        self, 
        filters: schemas.SalesSummaryListFilter
    ) -> List[schemas.MonthlyBranchSalesSummaryResponse]:
        """List all monthly sales summaries with filters"""
        query = self.db.query(MonthlyBranchSalesSummary)
        
        if filters.branch_code:
            query = query.filter(MonthlyBranchSalesSummary.branch_code == filters.branch_code)
        if filters.fiscal_year:
            query = query.filter(MonthlyBranchSalesSummary.fiscal_year == filters.fiscal_year)
        if filters.fiscal_month:
            query = query.filter(MonthlyBranchSalesSummary.fiscal_month == filters.fiscal_month)
        if filters.status:
            query = query.filter(MonthlyBranchSalesSummary.status == filters.status)
        
        query = query.order_by(
            MonthlyBranchSalesSummary.fiscal_year.desc(),
            MonthlyBranchSalesSummary.fiscal_month.desc(),
            MonthlyBranchSalesSummary.branch_code,
        )
        
        summaries = query.offset(filters.skip).limit(filters.limit).all()
        return [self._summary_to_response(s) for s in summaries]
    
    def get_summary(self, summary_id: int) -> schemas.MonthlyBranchSalesSummaryWithCommissions:
        """Get a single summary with its commissions"""
        summary = self.db.query(MonthlyBranchSalesSummary).filter(
            MonthlyBranchSalesSummary.id == summary_id
        ).first()
        
        if not summary:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary not found")
        
        # Get associated commissions
        commissions = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.monthly_sales_summary_id == summary_id
        ).all()
        
        response = schemas.MonthlyBranchSalesSummaryWithCommissions(
            **self._summary_to_response(summary).model_dump(),
            commissions=[self._commission_to_response(c) for c in commissions],
        )
        return response
    
    def list_commissions(
        self, 
        filters: schemas.SalesCommissionListFilter
    ) -> List[schemas.SalesOfficerCommissionResponse]:
        """List all commissions with filters"""
        query = self.db.query(SalesOfficerMonthlyCommission)
        
        if filters.employee_id:
            query = query.filter(SalesOfficerMonthlyCommission.employee_id == filters.employee_id)
        if filters.branch_code:
            query = query.filter(SalesOfficerMonthlyCommission.branch_code == filters.branch_code)
        if filters.fiscal_year:
            query = query.filter(SalesOfficerMonthlyCommission.fiscal_year == filters.fiscal_year)
        if filters.fiscal_month:
            query = query.filter(SalesOfficerMonthlyCommission.fiscal_month == filters.fiscal_month)
        if filters.status:
            query = query.filter(SalesOfficerMonthlyCommission.status == filters.status)
        if filters.monthly_sales_summary_id:
            query = query.filter(
                SalesOfficerMonthlyCommission.monthly_sales_summary_id == filters.monthly_sales_summary_id
            )
        
        query = query.order_by(
            SalesOfficerMonthlyCommission.fiscal_year.desc(),
            SalesOfficerMonthlyCommission.fiscal_month.desc(),
            SalesOfficerMonthlyCommission.branch_code,
        )
        
        commissions = query.offset(filters.skip).limit(filters.limit).all()
        return [self._commission_to_response(c) for c in commissions]
    
    def get_commission(self, commission_id: int) -> schemas.SalesOfficerCommissionResponse:
        """Get a single commission by ID"""
        commission = self.db.query(SalesOfficerMonthlyCommission).filter(
            SalesOfficerMonthlyCommission.id == commission_id
        ).first()
        
        if not commission:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commission not found")
        
        return self._commission_to_response(commission)
    
    # =========================================================================
    # Dashboard / Analytics
    # =========================================================================
    
    def get_dashboard_stats(self) -> schemas.CommissionDashboardStats:
        """Get overview statistics for commission dashboard"""
        # Summary counts
        pending_summaries = self.db.query(func.count(MonthlyBranchSalesSummary.id)).filter(
            MonthlyBranchSalesSummary.status == "draft"
        ).scalar() or 0
        
        finalized_summaries = self.db.query(func.count(MonthlyBranchSalesSummary.id)).filter(
            MonthlyBranchSalesSummary.status.in_(["finalized", "commission_calculated"])
        ).scalar() or 0
        
        # Commission counts and amounts
        pending_comms = self.db.query(
            func.count(SalesOfficerMonthlyCommission.id),
            func.coalesce(func.sum(SalesOfficerMonthlyCommission.individual_commission_amount), 0)
        ).filter(SalesOfficerMonthlyCommission.status == "pending").first()
        
        approved_comms = self.db.query(
            func.count(SalesOfficerMonthlyCommission.id),
            func.coalesce(func.sum(SalesOfficerMonthlyCommission.individual_commission_amount), 0)
        ).filter(SalesOfficerMonthlyCommission.status == "approved").first()
        
        paid_comms = self.db.query(
            func.count(SalesOfficerMonthlyCommission.id),
            func.coalesce(func.sum(SalesOfficerMonthlyCommission.individual_commission_amount), 0)
        ).filter(SalesOfficerMonthlyCommission.status == "paid").first()
        
        return schemas.CommissionDashboardStats(
            total_summaries_pending=pending_summaries,
            total_summaries_finalized=finalized_summaries,
            total_commissions_pending=pending_comms[0] or 0,
            total_commissions_approved=approved_comms[0] or 0,
            total_commissions_paid=paid_comms[0] or 0,
            total_pending_amount=Decimal(str(pending_comms[1] or 0)),
            total_approved_amount=Decimal(str(approved_comms[1] or 0)),
            total_paid_amount=Decimal(str(paid_comms[1] or 0)),
        )
