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
from .models import PurchasingOrder, PurchasingOrderItems, GoodReceivedNote, Supplier, SupplierAdvancePayment

router = APIRouter(prefix="/purchasing", tags=["purchasing"])


def _user_display_name(user: User) -> str:
    full_name = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full_name or user.username


def _serialize_order_with_user_fields(
    order,
    created_by: Optional[int],
    approved_by: Optional[int],
    user_name_map: Dict[int, str],
    supplier_name_map: Optional[Dict[int, str]] = None,
) -> Dict[str, Any]:
    payload = schemas.PurchasingOrder.model_validate(order).model_dump()
    payload["created_by"] = created_by
    payload["created_by_name"] = user_name_map.get(created_by) if created_by else None
    payload["approved_by"] = approved_by
    payload["approved_by_name"] = user_name_map.get(approved_by) if approved_by else None
    if supplier_name_map and order.first_suppliers_id:
        payload["supplier_name"] = supplier_name_map.get(order.first_suppliers_id)
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
            supplier_name_map=_get_supplier_name_map(db, orders),
        )
        for order in orders
    ]


def _get_supplier_name_map(db: Session, orders) -> Dict[int, str]:
    """Batch-lookup supplier names for a list of POs."""
    supplier_ids = list({o.first_suppliers_id for o in orders if o.first_suppliers_id})
    if not supplier_ids:
        return {}
    rows = db.query(Supplier.id, Supplier.full_name).filter(Supplier.id.in_(supplier_ids)).all()
    return {r.id: r.full_name for r in rows}


def _enrich_grns(db: Session, grns: List[Any]) -> List[Dict[str, Any]]:
    """Add po_no and supplier_name to GRN list responses."""
    if not grns:
        return []
    po_ids = list({g.purchasingorders_id for g in grns if g.purchasingorders_id})
    po_map: Dict[int, Any] = {}
    if po_ids:
        pos = db.query(
            PurchasingOrder.id, PurchasingOrder.purchasing_order_no, PurchasingOrder.first_suppliers_id
        ).filter(PurchasingOrder.id.in_(po_ids)).all()
        po_map = {p.id: p for p in pos}
    supplier_ids = list({p.first_suppliers_id for p in po_map.values() if p.first_suppliers_id})
    supplier_map: Dict[int, str] = {}
    if supplier_ids:
        rows = db.query(Supplier.id, Supplier.full_name).filter(Supplier.id.in_(supplier_ids)).all()
        supplier_map = {r.id: r.full_name for r in rows}
    results = []
    for g in grns:
        payload = schemas.GoodReceivedNote.model_validate(g).model_dump()
        po = po_map.get(g.purchasingorders_id)
        if po:
            payload["po_no"] = po.purchasing_order_no
            payload["supplier_name"] = supplier_map.get(po.first_suppliers_id)
        results.append(payload)
    return results


def _enrich_purchase_returns(db: Session, returns: List[Any]) -> List[Dict[str, Any]]:
    """Add grn_no, po_no and supplier_name to PurchaseReturn list responses."""
    if not returns:
        return []
    grn_ids = list({r.goodreceivednote_id for r in returns if r.goodreceivednote_id})
    grn_map: Dict[int, Any] = {}
    if grn_ids:
        grns = db.query(
            GoodReceivedNote.id, GoodReceivedNote.good_received_no, GoodReceivedNote.purchasingorders_id
        ).filter(GoodReceivedNote.id.in_(grn_ids)).all()
        grn_map = {g.id: g for g in grns}
    po_ids = list({g.purchasingorders_id for g in grn_map.values() if g.purchasingorders_id})
    po_map: Dict[int, Any] = {}
    if po_ids:
        pos = db.query(
            PurchasingOrder.id, PurchasingOrder.purchasing_order_no, PurchasingOrder.first_suppliers_id
        ).filter(PurchasingOrder.id.in_(po_ids)).all()
        po_map = {p.id: p for p in pos}
    supplier_ids = list({p.first_suppliers_id for p in po_map.values() if p.first_suppliers_id})
    supplier_map: Dict[int, str] = {}
    if supplier_ids:
        rows = db.query(Supplier.id, Supplier.full_name).filter(Supplier.id.in_(supplier_ids)).all()
        supplier_map = {r.id: r.full_name for r in rows}
    results = []
    for r in returns:
        payload = schemas.PurchasingReturn.model_validate(r).model_dump()
        grn = grn_map.get(r.goodreceivednote_id)
        if grn:
            payload["grn_no"] = grn.good_received_no
            po = po_map.get(grn.purchasingorders_id)
            if po:
                payload["po_no"] = po.purchasing_order_no
                payload["supplier_name"] = supplier_map.get(po.first_suppliers_id)
        results.append(payload)
    return results


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
)
def list_suppliers(
    active: Optional[bool] = None,
    country_id: Optional[int] = None,
    search: Optional[str] = None,
    min_credit_limit: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
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
    "/orders/daily-limit/{branch_code}",
    response_model=schemas.DailyPOLimitCheck,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW))],
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
    current_user: User = Depends(require_permission(*Permissions.PURCHASE_ORDER_CREATE)),
):
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, order.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {order.branch_code}",
        )
    order_service = service.PurchasingOrderService(db)
    created = order_service.create_order(order, created_by=current_user.id)

    # Notify the branch (everyone but the creator) about the new purchase order.
    from app.modules.notifications import dispatcher as notify

    notify.branch(
        created.branch_code,
        title="Purchase Order Created",
        message=f"PO {created.purchasing_order_no} was created.",
        notification_type=notify.INFO,
        category=notify.PURCHASING,
        action_url="/purchasing/orders",
        exclude_user_id=current_user.id,
    )
    return created


@router.get(
    "/orders/{order_id}",
    response_model=schemas.PurchasingOrderWithItems,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW))],
)
def get_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order_service = service.PurchasingOrderService(db)
    order = order_service.get_order(order_id)
    return _enrich_single_purchase_order_with_user_fields(db, order)


@router.get(
    "/orders",
    response_model=List[schemas.PurchasingOrder],
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW))],
)
def list_purchase_orders(
    status: Optional[str] = None,
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    for_grn: bool = False,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
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


@router.patch(
    "/orders/{order_id}",
    response_model=schemas.PurchasingOrder,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_UPDATE))],
)
def update_purchase_order(
    order_id: int,
    order_update: schemas.PurchasingOrderUpdate,
    db: Session = Depends(get_db),
):
    order_service = service.PurchasingOrderService(db)
    return order_service.update_order(order_id, order_update)


@router.delete(
    "/orders/{order_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_DELETE))],
)
def delete_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order_service = service.PurchasingOrderService(db)
    order_service.delete_order(order_id)
    return None


@router.post(
    "/orders/check-credit",
    response_model=schemas.POCreditCheckResponse,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW))],
)
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


@router.post(
    "/grn/check-credit",
    response_model=schemas.GRNCreditCheckResponse,
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
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
    "/suppliers/{supplier_id}/orders",
    response_model=List[schemas.PurchasingOrder],
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_ORDER_VIEW))],
)
def get_supplier_orders(
    supplier_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    order_service = service.PurchasingOrderService(db)
    filters = schemas.PurchaseOrderListFilter(
        supplier_id=supplier_id, skip=skip, limit=limit
    )
    orders = order_service.list_orders(filters)
    return _enrich_purchase_orders_with_user_fields(db, orders)


@router.post(
    "/returns/validate-barcode",
    response_model=schemas.BarcodeValidationResponse,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_RETURN_VIEW))],
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
    if not validate_branch_access(current_user, return_data.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {return_data.branch_code}",
        )
    return_service = service.PurchasingReturnService(db)
    return return_service.create_return(return_data, user_id=current_user.id)


# NOTE: Purchase return approvals are handled through the centralized Approval Dashboard
# Use POST /api/v1/common/approvals/{approval_id}/approve or /reject instead


@router.get(
    "/returns/{return_id}",
    response_model=schemas.PurchasingReturnWithItems,
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_RETURN_VIEW))],
)
def get_purchase_return(return_id: int, db: Session = Depends(get_db)):

    return_service = service.PurchasingReturnService(db)
    return_record = return_service.get_return(return_id)

    from app.modules.inventory.models import SalesStock
    items_with_names = []
    for item in return_record.items:
        # Resolve warranty_month: try FK relationship first, fall back to barcode lookup
        warranty_month = None
        if item.sales_stock:
            warranty_month = item.sales_stock.warranty_month
        elif item.barcode:
            stock = db.query(SalesStock).filter(SalesStock.barcode == item.barcode).first()
            if stock:
                warranty_month = stock.warranty_month
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
            "warranty_month": warranty_month,
        }
        items_with_names.append(item_dict)

    # Resolve supplier name via GRN → PO → Supplier
    supplier_name = None
    if return_record.good_received_note:
        grn = return_record.good_received_note
        po = getattr(grn, 'purchasing_order', None)
        if po and po.first_supplier:
            supplier_name = po.first_supplier.full_name

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
        "supplier_name": supplier_name,
        "items": items_with_names,
    }


@router.get(
    "/returns",
    response_model=List[schemas.PurchasingReturn],
    dependencies=[Depends(require_permission(*Permissions.PURCHASE_RETURN_VIEW))],
)
def list_purchase_returns(
    status_filter: Optional[str] = Query(
        None, description="Filter by status: draft, pending, approved, rejected"
    ),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    return_service = service.PurchasingReturnService(db)
    returns = return_service.list_returns(skip, limit, status_filter)
    return _enrich_purchase_returns(db, returns)


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
    current_user: User = Depends(require_permission(*Permissions.GRN_CREATE)),
):
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, grn.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {grn.branch_code}",
        )
    grn_service = service.GoodReceivedNoteService(db)
    created = grn_service.create(grn, allow_credit_override=allow_credit_override)

    # Notify the branch that stock was received against this GRN.
    from app.modules.notifications import dispatcher as notify

    notify.branch(
        created.branch_code,
        title="Goods Received",
        message=f"GRN {created.good_received_no} was received into stock.",
        notification_type=notify.INFO,
        category=notify.PURCHASING,
        action_url="/purchasing/grn",
        exclude_user_id=current_user.id,
    )
    return created


@router.get(
    "/grn/{grn_id}",
    response_model=schemas.GoodReceivedNote,
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
def get_grn(grn_id: int, db: Session = Depends(get_db)):

    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_by_id(grn_id)


@router.get(
    "/grn/{grn_id}/items",
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
def get_grn_items(grn_id: int, db: Session = Depends(get_db)):
    """Return all received items for a GRN (from sales_stock + company_assets)
    including warranty_month, product_name, and saved-to flags."""
    from app.modules.inventory.models import SalesStock, CompanyAssets
    from app.modules.purchasing.models import GoodReceivedNote

    grn = db.query(GoodReceivedNote).filter(GoodReceivedNote.id == grn_id).first()
    if not grn:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="GRN not found")

    results = []
    seen_barcodes: set = set()

    # Sales stock items
    stock_items = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn_id).all()
    for s in stock_items:
        product_name = s.product.name if s.product else None
        results.append({
            "id": s.id,
            "barcode": s.barcode,
            "branch_code": s.branch_code,
            "active": s.status == "available",
            "good_received_note": grn.good_received_no,
            "purchasing_order_items_id": s.purchasing_order_items_id,
            "product_id": s.product_id,
            "product_name": product_name,
            "warranty_month": s.warranty_month,
            "saved_to_sales_stock": True,
            "saved_to_company_assets": False,
            "added_date": s.added_date,
            "created_date": s.added_date,
        })
        seen_barcodes.add(s.barcode)

    # Company asset items (skip barcodes already in sales stock)
    asset_items = db.query(CompanyAssets).filter(CompanyAssets.good_received_note_id == grn_id).all()
    for a in asset_items:
        product_name = a.product.name if a.product else a.item
        if a.barcode in seen_barcodes:
            # Already listed under sales stock; add company-asset flag to existing entry
            for r in results:
                if r["barcode"] == a.barcode:
                    r["saved_to_company_assets"] = True
            continue
        results.append({
            "id": a.id,
            "barcode": a.barcode or "",
            "branch_code": a.branch_code,
            "active": a.status == "available",
            "good_received_note": grn.good_received_no,
            "purchasing_order_items_id": a.purchasing_order_items_id or 0,
            "product_id": a.product_id,
            "product_name": product_name,
            "warranty_month": a.warranty_month,
            "saved_to_sales_stock": False,
            "saved_to_company_assets": True,
            "added_date": a.added_date,
            "created_date": a.added_date,
        })

    return results


@router.get(
    "/grn",
    response_model=List[schemas.GoodReceivedNote],
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
def list_grns(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
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
    grns = grn_service.list_grns(filters)
    return _enrich_grns(db, grns)


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
    "/grn/{grn_id}/items",
    response_model=List[schemas.GoodReceivedItemWithDetails],
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
def get_grn_items(grn_id: int, db: Session = Depends(get_db)):
    grn_service = service.GoodReceivedNoteService(db)
    return grn_service.get_items_with_details(grn_id)


@router.post(
    "/grn-items",
    response_model=schemas.GoodReceivedItem,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.GRN_CREATE))],
)
def create_grn_item(
    item: schemas.GoodReceivedItemCreate, db: Session = Depends(get_db)
):
    grn_service = service.GoodReceivedNoteService(db)
    try:
        return grn_service.create_item(item)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/grn-items/check-barcode/{barcode}",
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
def check_grn_item_barcode_exists(barcode: str, db: Session = Depends(get_db)):
    grn_service = service.GoodReceivedNoteService(db)
    exists = grn_service.barcode_exists(barcode)
    return {"exists": exists, "barcode": barcode}


@router.get(
    "/grn-items/by-po/{po_id}",
    response_model=List[schemas.GoodReceivedItem],
    dependencies=[Depends(require_permission(*Permissions.GRN_VIEW))],
)
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
    settle: schemas.SupplierCreditsSettleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_CREATE)),
):
    if not validate_branch_access(current_user, settle.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {settle.branch_code}",
        )
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.create(settle, created_by=current_user.id)


@router.get(
    "/credit-settlements/{settle_id}",
    response_model=schemas.SupplierCreditsSettleWithTransactions,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_credit_settlement(settle_id: int, db: Session = Depends(get_db)):
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.get_with_transactions(settle_id)


@router.get(
    "/credit-settlements",
    response_model=List[schemas.SupplierCreditsSettleWithTransactions],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def list_credit_settlements(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):
    """List all credit settlements with transactions (eagerly loaded)"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.list_settlements_with_transactions(skip, limit)


@router.get(
    "/suppliers/{supplier_id}/credit-settlements",
    response_model=List[schemas.SupplierCreditsSettle],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_supplier_credit_settlements(supplier_id: int, db: Session = Depends(get_db)):
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.get_by_supplier(supplier_id)


@router.delete(
    "/credit-settlements/{settle_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_DELETE))],
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
    current_user=Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_UPDATE)),
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
    current_user=Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_UPDATE)),
):
    """Cancel a credit settlement"""
    settle_service = service.SupplierCreditsSettleService(db)
    return settle_service.cancel_settlement(settle_id, verified_by=current_user.id)


# ==================== SUPPLIER CREDIT MANAGEMENT ENDPOINTS ====================

from datetime import date

from app.modules.purchasing.credit_service import supplier_credit_service


@router.get(
    "/suppliers/{supplier_id}/credit-status",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_VIEW))],
)
def get_supplier_credit_status(supplier_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_supplier_credit_status(db, supplier_id)


@router.get(
    "/suppliers/{supplier_id}/non-credit-status",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_VIEW))],
)
def get_supplier_non_credit_status(supplier_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_supplier_non_credit_status(db, supplier_id)


@router.get(
    "/suppliers/{supplier_id}/payment-status",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_VIEW))],
)
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


@router.post(
    "/suppliers/{supplier_id}/credit-check",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_VIEW))],
)
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


@router.get(
    "/payments/report",
    response_model=schemas.PaymentReportResponse,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
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


@router.get(
    "/outstanding-documents",
    response_model=schemas.SupplierOutstandingDocsReport,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
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


@router.get(
    "/suppliers/{supplier_id}/aging-report",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_supplier_aging_report(supplier_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_aging_report(db, supplier_id)


@router.get(
    "/reports/payables-aging",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_all_suppliers_aging_report(db: Session = Depends(get_db)):
    return supplier_credit_service.get_aging_report(db)


@router.get(
    "/suppliers/{supplier_id}/statement",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_supplier_statement(
    supplier_id: int,
    from_date: Optional[date] = Query(None, description="Start date for statement"),
    to_date: Optional[date] = Query(None, description="End date for statement"),
    db: Session = Depends(get_db),
):
    return supplier_credit_service.get_supplier_statement(
        db, supplier_id, from_date, to_date
    )


@router.get(
    "/grn/{grn_id}/payment-history",
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_grn_payment_history(grn_id: int, db: Session = Depends(get_db)):
    return supplier_credit_service.get_grn_payment_history(db, grn_id)


@router.post(
    "/supplier-payments",
    response_model=schemas.SupplierPayment,
    status_code=status.HTTP_201_CREATED,
)
def create_supplier_payment(
    payment: schemas.SupplierPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_CREATE)),
):
    if not validate_branch_access(current_user, payment.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {payment.branch_code}",
        )
    payment_service = service.SupplierPaymentService(db)
    return payment_service.create_payment(payment, created_by=current_user.id)


@router.get(
    "/supplier-payments/{payment_id}",
    response_model=schemas.SupplierPayment,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_supplier_payment(payment_id: int, db: Session = Depends(get_db)):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.get_payment(payment_id)


@router.get(
    "/supplier-payments",
    response_model=List[schemas.SupplierPayment],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def list_supplier_payments(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    payment_method: Optional[str] = None,
    payment_for: Optional[str] = None,
    status: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
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


@router.patch(
    "/supplier-payments/{payment_id}",
    response_model=schemas.SupplierPayment,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_UPDATE))],
)
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
    "/supplier-payments/{payment_id}/cancel",
    response_model=schemas.SupplierPayment,
)
def cancel_supplier_payment(
    payment_id: int,
    payload: schemas.SupplierPaymentCancel = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_UPDATE)),
):
    payment_service = service.SupplierPaymentService(db)
    return payment_service.cancel_payment(
        payment_id,
        remarks=payload.remarks if payload else None,
        cancelled_by=current_user.id,
    )


@router.delete(
    "/supplier-payments/{payment_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_DELETE))],
)
def delete_supplier_payment(payment_id: int, db: Session = Depends(get_db)):
    payment_service = service.SupplierPaymentService(db)
    payment_service.delete_payment(payment_id)
    return None


@router.get(
    "/suppliers/{supplier_id}/payments",
    response_model=List[schemas.SupplierPayment],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_PAYMENT_VIEW))],
)
def get_supplier_payments(
    supplier_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
):

    payment_service = service.SupplierPaymentService(db)
    return payment_service.get_supplier_payments(supplier_id, skip, limit)


# ==================== ELIGIBLE ADVANCE POs (single-query) ====================

@router.get(
    "/eligible-advance-pos",
)
def get_eligible_advance_pos(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW)),
):
    """
    Return approved, non-credit POs that have NO GRN and still have a remaining
    amount > 0.  This replaces the N+1 pattern on the frontend that previously
    called /payment-status for every single supplier.
    """
    from sqlalchemy import func, exists, and_
    from decimal import Decimal

    PO = PurchasingOrder
    POI = PurchasingOrderItems
    GRN = GoodReceivedNote

    # Subquery: POs that already have at least one GRN
    grn_exists = (
        db.query(GRN.purchasingorders_id)
        .filter(GRN.purchasingorders_id == PO.id)
        .correlate(PO)
        .exists()
    )

    # Approved, non-credit POs without a GRN
    pos = (
        db.query(
            PO.id,
            PO.purchasing_order_no,
            PO.first_suppliers_id,
            PO.branch_code,
            func.coalesce(
                func.sum(POI.quantity * POI.unit_price), 0
            ).label("total_amount"),
        )
        .outerjoin(POI, POI.purchasingorders_id == PO.id)
        .filter(
            PO.status == "approved",
            PO.payment_method != "credit",
            ~grn_exists,
        )
        .group_by(PO.id, PO.purchasing_order_no, PO.first_suppliers_id, PO.branch_code)
        .all()
    )

    # Supplier name lookup
    supplier_ids = list({row.first_suppliers_id for row in pos})
    supplier_names: dict = {}
    if supplier_ids:
        rows = (
            db.query(Supplier.id, Supplier.full_name)
            .filter(Supplier.id.in_(supplier_ids))
            .all()
        )
        supplier_names = {r.id: r.full_name for r in rows}

    # Build result, only include POs with remaining > 0
    # Subtract any existing advance payments linked to this PO
    result = []
    for row in pos:
        total = float(row.total_amount)
        if total <= 0:
            continue
        # Subtract existing advances for this PO
        existing_advance = db.query(
            func.coalesce(func.sum(SupplierAdvancePayment.original_amount), 0)
        ).filter(
            SupplierAdvancePayment.purchasing_order_id == row.id
        ).scalar() or 0
        remaining = total - float(existing_advance)
        if remaining <= 0:
            continue
        result.append({
            "po_id": row.id,
            "po_no": row.purchasing_order_no,
            "supplier_id": row.first_suppliers_id,
            "supplier_name": supplier_names.get(row.first_suppliers_id, ""),
            "branch_code": row.branch_code,
            "remaining_amount": round(remaining, 2),
        })

    result.sort(key=lambda x: x["po_no"])
    return result


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
    if not validate_branch_access(current_user, data.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {data.branch_code}",
        )
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.create_advance(data, created_by=current_user.id)


@router.get(
    "/supplier-advances",
    response_model=List[schemas.SupplierAdvancePayment],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW))],
)
def list_supplier_advances(
    supplier_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    is_fully_applied: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
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
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW))],
)
def get_supplier_advance(advance_id: int, db: Session = Depends(get_db)):
    """Get supplier advance payment by ID with applications"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.get_advance(advance_id)


@router.patch(
    "/supplier-advances/{advance_id}",
    response_model=schemas.SupplierAdvancePayment,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_UPDATE))],
)
def update_supplier_advance(
    advance_id: int,
    data: schemas.SupplierAdvancePaymentUpdate,
    db: Session = Depends(get_db),
):
    """Update a supplier advance payment (only active advances can be updated)"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.update_advance(advance_id, data)


@router.post(
    "/supplier-advances/{advance_id}/return",
    response_model=schemas.SupplierAdvancePayment,
    summary="Return (refund) unused supplier advance",
)
def return_supplier_advance(
    advance_id: int,
    data: schemas.SupplierAdvanceReturnCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_permission(*Permissions.SUPPLIER_ADVANCE_CREATE)
    ),
):
    """
    Record a return of an unused supplier advance.
    The supplier sends back money that was advanced but not applied to any GRN.
    Posts a GL entry: Dr Bank/Cash, Cr Supplier Advances.
    """
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.return_advance(advance_id, data, user_id=current_user.id)


@router.delete(
    "/supplier-advances/{advance_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_DELETE))],
)
def delete_supplier_advance(advance_id: int, db: Session = Depends(get_db)):
    """Delete a supplier advance payment (only if no applications)"""
    advance_service = service.SupplierAdvancePaymentService(db)
    advance_service.delete_advance(advance_id)
    return None


@router.get(
    "/suppliers/{supplier_id}/advance-balance",
    response_model=schemas.SupplierAdvanceBalanceSummary,
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW))],
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
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW))],
)
def get_supplier_advances(
    supplier_id: int,
    is_fully_applied: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
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
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW))],
)
def get_advance_applications(advance_id: int, db: Session = Depends(get_db)):
    """Get all applications for a specific advance payment"""
    advance_service = service.SupplierAdvancePaymentService(db)
    return advance_service.get_applications_by_advance(advance_id)


@router.get(
    "/grn/{grn_id}/advance-applications",
    response_model=List[schemas.SupplierAdvanceApplication],
    dependencies=[Depends(require_permission(*Permissions.SUPPLIER_ADVANCE_VIEW))],
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
    order_service = service.PurchasingOrderService(db)
    pos = order_service.list_orders(
        schemas.PurchaseOrderListFilter(
            branch_codes=effective_branches,
            skip=skip,
            limit=limit,
        )
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
        total_amount = sum(
            (item.quantity or 0) * (item.unit_price or 0)
            for item in (order.items or [])
        )
        paid_amount = sum(
            (payment.payment_amount or 0) for payment in (order.payments or [])
        )
        writer.writerow(
            [
                order.purchasing_order_no or "",
                order.purchasing_order_date or "",
                order.branch_code or "",
                order.payment_method or "",
                order.status or "",
                order.remarks or "",
                total_amount,
                paid_amount,
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
