"""
Debtors Management API Routes

REST API endpoints for debtors management including:
- Debtors list with filtering and sorting
- Customer debt details
- Payment recording
- Follow-up management
- Reports generation
"""

from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.auth.dependencies import get_current_user_flexible
from app.modules.sales.debtors_service import DebtorsService
from app.modules.sales.debtors_schemas import (
    DebtorListRequest,
    DebtorSummary,
    DebtorsReport,
    CustomerDebtDetails,
    PaymentRecordRequest,
    InvoicePaymentResponse,
    FollowupCreate,
    FollowupResponse,
    DebtorStatement,
    DebtorStatementRequest,
)

router = APIRouter(
    prefix="/sales/debtors",
    tags=["Debtors Management"]
)


@router.get("/list", response_model=DebtorsReport)
def get_debtors_list(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
    status: str = Query("all", description="Filter by status: all, current, overdue, critical"),
    sort_by: str = Query("outstanding_balance", description="Sort by field"),
    sort_order: str = Query("desc", description="Sort order: asc or desc"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    branch_code: Optional[str] = Query(None, description="Branch filter"),
):
    """
    Get list of debtors with filtering and sorting.
    
    Status filter options:
    - all: All debtors
    - current: Current accounts
    - overdue: Overdue accounts (0-90 days)
    - critical: Critical accounts (90+ days overdue)
    """
    try:
        result = DebtorsService.get_debtors_list(
            db=db,
            status_filter=status,
            sort_by=sort_by,
            sort_order=sort_order,
            skip=skip,
            limit=limit,
            branch_code=branch_code or current_user.get('branch_code')
        )
        
        return DebtorsReport(
            total_debtors=result['total_debtors'],
            total_outstanding=result['total_outstanding'],
            total_overdue=result['total_overdue'],
            critical_count=result['critical_count'],
            overdue_count=result['overdue_count'],
            current_count=result['current_count'],
            debtors=[
                DebtorSummary(
                    customer_id=d['customer_id'],
                    customer_name=d['customer_name'],
                    company_name=d['company_name'],
                    outstanding_balance=d['outstanding_balance'],
                    credit_limit=d['credit_limit'],
                    credit_days=d['credit_days'],
                    days_overdue=d['days_overdue'],
                    status=d['status'],
                )
                for d in result['debtors']
            ]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customers/{customer_id}/debt-details", response_model=CustomerDebtDetails)
def get_customer_debt_details(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
):
    """
    Get detailed debt information for a customer including:
    - Outstanding invoices breakdown
    - Payment history
    - Follow-up history
    - Credit information
    """
    try:
        details = DebtorsService.get_customer_debt_details(db, customer_id)
        if not details:
            raise HTTPException(status_code=404, detail="Customer not found")
        
        return CustomerDebtDetails(**details)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/customers/{customer_id}/payments", response_model=InvoicePaymentResponse)
def record_payment(
    customer_id: int,
    request: PaymentRecordRequest,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
):
    """
    Record a payment against an invoice.
    
    - Validates payment amount doesn't exceed outstanding balance
    - Updates invoice paid amount and balance
    - Updates payment status
    - Creates payment record for audit trail
    """
    try:
        payment = DebtorsService.record_payment(
            db=db,
            customer_id=customer_id,
            invoice_id=request.invoice_id,
            amount=request.amount,
            payment_date=request.payment_date,
            payment_method=request.payment_method,
            branch_code=current_user.get('branch_code'),
            reference_no=request.reference_no,
            notes=request.notes,
            created_by=current_user.get('user_id')
        )
        
        return InvoicePaymentResponse(**payment)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/customers/{customer_id}/followups", response_model=FollowupResponse)
def create_followup(
    customer_id: int,
    request: FollowupCreate,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
):
    """
    Create a follow-up record for a debtor.
    
    Follow-up types:
    - call: Phone call
    - email: Email communication
    - sms: SMS message
    - visit: In-person visit
    - reminder: Payment reminder
    
    Can include promised payment details.
    """
    try:
        followup = DebtorsService.create_followup(
            db=db,
            customer_id=customer_id,
            followup_date=request.followup_date,
            followup_type=request.followup_type,
            notes=request.notes,
            branch_code=current_user.get('branch_code'),
            amount_promised=request.amount_promised,
            promised_payment_date=request.promised_payment_date,
            created_by=current_user.get('user_id')
        )
        
        return FollowupResponse(**followup)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customers/{customer_id}/followups", response_model=list)
def get_followup_history(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
):
    """
    Get complete follow-up history for a customer.
    
    Returns all recorded interactions in reverse chronological order.
    """
    try:
        followups = DebtorsService.get_followup_history(db, customer_id)
        return followups
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/aging-report", response_model=DebtorStatement)
def get_aging_report(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
    as_on_date: Optional[date] = Query(None, description="Report date"),
):
    """
    Generate aging report of all debtors.
    
    Groups debtors by aging buckets:
    - 0-30 days
    - 31-60 days
    - 61-90 days
    - 90+ days
    """
    try:
        report_date = as_on_date or date.today()
        
        result = DebtorsService.get_debtors_list(
            db=db,
            branch_code=current_user.get('branch_code')
        )
        
        aging_buckets = {
            "current": Decimal(0),
            "0_30_days": Decimal(0),
            "31_60_days": Decimal(0),
            "61_90_days": Decimal(0),
            "over_90_days": Decimal(0)
        }
        
        # Categorize by days overdue
        for debtor in result['debtors']:
            days_overdue = debtor['days_overdue']
            outstanding = debtor['outstanding_balance']
            
            if days_overdue == 0:
                aging_buckets["current"] += outstanding
            elif days_overdue <= 30:
                aging_buckets["0_30_days"] += outstanding
            elif days_overdue <= 60:
                aging_buckets["31_60_days"] += outstanding
            elif days_overdue <= 90:
                aging_buckets["61_90_days"] += outstanding
            else:
                aging_buckets["over_90_days"] += outstanding
        
        return DebtorStatement(
            as_on_date=report_date,
            total_outstanding=result['total_outstanding'],
            current_amount=aging_buckets["current"],
            days_0_30=aging_buckets["0_30_days"],
            days_31_60=aging_buckets["31_60_days"],
            days_61_90=aging_buckets["61_90_days"],
            days_over_90=aging_buckets["over_90_days"],
            generated_at=datetime.now()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/export")
def export_debtors(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
    status: str = Query("all"),
):
    """
    Export debtors list as CSV.
    
    Includes:
    - Customer details
    - Outstanding balance
    - Days overdue
    - Credit limit
    - Contact information
    """
    try:
        import io
        import csv
        from fastapi.responses import StreamingResponse
        
        result = DebtorsService.get_debtors_list(
            db=db,
            status_filter=status,
            branch_code=current_user.get('branch_code'),
            limit=10000
        )
        
        # Create CSV
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Headers
        writer.writerow([
            'Customer ID',
            'Customer Name',
            'Company Name',
            'Outstanding Balance',
            'Credit Limit',
            'Credit Days',
            'Days Overdue',
            'Status',
            'Contact Number',
            'Email'
        ])
        
        # Data rows
        for debtor in result['debtors']:
            writer.writerow([
                debtor['customer_id'],
                debtor['customer_name'],
                debtor['company_name'] or '',
                float(debtor['outstanding_balance']),
                float(debtor['credit_limit']),
                debtor['credit_days'],
                debtor['days_overdue'],
                debtor['status'],
                debtor['contact_number'] or '',
                debtor['email'] or ''
            ])
        
        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=debtors_report.csv"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/statement", response_model=DebtorStatement)
def get_customer_statement(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
    customer_id: int = Query(..., description="Customer ID"),
    from_date: Optional[date] = Query(None, description="From date"),
    to_date: Optional[date] = Query(None, description="To date"),
    include_payments: bool = Query(True, description="Include payment history"),
):
    """
    Get customer statement/aging report.
    
    Returns:
    - Payment history
    - Aging breakdown by days overdue
    - Credit utilization
    - Outstanding invoices
    """
    try:
        if not from_date:
            from_date = date.today().replace(day=1)
        if not to_date:
            to_date = date.today()
        
        # Get customer debt details
        details = DebtorsService.get_customer_debt_details(db, customer_id)
        if not details:
            raise HTTPException(status_code=404, detail="Customer not found")
        
        # Calculate aging buckets
        aging_buckets = {
            "current": Decimal(0),
            "days_0_30": Decimal(0),
            "days_31_60": Decimal(0),
            "days_61_90": Decimal(0),
            "days_over_90": Decimal(0)
        }
        
        for invoice in details['invoices']:
            if invoice['status'] == 'paid':
                continue
            
            days_overdue = invoice['days_overdue']
            outstanding = invoice['outstanding_balance']
            
            if days_overdue == 0:
                aging_buckets["current"] += outstanding
            elif days_overdue <= 30:
                aging_buckets["days_0_30"] += outstanding
            elif days_overdue <= 60:
                aging_buckets["days_31_60"] += outstanding
            elif days_overdue <= 90:
                aging_buckets["days_61_90"] += outstanding
            else:
                aging_buckets["days_over_90"] += outstanding
        
        return DebtorStatement(
            as_on_date=to_date,
            total_outstanding=details['total_outstanding'],
            current_amount=aging_buckets["current"],
            days_0_30=aging_buckets["days_0_30"],
            days_31_60=aging_buckets["days_31_60"],
            days_61_90=aging_buckets["days_61_90"],
            days_over_90=aging_buckets["days_over_90"],
            generated_at=datetime.now()
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/customers/{customer_id}/aging")
def get_customer_aging(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
):
    """
    Get aging breakdown for a customer.
    
    Returns invoices grouped by age buckets:
    - Current (not yet due)
    - 0-30 days overdue
    - 31-60 days overdue
    - 61-90 days overdue
    - 90+ days overdue
    """
    try:
        details = DebtorsService.get_customer_debt_details(db, customer_id)
        if not details:
            raise HTTPException(status_code=404, detail="Customer not found")
        
        # Group invoices by aging
        aging_groups = {
            "current": [],
            "days_0_30": [],
            "days_31_60": [],
            "days_61_90": [],
            "days_over_90": []
        }
        
        for invoice in details['invoices']:
            days_overdue = invoice['days_overdue']
            
            if days_overdue == 0:
                aging_groups["current"].append(invoice)
            elif days_overdue <= 30:
                aging_groups["days_0_30"].append(invoice)
            elif days_overdue <= 60:
                aging_groups["days_31_60"].append(invoice)
            elif days_overdue <= 90:
                aging_groups["days_61_90"].append(invoice)
            else:
                aging_groups["days_over_90"].append(invoice)
        
        # Calculate totals per bucket
        result = {}
        for bucket, invoices in aging_groups.items():
            result[bucket] = {
                "count": len(invoices),
                "total_outstanding": sum(
                    Decimal(str(inv.get('outstanding_balance', 0))) 
                    for inv in invoices
                ),
                "invoices": invoices
            }
        
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{customer_id}/aging-invoice")
def generate_aging_invoice(
    customer_id: int,
    invoice_id: Optional[int] = Query(None, description="Specific invoice ID"),
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user_flexible),
):
    """
    Generate aging invoice with current balance and duration.
    
    Returns invoice details including:
    - Current outstanding balance
    - Days outstanding duration
    - Days overdue (if applicable)
    - Payment terms and credit limit
    - Invoice aging information
    """
    try:
        from app.modules.sales.models import Invoice
        
        # Get invoice(s)
        if invoice_id:
            invoice = db.query(Invoice).filter(
                Invoice.id == invoice_id,
                Invoice.customer_id == customer_id
            ).first()
            
            if not invoice:
                raise HTTPException(status_code=404, detail="Invoice not found")
            
            invoices = [invoice]
        else:
            # Get all outstanding invoices for customer
            invoices = db.query(Invoice).filter(
                Invoice.customer_id == customer_id,
                Invoice.payment_status.in_(['unpaid', 'partial'])
            ).order_by(Invoice.created_date.desc()).all()
        
        if not invoices:
            raise HTTPException(status_code=404, detail="No invoices found")
        
        # Build invoice data
        invoice_data = []
        for inv in invoices:
            outstanding = DebtorsService.get_outstanding_balance(db, inv.id)
            days_overdue = DebtorsService.get_days_overdue(inv)
            days_outstanding = DebtorsService.get_days_outstanding(inv)
            
            invoice_data.append({
                "invoice_id": inv.id,
                "invoice_no": inv.invoice_no,
                "date": inv.created_date.isoformat() if inv.created_date else None,
                "invoice_amount": float(inv.grand_total or 0),
                "paid_amount": float(inv.paid_amount or 0),
                "outstanding_balance": float(outstanding),
                "days_outstanding": days_outstanding,
                "days_overdue": max(0, days_overdue),
                "status": "overdue" if days_overdue > 0 else "current",
                "due_date": (inv.created_date.replace(day=1).replace(month=inv.created_date.month + 1 if inv.created_date.month < 12 else 1) 
                           + timedelta(days=-1)).isoformat() if inv.created_date else None,
                "remarks": inv.remarks or ""
            })
        
        # Get customer info
        from app.modules.customers.models import Customer
        customer = db.query(Customer).filter(
            Customer.id == customer_id
        ).first()
        
        customer_info = {
            "customer_id": customer_id,
            "customer_name": customer.customer_name if customer else "Unknown",
            "company_name": customer.company_name if customer else "",
            "credit_limit": float(customer.max_credit_limit or 0) if customer else 0,
            "credit_days": customer.credit_days if customer else 0,
        }
        
        return {
            "customer": customer_info,
            "invoices": invoice_data,
            "generated_at": datetime.now().isoformat(),
            "total_outstanding": sum(Decimal(str(inv['outstanding_balance'])) for inv in invoice_data),
            "total_overdue": sum(
                Decimal(str(inv['outstanding_balance'])) 
                for inv in invoice_data 
                if inv['status'] == 'overdue'
            )
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
