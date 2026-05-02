from datetime import date
from typing import Any, Dict, List, Optional

from app.auth.dependencies import (
    get_current_user,
    get_user_branch_filter,
    validate_branch_access,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.common.audit import AuditLog
from app.db.session import get_db
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from . import schemas, service

router = APIRouter(prefix="/purchasing", tags=["purchasing"])


def _user_display_name(user: User) -> str:
    full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full_name or user.username


def _serialize_order_with_user_fields(
    order,
    created_by: Optional[int],
    approved_by: Optional[int],
    user_name_map: Dict[int, str],
) -> Dict[str, Any]:
    payload = schemas.PurchasingOrder.model_validate(order).model_dump()
    payload["created_by"] = created_by
    payload["created_by_name"] = user_name_map.get(created_by) if created_by else None
    payload["approved_by"] = approved_by
    payload["approved_by_name"] = user_name_map.get(approved_by) if approved_by else None
    return payload


def _enrich_purchase_orders_with_user_fields(
    db: Session, orders: List[Any]
) -> List[Dict[str, Any]]:
    if not orders:
        return []

    from app.modules.common.models import Approvals

    order_ids = [order.id for order in orders]
    approval_ids = [order.approval_id for order in orders if order.approval_id]

    created_by_map: Dict[int, int] = {}
    create_logs = (
        db.query(AuditLog.entity_id, AuditLog.user_id)
        .filter(
            AuditLog.entity_type == "purchase_order",
            AuditLog.action == "create",
            AuditLog.entity_id.in_(order_ids),
        )
        .order_by(AuditLog.entity_id.asc(), desc(AuditLog.timestamp))
        .all()
    )
    for entity_id, user_id in create_logs:
        if entity_id not in created_by_map and user_id:
            created_by_map[entity_id] = user_id

    approval_user_map: Dict[int, int] = {}
    if approval_ids:
        approval_records = (
            db.query(Approvals.id, Approvals.status, Approvals.status_changed_by)
            .filter(Approvals.id.in_(approval_ids))
            .all()
        )
        for approval_id, status_value, status_changed_by in approval_records:
            if (
                status_changed_by
                and status_value
                and str(status_value).lower() in {"approved", "rejected"}
            ):
                approval_user_map[approval_id] = status_changed_by

    user_ids = set(created_by_map.values()) | set(approval_user_map.values())
    user_name_map: Dict[int, str] = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(list(user_ids))).all()
        user_name_map = {user.id: _user_display_name(user) for user in users}

    return [
        _serialize_order_with_user_fields(
            order,
            created_by=created_by_map.get(order.id),
            approved_by=approval_user_map.get(order.approval_id)
            if order.approval_id
            else None,
            user_name_map=user_name_map,
        )
        for order in orders
    ]


def _enrich_single_purchase_order_with_user_fields(
    db: Session, order: Any
) -> Dict[str, Any]:
    enriched = _enrich_purchase_orders_with_user_fields(db, [order])
    if not enriched:
        return schemas.PurchasingOrder.model_validate(order).model_dump()

    order_payload = enriched[0]
    if hasattr(order, "items") and order.items is not None:
        order_payload["items"] = [
            schemas.PurchasingOrderItem.model_validate(item).model_dump()
            for item in order.items
        ]
    return order_payload


# ── Statistics endpoint ────────────────────────────────────────────────────
@router.get(
    "/statistics",
    response_model=Dict[str, Any],
    summary="Get Purchasing Statistics",
    dependencies=[Depends(require_permission(*Permissions.PURCHASING_DASHBOARD_VIEW))],
)
def get_purchasing_statistics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PURCHASING_DASHBOARD_VIEW)),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
    branch_code: Optional[str] = Query(
        None, description="Filter statistics by a specific branch"
    ),
):
    """Get purchasing statistics for dashboard."""
    if branch_code:
        if user_branches and branch_code not in user_branches:
            effective_branches = ["__none__"]
        else:
            effective_branches = [branch_code]
    else:
        effective_branches = user_branches
    return service.get_purchasing_statistics(db, effective_branches)


@router.post(
    "/suppliers",
    response_model=schemas.Supplier,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_CREATE))],
)
def create_supplier(
    supplier: schemas.SupplierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_CREATE)),
):

    supplier_service = service.SupplierService(db)
    return supplier_service.create_supplier(supplier)


@router.get(
    "/suppliers/{supplier_id}",
    response_model=schemas.Supplier,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_VIEW))],
)
def get_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_VIEW)),
):

    supplier_service = service.SupplierService(db)
    return supplier_service.get_supplier(supplier_id)


@router.get(
    "/suppliers",
    response_model=List[schemas.Supplier],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_VIEW))],
)
def list_suppliers(
    active: Optional[bool] = None,
    country_id: Optional[int] = None,
    search: Optional[str] = None,
    min_credit_limit: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_VIEW)),
):
    supplier_service = service.SupplierService(db)
    filters = schemas.SupplierListFilter(
        active=active,
        country_id=country_id,
        search=search,
        min_credit_limit=min_credit_limit,
        skip=skip,
        limit=limit,
    )
    return supplier_service.list_suppliers(filters)


@router.patch(
    "/suppliers/{supplier_id}",
    response_model=schemas.Supplier,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_UPDATE))],
)
def update_supplier(
    supplier_id: int,
    supplier_update: schemas.SupplierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_UPDATE)),
):
    supplier_service = service.SupplierService(db)
    return supplier_service.update_supplier(supplier_id, supplier_update)


@router.delete(
    "/suppliers/{supplier_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_DELETE))],
)
def delete_supplier(
    supplier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_DELETE)),
):
    supplier_service = service.SupplierService(db)
    supplier_service.delete_supplier(supplier_id)
    return None


@router.get(
    "/orders/daily-limit/{branch_code}", response_model=schemas.DailyPOLimitCheck
)
def check_daily_po_limit(
    branch_code: str, check_date: Optional[str] = None, db: Session = Depends(get_db)
):
    from datetime import date as date_type

    order_service = service.PurchasingOrderService(db)
    target_date = date_type.fromisoformat(check_date) if check_date else None
    return order_service.check_daily_limit(branch_code, target_date)


@router.post(
    "/orders",
    response_model=schemas.PurchasingOrderWithItems,
    status_code=status.HTTP_201_CREATED,
)
def create_purchase_order(
    order: schemas.PurchasingOrderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, order.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {order.branch_code}",
        )
    order_service = service.PurchasingOrderService(db)
    return order_service.create_order(order, created_by=current_user.id)


@router.get("/orders/{order_id}", response_model=schemas.PurchasingOrderWithItems)
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order_service = service.PurchasingOrderService(db)
    order = order_service.get_order(order_id)
    return _enrich_single_purchase_order_with_user_fields(db, order)


@router.get("/orders", response_model=List[schemas.PurchasingOrder])
def list_purchase_orders(
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    for_grn: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    from datetime import date as date_type

    # Apply branch-based access control
    # If user requested a specific branch, validate they have access
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )
        filter_branch = branch_code
    else:
        # If no branch specified, filter by user's allowed branches
        # For superusers (user_branches is None), don't filter
        filter_branch = None

    order_service = service.PurchasingOrderService(db)
    filters = schemas.PurchaseOrderListFilter(
        status=status,
        supplier_id=supplier_id,
        branch_code=filter_branch,
        branch_codes=user_branches,  # Pass list of allowed branches for filtering
        date_from=date_type.fromisoformat(date_from) if date_from else None,
        date_to=date_type.fromisoformat(date_to) if date_to else None,
        for_grn=for_grn,
        skip=skip,
        limit=limit,
    )
    orders = order_service.list_orders(filters)
    return _enrich_purchase_orders_with_user_fields(db, orders)


@router.patch("/orders/{order_id}", response_model=schemas.PurchasingOrder)
def update_purchase_order(
    order_id: int,
    order_update: schemas.PurchasingOrderUpdate,
    db: Session = Depends(get_db),
):
    order_service = service.PurchasingOrderService(db)
    return order_service.update_order(order_id, order_update)


@router.delete("/orders/{order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order_service = service.PurchasingOrderService(db)
    order_service.delete_order(order_id)
    return None


@router.post("/orders/check-credit", response_model=schemas.POCreditCheckResponse)
def check_po_credit(
    supplier_id: int = Query(..., description="Supplier ID"),
    po_value: float = Query(..., description="Total PO value"),
    payment_method: str = Query("Credit", description="Payment method (Credit/Cash)"),
    po_id: Optional[int] = Query(None, description="PO ID to exclude from pending credits (used when re-checking an existing PO)"),
    db: Session = Depends(get_db)
):
    from decimal import Decimal

    return supplier_credit_service.check_po_credit(
        db, supplier_id, Decimal(str(po_value)), payment_method,
        exclude_po_id=po_id
    )


@router.post("/grn/check-credit", response_model=schemas.GRNCreditCheckResponse)
def check_grn_credit(
    supplier_id: int = Query(..., description="Supplier ID"),
    grn_value: float = Query(..., description="Total GRN value"),
    po_id: Optional[int] = Query(None, description="Purchase Order ID"),
    allow_override: bool = Query(False, description="Allow override if over limit"),
    db: Session = Depends(get_db),
):

    from decimal import Decimal

    return supplier_credit_service.check_grn_credit(
        db, supplier_id, Decimal(str(grn_value)), po_id, allow_override
    )


@router.get(
    "/suppliers/{supplier_id}/orders", response_model=List[schemas.PurchasingOrder]
)
def get_supplier_orders(
    supplier_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    order_service = service.PurchasingOrderService(db)
    filters = schemas.PurchaseOrderListFilter(
        supplier_id=supplier_id, skip=skip, limit=limit
    )
    orders = order_service.list_orders(filters)
    return _enrich_purchase_orders_with_user_fields(db, orders)


@router.post(
    "/returns/validate-barcode", response_model=schemas.BarcodeValidationResponse
)
def validate_barcode_for_return(
    request: schemas.BarcodeValidationRequest, db: Session = Depends(get_db)
):

    return_service = service.PurchasingReturnService(db)
    return return_service.validate_barcode_for_return(
        request.barcode, request.grn_id, request.branch_code
    )


@router.post(
    "/returns",
    response_model=schemas.PurchasingReturnWithItems,
    status_code=status.HTTP_201_CREATED,
)
def create_purchase_return(
    return_data: schemas.PurchasingReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(*Permissions.PURCHASE_RETURN_CREATE)
    ),
):
    return_service = service.PurchasingReturnService(db)
    return return_service.create_return(return_data, user_id=current_user.id)


# NOTE: Purchase return approvals are handled through the centralized Approval Dashboard
# Use POST /api/v1/common/approvals/{approval_id}/approve or /reject instead


@router.get("/returns/{return_id}", response_model=schemas.PurchasingReturnWithItems)
def get_purchase_return(return_id: int, db: Session = Depends(get_db)):

    return_service = service.PurchasingReturnService(db)
    return_record = return_service.get_return(return_id)

    items_with_names = []
    for item in return_record.items:
        item_dict = {
            "id": item.id,
            "product_id": item.product_id,
            "purchasing_price": item.purchasing_price,
            "return_price": item.return_price,
            "barcode": item.barcode,
            "purchasingreturn_id": item.purchasingreturn_id,
            "branch_code": item.branch_code,
            "added_date": item.added_date,
            "sales_stock_id": item.sales_stock_id,
            "product_name": item.product.name if item.product else None,
        }
        items_with_names.append(item_dict)

    return {
        "id": return_record.id,
        "purchasing_return_no": return_record.purchasing_return_no,
        "branch_code": return_record.branch_code,
        "remark": return_record.remark,
        "goodreceivednote_id": return_record.goodreceivednote_id,
        "added_date": return_record.added_date,
        "status": return_record.status,
        "approved_date": return_record.approved_date,
        "approval_id": return_record.approval_id,
        "items": items_with_names,
    }


@router.get("/returns", response_model=List[schemas.PurchasingReturn])
def list_purchase_returns(
    status_filter: Optional[str] = Query(
        None, description="Filter by status: draft, pending, approved, rejected"
    ),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return_service = service.PurchasingReturnService(db)
    return return_service.list_returns(skip, limit, status_filter)


@router.post(
    "/grn", response_model=schemas.GoodReceivedNote, status_code=status.HTTP_201_CREATED
)
def create_grn(
    grn: schemas.GoodReceivedNoteCreate,
    allow_credit_override: bool = Query(
        False,
        description="Allow GRN creation even if credit limit exceeded (requires authorization)",
    ),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, grn.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {grn.branch_code}",
        )
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.create(grn, allow_credit_override=allow_credit_override)


@router.get("/grn/{grn_id}", response_model=schemas.GoodReceivedNote)
def get_grn(grn_id: int, db: Session = Depends(get_db)):

    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_by_id(grn_id)


@router.get("/grn", response_model=List[schemas.GoodReceivedNote])
def list_grns(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    from datetime import date as date_type

    # Apply branch-based access control
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )
        filter_branch = branch_code
    else:
        filter_branch = None

    grn_service = service.GoodReceivedNoteService(db)
    filters = schemas.GoodReceivedNoteListFilter(
        branch_code=filter_branch,
        branch_codes=user_branches,  # Pass list of allowed branches for filtering
        date_from=date_type.fromisoformat(date_from) if date_from else None,
        date_to=date_type.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit,
    )
    return grn_service.list_grns(filters)


# GRN Update endpoint disabled - GRNs are not editable after creation
# @router.patch("/grn/{grn_id}", response_model=schemas.GoodReceivedNote)
# def update_grn(
#     grn_id: int,
#     grn: schemas.GoodReceivedNoteCreate,
#     db: Session = Depends(get_db)
# ):
#     """Update a GRN"""
#     grn_service = service.GoodReceivedNoteService(db)
#     return grn_service.update(grn_id, grn)


@router.get(
    "/grn/{grn_id}/items", response_model=List[schemas.GoodReceivedItemWithDetails]
)
def get_grn_items(grn_id: int, db: Session = Depends(get_db)):
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_items_with_details(grn_id)


@router.post(
    "/grn-items",
    response_model=schemas.GoodReceivedItem,
    status_code=status.HTTP_201_CREATED,
)
def create_grn_item(
    item: schemas.GoodReceivedItemCreate, db: Session = Depends(get_db)
):
    grn_service = service.GoodReceivedNoteService(db)
    try:
        return grn_service.create_item(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/grn-items/check-barcode/{barcode}")
def check_grn_item_barcode_exists(barcode: str, db: Session = Depends(get_db)):
    grn_service = service.GoodReceivedNoteService(db)
    exists = grn_service.barcode_exists(barcode)
    return {"exists": exists, "barcode": barcode}


@router.get("/grn-items/by-po/{po_id}", response_model=List[schemas.GoodReceivedItem])
def get_grn_items_by_po(po_id: int, db: Session = Depends(get_db)):
    """Get all GRN items for a specific Purchase Order"""
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_items_by_po(po_id)


# Supplier Credits Settlement Endpoints
@router.post(
    "/credit-settlements",
    response_model=schemas.SupplierCreditsSettle,
    status_code=status.HTTP_201_CREATED,
)
def create_credit_settlement(
    settle: schemas.SupplierCreditsSettleCreate, db: Session = Depends(get_db)
):
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.create(settle)


@router.get(
    "/credit-settlements/{settle_id}",
    response_model=schemas.SupplierCreditsSettleWithTransactions,
)
def get_credit_settlement(settle_id: int, db: Session = Depends(get_db)):
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.get_with_transactions(settle_id)


@router.get(
    "/credit-settlements",
    response_model=List[schemas.SupplierCreditsSettleWithTransactions],
)
def list_credit_settlements(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List all credit settlements with transactions (eagerly loaded)"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.list_settlements_with_transactions(skip, limit)


@router.get(
    "/suppliers/{supplier_id}/credit-settlements",
    response_model=List[schemas.SupplierCreditsSettle],
)
def get_supplier_credit_settlements(supplier_id: int, db: Session = Depends(get_db)):
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.get_by_supplier(supplier_id)


@router.delete(
    "/credit-settlements/{settle_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_credit_settlement(settle_id: int, db: Session = Depends(get_db)):
    settle_service = service.SupplierCreditsSettleService(db)
    settle_service.delete(settle_id)


@router.post(
    "/credit-settlements/{settle_id}/verify",
    response_model=schemas.SupplierCreditsSettle,
)
def verify_credit_settlement(
    settle_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Verify a credit settlement"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.verify_settlement(settle_id, verified_by=current_user.id)


@router.post(
    "/credit-settlements/{settle_id}/cancel",
    response_model=schemas.SupplierCreditsSettle,
)
def cancel_credit_settlement(
    settle_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """Cancel a credit settlement"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.cancel_settlement(settle_id, verified_by=current_user.id)


# ==================== SUPPLIER CREDIT MANAGEMENT ENDPOINTS ====================

from datetime import date

from app.modules.purchasing.credit_service import supplier_credit_service


@router.get("/suppliers/{supplier_id}/credit-status")
def get_supplier_credit_status(supplier_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_supplier_credit_status(db, supplier_id)


@router.get("/suppliers/{supplier_id}/non-credit-status")
def get_supplier_non_credit_status(supplier_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_supplier_non_credit_status(db, supplier_id)


@router.get("/suppliers/{supplier_id}/payment-status")
def get_supplier_payment_status(supplier_id: int, db: Session = Depends(get_db)):
    """
    Get complete payment status for a supplier - ALL outstanding documents.

    This is the unified API for the Supplier Payments page that shows
    both credit and non-credit POs in a single view.

    Returns:
    - Supplier info and credit details
    - All outstanding purchase orders (both credit and non-credit)
    - Outstanding amounts by payment type
    """
    return supplier_credit_service.get_supplier_payment_status(db, supplier_id)


@router.post("/suppliers/{supplier_id}/credit-check")
def check_supplier_credit(
    supplier_id: int,
    purchase_amount: float = Query(
        ..., description="Amount of the proposed credit purchase"
    ),
    allow_over_limit: bool = Query(
        False, description="Allow purchase if over limit (warning only)"
    ),
    db: Session = Depends(get_db),
):
    from decimal import Decimal

    return supplier_credit_service.validate_credit_purchase(
        db, supplier_id, Decimal(str(purchase_amount)), allow_over_limit
    )


@router.get("/payments/report", response_model=schemas.PaymentReportResponse)
def get_payment_report(
    date_from: Optional[date] = Query(None, description="Start date"),
    date_to: Optional[date] = Query(None, description="End date"),
    supplier_id: Optional[int] = Query(None, description="Filter by supplier"),
    branch_code: Optional[str] = Query(None, description="Filter by branch"),
    db: Session = Depends(get_db),
):
    """Consolidated payment report across all suppliers and payment types."""
    from .credit_service import supplier_credit_service
    return supplier_credit_service.get_payment_report(
        db, date_from=date_from, date_to=date_to,
        supplier_id=supplier_id, branch_code=branch_code,
    )


@router.get("/outstanding-documents", response_model=schemas.SupplierOutstandingDocsReport)
def get_outstanding_documents(
    supplier_id: Optional[int] = Query(None, description="Filter by supplier"),
    branch_code: Optional[str] = Query(None, description="Filter by branch"),
    db: Session = Depends(get_db),
):
    """All unpaid/partial GRNs across all suppliers."""
    from .credit_service import supplier_credit_service
    return supplier_credit_service.get_outstanding_documents(
        db, supplier_id=supplier_id, branch_code=branch_code,
    )


@router.get("/suppliers/{supplier_id}/aging-report")
def get_supplier_aging_report(supplier_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_aging_report(db, supplier_id)


@router.get("/reports/payables-aging")
def get_all_suppliers_aging_report(db: Session = Depends(get_db)):
    return supplier_credit_service.get_aging_report(db)


@router.get("/suppliers/{supplier_id}/statement")
def get_supplier_statement(
    supplier_id: int,
    from_date: Optional[date] = Query(None, description="Start date for statement"),
    to_date: Optional[date] = Query(None, description="End date for statement"),
    db: Session = Depends(get_db),
):
    return supplier_credit_service.get_supplier_statement(
        db, supplier_id, from_date, to_date
    )


@router.get("/grn/{grn_id}/payment-history")
def get_grn_payment_history(grn_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_grn_payment_history(db, grn_id)


@router.post(
    "/supplier-payments",
    response_model=schemas.SupplierPayment,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier_payment(
    payment: schemas.SupplierPaymentCreate, db: Session = Depends(get_db)
):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.create_payment(payment)


@router.get("/supplier-payments/{payment_id}", response_model=schemas.SupplierPayment)
def get_supplier_payment(payment_id: int, db: Session = Depends(get_db)):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.get_payment(payment_id)


@router.get("/supplier-payments", response_model=List[schemas.SupplierPayment])
def list_supplier_payments(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    payment_method: Optional[str] = None,
    payment_for: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    from datetime import date as date_type

    payment_service = service.SupplierPaymentService(db)
    filters = schemas.SupplierPaymentListFilter(
        supplier_id=supplier_id,
        branch_code=branch_code,
        payment_method=payment_method,
        payment_for=payment_for,
        status=status,
        date_from=date_type.fromisoformat(date_from) if date_from else None,
        date_to=date_type.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit,
    )
    return payment_service.list_payments(filters)


@router.patch("/supplier-payments/{payment_id}", response_model=schemas.SupplierPayment)
def update_supplier_payment(
    payment_id: int,
    payment_update: schemas.SupplierPaymentUpdate,
    db: Session = Depends(get_db),
):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.update_payment(payment_id, payment_update)


@router.post(
    "/supplier-payments/{payment_id}/verify", response_model=schemas.SupplierPayment
)
def verify_supplier_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(*Permissions.SUPPLIER_PAYMENT_UPDATE)
    ),
):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.verify_payment(payment_id, verified_by=current_user.id)


@router.post(
    "/supplier-payments/{payment_id}/cancel", response_model=schemas.SupplierPayment
)
def cancel_supplier_payment(
    payment_id: int,
    payload: schemas.SupplierPaymentCancel = None,
    db: Session = Depends(get_db),
):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.cancel_payment(
        payment_id,
        remarks=payload.remarks if payload else None,
    )


@router.delete(
    "/supplier-payments/{payment_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_supplier_payment(payment_id: int, db: Session = Depends(get_db)):
    payment_service = service.SupplierPaymentService(db)
    payment_service.delete_payment(payment_id)
    return None


@router.get(
    "/suppliers/{supplier_id}/payments", response_model=List[schemas.SupplierPayment]
)
def get_supplier_payments(
    supplier_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):

    payment_service = service.SupplierPaymentService(db)
    return payment_service.get_supplier_payments(supplier_id, skip, limit)


# ==================== SUPPLIER ADVANCE PAYMENT ENDPOINTS ====================


@router.post(
    "/supplier-advances",
    response_model=schemas.SupplierAdvancePayment,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier_advance(
    data: schemas.SupplierAdvancePaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(*Permissions.SUPPLIER_ADVANCE_CREATE)
    ),
):
    """
    Create a new supplier advance payment.

    Use this when paying a supplier before receiving goods/services.
    The advance will be tracked and can later be applied against GRNs.
    """
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.create_advance(data, created_by=current_user.id)


@router.get("/supplier-advances", response_model=List[schemas.SupplierAdvancePayment])
def list_supplier_advances(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    is_fully_applied: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List all supplier advance payments with optional filters"""
    from datetime import datetime

    advance_service = service.SupplierAdvancePaymentService(db)
    filters = schemas.SupplierAdvancePaymentListFilter(
        supplier_id=supplier_id,
        branch_code=branch_code,
        is_fully_applied=is_fully_applied,
        date_from=(
            datetime.strptime(date_from, "%Y-%m-%d").date() if date_from else None
        ),
        date_to=datetime.strptime(date_to, "%Y-%m-%d").date() if date_to else None,
        skip=skip,
        limit=limit,
    )
    return advance_service.list_advances(filters)


@router.get(
    "/supplier-advances/{advance_id}",
    response_model=schemas.SupplierAdvancePaymentWithApplications,
)
def get_supplier_advance(advance_id: int, db: Session = Depends(get_db)):
    """Get supplier advance payment by ID with applications"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.get_advance(advance_id)


@router.patch(
    "/supplier-advances/{advance_id}", response_model=schemas.SupplierAdvancePayment
)
def update_supplier_advance(
    advance_id: int,
    data: schemas.SupplierAdvancePaymentUpdate,
    db: Session = Depends(get_db),
):
    """Update a supplier advance payment (only active advances can be updated)"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.update_advance(advance_id, data)


@router.delete(
    "/supplier-advances/{advance_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_supplier_advance(advance_id: int, db: Session = Depends(get_db)):
    """Delete a supplier advance payment (only if no applications)"""
    advance_service = service.SupplierAdvancePaymentService(db)
    advance_service.delete_advance(advance_id)
    return None


@router.get(
    "/suppliers/{supplier_id}/advance-balance",
    response_model=schemas.SupplierAdvanceBalanceSummary,
)
def get_supplier_advance_balance(supplier_id: int, db: Session = Depends(get_db)):
    """
    Get advance payment balance summary for a supplier.

    Returns total advances, total applied, and available balance.
    """
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.get_supplier_balance(supplier_id)


@router.get(
    "/suppliers/{supplier_id}/advances",
    response_model=List[schemas.SupplierAdvancePayment],
)
def get_supplier_advances(
    supplier_id: int,
    is_fully_applied: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """Get all advance payments for a specific supplier"""
    advance_service = service.SupplierAdvancePaymentService(db)
    filters = schemas.SupplierAdvancePaymentListFilter(
        supplier_id=supplier_id,
        is_fully_applied=is_fully_applied,
        skip=skip,
        limit=limit,
    )
    return advance_service.list_advances(filters)


# ==================== SUPPLIER ADVANCE APPLICATION ENDPOINTS ====================


@router.post(
    "/supplier-advance-applications",
    response_model=schemas.SupplierAdvanceApplication,
    status_code=status.HTTP_201_CREATED,
)
def create_advance_application(
    data: schemas.SupplierAdvanceApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(*Permissions.SUPPLIER_ADVANCE_UPDATE)
    ),
):
    """
    Create an application to apply advance against a GRN.

    This reduces the advance remaining balance and settles the corresponding GRN.
    Validates that application amount doesn't exceed available balance.
    """
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.create_application(data, created_by=current_user.id)


@router.get(
    "/supplier-advances/{advance_id}/applications",
    response_model=List[schemas.SupplierAdvanceApplication],
)
def get_advance_applications(advance_id: int, db: Session = Depends(get_db)):
    """Get all applications for a specific advance payment"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.get_applications_by_advance(advance_id)


@router.get(
    "/grn/{grn_id}/advance-applications",
    response_model=List[schemas.SupplierAdvanceApplication],
)
def get_grn_advance_applications(grn_id: int, db: Session = Depends(get_db)):
    """Get all advance applications applied to a specific GRN"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.get_applications_by_grn(grn_id)


import csv
import io

from fastapi.responses import StreamingResponse


@router.get(
    "/export-csv",
    summary="Export Purchase Orders to CSV",
)
def export_po_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    branch_codes: Optional[List[str]] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW)),
):
    pos = service.purchasing_service.get_all_purchasing_orders(
        db, skip, limit, branch_codes
    )
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "PO Number",
            "Date",
            "Branch",
            "Payment Method",
            "Status",
            "Remarks",
            "Total Amount",
            "Paid Amount",
            "Created At",
            "Updated At",
        ]
    )
    for order in pos:
        writer.writerow(
            [
                order.purchasing_order_no or "",
                order.purchasing_order_date or "",
                order.branch_code or "",
                order.payment_method or "",
                order.status or "",
                order.remarks or "",
                order.total_amount or 0,
                order.paid_amount or 0,
                (
                    order.created_at.isoformat()
                    if getattr(order, "created_at", None)
                    else ""
                ),
                (
                    order.updated_at.isoformat()
                    if getattr(order, "updated_at", None)
                    else ""
                ),
            ]
        )
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=purchase_orders.csv"
    return response
