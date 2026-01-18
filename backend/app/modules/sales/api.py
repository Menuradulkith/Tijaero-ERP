from typing import List, Dict, Any
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from app.modules.sales import schemas, service

router = APIRouter()

# Available Products endpoint for sales stock
@router.get(
    "/available-products",
    response_model=List[Dict[str, Any]],
    summary="Get Products Available in Sales Stock",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_available_products(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get products that are available in sales stock with quantities."""
    return service.sales_service.get_available_products_from_stock(db)

# Statistics endpoint
@router.get(
    "/statistics",
    response_model=Dict[str, Any],
    summary="Get Sales Statistics",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_sales_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get sales statistics for dashboard."""
    return service.sales_service.get_sales_statistics(db)

# Invoice/Sales Order Endpoints
@router.get(
    "/",
    response_model=List[schemas.Invoice],
    summary="List All Sales Orders",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def list_invoices(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get list of all sales orders/invoices with pagination."""
    return service.sales_service.get_all_invoices(db, skip, limit)

@router.get(
    "/search",
    response_model=List[schemas.Invoice],
    summary="Search Sales Orders",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def search_invoices(
    q: str = Query(..., min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Search sales orders by invoice number or customer."""
    return service.sales_service.search_invoices(db, q, skip, limit)

@router.get(
    "/pending-approval",
    response_model=List[schemas.Invoice],
    summary="Get Pending Approval Invoices",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_pending_approval_invoices(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get invoices pending approval - server-side filtered for efficiency."""
    return service.sales_service.get_pending_approval(db, skip, limit)

@router.get(
    "/by-customer/{customer_id}",
    response_model=List[schemas.Invoice],
    summary="Get Invoices by Customer",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_invoices_by_customer(
    customer_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get all invoices for a specific customer."""
    return service.sales_service.get_by_customer(db, customer_id, skip, limit)

@router.get(
    "/customer/{customer_id}/recent",
    response_model=List[schemas.Invoice],
    summary="Get Recent Sales for Customer",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_recent_customer_sales(
    customer_id: int,
    limit: int = Query(5, ge=1, le=20),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get the most recent sales records for a customer from any branch."""
    return service.sales_service.get_recent_by_customer(db, customer_id, limit)

@router.get(
    "/{invoice_id}",
    response_model=schemas.InvoiceWithItems,
    summary="Get Sales Order by ID",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get sales order/invoice details with items."""
    return service.sales_service.get_invoice(db, invoice_id)

@router.post(
    "/",
    response_model=schemas.InvoiceWithItems,
    status_code=status.HTTP_201_CREATED,
    summary="Create Sales Order",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_invoice(
    invoice: schemas.InvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """Create a new sales order/invoice with items."""
    return service.sales_service.create_invoice(db, invoice, current_user.id)

@router.put(
    "/{invoice_id}",
    response_model=schemas.InvoiceWithItems,
    summary="Update Sales Order",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def update_invoice(
    invoice_id: int,
    invoice: schemas.InvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """Update sales order/invoice information."""
    return service.sales_service.update_invoice(db, invoice_id, invoice, current_user.id)

@router.delete(
    "/{invoice_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Sales Order",
    dependencies=[Depends(require_permission(*Permissions.SALES_DELETE))]
)
def delete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_DELETE))
):
    """Delete a sales order/invoice."""
    return service.sales_service.delete_invoice(db, invoice_id)

# Sale Return Endpoints
@router.get(
    "/returns/",
    response_model=List[schemas.SaleReturn],
    summary="List All Sale Returns",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def list_sale_returns(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get list of all sale returns."""
    return service.sales_service.get_all_sale_returns(db, skip, limit)

@router.get(
    "/returns/by-invoice/{invoice_id}",
    response_model=List[schemas.SaleReturn],
    summary="Get Sale Returns by Invoice",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_returns_by_invoice(
    invoice_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get all sale returns for a specific invoice - server-side filtered."""
    return service.sales_service.get_returns_by_invoice(db, invoice_id, skip, limit)

@router.get(
    "/returns/{return_id}",
    response_model=schemas.SaleReturnWithItems,
    summary="Get Sale Return by ID",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_sale_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get sale return details with items."""
    return service.sales_service.get_sale_return_with_items(db, return_id)

@router.post(
    "/returns/",
    response_model=schemas.SaleReturn,
    status_code=status.HTTP_201_CREATED,
    summary="Create Sale Return",
    dependencies=[Depends(require_permission(*Permissions.SALES_CREATE))]
)
def create_sale_return(
    sale_return: schemas.SaleReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_CREATE))
):
    """Create a new sale return."""
    return service.sales_service.create_sale_return(db, sale_return, current_user.id)

@router.delete(
    "/returns/{return_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Sale Return",
    dependencies=[Depends(require_permission(*Permissions.SALES_DELETE))]
)
def delete_sale_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_DELETE))
):
    """Delete a pending sale return."""
    return service.sales_service.delete_sale_return(db, return_id)

# NOTE: Sale return approvals are handled through the centralized Approval Dashboard
# Use POST /api/v1/common/approvals/{approval_id}/approve or /reject instead

@router.post(
    "/returns/{return_id}/process",
    response_model=schemas.SaleReturnProcessResponse,
    summary="Process Sale Return",
    dependencies=[Depends(require_permission(*Permissions.SALES_APPROVE))]
)
def process_sale_return(
    return_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
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
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_return_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """Get sale return statistics for dashboard."""
    return service.sales_service.get_return_statistics(db)

# Invoice Workflow Endpoints
# NOTE: Invoice/Sales Order approvals are handled through the centralized Approval Dashboard
# Use POST /api/v1/common/approvals/{approval_id}/approve instead

@router.post(
    "/{invoice_id}/complete",
    response_model=schemas.InvoiceWithItems,
    summary="Complete Sales Order",
    dependencies=[Depends(require_permission(*Permissions.SALES_APPROVE))]
)
def complete_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_APPROVE))
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
    dependencies=[Depends(require_permission(*Permissions.SALES_DELETE))]
)
def cancel_invoice(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_DELETE))
):
    """
    Cancel a sales order and restore stock to available.
    Cannot cancel completed invoices - use sale return instead.
    """
    return service.sales_service.cancel_invoice(db, invoice_id, current_user.id)

# Credit Payment Settlement Endpoints
@router.post(
    "/{invoice_id}/settle-payment",
    response_model=schemas.CreditPaymentResponse,
    summary="Settle Credit Payment",
    dependencies=[Depends(require_permission(*Permissions.SALES_UPDATE))]
)
def settle_credit_payment(
    invoice_id: int,
    payment_data: schemas.CreditPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_UPDATE))
):
    """
    Record a payment (full or partial) against a credit sales order.
    Standard ERP credit settlement process - updates paid_amount and balance_due.
    """
    # Ensure invoice_id matches
    payment_data.invoice_id = invoice_id
    return service.sales_service.settle_credit_payment(db, payment_data, current_user.id)

@router.get(
    "/{invoice_id}/payment-history",
    response_model=List[schemas.InvoicePaymentHistory],
    summary="Get Invoice Payment History",
    dependencies=[Depends(require_permission(*Permissions.SALES_VIEW))]
)
def get_invoice_payment_history(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SALES_VIEW))
):
    """
    Get payment history for a credit invoice showing all settlement transactions.
    """
    return service.sales_service.get_invoice_payment_history(db, invoice_id)
