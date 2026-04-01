from typing import List, Optional

from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.sales.quotation_schemas import (ConvertToInvoiceRequest,
                                                 ConvertToInvoiceResponse,
                                                 CreatePOFromQuoteRequest,
                                                 CreatePOFromQuoteResponse,
                                                 CreateRevisionRequest,
                                                 CreateRevisionResponse,
                                                 CustomerApprovalRequest,
                                                 QuoteStatusEnum,
                                                 QuoteTypeEnum,
                                                 RejectQuoteRequest,
                                                 SalesQuote,
                                                 SalesQuoteCreate,
                                                 SalesQuoteDetail,
                                                 SalesQuoteFilter,
                                                 SalesQuoteList,
                                                 SalesQuoteStatusUpdate,
                                                 SalesQuoteUpdate,
                                                 SalesQuoteWithItems,
                                                 StockAvailabilityResponse,
                                                 ToggleProformaRequest,
                                                 ToggleProformaResponse)
from app.modules.sales.quotation_service import sales_quote_service
from app.modules.sales.schemas import InvoiceWithItems
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

router = APIRouter()


# ==================== List & Search ====================

@router.get(
    "/",
    response_model=SalesQuoteList,
    summary="List All Quotes",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def list_quotes(
    quote_type: Optional[QuoteTypeEnum] = Query(None, description="Filter by quote type"),
    status: Optional[QuoteStatusEnum] = Query(None, description="Filter by status"),
    customer_id: Optional[int] = Query(None, description="Filter by customer"),
    sale_rep_id: Optional[int] = Query(None, description="Filter by sales rep"),
    branch_code: Optional[str] = Query(None, description="Filter by branch"),
    search: Optional[str] = Query(None, description="Search in quote number"),
    page: int = Query(1, ge=1, description="Page number"),
    per_page: int = Query(20, ge=1, le=500, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """
    Get list of all sales quotes (quotations and proforma invoices) with filtering and pagination.
    """
    filters = SalesQuoteFilter(
        quote_type=quote_type,
        status=status,
        customer_id=customer_id,
        sale_rep_id=sale_rep_id,
        branch_code=branch_code,
        search=search
    )
    
    quotes, total, pages = sales_quote_service.get_filtered_quotes(db, filters, page, per_page)
    
    return SalesQuoteList(
        items=quotes,
        total=total,
        page=page,
        per_page=per_page,
        pages=pages
    )


@router.get(
    "/quotations",
    response_model=SalesQuoteList,
    summary="List Quotations Only",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def list_quotations(
    status: Optional[QuoteStatusEnum] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get list of quotations (estimates) only."""
    filters = SalesQuoteFilter(quote_type=QuoteTypeEnum.QUOTATION, status=status)
    quotes, total, pages = sales_quote_service.get_filtered_quotes(db, filters, page, per_page)
    
    return SalesQuoteList(items=quotes, total=total, page=page, per_page=per_page, pages=pages)


@router.get(
    "/proforma",
    response_model=SalesQuoteList,
    summary="List Proforma Invoices Only",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def list_proforma_invoices(
    status: Optional[QuoteStatusEnum] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get list of proforma invoices (exact pricing) only."""
    filters = SalesQuoteFilter(quote_type=QuoteTypeEnum.PROFORMA, status=status)
    quotes, total, pages = sales_quote_service.get_filtered_quotes(db, filters, page, per_page)
    
    return SalesQuoteList(items=quotes, total=total, page=page, per_page=per_page, pages=pages)


@router.get(
    "/expiring",
    response_model=List[SalesQuote],
    summary="Get Expiring Quotes",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_expiring_quotes(
    days: int = Query(7, ge=1, le=90, description="Days until expiry"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get quotes expiring within specified days."""
    return sales_quote_service.get_expiring_soon(db, days)


# ==================== CRUD Operations ====================

@router.get(
    "/{quote_id}",
    response_model=SalesQuoteWithItems,
    summary="Get Quote by ID",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_quote(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get quote details with items."""
    quote = sales_quote_service.get_quote_by_id(db, quote_id)
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote with ID {quote_id} not found"
        )
    return quote


@router.post(
    "/",
    response_model=SalesQuoteWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Quote",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_quote(
    quote_data: SalesQuoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """
    Create a new sales quote (quotation or proforma invoice).
    
    - **quote_type**: 'quotation' for estimates, 'proforma' for exact pricing
    - **is_estimate**: automatically set based on quote_type
    """
    return sales_quote_service.create_quote(db, quote_data, current_user.id)


@router.post(
    "/quotation",
    response_model=SalesQuoteWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Quotation",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_quotation(
    quote_data: SalesQuoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """Create a new quotation (estimate) - shorthand endpoint."""
    quote_data.quote_type = QuoteTypeEnum.QUOTATION
    quote_data.is_estimate = True
    return sales_quote_service.create_quote(db, quote_data, current_user.id)


@router.post(
    "/proforma",
    response_model=SalesQuoteWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Proforma Invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_proforma(
    quote_data: SalesQuoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """Create a new proforma invoice (exact pricing) - shorthand endpoint."""
    quote_data.quote_type = QuoteTypeEnum.PROFORMA
    quote_data.is_estimate = False
    return sales_quote_service.create_quote(db, quote_data, current_user.id)


@router.put(
    "/{quote_id}",
    response_model=SalesQuoteWithItems,
    summary="Update Quote",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def update_quote(
    quote_id: int,
    quote_data: SalesQuoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Update an existing quote. Only draft quotes can be edited."""
    return sales_quote_service.update_quote(db, quote_id, quote_data)


@router.delete(
    "/{quote_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Quote",
    dependencies=[Depends(require_permission(*Permissions.SALES_DELETE))]
)
def delete_quote(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_DELETE))
):
    """Delete a quote. Only draft quotes can be deleted."""
    sales_quote_service.delete_quote(db, quote_id)
    return None


# ==================== Status Management ====================

@router.patch(
    "/{quote_id}/status",
    response_model=SalesQuote,
    summary="Update Quote Status",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def update_quote_status(
    quote_id: int,
    status_update: SalesQuoteStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Update quote status."""
    return sales_quote_service.update_status(db, quote_id, status_update)


@router.post(
    "/{quote_id}/submit",
    response_model=SalesQuote,
    summary="Submit for Approval",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def submit_for_approval(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Submit quote for approval."""
    return sales_quote_service.submit_for_approval(db, quote_id)


@router.post(
    "/{quote_id}/approve",
    response_model=SalesQuote,
    summary="Approve Quote",
    dependencies=[Depends(require_permission(*Permissions.SALES_APPROVE))]
)
def approve_quote(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
):
    """Approve a quote."""
    return sales_quote_service.approve_quote(db, quote_id)


@router.post(
    "/{quote_id}/reject",
    response_model=SalesQuote,
    summary="Reject Quote",
    dependencies=[Depends(require_permission(*Permissions.SALES_APPROVE))]
)
def reject_quote(
    quote_id: int,
    reason: Optional[str] = Query(None, description="Rejection reason"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
):
    """Reject a quote."""
    return sales_quote_service.reject_quote(db, quote_id, reason)


@router.post(
    "/{quote_id}/send",
    response_model=SalesQuote,
    summary="Mark as Sent",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def mark_as_sent(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Mark quote as sent to customer."""
    return sales_quote_service.mark_as_sent(db, quote_id)


@router.post(
    "/{quote_id}/accept",
    response_model=SalesQuote,
    summary="Mark as Accepted",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def mark_as_accepted(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Mark quote as accepted by customer."""
    return sales_quote_service.mark_as_accepted(db, quote_id)


@router.post(
    "/{quote_id}/submit-to-customer",
    response_model=SalesQuote,
    summary="Submit Quotation to Customer",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def submit_to_customer(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Submit quotation to customer. Sets status to 'submitted' and records submitted_date."""
    return sales_quote_service.submit_to_customer(db, quote_id)


@router.post(
    "/{quote_id}/under-review",
    response_model=SalesQuote,
    summary="Mark as Under Review",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def mark_under_review(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Mark quote as under review by customer (proforma stage)."""
    return sales_quote_service.mark_under_review(db, quote_id)


@router.post(
    "/{quote_id}/toggle-proforma",
    response_model=ToggleProformaResponse,
    summary="Toggle Proforma Invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def toggle_proforma(
    quote_id: int,
    data: ToggleProformaRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """
    Toggle between quotation and proforma invoice type.
    When is_proforma=true, the quote is displayed as a Proforma Invoice.
    """
    quote = sales_quote_service.toggle_proforma(db, quote_id, data.is_proforma)
    return ToggleProformaResponse(
        quote_id=quote.id,
        quote_no=quote.quote_no,
        is_proforma=quote.quote_type == 'proforma',
        quote_type=quote.quote_type,
        message=f"Quote {quote.quote_no} is now a {'Proforma Invoice' if data.is_proforma else 'Quotation'}"
    )


@router.post(
    "/{quote_id}/customer-approve",
    response_model=SalesQuote,
    summary="Customer Approval",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def customer_approve(
    quote_id: int,
    data: Optional[CustomerApprovalRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """
    Record customer approval. Customer agrees to proceed with purchase.
    This sets the quote status to 'approved' and records the approval date.
    """
    approved_by = data.approved_by_customer if data else None
    remarks = data.remarks if data else None
    return sales_quote_service.customer_approve(db, quote_id, approved_by, remarks)


@router.post(
    "/{quote_id}/reject-quote",
    response_model=SalesQuote,
    summary="Reject Quote with Options",
    dependencies=[Depends(require_permission(*Permissions.SALES_APPROVE))]
)
def reject_quote_with_options(
    quote_id: int,
    data: Optional[RejectQuoteRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
):
    """
    Reject a quote with optional reason and option to cancel linked PO.
    If cancel_linked_po=true and a PO was created from this quote, the PO will also be cancelled.
    """
    reason = data.reason if data else None
    cancel_po = data.cancel_linked_po if data else False
    return sales_quote_service.reject_quote(db, quote_id, reason, cancel_po)


@router.post(
    "/{quote_id}/cancel",
    response_model=SalesQuote,
    summary="Cancel Quote",
    dependencies=[Depends(require_permission(*Permissions.SALES_DELETE))]
)
def cancel_quote(
    quote_id: int,
    reason: Optional[str] = Query(None, description="Cancellation reason"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_DELETE))
):
    """Cancel a quote."""
    return sales_quote_service.cancel_quote(db, quote_id, reason)


# ==================== Conversion ====================

@router.post(
    "/{quote_id}/convert",
    response_model=ConvertToInvoiceResponse,
    summary="Convert to Invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def convert_to_invoice(
    quote_id: int,
    conversion_data: ConvertToInvoiceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """
    Convert quote/proforma to invoice.
    
    Quote must be in 'accepted' or 'approved' status.
    For quotations with estimate prices, all items must have exact prices set.
    """
    quote = sales_quote_service.get_quote_by_id(db, quote_id)
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote with ID {quote_id} not found"
        )
    
    invoice = sales_quote_service.convert_to_invoice(
        db, quote_id, conversion_data, current_user.id
    )
    
    return ConvertToInvoiceResponse(
        quote_id=quote_id,
        quote_no=quote.quote_no,
        invoice_id=invoice.id,
        invoice_no=invoice.invoice_no,
        message=f"Successfully converted {quote.quote_no} to invoice {invoice.invoice_no}"
    )


# ==================== Stock Availability ====================

@router.get(
    "/{quote_id}/stock-availability",
    response_model=StockAvailabilityResponse,
    summary="Check Stock Availability",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def check_stock_availability(
    quote_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """
    Check stock availability for all items in a quote.
    Returns per-item availability and an overall sufficiency flag.
    """
    return sales_quote_service.check_stock_availability(db, quote_id)


# ==================== Create PO from Quotation ====================

@router.post(
    "/{quote_id}/create-po",
    response_model=CreatePOFromQuoteResponse,
    summary="Create PO from Quotation",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_po_from_quotation(
    quote_id: int,
    po_data: CreatePOFromQuoteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """
    Create a Purchasing Order from an accepted/approved quotation.
    
    This is used when the quoted items need to be procured from a supplier
    before the quotation can be fulfilled and converted to an invoice.
    The quote status will be updated to 'po_created'.
    """
    quote = sales_quote_service.get_quote_by_id(db, quote_id)
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote with ID {quote_id} not found"
        )
    
    po = sales_quote_service.create_po_from_quote(
        db, quote_id, po_data.model_dump(), current_user.id
    )
    
    return CreatePOFromQuoteResponse(
        quote_id=quote_id,
        quote_no=quote.quote_no,
        purchasing_order_id=po.id,
        purchasing_order_no=po.purchasing_order_no,
        message=f"Successfully created PO {po.purchasing_order_no} from quotation {quote.quote_no}"
    )


# ==================== Revision ====================

@router.post(
    "/{quote_id}/revise",
    response_model=CreateRevisionResponse,
    summary="Create Revision",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_revision(
    quote_id: int,
    revision_data: Optional[CreateRevisionRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """
    Create a new revision of a quotation.
    
    Only quotations can have revisions. For proforma invoices, create a new document.
    The original quote will be marked as 'revised'.
    """
    original_quote = sales_quote_service.get_quote_by_id(db, quote_id)
    if not original_quote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote with ID {quote_id} not found"
        )
    
    reason = revision_data.remarks if revision_data else None
    new_quote = sales_quote_service.create_revision(db, quote_id, reason)
    
    return CreateRevisionResponse(
        original_quote_id=quote_id,
        original_quote_no=original_quote.quote_no,
        new_quote_id=new_quote.id,
        new_quote_no=new_quote.quote_no,
        revision_number=new_quote.revision_number,
        message=f"Created revision {new_quote.revision_number} of {original_quote.quote_no}"
    )


# ==================== Maintenance ====================

@router.post(
    "/mark-expired",
    summary="Mark Expired Quotes",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def mark_expired_quotes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Mark all expired quotes as expired. Can be called by a scheduled job."""
    count = sales_quote_service.mark_expired_quotes(db)
    return {"message": f"Marked {count} quotes as expired"}
