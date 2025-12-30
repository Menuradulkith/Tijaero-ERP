from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/purchasing", tags=["purchasing"])

# Supplier Endpoints
@router.post("/suppliers", response_model=schemas.Supplier, status_code=status.HTTP_201_CREATED)
def create_supplier(
    supplier: schemas.SupplierCreate,
    db: Session = Depends(get_db)
):
    """Create a new supplier"""
    supplier_service = service.SupplierService(db)
    return supplier_service.create_supplier(supplier)

@router.get("/suppliers/{supplier_id}", response_model=schemas.Supplier)
def get_supplier(supplier_id: int, db: Session = Depends(get_db)):
    """Get supplier by ID"""
    supplier_service = service.SupplierService(db)
    return supplier_service.get_supplier(supplier_id)

@router.get("/suppliers", response_model=List[schemas.Supplier])
def list_suppliers(
    active: Optional[bool] = None,
    country_id: Optional[int] = None,
    search: Optional[str] = None,
    min_credit_limit: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all suppliers with optional filters"""
    supplier_service = service.SupplierService(db)
    filters = schemas.SupplierListFilter(
        active=active,
        country_id=country_id,
        search=search,
        min_credit_limit=min_credit_limit,
        skip=skip,
        limit=limit
    )
    return supplier_service.list_suppliers(filters)

@router.patch("/suppliers/{supplier_id}", response_model=schemas.Supplier)
def update_supplier(
    supplier_id: int,
    supplier_update: schemas.SupplierUpdate,
    db: Session = Depends(get_db)
):
    """Update supplier information"""
    supplier_service = service.SupplierService(db)
    return supplier_service.update_supplier(supplier_id, supplier_update)

@router.delete("/suppliers/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_supplier(supplier_id: int, db: Session = Depends(get_db)):
    """Delete a supplier"""
    supplier_service = service.SupplierService(db)
    supplier_service.delete_supplier(supplier_id)
    return None

# Purchase Order Endpoints
@router.post("/orders", response_model=schemas.PurchasingOrderWithItems, status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    order: schemas.PurchasingOrderCreate,
    db: Session = Depends(get_db)
):
    """Create a new purchase order"""
    order_service = service.PurchasingOrderService(db)
    return order_service.create_order(order)

@router.get("/orders/{order_id}", response_model=schemas.PurchasingOrderWithItems)
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    """Get purchase order by ID"""
    order_service = service.PurchasingOrderService(db)
    return order_service.get_order(order_id)

@router.get("/orders", response_model=List[schemas.PurchasingOrder])
def list_purchase_orders(
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all purchase orders with optional filters"""
    from datetime import date as date_type
    
    order_service = service.PurchasingOrderService(db)
    filters = schemas.PurchaseOrderListFilter(
        status=status,
        supplier_id=supplier_id,
        branch_code=branch_code,
        date_from=date_type.fromisoformat(date_from) if date_from else None,
        date_to=date_type.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return order_service.list_orders(filters)

@router.patch("/orders/{order_id}", response_model=schemas.PurchasingOrder)
def update_purchase_order(
    order_id: int,
    order_update: schemas.PurchasingOrderUpdate,
    db: Session = Depends(get_db)
):
    """Update purchase order status"""
    order_service = service.PurchasingOrderService(db)
    return order_service.update_order(order_id, order_update)

# Supplier Payment Tracking (using existing tables)
@router.get("/suppliers/{supplier_id}/orders", response_model=List[schemas.PurchasingOrder])
def get_supplier_orders(
    supplier_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """Get all purchase orders for a supplier"""
    order_service = service.PurchasingOrderService(db)
    filters = schemas.PurchaseOrderListFilter(
        supplier_id=supplier_id,
        skip=skip,
        limit=limit
    )
    return order_service.list_orders(filters)

# Purchase Return Endpoints
@router.post("/returns", response_model=schemas.PurchasingReturnWithItems, status_code=status.HTTP_201_CREATED)
def create_purchase_return(
    return_data: schemas.PurchasingReturnCreate,
    db: Session = Depends(get_db)
):
    """Create a purchase return"""
    return_service = service.PurchasingReturnService(db)
    return return_service.create_return(return_data)

@router.get("/returns/{return_id}", response_model=schemas.PurchasingReturnWithItems)
def get_purchase_return(return_id: int, db: Session = Depends(get_db)):
    """Get purchase return by ID"""
    return_service = service.PurchasingReturnService(db)
    return return_service.get_return(return_id)
