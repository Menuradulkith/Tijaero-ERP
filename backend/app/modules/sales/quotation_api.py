from datetime import date
from typing import Annotated, List, Literal, Optional

from app.auth.dependencies import get_current_active_user, get_user_branch_filter, validate_branch_access
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.sales.quotation_schemas import (
    CancelQuoteItemRequest,
    ConvertToInvoiceRequest,
    ConvertToInvoiceResponse,
    CreatePartialSORequest,
    CreateRevisionRequest,
    CreateRevisionResponse,
    CustomerApprovalRequest,
    MarkQuoteItemsRequest,
    ProcurementSummaryResponse,
    QuoteStatusEnum,
    QuoteTypeEnum,
    RejectQuoteRequest,
    ReleaseReservationRequest,
    ReleaseReservationResponse,
    SalesQuote,
    SalesQuoteCreate,
    SalesQuoteDetail,
    SalesQuoteFilter,
    SalesQuoteList,
    SalesQuoteStatusUpdate,
    SalesQuoteUpdate,
    SalesQuoteWithItems,
    StockAvailabilityResponse,
)
from app.modules.sales.quotation_service import sales_quote_service
from app.modules.sales.schemas import InvoiceWithItems
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from sqlalchemy.orm import Session

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]


def _quote_scope(
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """Every route that names a quotation (`/{quote_id}...`) is limited to the user's branches.
    A missing quotation falls through to the route's own 404."""
    raw = request.path_params.get("quote_id")
    if raw is None:
        return
    try:
        quote_id = int(raw)
    except (TypeError, ValueError):
        return
    if not 1 <= quote_id <= 2_147_483_647:
        return
    from app.modules.sales.quotation_models import SalesQuote as _Quote

    row = db.query(_Quote.branch_code).filter(_Quote.id == quote_id).first()
    if row and not validate_branch_access(current_user, row.branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {row.branch_code}")


def _require_branch(user: User, branch_code: Optional[str]) -> None:
    if branch_code and not validate_branch_access(user, branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")


router = APIRouter(dependencies=[Depends(_quote_scope)])


def _attach_approved_by(db: Session, quote) -> None:
    """Stamp quote.approved_by/approved_by_name from the linked Approvals
    row, mirroring purchasing/api.py's _enrich_purchase_orders_with_user_fields.
    Only set once the approval has actually been approved (not rejected) —
    rejections are already tracked separately via rejection_date/rejection_reason."""
    quote.approved_by = None
    quote.approved_by_name = None
    if not quote.approval_id:
        return

    from app.modules.common.models import Approvals

    approval = db.query(Approvals).filter(Approvals.id == quote.approval_id).first()
    if not approval or str(approval.status).lower() != "approved" or not approval.status_changed_by:
        return

    user = db.query(User).filter(User.id == approval.status_changed_by).first()
    if not user:
        return

    quote.approved_by = user.id
    full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    quote.approved_by_name = full_name or user.username


# ==================== List & Search ====================

@router.get(
    "/",
    response_model=SalesQuoteList,
    summary="List All Quotes",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_VIEW))]
)
def list_quotes(
    quote_type: Optional[QuoteTypeEnum] = Query(None, description="Filter by quote type"),
    status_filter: Optional[QuoteStatusEnum] = Query(None, alias="status", description="Filter by status"),
    customer_id: Optional[int] = Query(None, ge=1, le=2_147_483_647, description="Filter by customer"),
    sale_rep_id: Optional[int] = Query(None, ge=1, le=2_147_483_647, description="Filter by sales rep"),
    branch_code: Optional[str] = Query(None, max_length=200, description="Filter by branch"),
    search: Optional[str] = Query(None, max_length=255, description="Search in quote number, customer name, remarks"),
    date_from: Optional[date] = Query(None, description="Created on or after"),
    date_to: Optional[date] = Query(None, description="Created on or before"),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("desc"),
    page: int = Query(1, ge=1, le=1_000_000, description="Page number"),
    per_page: int = Query(20, ge=1, le=200, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Get list of sales quotes with filtering, sorting and pagination. Non-superusers only see their branches.
    """
    if branch_code and user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")
    filters = SalesQuoteFilter(
        quote_type=quote_type,
        status=status_filter,
        customer_id=customer_id,
        sale_rep_id=sale_rep_id,
        branch_code=branch_code,
        branch_codes=user_branches,
        search=search,
        date_from=date_from,
        date_to=date_to,
        sort_by=sort_by,
        order=order,
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
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_VIEW))]
)
def list_quotations(
    status_filter: Optional[QuoteStatusEnum] = Query(None, alias="status"),
    page: int = Query(1, ge=1, le=1_000_000),
    per_page: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get list of quotations (estimates) only."""
    filters = SalesQuoteFilter(quote_type=QuoteTypeEnum.QUOTATION, status=status_filter, branch_codes=user_branches)
    quotes, total, pages = sales_quote_service.get_filtered_quotes(db, filters, page, per_page)

    return SalesQuoteList(items=quotes, total=total, page=page, per_page=per_page, pages=pages)


@router.get(
    "/expiring",
    response_model=List[SalesQuote],
    summary="Get Expiring Quotes",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_VIEW))]
)
def get_expiring_quotes(
    days: int = Query(7, ge=1, le=365, description="Days until expiry"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get quotes expiring within specified days."""
    quotes = sales_quote_service.get_expiring_soon(db, days)
    return [q for q in quotes if user_branches is None or q.branch_code in user_branches]


# ==================== CRUD Operations ====================

@router.get(
    "/{quote_id}",
    response_model=SalesQuoteDetail,
    summary="Get Quote by ID",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_VIEW))]
)
def get_quote(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_VIEW))
):
    """Get quote details with items."""
    quote = sales_quote_service.get_quote_by_id(db, quote_id)
    if not quote:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Quote with ID {quote_id} not found"
        )
    _attach_approved_by(db, quote)
    # Enrich with advance payment info if linked
    from app.modules.customers.models import CustomerAdvancePayments
    advance = db.query(CustomerAdvancePayments).filter(
        CustomerAdvancePayments.quote_id == quote_id,
        CustomerAdvancePayments.active == True
    ).first()
    if advance:
        quote.advance_payment_id = advance.id
        quote.advance_amount = float(advance.payment_amount)
    else:
        quote.advance_payment_id = None
        quote.advance_amount = None
    return quote


@router.post(
    "/",
    response_model=SalesQuoteWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Quote",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_CREATE))]
)
def create_quote(
    quote_data: SalesQuoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_CREATE))
):
    """Create a new sales quote."""
    _require_branch(current_user, quote_data.branch_code)
    return sales_quote_service.create_quote(db, quote_data, current_user.id)


@router.post(
    "/quotation",
    response_model=SalesQuoteWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Quotation",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_CREATE))]
)
def create_quotation(
    quote_data: SalesQuoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_CREATE))
):
    """Create a new quotation (estimate) - shorthand endpoint."""
    _require_branch(current_user, quote_data.branch_code)
    quote_data.quote_type = QuoteTypeEnum.QUOTATION
    quote_data.is_estimate = True
    return sales_quote_service.create_quote(db, quote_data, current_user.id)


@router.put(
    "/{quote_id}",
    response_model=SalesQuoteWithItems,
    summary="Update Quote",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def update_quote(
    quote_id: RowId,
    quote_data: SalesQuoteUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Update an existing quote. Only draft quotes can be edited."""
    _require_branch(current_user, quote_data.branch_code)
    return sales_quote_service.update_quote(db, quote_id, quote_data, user_id=current_user.id)


@router.delete(
    "/{quote_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Quote",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_DELETE))]
)
def delete_quote(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_DELETE))
):
    """Delete a quote. Only draft quotes can be deleted."""
    sales_quote_service.delete_quote(db, quote_id, user_id=current_user.id)
    return None


# ==================== Status Management ====================

@router.patch(
    "/{quote_id}/status",
    response_model=SalesQuote,
    summary="Update Quote Status",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def update_quote_status(
    quote_id: RowId,
    status_update: SalesQuoteStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Update quote status."""
    return sales_quote_service.update_status(db, quote_id, status_update, user_id=current_user.id)


@router.post(
    "/{quote_id}/submit",
    response_model=SalesQuote,
    summary="Submit for Approval",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def submit_for_approval(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Submit quote for approval."""
    return sales_quote_service.submit_for_approval(db, quote_id, user_id=current_user.id)


# Approving/rejecting a quotation flows only through the generic
# /common/approvals/{id}/approve|reject dashboard (same as Purchase Orders)
# — see approval_service._dispatch_approve/_dispatch_reject.


@router.post(
    "/{quote_id}/send",
    response_model=SalesQuote,
    summary="Mark as Sent",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def mark_as_sent(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Mark quote as sent to customer."""
    return sales_quote_service.mark_as_sent(db, quote_id)


@router.post(
    "/{quote_id}/accept",
    response_model=SalesQuote,
    summary="Mark as Accepted",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def mark_as_accepted(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Mark quote as accepted by customer."""
    return sales_quote_service.mark_as_accepted(db, quote_id)


@router.post(
    "/{quote_id}/submit-to-customer",
    response_model=SalesQuote,
    summary="Submit Quotation to Customer",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def submit_to_customer(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Submit quotation to customer. Sets status to 'submitted' and records submitted_date."""
    return sales_quote_service.submit_to_customer(db, quote_id)


@router.post(
    "/{quote_id}/under-review",
    response_model=SalesQuote,
    summary="Mark as Under Review",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def mark_under_review(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Mark quote as under review by customer."""
    return sales_quote_service.mark_under_review(db, quote_id)


@router.post(
    "/{quote_id}/customer-approve",
    response_model=SalesQuote,
    summary="Customer Approval",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def customer_approve(
    quote_id: RowId,
    data: Optional[CustomerApprovalRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
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
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def reject_quote_with_options(
    quote_id: RowId,
    data: Optional[RejectQuoteRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """
    Reject a quote with optional reason and option to cancel linked PO.
    If cancel_linked_po=true and a PO was created from this quote, the PO will also be cancelled.
    """
    reason = data.reason if data else None
    cancel_po = data.cancel_linked_po if data else False
    return sales_quote_service.reject_quote(db, quote_id, reason, cancel_po, user_id=current_user.id)


@router.post(
    "/{quote_id}/cancel",
    response_model=SalesQuote,
    summary="Cancel Quote",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_DELETE))]
)
def cancel_quote(
    quote_id: RowId,
    reason: str = Query(..., min_length=1, max_length=500, description="Cancellation reason"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_DELETE))
):
    """Cancel a quote."""
    reason = reason.strip()
    if not reason:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A cancellation reason is required")
    return sales_quote_service.cancel_quote(db, quote_id, reason)


# ==================== Conversion ====================

@router.post(
    "/{quote_id}/convert",
    response_model=ConvertToInvoiceResponse,
    summary="Convert to Invoice",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_CREATE))]
)
def convert_to_invoice(
    quote_id: RowId,
    conversion_data: ConvertToInvoiceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_CREATE))
):
    """
    Convert quote to invoice.

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
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_VIEW))]
)
def check_stock_availability(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_VIEW))
):
    """
    Check stock availability for all items in a quote.
    Returns per-item availability and an overall sufficiency flag.
    """
    return sales_quote_service.check_stock_availability(db, quote_id)


@router.get(
    "/{quote_id}/procurement-summary",
    response_model=ProcurementSummaryResponse,
    summary="Get Procurement / Reservation Summary",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_VIEW))]
)
def get_procurement_summary(
    quote_id: RowId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_VIEW))
):
    """
    Per-item procurement/reservation traceability: required, ordered (PO'd),
    received (GRN'd), reserved (committed stock units), available, and
    outstanding quantities.
    """
    return sales_quote_service.get_procurement_summary(db, quote_id)


@router.post(
    "/{quote_id}/release-reservation",
    response_model=ReleaseReservationResponse,
    summary="Release Reserved Stock",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def release_reservation(
    quote_id: RowId,
    body: Optional[ReleaseReservationRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """
    Explicitly release stock reserved for this quotation (or a single item on
    it) back to the available pool. Reservations are never released
    automatically — only on quotation cancellation or this explicit action.
    """
    item_id = body.item_id if body else None
    reason = body.reason if body else None
    result = sales_quote_service.release_reservation(
        db, quote_id, item_id=item_id, reason=reason, user_id=current_user.id
    )
    return ReleaseReservationResponse(
        quote_id=quote_id,
        units_released=result["units_released"],
        message=f"Released {result['units_released']} reserved unit(s).",
    )


# ==================== Revision ====================

@router.post(
    "/{quote_id}/revise",
    response_model=CreateRevisionResponse,
    summary="Create Revision",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_CREATE))]
)
def create_revision(
    quote_id: RowId,
    revision_data: Optional[CreateRevisionRequest] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_CREATE))
):
    """
    Create a new revision of a quotation.
    
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
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def mark_expired_quotes(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Mark all expired quotes as expired. Can be called by a scheduled job."""
    count = sales_quote_service.mark_expired_quotes(db)
    return {"message": f"Marked {count} quotes as expired"}


# ==================== Partial SO & Item-Level Actions ====================

@router.post(
    "/{quote_id}/partial-so",
    response_model=InvoiceWithItems,
    summary="Create Partial Sales Order",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def create_partial_so(
    quote_id: RowId,
    request: CreatePartialSORequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """
    Create a Sales Order from selected/partial items of a quotation.
    Supports partial quantities (e.g. convert 5 of 10 available).
    Updates per-item converted_qty and item_status, then recomputes overall quote status.
    """
    invoice = sales_quote_service.create_partial_so(
        db, quote_id, request, created_by=current_user.id
    )
    return invoice


@router.post(
    "/{quote_id}/mark-so-created",
    response_model=SalesQuoteWithItems,
    summary="Mark quote items as SO Created",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def mark_items_so_created(
    quote_id: RowId,
    product_ids: List[int],
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """
    Called after a Sales Order is saved from the SO page.
    Marks the given product_ids on this quote as 'so_created' and recomputes header status.
    """
    return sales_quote_service.mark_items_so_created(db, quote_id, product_ids)


@router.post(
    "/{quote_id}/items/{item_id}/cancel",
    response_model=SalesQuoteWithItems,
    summary="Cancel a single quotation item",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def cancel_quote_item(
    quote_id: RowId,
    item_id: RowId,
    body: CancelQuoteItemRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """
    Mark one item on a quotation as cancelled (e.g. customer no longer wants it).
    Recomputes overall quote status — if all remaining items are completed/cancelled, the quote closes.
    """
    quote = sales_quote_service.cancel_quote_item(
        db, quote_id, item_id, reason=body.reason, cancelled_by=current_user.id
    )
    return quote


@router.post(
    "/{quote_id}/items/procurement",
    response_model=SalesQuoteWithItems,
    summary="Mark quotation items as procurement",
    dependencies=[Depends(require_permission(*Permissions.QUOTATION_UPDATE))]
)
def mark_quote_items_procurement(
    quote_id: RowId,
    body: MarkQuoteItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.QUOTATION_UPDATE))
):
    """Mark selected quotation items as procurement (PO/ITN)."""
    quote = sales_quote_service.mark_items_procurement(
        db, quote_id, body.item_ids
    )
    return quote
