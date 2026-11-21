"""Stock ledger (stock_transactions), written centrally from sales_stock changes.

Every writer keeps changing ``sales_stock`` rows in place as before; a session
``before_flush`` hook compares each changed row with its previous state and
appends one ``StockTransaction`` per real movement:

* a new row            -> receipt / production_output / by_product / manual_create / ...
* a status, location or branch change -> sale, reserve, transfer_out, damage, ...
* a quantity change that is not a lot split -> quantity_adjustment

Lot splits (``lots.split_lot``) must not look like receipts: the split child is
marked with the parent's state and its insert is logged as a parent -> child
movement (nothing when the status is unchanged, which is the normal case — the
caller's later status change on the child is the real movement); the parent's
matching quantity decrease is not logged.

Count adjustments: a stock count posts with reference type ``stock_count``; every
movement it flushes is logged as ``count_adjustment``.

Costing (central stock phase 5, see inventory/costing.py): a movement that takes
stock off hand records the issue unit cost (weighted-average items: the item's
average cost); a movement that brings stock in at a cost re-averages a
weighted-average item exactly once, here.

Document reference: services call ``set_stock_reference(db, "sales_order",
invoice.id, invoice.invoice_no)`` before moving stock. The reference lives on
the session (``db.info``) and is cleared when the outer transaction ends. When
none is set it is derived from the row (GRN, purchase return, production order).
"""

from __future__ import annotations

from contextlib import contextmanager
from decimal import Decimal
from typing import Optional

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

from app.common.enums import StockStatus as S
from app.modules.inventory.models import SalesStock, StockTransaction

# Units physically sitting at a branch / location. in_transit is between
# branches, so it is not on hand anywhere.
ON_HAND_STATUSES = frozenset({
    S.AVAILABLE.value, S.RESERVED.value, S.FROZEN.value, S.DAMAGED.value,
    S.TRANSFER_PENDING.value, S.RETURN_PENDING.value,
})

REF_KEY = "stock_reference"
SPLIT_ATTR = "_ledger_split_from"
SKIP_QTY_ATTR = "_ledger_skip_qty"
_TRACKED = ("status", "quantity", "location_id", "branch_code")


# ───────────────────────────── document reference ─────────────────────────────
def set_stock_reference(db: Session, reference_type: str, reference_id: Optional[int] = None,
                        reference_no: Optional[str] = None) -> None:
    """Tag the stock movements flushed from now on (until the transaction ends)
    with this source document."""
    db.info[REF_KEY] = {
        "type": reference_type,
        "id": reference_id,
        "no": (str(reference_no)[:60] if reference_no else None),
    }


def clear_stock_reference(db: Session) -> None:
    db.info.pop(REF_KEY, None)


@contextmanager
def stock_reference(db: Session, reference_type: str, reference_id: Optional[int] = None,
                    reference_no: Optional[str] = None):
    """Scoped form of ``set_stock_reference``: flushes pending stock changes on exit
    so they are logged with this reference, then restores the previous one."""
    previous = db.info.get(REF_KEY)
    set_stock_reference(db, reference_type, reference_id, reference_no)
    try:
        yield
        db.flush()
    finally:
        if previous is None:
            db.info.pop(REF_KEY, None)
        else:
            db.info[REF_KEY] = previous


# ───────────────────────────── lot split marking ─────────────────────────────
def _original(row: SalesStock, attr: str):
    """The attribute's value as of the last flush/load (before pending edits)."""
    state = inspect(row)
    if state.transient or state.pending:
        return getattr(row, attr)
    hist = state.attrs[attr].history
    if hist.deleted:
        return hist.deleted[0]
    return getattr(row, attr)


def mark_split(parent: SalesStock, child: SalesStock, qty: int) -> None:
    """Called by lots.split_lot before flushing a split: the child's insert is a
    movement from the parent's (pre-edit) state, and the parent's quantity drop
    of ``qty`` is not a movement of its own."""
    if not inspect(parent).persistent:
        return  # parent not logged yet: the child is logged as its own insert
    setattr(child, SPLIT_ATTR, {
        "status": _original(parent, "status"),
        "location_id": _original(parent, "location_id"),
        "branch_code": _original(parent, "branch_code"),
    })
    setattr(parent, SKIP_QTY_ATTR, getattr(parent, SKIP_QTY_ATTR, 0) + qty)


# ───────────────────────────── classification ─────────────────────────────
def is_on_hand(status) -> int:
    return 1 if (status.value if hasattr(status, "value") else status) in ON_HAND_STATUSES else 0


def _s(value):
    return value.value if hasattr(value, "value") else value


def movement_type(old: Optional[str], new: Optional[str], place_changed: bool,
                  ref_type: Optional[str] = None) -> str:
    old, new = _s(old), _s(new)
    if old == new:
        return "location_change" if place_changed else "status_change"
    if new == S.SOLD:
        return "sale"
    if old == S.SOLD:
        if new in (S.AVAILABLE, S.RESERVED):
            return "sale_return" if ref_type == "sale_return" else "sale_reversal"
        return "sale_return"
    if new in (S.RETURNED, S.RETURNED_NON_RESTOCKABLE):
        return "sale_return"
    if new == S.CONSUMED:
        return "issue_to_production"
    if old == S.CONSUMED:
        return "return_from_production"
    if new in (S.RETURN_PENDING, S.RETURNED_TO_SUPPLIER):
        return "purchase_return"
    if old in (S.RETURN_PENDING, S.RETURNED_TO_SUPPLIER):
        return "purchase_return_reversed"
    if new == S.TRANSFER_PENDING:
        return "transfer_pending"
    if new == S.IN_TRANSIT:
        return "transfer_out"
    if old == S.IN_TRANSIT:
        return "transfer_in" if place_changed else "transfer_cancelled"
    if old == S.TRANSFER_PENDING:
        return "transfer_in" if place_changed else "transfer_cancelled"
    if new == S.TRANSFERRED:
        return "reclass_to_asset"
    if old == S.TRANSFERRED:
        return "reclass_from_asset"
    if new == S.CANCELLED:
        return "receipt_cancelled"
    if new == S.DAMAGED:
        return "damage"
    if old == S.DAMAGED:
        return "undamage"
    if new == S.FROZEN:
        return "freeze"
    if old == S.FROZEN:
        return "unfreeze"
    if new == S.RESERVED:
        return "reserve"
    if old == S.RESERVED:
        return "unreserve"
    return "status_change"


def _is_finished_item(order, row: SalesStock) -> bool:
    """Whether a stock row of a production order is its finished item (else a by-product).
    Orders since central stock phase 4 make an item; older ones a product."""
    if order.material_id and row.material_id:
        return order.material_id == row.material_id
    return order.product_id == row.product_id


def _insert_type(session: Session, row: SalesStock, ref_type: Optional[str]) -> str:
    if ref_type == "reclassification":
        return "reclass_from_asset"
    if ref_type == "stock_count" or row.stock_count_id:
        return "count_adjustment"
    if row.production_order_id:
        from app.modules.manufacturing.models import MfgProductionOrder
        order = session.get(MfgProductionOrder, row.production_order_id)
        if order is not None and not _is_finished_item(order, row):
            return "by_product"
        return "production_output"
    if ref_type == "manual":
        return "manual_create"
    if row.good_received_note_id or ref_type == "grn":
        return "receipt"
    return "manual_create"


# ───────────────────────────── cost / reference / user ─────────────────────────────
def default_unit_cost(session: Session, row: SalesStock) -> Optional[Decimal]:
    """PO line price, else production standard cost, else product cost price."""
    from app.modules.products.models import Product
    from app.modules.purchasing.models import PurchasingOrderItems

    if row.purchasing_order_items_id:
        line = session.get(PurchasingOrderItems, row.purchasing_order_items_id)
        if line is not None and line.unit_price:
            return Decimal(str(line.unit_price))
    if row.production_order_id:
        from app.modules.manufacturing.models import MfgProductionOrder
        order = session.get(MfgProductionOrder, row.production_order_id)
        if order is not None and _is_finished_item(order, row) and order.standard_unit_cost:
            return Decimal(str(order.standard_unit_cost))
    if row.material_id and not row.product_id:   # item-only stock: the item's cost price
        from app.modules.materials.models import Material
        item = session.get(Material, row.material_id)
        if item is not None and item.cost_price is not None:
            return Decimal(str(item.cost_price))
    if row.product_id:
        product = session.get(Product, row.product_id)
        if product is not None and product.cost_price is not None:
            return Decimal(str(product.cost_price))
    return None


def _row_reference(session: Session, row: SalesStock, mtype: str):
    """Fallback reference derived from the row when no service set one."""
    from app.modules.purchasing.models import GoodReceivedNote, PurchasingReturn
    from app.modules.manufacturing.models import MfgProductionOrder

    if mtype.startswith("purchase_return") and row.purchase_return_id:
        doc = session.get(PurchasingReturn, row.purchase_return_id)
        return "purchase_return", row.purchase_return_id, getattr(doc, "purchasing_return_no", None)
    po_id = None
    if mtype in ("issue_to_production", "return_from_production"):
        po_id = row.consumed_by_production_order_id or row.production_order_id
    elif mtype in ("production_output", "by_product") or (row.production_order_id and not row.good_received_note_id):
        po_id = row.production_order_id
    if po_id:
        doc = session.get(MfgProductionOrder, po_id)
        return "production_order", po_id, getattr(doc, "order_no", None)
    if row.good_received_note_id:
        doc = session.get(GoodReceivedNote, row.good_received_note_id)
        return "grn", row.good_received_note_id, getattr(doc, "good_received_no", None)
    if row.stock_count_id:
        from app.modules.inventory.models import StockCount
        doc = session.get(StockCount, row.stock_count_id)
        return "stock_count", row.stock_count_id, getattr(doc, "count_no", None)
    return None, None, None


def _user_id(row: SalesStock) -> Optional[int]:
    from app.core.audit_context import current_user_id
    return current_user_id.get() or row.updated_by or row.created_by


def _product_item(session: Session, product_id: int) -> Optional[int]:
    """The Item Catalog item the product sells (central stock phase 2): a new
    stock row of a linked product is stock of that item."""
    from app.modules.products.models import Product

    product = session.get(Product, product_id)
    return product.material_id if product is not None else None


# ───────────────────────────── flush hook ─────────────────────────────
def _emit(session: Session, row: SalesStock, *, mtype: str, qty, on_hand_change, from_status, to_status,
          from_loc, to_loc, branch_code, now, inserted: bool = False):
    from app.modules.inventory import costing

    ref = session.info.get(REF_KEY)
    if ref:
        rtype, rid, rno = ref["type"], ref["id"], ref["no"]
    else:
        rtype, rid, rno = _row_reference(session, row, mtype)
    if rtype == "stock_count":
        mtype = "count_adjustment"
    unit_cost = row.unit_cost
    if on_hand_change < 0:
        unit_cost = costing.issue_unit_cost(session, row)
    elif on_hand_change > 0 and mtype in costing.AVERAGE_IN_MOVEMENTS:
        # A quantity gain on an existing row comes in at the issue cost (no re-pricing);
        # new rows and returns to stock at their own cost.
        in_cost = row.unit_cost if (inserted or mtype == "sale_return") else costing.issue_unit_cost(session, row)
        costing.apply_receipt(session, row.material_id, on_hand_change, in_cost)
    session.add(StockTransaction(
        created_at=now,
        stock=row,
        product_id=row.product_id,
        material_id=row.material_id,
        movement_type=mtype,
        quantity=Decimal(qty),
        on_hand_change=Decimal(on_hand_change),
        from_status=_s(from_status),
        to_status=_s(to_status),
        branch_code=branch_code,
        from_location_id=from_loc,
        to_location_id=to_loc,
        batch_no=row.batch_no,
        barcode=row.barcode,
        unit_cost=(Decimal(str(unit_cost)).quantize(Decimal("0.01")) if unit_cost is not None else None),
        reference_type=rtype,
        reference_id=rid,
        reference_no=(str(rno)[:60] if rno else None),
        user_id=_user_id(row),
    ))


def _log_change(session: Session, row: SalesStock, old: dict, skip_qty: int, now) -> None:
    new = {a: getattr(row, a) for a in _TRACKED}
    new_qty = int(new["quantity"] or 0)
    old_qty = int(old["quantity"] if old["quantity"] is not None else new_qty)
    ref = session.info.get(REF_KEY)
    ref_type = ref["type"] if ref else None

    # Units that appeared/vanished without a split: logged at the old status first.
    delta = new_qty - old_qty + skip_qty
    if delta:
        _emit(session, row, mtype="quantity_adjustment", qty=abs(delta),
              on_hand_change=delta * is_on_hand(old["status"]), from_status=old["status"],
              to_status=old["status"], from_loc=old["location_id"], to_loc=old["location_id"],
              branch_code=old["branch_code"], now=now)

    status_changed = _s(old["status"]) != _s(new["status"])
    place_changed = old["location_id"] != new["location_id"] or old["branch_code"] != new["branch_code"]
    if (status_changed or place_changed) and new_qty > 0:
        _emit(session, row, mtype=movement_type(old["status"], new["status"], place_changed, ref_type),
              qty=new_qty, on_hand_change=new_qty * (is_on_hand(new["status"]) - is_on_hand(old["status"])),
              from_status=old["status"], to_status=new["status"], from_loc=old["location_id"],
              to_loc=new["location_id"], branch_code=new["branch_code"], now=now)


@event.listens_for(Session, "before_flush")
def _stock_ledger_before_flush(session, flush_context, instances):
    from app.modules.inventory.costing import reset_pending
    reset_pending(session)  # units averaged in an earlier flush are in the database now
    stock_new = [o for o in session.new if isinstance(o, SalesStock)]
    stock_dirty = [o for o in session.dirty if isinstance(o, SalesStock)]
    if not stock_new and not stock_dirty:
        return
    from app.core import timezone as tz
    now = tz.now()
    with session.no_autoflush:
        for row in stock_new:
            split_from = row.__dict__.pop(SPLIT_ATTR, None)
            if row.material_id is None and row.product_id:
                row.material_id = _product_item(session, row.product_id)
            if row.unit_cost is None and split_from is None:
                row.unit_cost = default_unit_cost(session, row)
            if split_from is not None:
                _log_change(session, row, {**split_from, "quantity": row.quantity}, 0, now)
                continue
            ref = session.info.get(REF_KEY)
            qty = int(row.quantity or 1)
            _emit(session, row, mtype=_insert_type(session, row, ref["type"] if ref else None), qty=qty,
                  on_hand_change=qty * is_on_hand(row.status or S.AVAILABLE.value), from_status=None,
                  to_status=row.status or S.AVAILABLE.value, from_loc=None, to_loc=row.location_id,
                  branch_code=row.branch_code, now=now, inserted=True)
        for row in stock_dirty:
            state = inspect(row)
            if not state.persistent:
                continue
            skip = row.__dict__.pop(SKIP_QTY_ATTR, 0)
            old = {}
            for attr in _TRACKED:
                hist = state.attrs[attr].history
                old[attr] = hist.deleted[0] if hist.deleted else getattr(row, attr)
            _log_change(session, row, old, skip, now)


# Load the old value on assignment even when the attribute was expired (e.g.
# after a commit), so the history above always knows the previous state.
def _noop(target, value, oldvalue, initiator):
    return value


for _attr in _TRACKED:
    event.listen(getattr(SalesStock, _attr), "set", _noop, active_history=True, retval=True)


@event.listens_for(Session, "after_transaction_end")
def _clear_reference(session, transaction):
    if transaction.parent is None:
        session.info.pop(REF_KEY, None)
