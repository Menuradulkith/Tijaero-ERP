"""Central warehouse stock: KPIs, on-hand grid and the stock movement ledger.

Mounted at /api/v1/inventory/warehouse-stock. Reads sales_stock (on hand) and
stock_transactions (movements); branch-scoped like /inventory/sales-stock/paginated.
Cost figures (value, unit cost) are null for users without cost_price:view.
"""

from datetime import date, timedelta
from decimal import Decimal
from math import ceil
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, func, literal, or_
from sqlalchemy.orm import Session, aliased

from app.auth.dependencies import get_current_user, get_user_branch_filter
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission, user_has_permission
from app.common.enums import StockStatus as S
from app.core import timezone as tz
from app.db.session import get_db
from app.modules.common.models import Locations
from app.modules.inventory.costing import stock_cost_expr
from app.modules.inventory.ledger import ON_HAND_STATUSES
from app.modules.inventory.models import SalesStock, StockTransaction
from app.modules.materials.models import Material, MaterialCategory
from app.modules.products.models import Category, ItemsBrand, Product
from app.utils.csv_export import build_csv_response

router = APIRouter(dependencies=[Depends(require_permission(*Permissions.SALES_STOCK_VIEW))])

LOW_STOCK_THRESHOLD = 5  # same fixed threshold as the low-stock alert (notifications/alerts.py)
EXPIRY_WINDOW_DAYS = 30
EXPORT_LIMIT = 50000
_ON_HAND = tuple(sorted(ON_HAND_STATUSES))
_LIVE = _ON_HAND + (S.IN_TRANSIT.value,)


def _scope(branch_code: Optional[str], user_branches: Optional[List[str]], column):
    """Filter for the requested branch, limited to the user's branches (None = all)."""
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")
        return column == branch_code
    if user_branches is not None:
        return column.in_(user_branches)
    return literal(True)


def _money(value) -> Optional[Decimal]:
    return None if value is None else Decimal(value).quantize(Decimal("0.01"))


def _num(value) -> Decimal:
    return Decimal(value or 0)


def _pages(total: int, size: int) -> int:
    return ceil(total / size) if size else 0


# ─────────────────────────────── KPIs ───────────────────────────────
def _qty_when(cond):
    return func.coalesce(func.sum(case((cond, SalesStock.quantity), else_=0)), 0)


# Issue cost: WAC items at the item's average cost, else the row's own cost (inventory/costing.py)
_COST = stock_cost_expr()

# Stock is keyed by item (central stock phase 2): rows of an item group together
# whichever product they came in under; a row without an item (should not exist
# after s142) groups by its product as before.
_LINKED = SalesStock.material_id.isnot(None)
_UNLINKED_PID = case((SalesStock.material_id.is_(None), SalesStock.product_id))
_ItemBrand = aliased(ItemsBrand)


def _pick(item_col, product_col):
    return case((_LINKED, item_col), else_=product_col)


@router.get("/kpis")
def warehouse_kpis(
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scope = _scope(branch_code, user_branches, SalesStock.branch_code)
    today = tz.today()
    soon = today + timedelta(days=EXPIRY_WINDOW_DAYS)
    on_hand = SalesStock.status.in_(_ON_HAND)
    row = (
        db.query(
            func.coalesce(func.sum(case((on_hand, SalesStock.quantity * _COST), else_=0)), 0),
            _qty_when(on_hand),
            _qty_when(SalesStock.status == S.RESERVED.value),
            _qty_when(SalesStock.status == S.AVAILABLE.value),
            _qty_when(SalesStock.status == S.IN_TRANSIT.value),
            _qty_when(SalesStock.status == S.DAMAGED.value),
            _qty_when(SalesStock.status == S.FROZEN.value),
            _qty_when(and_(SalesStock.status.in_((S.AVAILABLE.value, S.RESERVED.value)),
                           SalesStock.expiry_date >= today, SalesStock.expiry_date <= soon)),
            _qty_when(and_(on_hand, SalesStock.expiry_date < today)),
        )
        .outerjoin(Product, Product.id == SalesStock.product_id)
        .outerjoin(Material, Material.id == SalesStock.material_id)
        .filter(SalesStock.is_active.is_(True), SalesStock.status.in_(_LIVE), scope)
        .one()
    )
    available_by_pair = (
        db.query(func.sum(SalesStock.quantity).label("qty"))
        .filter(SalesStock.is_active.is_(True), SalesStock.status == S.AVAILABLE.value, scope)
        .group_by(SalesStock.material_id, _UNLINKED_PID, SalesStock.branch_code)
        .subquery()
    )
    low = db.query(func.count()).select_from(available_by_pair).filter(
        available_by_pair.c.qty >= 1, available_by_pair.c.qty <= LOW_STOCK_THRESHOLD).scalar()
    show_cost = user_has_permission(current_user, *Permissions.COST_PRICE_VIEW)
    return {
        "stock_value": _money(row[0]) if show_cost else None,
        "on_hand_qty": _num(row[1]),
        "reserved_qty": _num(row[2]),
        "available_qty": _num(row[3]),
        "in_transit_qty": _num(row[4]),
        "damaged_qty": _num(row[5]),
        "frozen_qty": _num(row[6]),
        "low_stock_items": int(low or 0),
        "expiring_30_days_qty": _num(row[7]),
        "expired_qty": _num(row[8]),
    }


# ─────────────────────────────── on hand ───────────────────────────────
_ON_HAND_SORTS = {
    "item_name": "item_name", "item_code": "item_code", "on_hand": "on_hand", "available": "available",
    "value": "value", "ageing_days": "oldest_received", "nearest_expiry": "nearest_expiry",
    "branch_code": "branch_code",
}
_BUCKETS = ("reserved", "in_transit", "damaged", "frozen", "expiring", "expired", "low_stock")


@router.get("/on-hand")
def warehouse_on_hand(
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=100),
    branch_code: Optional[str] = None,
    location_id: Optional[int] = None,
    category_id: Optional[int] = None,
    brand_id: Optional[int] = None,
    bucket: Optional[str] = None,
    sort_by: str = "item_name",
    order: str = Query("asc", pattern="^(asc|desc)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    if bucket and bucket not in _BUCKETS:
        raise HTTPException(status_code=422, detail=f"bucket must be one of: {', '.join(_BUCKETS)}")
    if sort_by not in _ON_HAND_SORTS:
        raise HTTPException(status_code=422, detail=f"sort_by must be one of: {', '.join(_ON_HAND_SORTS)}")
    scope = _scope(branch_code, user_branches, SalesStock.branch_code)
    today = tz.today()
    soon = today + timedelta(days=EXPIRY_WINDOW_DAYS)
    on_hand = SalesStock.status.in_(_ON_HAND)

    filters = [SalesStock.is_active.is_(True), SalesStock.status.in_(_LIVE), scope]
    if location_id:
        filters.append(SalesStock.location_id == location_id)
    if category_id:  # the item's (material) category; the product's for a row without an item
        filters.append(_pick(Material.category_id, Product.category_id) == category_id)
    if brand_id:
        filters.append(_pick(Material.items_brand_id, Product.items_brand_id) == brand_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        filters.append(or_(Material.item_code.ilike(like), Material.name.ilike(like),
                           Product.item_code.ilike(like), Product.name.ilike(like),
                           SalesStock.batch_no.ilike(like), SalesStock.barcode.ilike(like)))

    on_hand_qty = _qty_when(on_hand)
    available = _qty_when(SalesStock.status == S.AVAILABLE.value)
    in_transit = _qty_when(SalesStock.status == S.IN_TRANSIT.value)
    value = func.coalesce(func.sum(case((on_hand, SalesStock.quantity * _COST), else_=0)), 0)
    expiring = _qty_when(and_(SalesStock.status.in_((S.AVAILABLE.value, S.RESERVED.value)),
                              SalesStock.expiry_date >= today, SalesStock.expiry_date <= soon))
    expired = _qty_when(and_(on_hand, SalesStock.expiry_date < today))

    item_code = _pick(Material.item_code, Product.item_code)
    item_name = _pick(Material.name, Product.name)
    category_name = _pick(MaterialCategory.name, Category.name)
    brand_name = _pick(_ItemBrand.brand_name, ItemsBrand.brand_name)
    uom = _pick(Material.unit_of_measure, Product.unit_of_measure)
    tracking = _pick(Material.tracking_type, Product.tracking_type)
    grouped = (
        db.query(
            func.min(SalesStock.product_id).label("product_id"),
            SalesStock.material_id.label("material_id"),
            _UNLINKED_PID.label("unlinked_product_id"),
            item_code.label("item_code"),
            item_name.label("item_name"),
            category_name.label("category_name"),
            brand_name.label("brand_name"),
            uom.label("unit_of_measure"),
            tracking.label("tracking_type"),
            SalesStock.branch_code.label("branch_code"),
            SalesStock.location_id.label("location_id"),
            Locations.name.label("location_name"),
            on_hand_qty.label("on_hand"),
            _qty_when(SalesStock.status == S.RESERVED.value).label("reserved"),
            available.label("available"),
            in_transit.label("in_transit"),
            _qty_when(SalesStock.status == S.DAMAGED.value).label("damaged"),
            _qty_when(SalesStock.status == S.FROZEN.value).label("frozen"),
            value.label("value"),
            func.min(case((on_hand, SalesStock.added_date))).label("oldest_received"),
            func.min(case((on_hand, SalesStock.expiry_date))).label("nearest_expiry"),
            expiring.label("expiring"),
            expired.label("expired"),
        )
        .outerjoin(Product, Product.id == SalesStock.product_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .outerjoin(ItemsBrand, ItemsBrand.id == Product.items_brand_id)
        .outerjoin(Material, Material.id == SalesStock.material_id)
        .outerjoin(MaterialCategory, MaterialCategory.id == Material.category_id)
        .outerjoin(_ItemBrand, _ItemBrand.id == Material.items_brand_id)
        .outerjoin(Locations, Locations.id == SalesStock.location_id)
        .filter(*filters)
        .group_by(SalesStock.material_id, _UNLINKED_PID, item_code, item_name, category_name, brand_name, uom,
                  tracking, SalesStock.branch_code, SalesStock.location_id, Locations.name)
        .having(on_hand_qty + in_transit > 0)
    )
    if bucket == "reserved":
        grouped = grouped.having(_qty_when(SalesStock.status == S.RESERVED.value) > 0)
    elif bucket == "in_transit":
        grouped = grouped.having(in_transit > 0)
    elif bucket == "damaged":
        grouped = grouped.having(_qty_when(SalesStock.status == S.DAMAGED.value) > 0)
    elif bucket == "frozen":
        grouped = grouped.having(_qty_when(SalesStock.status == S.FROZEN.value) > 0)
    elif bucket == "expiring":
        grouped = grouped.having(expiring > 0)
    elif bucket == "expired":
        grouped = grouped.having(expired > 0)

    sub = grouped.subquery()
    query = db.query(sub)
    if bucket == "low_stock":
        # Item's available units at the branch (all locations) between 1 and the threshold
        pair = (
            db.query(SalesStock.material_id.label("mid"), _UNLINKED_PID.label("upid"),
                     SalesStock.branch_code.label("bc"), func.sum(SalesStock.quantity).label("qty"))
            .filter(SalesStock.is_active.is_(True), SalesStock.status == S.AVAILABLE.value, scope)
            .group_by(SalesStock.material_id, _UNLINKED_PID, SalesStock.branch_code)
            .subquery()
        )
        query = query.join(pair, and_(pair.c.mid.is_not_distinct_from(sub.c.material_id),
                                      pair.c.upid.is_not_distinct_from(sub.c.unlinked_product_id),
                                      pair.c.bc == sub.c.branch_code)).filter(
            pair.c.qty >= 1, pair.c.qty <= LOW_STOCK_THRESHOLD)

    total = query.count()
    sort_col = getattr(sub.c, _ON_HAND_SORTS[sort_by])
    if sort_by == "ageing_days":  # oldest receipt first = most days
        primary = sort_col.asc().nulls_last() if order == "desc" else sort_col.desc().nulls_last()
    else:
        primary = sort_col.desc().nulls_last() if order == "desc" else sort_col.asc().nulls_last()
    rows = (query.order_by(primary, sub.c.item_name.asc(), sub.c.branch_code.asc(), sub.c.location_id.asc())
            .offset((page - 1) * size).limit(size).all())

    show_cost = user_has_permission(current_user, *Permissions.COST_PRICE_VIEW)
    items = []
    for r in rows:
        oldest = r.oldest_received.date() if r.oldest_received else None
        on_hand_v = _num(r.on_hand)
        items.append({
            "product_id": r.product_id,
            "material_id": r.material_id,
            "item_code": r.item_code,
            "item_name": r.item_name,
            "category_name": r.category_name,
            "brand_name": r.brand_name,
            "unit_of_measure": r.unit_of_measure,
            "tracking_type": r.tracking_type,
            "branch_code": r.branch_code,
            "location_id": r.location_id,
            "location_name": r.location_name,
            "on_hand": on_hand_v,
            "reserved": _num(r.reserved),
            "available": _num(r.available),
            "in_transit": _num(r.in_transit),
            "damaged": _num(r.damaged),
            "frozen": _num(r.frozen),
            "value": _money(r.value) if show_cost else None,
            "avg_unit_cost": (_money(Decimal(r.value) / on_hand_v) if on_hand_v else None) if show_cost else None,
            "oldest_received": oldest,
            "ageing_days": (today - oldest).days if oldest else None,
            "nearest_expiry": r.nearest_expiry,
        })
    return {"items": items, "total": total, "page": page, "size": size, "pages": _pages(total, size)}


# ─────────────────────────────── movements ───────────────────────────────
def _movement_query(db: Session, user_branches, *, product_id=None, material_id=None, stock_id=None,
                    branch_code=None, location_id=None, movement_type=None, reference_type=None,
                    reference_id=None, date_from=None, date_to=None, q=None):
    T = StockTransaction
    from_loc, to_loc = aliased(Locations), aliased(Locations)
    query = (
        db.query(T, func.coalesce(Material.item_code, Product.item_code), func.coalesce(Material.name, Product.name),
                 from_loc.name, to_loc.name, User.first_name, User.last_name, User.username)
        .outerjoin(Product, Product.id == T.product_id)
        .outerjoin(Material, Material.id == T.material_id)
        .outerjoin(from_loc, from_loc.id == T.from_location_id)
        .outerjoin(to_loc, to_loc.id == T.to_location_id)
        .outerjoin(User, User.id == T.user_id)
        .filter(_scope(branch_code, user_branches, T.branch_code))
    )
    if product_id:
        query = query.filter(T.product_id == product_id)
    if material_id:
        query = query.filter(T.material_id == material_id)
    if stock_id:
        query = query.filter(T.stock_id == stock_id)
    if location_id:
        query = query.filter(or_(T.from_location_id == location_id, T.to_location_id == location_id))
    if movement_type:
        query = query.filter(T.movement_type == movement_type)
    if reference_type:
        query = query.filter(T.reference_type == reference_type)
    if reference_id:
        query = query.filter(T.reference_id == reference_id)
    if date_from:
        query = query.filter(T.created_at >= date_from)
    if date_to:
        query = query.filter(T.created_at < date_to + timedelta(days=1))
    if q and q.strip():
        like = f"%{q.strip()}%"
        query = query.filter(or_(Material.item_code.ilike(like), Material.name.ilike(like),
                                 Product.item_code.ilike(like), Product.name.ilike(like), T.batch_no.ilike(like),
                                 T.barcode.ilike(like), T.reference_no.ilike(like)))
    return query.order_by(T.created_at.desc(), T.id.desc())


def _movement_out(row, show_cost: bool) -> dict:
    t, item_code, item_name, from_name, to_name, first, last, username = row
    user_name = " ".join(p for p in (first, last) if p) or username
    return {
        "id": t.id,
        "created_at": t.created_at,
        "movement_type": t.movement_type,
        "item_code": item_code,
        "item_name": item_name,
        "product_id": t.product_id,
        "material_id": t.material_id,
        "quantity": t.quantity,
        "on_hand_change": t.on_hand_change,
        "from_status": t.from_status,
        "to_status": t.to_status,
        "branch_code": t.branch_code,
        "from_location_name": from_name,
        "to_location_name": to_name,
        "batch_no": t.batch_no,
        "barcode": t.barcode,
        "unit_cost": t.unit_cost if show_cost else None,
        "value": (_money(t.quantity * t.unit_cost) if t.unit_cost is not None else None) if show_cost else None,
        "reference_type": t.reference_type,
        "reference_id": t.reference_id,
        "reference_no": t.reference_no,
        "user_name": user_name,
    }


def _movement_filters(
    product_id: Optional[int] = None,
    material_id: Optional[int] = None,
    stock_id: Optional[int] = None,
    branch_code: Optional[str] = None,
    location_id: Optional[int] = None,
    movement_type: Optional[str] = Query(None, max_length=30),
    reference_type: Optional[str] = Query(None, max_length=40),
    reference_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    q: Optional[str] = Query(None, max_length=100),
) -> dict:
    return dict(product_id=product_id, material_id=material_id, stock_id=stock_id, branch_code=branch_code,
                location_id=location_id, movement_type=movement_type, reference_type=reference_type,
                reference_id=reference_id, date_from=date_from, date_to=date_to, q=q)


@router.get("/movements")
def warehouse_movements(
    page: int = Query(1, ge=1),
    size: int = Query(25, ge=1, le=200),
    filters: dict = Depends(_movement_filters),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    query = _movement_query(db, user_branches, **filters)
    total = query.order_by(None).count()
    rows = query.offset((page - 1) * size).limit(size).all()
    show_cost = user_has_permission(current_user, *Permissions.COST_PRICE_VIEW)
    return {"items": [_movement_out(r, show_cost) for r in rows], "total": total, "page": page, "size": size,
            "pages": _pages(total, size)}


@router.get("/movements/export-csv")
def export_warehouse_movements(
    filters: dict = Depends(_movement_filters),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    show_cost = user_has_permission(current_user, *Permissions.COST_PRICE_VIEW)
    rows = [_movement_out(r, show_cost) for r in _movement_query(db, user_branches, **filters).limit(EXPORT_LIMIT)]
    headers = ["Date", "Movement", "Item Code", "Item", "Quantity", "On-hand Change", "From Status", "To Status",
               "Branch", "From Location", "To Location", "Batch", "Barcode", "Unit Cost", "Value",
               "Reference Type", "Reference No", "User"]
    return build_csv_response(
        filename="stock_movements",
        headers=headers,
        rows=[[m["created_at"], m["movement_type"], m["item_code"], m["item_name"], m["quantity"],
               m["on_hand_change"], m["from_status"], m["to_status"], m["branch_code"], m["from_location_name"],
               m["to_location_name"], m["batch_no"], m["barcode"], m["unit_cost"], m["value"],
               m["reference_type"], m["reference_no"], m["user_name"]] for m in rows],
    )
