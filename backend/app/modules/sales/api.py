from typing import List, Dict, Any
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from app.modules.sales import schemas, service

router = APIRouter()

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
    return service.sales_service.get_sale_return(db, return_id)

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
    return service.sales_service.create_sale_return(db, sale_return)
