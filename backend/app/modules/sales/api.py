from typing import Any, Dict, List, Optional

from app.auth.dependencies import (
    get_current_user,
    get_user_branch_filter,
    validate_branch_access,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.sales import schemas, service
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

router = APIRouter()


# Available Products endpoint for sales stock
@router.get(
    "/available-products",
    response_model=List[Dict[str, Any]],
    summary="Get Products Available in Sales Stock",
)
def get_available_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Get products that are available in sales stock with quantities."""
    return service.sales_service.get_available_products_from_stock(db)


# Statistics endpoint
@router.get(
    "/statistics",
    response_model=Dict[str, Any],
    summary="Get Sales Statistics",
)
def get_sales_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
    branch_code: Optional[str] = Query(
        None, description="Filter statistics by a specific branch"
    ),
):
    """Get sales statistics for dashboard."""
    # If a specific branch is requested, filter to that single branch
    # (still constrained by the user's permitted branches)
    if branch_code:
        if user_branches and branch_code not in user_branches:
            # User has no access to the requested branch — return empty stats
            effective_branches = ["__none__"]
        else:
            effective_branches = [branch_code]
    else:
        effective_branches = user_branches
    return service.sales_service.get_sales_statistics(db, effective_branches)


# Optimized paginated list with server-side filtering
@router.get(
    "/list",
    response_model=Dict[str, Any],
    summary="Get Paginated Sales Orders with Filters",
)
def get_paginated_invoices(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, ge=10, le=100000, description="Items per page"),
    search: Optional[str] = Query(
        None, description="Search by invoice no, customer, or payment ref"
    ),
    branch_code: Optional[str] = Query(None, description="Filter by branch"),
    status: Optional[str] = Query(
        None, description="Filter by status: pending, approved, completed, cancelled"
    ),
    sort_by: str = Query("created_date", description="Sort field"),
    sort_desc: bool = Query(True, description="Sort descending"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Get paginated list of invoices with server-side filtering.

    Returns:
        - items: List of invoices for current page
        - total: Total count matching filters
        - page: Current page number
        - page_size: Items per page
        - total_pages: Total number of pages
    """
    return service.sales_service.get_paginated_invoices(
        db=db,
        page=page,
        page_size=page_size,
        search=search,
        branch_code=branch_code,
        status=status,
        sort_by=sort_by,
        sort_desc=sort_desc,
        user_branches=user_branches,
    )


# Invoice/Sales Order Endpoints
@router.get(
    "/",
    response_model=List[schemas.Invoice],
    summary="List All Sales Orders",
)
def list_invoices(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get list of all sales orders/invoices with pagination."""
    return service.sales_service.get_all_invoices(db, skip, limit, user_branches)


@router.get(
    "/search",
    response_model=List[schemas.Invoice],
    summary="Search Sales Orders",
)
def search_invoices(
    q: str = Query(..., min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Search sales orders by invoice number or customer."""
    return service.sales_service.search_invoices(db, q, skip, limit, user_branches)


@router.get(
    "/pending-approval",
    response_model=List[schemas.Invoice],
    summary="Get Pending Approval Invoices",
)
def get_pending_approval_invoices(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get invoices pending approval - server-side filtered for efficiency."""
    return service.sales_service.get_pending_approval(db, skip, limit, user_branches)


@router.get(
    "/by-customer/{customer_id}",
    response_model=List[schemas.Invoice],
    summary="Get Invoices by Customer",
)
def get_invoices_by_customer(
    customer_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get all invoices for a specific customer."""
    return service.sales_service.get_by_customer(
        db, customer_id, skip, limit, user_branches
    )


@router.get(
    "/customer/{customer_id}/recent",
    response_model=List[schemas.InvoiceWithItems],
    summary="Get Recent Sales for Customer",
)
def get_recent_customer_sales(
    customer_id: int,
    limit: int = Query(5, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get the most recent sales records for a customer from allowed branches."""
    return service.sales_service.get_recent_by_customer(
        db, customer_id, limit, user_branches
    )


@router.get(
    "/{invoice_id}",
    response_model=schemas.InvoiceWithItems,
    summary="Get Sales Order by ID",
)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Get sales order/invoice details with items."""
    return service.sales_service.get_invoice(db, invoice_id)


@router.post(
    "/",
    response_model=schemas.InvoiceWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Sales Order",
)
def create_invoice(
    invoice: schemas.InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_CREATE)),
):
    """Create a new sales order/invoice with items."""
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, invoice.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {invoice.branch_code}",
        )
    created = service.sales_service.create_invoice(db, invoice, current_user.id)

    # Important-only policy: a routine sale is not itself a notification, but a
    # sale that drives a product below the reorder threshold raises a real-time
    # low-stock alert for the branch.
    from app.modules.notifications import alerts

    alerts.check_low_stock_after_invoice(created.id)
    return created


@router.put(
    "/{invoice_id}",
    response_model=schemas.InvoiceWithItems,
    summary="Update Sales Order",
)
def update_invoice(
    invoice_id: int,
    invoice: schemas.InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_UPDATE)),
):
    """Update sales order/invoice information."""
    return service.sales_service.update_invoice(
        db, invoice_id, invoice, current_user.id
    )


@router.delete(
    "/{invoice_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Sales Order",
)
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_DELETE)),
):
    """Delete a sales order/invoice."""
    return service.sales_service.delete_invoice(db, invoice_id, current_user.id)


# Sale Return Endpoints
@router.get(
    "/returns/list",
    response_model=Dict[str, Any],
    summary="Get Paginated Sale Returns with Filters",
)
def get_paginated_sale_returns(
    page: int = Query(1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(50, ge=10, le=100000, description="Items per page"),
    search: Optional[str] = Query(
        None, description="Search by return no or invoice no"
    ),
    branch_code: Optional[str] = Query(None, description="Filter by branch"),
    status: Optional[str] = Query(None, description="Filter by status"),
    sort_by: str = Query("added_date", description="Sort field"),
    sort_desc: bool = Query(True, description="Sort descending"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get paginated list of sale returns with server-side filtering."""
    return service.sales_service.get_paginated_sale_returns(
        db=db,
        page=page,
        page_size=page_size,
        search=search,
        branch_code=branch_code,
        status=status,
        sort_by=sort_by,
        sort_desc=sort_desc,
        user_branches=user_branches,
    )


@router.get(
    "/returns/",
    response_model=List[schemas.SaleReturn],
    summary="List All Sale Returns",
)
def list_sale_returns(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get list of all sale returns."""
    return service.sales_service.get_all_sale_returns(db, skip, limit, user_branches)


@router.get(
    "/returns/by-invoice/{invoice_id}",
    response_model=List[schemas.SaleReturn],
    summary="Get Sale Returns by Invoice",
)
def get_returns_by_invoice(
    invoice_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_VIEW)),
):
    """Get all sale returns for a specific invoice - server-side filtered."""
    return service.sales_service.get_returns_by_invoice(db, invoice_id, skip, limit)


@router.get(
    "/returns/{return_id}",
    response_model=schemas.SaleReturnWithItems,
    summary="Get Sale Return by ID",
)
def get_sale_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_VIEW)),
):
    """Get sale return details with items."""
    return service.sales_service.get_sale_return_with_items(db, return_id)


@router.post(
    "/returns/",
    response_model=schemas.SaleReturn,
    status_code=status.HTTP_201_CREATED,
    summary="Create Sale Return",
)
def create_sale_return(
    sale_return: schemas.SaleReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_CREATE)),
):
    """Create a new sale return."""
    created = service.sales_service.create_sale_return(db, sale_return, current_user.id)

    # Notify the branch (everyone but the creator) about the sale return.
    from app.modules.notifications import dispatcher as notify

    notify.branch(
        created.branch_code,
        title="Sale Return Created",
        message=f"Return {created.sale_return_no} was created.",
        notification_type=notify.WARNING,
        category=notify.SALES,
        action_url="/sales/returns",
        exclude_user_id=current_user.id,
    )
    return created


@router.delete(
    "/returns/{return_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Sale Return",
)
def delete_sale_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_DELETE)),
):
    """Delete a pending sale return."""
    return service.sales_service.delete_sale_return(db, return_id)


# NOTE: Sale return approvals are handled through the centralized Approval Dashboard
# Use POST /api/v1/common/approvals/{approval_id}/approve or /reject instead


@router.post(
    "/returns/{return_id}/process",
    response_model=schemas.SaleReturnProcessResponse,
    summary="Process Sale Return",
)
def process_sale_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_APPROVAL_APPROVE)),
):
    """
    Process an approved sale return:
    - Restore stock for restockable items
    - Create credit note or process refund
    - Update original invoice totals
    """
    return service.sales_service.process_sale_return(db, return_id, current_user.id)


@router.get(
    "/returns/statistics",
    summary="Get Sale Return Statistics",
)
def get_return_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_VIEW)),
):
    """Get sale return statistics for dashboard."""
    return service.sales_service.get_return_statistics(db)


# Invoice Workflow Endpoints
# NOTE: Invoice/Sales Order approvals are handled through the centralized Approval Dashboard
# Use POST /api/v1/common/approvals/{approval_id}/approve instead


@router.post(
    "/{invoice_id}/approve",
    response_model=schemas.InvoiceWithItems,
    summary="Approve Sales Order",
)
def approve_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SO_APPROVAL_APPROVE)),
):
    """
    Approve a sales order.
    For credit orders, this marks it as approved and completed.
    """
    return service.sales_service.approve_invoice(db, invoice_id, current_user.id)


@router.post(
    "/{invoice_id}/complete",
    response_model=schemas.InvoiceWithItems,
    summary="Complete Sales Order",
)
def complete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SO_APPROVAL_APPROVE)),
):
    """
    Mark an approved invoice as completed (delivered/paid).
    This finalizes the sale and ensures all stock is marked as 'sold'.
    """
    return service.sales_service.complete_invoice(db, invoice_id, current_user.id)


@router.post(
    "/{invoice_id}/cancel",
    response_model=schemas.InvoiceWithItems,
    summary="Cancel Sales Order",
)
def cancel_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_DELETE)),
):
    """
    Cancel a sales order and restore stock to available.
    Cannot cancel completed invoices - use sale return instead.
    """
    return service.sales_service.cancel_invoice(db, invoice_id, current_user.id)


@router.post(
    "/{invoice_id}/return-full",
    response_model=schemas.SaleReturn,
    status_code=status.HTTP_201_CREATED,
    summary="Return Entire Invoice",
)
def return_full_invoice(
    invoice_id: int,
    payload: schemas.FullInvoiceReturnRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_RETURN_CREATE)),
):
    """
    Return an entire completed/approved invoice in one click ("Return Invoice").

    Builds a sale return for every not-yet-returned unit and runs it through the
    standard create → approve → process pipeline, so the same over-return guards,
    maker-checker approval and reversing GL/cashbook postings apply. Returns the
    newly created pending sale return.
    """
    return service.sales_service.create_full_invoice_return(
        db,
        invoice_id=invoice_id,
        payment_method=payload.payment_method,
        return_reason=payload.return_reason,
        remark=payload.remark,
        good_received_locations_id=payload.good_received_locations_id,
        user_id=current_user.id,
    )


# Credit Payment Settlement Endpoints
@router.post(
    "/{invoice_id}/settle-payment",
    response_model=schemas.CreditPaymentResponse,
    summary="Settle Credit Payment",
)
def settle_credit_payment(
    invoice_id: int,
    payment_data: schemas.CreditPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_UPDATE)),
):
    """
    Record a payment (full or partial) against a credit sales order.
    Standard ERP credit settlement process - updates paid_amount and balance_due.
    """
    # Ensure invoice_id matches
    payment_data.invoice_id = invoice_id
    return service.sales_service.settle_credit_payment(
        db, payment_data, current_user.id
    )


@router.get(
    "/{invoice_id}/payment-history",
    response_model=List[schemas.InvoicePaymentHistory],
    summary="Get Invoice Payment History",
)
def get_invoice_payment_history(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """
    Get payment history for a credit invoice showing all settlement transactions.
    """
    return service.sales_service.get_invoice_payment_history(db, invoice_id)


# Bank Transfer Confirmation Endpoints
@router.get(
    "/bank-transfers/pending",
    response_model=List[schemas.PendingBankTransfer],
    summary="Get Pending Bank Transfers",
)
def get_pending_bank_transfers(
    branch_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get all invoices pending bank transfer verification."""
    return service.sales_service.get_pending_bank_transfers(
        db, branch_code, user_branches
    )


@router.post(
    "/{invoice_id}/bank-transfer/confirm",
    response_model=schemas.BankTransferConfirmResponse,
    summary="Confirm/Reject Bank Transfer",
)
def confirm_bank_transfer(
    invoice_id: int,
    request: schemas.BankTransferConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_APPROVE)),
):
    """
    Confirm (verify) or reject a bank transfer payment.
    - verify: Marks the bank transfer as verified and completes the sale
    - reject: Marks the bank transfer as rejected and cancels the order
    """
    return service.sales_service.confirm_bank_transfer(
        db, invoice_id, request.action, current_user.id, request.rejection_reason
    )


@router.post(
    "/{invoice_id}/bank-transfer/verify",
    response_model=schemas.BankTransferConfirmResponse,
    summary="Verify Bank Transfer",
)
def verify_bank_transfer(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_APPROVE)),
):
    """Verify (approve) a bank transfer payment. Marks as verified and completes the sale."""
    return service.sales_service.confirm_bank_transfer(
        db, invoice_id, "verify", current_user.id, None
    )


@router.post(
    "/{invoice_id}/bank-transfer/reject",
    response_model=schemas.BankTransferConfirmResponse,
    summary="Reject Bank Transfer",
)
def reject_bank_transfer(
    invoice_id: int,
    request: schemas.BankTransferRejectRequest = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_APPROVE)),
):
    """Reject a bank transfer payment. Marks as rejected and cancels the order."""
    reason = request.reason if request else None
    return service.sales_service.confirm_bank_transfer(
        db, invoice_id, "reject", current_user.id, reason
    )


# Credit Settlement Bank Transfer Verification Endpoints
@router.post(
    "/credit-settlement/{transaction_id}/bank-transfer/verify",
    response_model=schemas.BankTransferConfirmResponse,
    summary="Verify Credit Settlement Bank Transfer",
)
def verify_credit_settlement_bank_transfer(
    transaction_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_APPROVE)),
):
    """Verify a credit settlement bank transfer. Applies the deferred payment to the invoice."""
    return service.sales_service.confirm_credit_settlement_bank_transfer(
        db, transaction_id, "verify", current_user.id
    )


@router.post(
    "/credit-settlement/{transaction_id}/bank-transfer/reject",
    response_model=schemas.BankTransferConfirmResponse,
    summary="Reject Credit Settlement Bank Transfer",
)
def reject_credit_settlement_bank_transfer(
    transaction_id: int,
    request: schemas.BankTransferRejectRequest = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_APPROVE)),
):
    """Reject a credit settlement bank transfer. Voids the settlement transaction."""
    reason = request.reason if request else None
    return service.sales_service.confirm_credit_settlement_bank_transfer(
        db, transaction_id, "reject", current_user.id, reason
    )


# =============================================================================
# Payment Card Settings Endpoints
# =============================================================================


@router.get(
    "/settings/payment-cards",
    response_model=List[schemas.PaymentCard],
    summary="List All Payment Cards",
)
def list_payment_cards(
    active_only: bool = Query(False, description="Filter active cards only"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Get list of all configured payment cards."""
    return service.payment_card_service.get_all(db, active_only)


@router.get(
    "/settings/payment-cards/{card_id}",
    response_model=schemas.PaymentCard,
    summary="Get Payment Card",
)
def get_payment_card(
    card_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Get a specific payment card by ID."""
    return service.payment_card_service.get_by_id(db, card_id)


@router.post(
    "/settings/payment-cards",
    response_model=schemas.PaymentCard,
    status_code=status.HTTP_201_CREATED,
    summary="Create Payment Card",
)
def create_payment_card(
    card_data: schemas.PaymentCardCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_SETTINGS_UPDATE)),
):
    """Create a new payment card configuration."""
    return service.payment_card_service.create(db, card_data)


@router.put(
    "/settings/payment-cards/{card_id}",
    response_model=schemas.PaymentCard,
    summary="Update Payment Card",
)
def update_payment_card(
    card_id: int,
    card_data: schemas.PaymentCardUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_SETTINGS_UPDATE)),
):
    """Update an existing payment card configuration."""
    return service.payment_card_service.update(db, card_id, card_data)


@router.delete(
    "/settings/payment-cards/{card_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete Payment Card",
)
def delete_payment_card(
    card_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_SETTINGS_UPDATE)),
):
    """Delete a payment card (soft delete by setting active=false)."""
    service.payment_card_service.delete(db, card_id)
    return None


# =============================================================================
# GL / Accounting Integration Endpoints (Scenario 30)
# =============================================================================


@router.get(
    "/{invoice_id}/gl-entries",
    response_model=List[Dict[str, Any]],
    summary="Get GL Entries for Invoice",
)
def get_invoice_gl_entries(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Get all General Ledger entries posted for a specific invoice."""
    from app.modules.sales.accounting_integration import SalesAccountingIntegration

    gl_integration = SalesAccountingIntegration(db)
    return gl_integration.get_gl_entries_for_invoice(invoice_id)


@router.get(
    "/{invoice_id}/journal-entries",
    response_model=List[Dict[str, Any]],
    summary="Get Journal Entries for Invoice",
)
def get_invoice_journal_entries(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Get all auto-generated journal entries for a specific invoice."""
    from app.modules.sales.accounting_integration import SalesAccountingIntegration

    gl_integration = SalesAccountingIntegration(db)
    return gl_integration.get_journal_entries_for_invoice(invoice_id)


@router.get(
    "/{invoice_id}/gl-status",
    response_model=Dict[str, Any],
    summary="Get GL Posting Status for Invoice",
)
def get_invoice_gl_status(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
):
    """Check whether an invoice has been posted to the General Ledger."""
    from app.modules.sales.accounting_integration import SalesAccountingIntegration

    gl_integration = SalesAccountingIntegration(db)
    return gl_integration.get_gl_posting_status(invoice_id)


@router.post(
    "/{invoice_id}/post-to-gl",
    response_model=Dict[str, Any],
    summary="Manually Post Invoice to GL",
)
def manually_post_invoice_to_gl(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SO_APPROVAL_APPROVE)),
):
    """
    Manually trigger GL posting for an invoice.
    Useful for invoices created before GL integration was enabled,
    or when automatic posting failed.
    Only works for completed/paid invoices.
    """
    from app.modules.sales.accounting_integration import SalesAccountingIntegration

    invoice = service.sales_service.get_invoice(db, invoice_id)

    if invoice.approval_status != "completed":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot post to GL: invoice status is '{invoice.approval_status}'. Only completed invoices can be posted.",
        )

    gl_integration = SalesAccountingIntegration(db)
    result = gl_integration.post_all_for_invoice(invoice, current_user.id)

    db.commit()

    return result


import csv
import io

from fastapi.responses import StreamingResponse


@router.get(
    "/export-csv",
    summary="Export Sales Orders to CSV",
)
def export_sales_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    branch_codes: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_ORDER_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    # Enforce branch-based access control on the export.
    # Regular users can only export their allowed branches; superusers
    # (user_branches is None) may export any/all branches.
    if branch_codes:
        if user_branches is not None:
            invalid = [b for b in branch_codes if b not in user_branches]
            if invalid:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Access denied to branch(es): {', '.join(invalid)}",
                )
        effective_branches = branch_codes
    else:
        effective_branches = user_branches
    invoices = service.sales_service.get_all_invoices(db, skip, limit, effective_branches)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Invoice No",
            "Branch Code",
            "Created Date",
            "Customer Name",
            "Payment Method",
            "Status",
            "Total",
            "Created At",
            "Updated At",
        ]
    )
    for inv in invoices:
        writer.writerow(
            [
                inv.invoice_no or "",
                inv.branch_code or "",
                inv.created_date or "",
                inv.customer.customer_name if getattr(inv, "customer", None) else "",
                inv.payment_method or "",
                inv.approval_status or "",
                (inv.cash_amount or 0)
                + (inv.card_visa_amount or 0)
                + (inv.cheque_amount or 0)
                + (inv.credit_amount or 0),
                inv.created_at.isoformat() if getattr(inv, "created_at", None) else "",
                inv.updated_at.isoformat() if getattr(inv, "updated_at", None) else "",
            ]
        )
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=sales_orders.csv"
    return response
