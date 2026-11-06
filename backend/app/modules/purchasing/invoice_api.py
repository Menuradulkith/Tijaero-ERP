"""
Purchase Invoice API Endpoints

Standard ERP Purchase Invoice workflow:
- Create invoice from GRN(s)
- Verify invoice (makes it payable)
- Pay against invoice(s)
- View outstanding/payable invoices per supplier
"""

from typing import List, Optional
from datetime import date as date_type

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_user_branch_filter, validate_branch_access
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db

from app.modules.purchasing.invoice_schemas import (
    PurchaseInvoiceCreate,
    PurchaseInvoiceUpdate,
    PurchaseInvoiceResponse,
    PurchaseInvoiceListResponse,
    PurchaseInvoiceListFilter,
    PaymentWithAllocationsCreate,
    GRNInvoiceableItem,
    OutstandingGRNItem,
)
from app.modules.purchasing.api import _ensure_row_branch
from app.modules.purchasing.invoice_models import PurchaseInvoice
from app.modules.purchasing.invoice_service import PurchaseInvoiceService
from app.modules.purchasing.models import GoodReceivedNote

router = APIRouter(
    prefix="/purchasing/invoices",
    tags=["purchase-invoices"],
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW))],
)


def _ensure_branch(user: User, branch_code: Optional[str]) -> None:
    """403 when the user is not assigned to `branch_code` (same answer as the PO routes)."""
    if branch_code and not validate_branch_access(user, branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")


# ─── CREATE ────────────────────────────────────────────────────────────────
@router.post(
    "",
    response_model=PurchaseInvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create Purchase Invoice from GRN(s)",
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_CREATE))],
)
def create_purchase_invoice(
    data: PurchaseInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a Purchase Invoice (Supplier Bill).
    
    Workflow:
    1. Supplier sends an invoice for goods already received (GRN exists)
    2. User creates Purchase Invoice, linking to one or more GRNs
    3. System validates quantities and creates the liability
    """
    _ensure_branch(current_user, data.branch_code)
    for grn_id in {item.grn_id for item in data.items}:
        _ensure_row_branch(db, current_user, GoodReceivedNote, grn_id)
    svc = PurchaseInvoiceService(db)
    return svc.create_invoice(data, created_by=current_user.id)


# ─── LIST ──────────────────────────────────────────────────────────────────
@router.get(
    "",
    response_model=List[PurchaseInvoiceListResponse],
    summary="List Purchase Invoices",
)
def list_purchase_invoices(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    payment_status: Optional[str] = None,
    payment_type: Optional[str] = None,
    po_no: Optional[str] = None,
    date_from: Optional[date_type] = None,
    date_to: Optional[date_type] = None,
    overdue_only: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    _ensure_branch(current_user, branch_code)
    svc = PurchaseInvoiceService(db)
    filters = PurchaseInvoiceListFilter(
        supplier_id=supplier_id,
        branch_code=branch_code,
        status=status_filter,
        payment_status=payment_status,
        payment_type=payment_type,
        po_no=po_no,
        date_from=date_from,
        date_to=date_to,
        overdue_only=overdue_only,
        skip=skip,
        limit=limit,
    )
    return svc.list_invoices(filters, branch_codes=user_branches)


# ─── GET BY ID ─────────────────────────────────────────────────────────────
@router.get(
    "/outstanding",
    response_model=List[PurchaseInvoiceListResponse],
    summary="Get all outstanding invoices across all suppliers",
)
def get_outstanding_invoices(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    payment_type: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Returns all unpaid/partially paid invoices across suppliers.
    Used by the Payment Report page Outstanding tab.
    """
    _ensure_branch(current_user, branch_code)
    svc = PurchaseInvoiceService(db)
    filters = PurchaseInvoiceListFilter(
        supplier_id=supplier_id,
        branch_code=branch_code,
        payment_type=payment_type,
        status=None,
        payment_status=None,
    )
    all_invoices = svc.list_invoices(filters, branch_codes=user_branches)
    return [i for i in all_invoices if i.payment_status in ("unpaid", "partial")]


# ─── OUTSTANDING GRNs (ALL SUPPLIERS) ─────────────────────────────────────
@router.get(
    "/outstanding-grns",
    response_model=List[OutstandingGRNItem],
    summary="Get all outstanding (uninvoiced) GRNs across all suppliers",
)
def get_outstanding_grns(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Returns all GRNs that have NOT yet been linked to a Purchase Invoice.
    These are goods received but not yet vouchered.
    Optionally filter by supplier_id and/or branch_code.
    """
    _ensure_branch(current_user, branch_code)
    svc = PurchaseInvoiceService(db)
    return svc.get_all_outstanding_grns(
        supplier_id=supplier_id,
        branch_code=branch_code,
        branch_codes=user_branches,
    )


@router.get(
    "/{invoice_id}",
    response_model=PurchaseInvoiceResponse,
    summary="Get Purchase Invoice details",
)
def get_purchase_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_row_branch(db, current_user, PurchaseInvoice, invoice_id)
    svc = PurchaseInvoiceService(db)
    return svc.get_invoice(invoice_id)


# ─── UPDATE ────────────────────────────────────────────────────────────────
@router.patch(
    "/{invoice_id}",
    response_model=PurchaseInvoiceResponse,
    summary="Update draft Purchase Invoice",
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_UPDATE))],
)
def update_purchase_invoice(
    invoice_id: int,
    data: PurchaseInvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_row_branch(db, current_user, PurchaseInvoice, invoice_id)
    for grn_id in {item.grn_id for item in (data.items or [])}:
        _ensure_row_branch(db, current_user, GoodReceivedNote, grn_id)
    svc = PurchaseInvoiceService(db)
    invoice = svc.update_invoice(invoice_id, data, user_id=current_user.id)
    return svc.get_invoice(invoice_id)


# ─── CANCEL ───────────────────────────────────────────────────────────────────
@router.post(
    "/{invoice_id}/cancel",
    response_model=PurchaseInvoiceResponse,
    summary="Cancel Purchase Invoice",
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_UPDATE))],
)
def cancel_purchase_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _ensure_row_branch(db, current_user, PurchaseInvoice, invoice_id)
    svc = PurchaseInvoiceService(db)
    svc.cancel_invoice(invoice_id, user_id=current_user.id)
    return svc.get_invoice(invoice_id)


# ─── INVOICEABLE GRNs ─────────────────────────────────────────────────────
@router.get(
    "/supplier/{supplier_id}/invoiceable-grns",
    response_model=List[GRNInvoiceableItem],
    summary="Get GRNs available for invoicing",
)
def get_invoiceable_grns(
    supplier_id: int,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Returns GRNs that have remaining quantity/amount to be invoiced.
    Use this to populate the "Select GRN" dropdown when creating a Purchase Invoice.
    Optionally filter by branch_code to only show GRNs from a specific branch.
    """
    _ensure_branch(current_user, branch_code)
    svc = PurchaseInvoiceService(db)
    return svc.get_invoiceable_grns(supplier_id, branch_code=branch_code, branch_codes=user_branches)


# ─── PAYABLE INVOICES ─────────────────────────────────────────────────────
@router.get(
    "/supplier/{supplier_id}/payable",
    response_model=List[PurchaseInvoiceListResponse],
    summary="Get payable invoices for a supplier",
)
def get_payable_invoices(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Returns verified, unpaid/partially paid invoices ready for payment.
    Used by the Supplier Payments page to select invoices to pay.
    """
    svc = PurchaseInvoiceService(db)
    return svc.get_payable_invoices(supplier_id, branch_codes=user_branches)


# ─── PAY AGAINST INVOICES ─────────────────────────────────────────────────
@router.post(
    "/pay",
    summary="Create payment with allocations to invoices",
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_CREATE))],
)
def pay_against_invoices(
    data: PaymentWithAllocationsCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Standard ERP payment flow:
    1. Select invoices to pay
    2. Enter payment amount
    3. Allocate amounts to each invoice
    4. System creates payment + updates invoice balances
    
    Example:
      Payment: Rs. 2,000,000
        → Invoice PI-2026-00001: Rs. 800,000 (fully paid)
        → Invoice PI-2026-00002: Rs. 1,200,000 (fully paid)
    """
    _ensure_branch(current_user, data.branch_code)
    for invoice_id in {a.purchase_invoice_id for a in data.allocations}:
        _ensure_row_branch(db, current_user, PurchaseInvoice, invoice_id)
    svc = PurchaseInvoiceService(db)
    payment = svc.create_payment_with_allocations(data, created_by=current_user.id)
    return {
        "payment_id": payment.id,
        "payment_no": payment.payment_no,
        "payment_amount": float(payment.payment_amount),
        "status": payment.status,
        "message": "Payment created successfully." if payment.status == "verified" else "Payment created. Pending approval.",
    }
