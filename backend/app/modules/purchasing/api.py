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

@router.delete("/orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase_order(order_id: int, db: Session = Depends(get_db)):
    """Delete a purchase order"""
    order_service = service.PurchasingOrderService(db)
    order_service.delete_order(order_id)
    return None

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
@router.post("/returns/validate-barcode", response_model=schemas.BarcodeValidationResponse)
def validate_barcode_for_return(
    request: schemas.BarcodeValidationRequest,
    db: Session = Depends(get_db)
):
    """
    Validate a barcode before adding to purchase return.
    Checks:
    - Barcode exists in sales stock
    - Item is available (not sold/returned/transferred)
    - Item belongs to the specified GRN and branch
    """
    return_service = service.PurchasingReturnService(db)
    return return_service.validate_barcode_for_return(
        request.barcode,
        request.grn_id,
        request.branch_code
    )

@router.post("/returns", response_model=schemas.PurchasingReturnWithItems, status_code=status.HTTP_201_CREATED)
def create_purchase_return(
    return_data: schemas.PurchasingReturnCreate,
    db: Session = Depends(get_db)
):
    """
    Create a purchase return.
    - Validates all barcodes
    - If require_approval=True: saves as 'pending', marks stock as 'return_pending'
    - If require_approval=False: saves as 'approved', marks stock as 'returned_to_supplier'
    """
    return_service = service.PurchasingReturnService(db)
    return return_service.create_return(return_data)

@router.post("/returns/{return_id}/approve", response_model=schemas.PurchasingReturnWithItems)
def approve_purchase_return(
    return_id: int,
    request: schemas.PurchaseReturnApprovalRequest,
    db: Session = Depends(get_db)
):
    """
    Approve or reject a pending purchase return.
    - If approve=True: finalizes stock updates, updates supplier credit
    - If approve=False: reverts stock status to 'available'
    """
    return_service = service.PurchasingReturnService(db)
    return return_service.approve_return(return_id, request.approve, request.remarks)

@router.get("/returns/{return_id}", response_model=schemas.PurchasingReturnWithItems)
def get_purchase_return(return_id: int, db: Session = Depends(get_db)):
    """Get purchase return by ID with product names"""
    return_service = service.PurchasingReturnService(db)
    return_record = return_service.get_return(return_id)
    
    # Build response with product names
    items_with_names = []
    for item in return_record.items:
        item_dict = {
            'id': item.id,
            'product_id': item.product_id,
            'purchasing_price': item.purchasing_price,
            'return_price': item.return_price,
            'barcode': item.barcode,
            'purchasingreturn_id': item.purchasingreturn_id,
            'branch_code': item.branch_code,
            'added_date': item.added_date,
            'sales_stock_id': item.sales_stock_id,
            'product_name': item.product.name if item.product else None,
        }
        items_with_names.append(item_dict)
    
    return {
        'id': return_record.id,
        'purchasing_return_no': return_record.purchasing_return_no,
        'branch_code': return_record.branch_code,
        'remark': return_record.remark,
        'goodreceivednote_id': return_record.goodreceivednote_id,
        'added_date': return_record.added_date,
        'status': return_record.status,
        'approved_date': return_record.approved_date,
        'approval_id': return_record.approval_id,
        'items': items_with_names,
    }

@router.get("/returns", response_model=List[schemas.PurchasingReturn])
def list_purchase_returns(
    status_filter: Optional[str] = Query(None, description="Filter by status: draft, pending, approved, rejected"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all purchase returns with optional status filter"""
    return_service = service.PurchasingReturnService(db)
    return return_service.list_returns(skip, limit, status_filter)

# Good Received Note Endpoints
@router.post("/grn", response_model=schemas.GoodReceivedNote, status_code=status.HTTP_201_CREATED)
def create_grn(
    grn: schemas.GoodReceivedNoteCreate,
    db: Session = Depends(get_db)
):
    """Create a new Good Received Note"""
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.create(grn)

@router.get("/grn/{grn_id}", response_model=schemas.GoodReceivedNote)
def get_grn(grn_id: int, db: Session = Depends(get_db)):
    """Get GRN by ID"""
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_by_id(grn_id)

@router.get("/grn", response_model=List[schemas.GoodReceivedNote])
def list_grns(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all GRNs with optional filters"""
    from datetime import date as date_type
    
    grn_service = service.GoodReceivedNoteService(db)
    filters = schemas.GoodReceivedNoteListFilter(
        branch_code=branch_code,
        date_from=date_type.fromisoformat(date_from) if date_from else None,
        date_to=date_type.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return grn_service.list_grns(filters)

@router.patch("/grn/{grn_id}", response_model=schemas.GoodReceivedNote)
def update_grn(
    grn_id: int,
    grn: schemas.GoodReceivedNoteCreate,
    db: Session = Depends(get_db)
):
    """Update a GRN"""
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.update(grn_id, grn)

# Good Received Items Endpoints
@router.get("/grn/{grn_id}/items", response_model=List[schemas.GoodReceivedItemWithDetails])
def get_grn_items(grn_id: int, db: Session = Depends(get_db)):
    """Get all items for a GRN with product details and saved-to info"""
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_items_with_details(grn_id)

@router.post("/grn-items", response_model=schemas.GoodReceivedItem, status_code=status.HTTP_201_CREATED)
def create_grn_item(
    item: schemas.GoodReceivedItemCreate,
    db: Session = Depends(get_db)
):
    """Create a GRN item"""
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.create_item(item)


# Supplier Credits Settlement Endpoints
@router.post("/credit-settlements", response_model=schemas.SupplierCreditsSettle, status_code=status.HTTP_201_CREATED)
def create_credit_settlement(
    settle: schemas.SupplierCreditsSettleCreate,
    db: Session = Depends(get_db)
):
    """Create a new supplier credit settlement"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.create(settle)

@router.get("/credit-settlements/{settle_id}", response_model=schemas.SupplierCreditsSettleWithTransactions)
def get_credit_settlement(settle_id: int, db: Session = Depends(get_db)):
    """Get credit settlement by ID with all transactions"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.get_with_transactions(settle_id)

@router.get("/credit-settlements", response_model=List[schemas.SupplierCreditsSettle])
def list_credit_settlements(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all credit settlements"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.list_settlements(skip, limit)

@router.get("/suppliers/{supplier_id}/credit-settlements", response_model=List[schemas.SupplierCreditsSettle])
def get_supplier_credit_settlements(supplier_id: int, db: Session = Depends(get_db)):
    """Get all credit settlements for a supplier"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.get_by_supplier(supplier_id)

@router.delete("/credit-settlements/{settle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_credit_settlement(settle_id: int, db: Session = Depends(get_db)):
    """Delete a credit settlement"""
    settle_service = service.SupplierCreditsSettleService(db)
    settle_service.delete(settle_id)


# ==================== SUPPLIER CREDIT MANAGEMENT ENDPOINTS ====================

from app.modules.purchasing.credit_service import supplier_credit_service
from datetime import date

@router.get("/suppliers/{supplier_id}/credit-status")
def get_supplier_credit_status(
    supplier_id: int,
    db: Session = Depends(get_db)
):
    """
    Get complete credit status for a supplier.
    
    Returns:
    - Credit limit and available credit
    - Outstanding payables
    - Overdue GRNs count and amount
    """
    return supplier_credit_service.get_supplier_credit_status(db, supplier_id)


@router.post("/suppliers/{supplier_id}/credit-check")
def check_supplier_credit(
    supplier_id: int,
    purchase_amount: float = Query(..., description="Amount of the proposed credit purchase"),
    allow_over_limit: bool = Query(False, description="Allow purchase if over limit (warning only)"),
    db: Session = Depends(get_db)
):
    """
    Check if a credit purchase can be made from a supplier.
    
    Use this before creating a credit purchase to validate:
    - Available credit from supplier
    - Purchase won't exceed credit limit
    - No overdue payments to supplier
    """
    from decimal import Decimal
    return supplier_credit_service.validate_credit_purchase(
        db, supplier_id, Decimal(str(purchase_amount)), allow_over_limit
    )


@router.get("/suppliers/{supplier_id}/aging-report")
def get_supplier_aging_report(
    supplier_id: int,
    db: Session = Depends(get_db)
):
    """
    Get aging report for supplier payables:
    - Current (not yet due)
    - 1-30 days overdue
    - 31-60 days overdue
    - 61-90 days overdue
    - Over 90 days overdue
    """
    return supplier_credit_service.get_aging_report(db, supplier_id)


@router.get("/reports/payables-aging")
def get_all_suppliers_aging_report(
    db: Session = Depends(get_db)
):
    """
    Get aging report for all suppliers' outstanding payables.
    """
    return supplier_credit_service.get_aging_report(db)


@router.get("/suppliers/{supplier_id}/statement")
def get_supplier_statement(
    supplier_id: int,
    from_date: Optional[date] = Query(None, description="Start date for statement"),
    to_date: Optional[date] = Query(None, description="End date for statement"),
    db: Session = Depends(get_db)
):
    """
    Get detailed supplier statement showing all purchases and payments.
    """
    return supplier_credit_service.get_supplier_statement(db, supplier_id, from_date, to_date)


@router.get("/grn/{grn_id}/payment-history")
def get_grn_payment_history(
    grn_id: int,
    db: Session = Depends(get_db)
):
    """
    Get payment history for a specific GRN.
    
    Shows all payments made against this GRN and remaining amount due.
    """
    return supplier_credit_service.get_grn_payment_history(db, grn_id)
