"""Stock costing (central stock phase 5): one place that says what a unit of stock costs.

* Receipt cost  — every stock row carries ``unit_cost`` from the moment it is created:
  the PO line price for a GRN (POs are in base currency — they have no currency or
  exchange rate of their own), the order's standard cost for production output, the
  count's cost for found stock. A posted landed cost voucher adds its per-unit share
  to the still-on-hand rows of each GRN line (``apply_landed_cost``).
* Weighted average — items whose ``inventory_valuation_method`` is ``weighted_average``
  keep one company-wide ``materials.average_cost``. Every movement that brings stock
  in at a cost (receipt, production output, by-product, manual stock, count gain, sale
  return to stock) re-averages it: ``(on_hand × avg + qty × cost) / (on_hand + qty)``.
  The stock ledger hook (inventory/ledger.py) calls ``apply_receipt`` for those movements,
  so it happens exactly once per movement wherever the stock comes from.
* Issue cost — ``issue_unit_cost``: weighted-average items leave stock at the item's
  average cost; FIFO items at the row's own (actual lot) cost. LIFO is not allowed under
  SLFRS / IAS 2, so an item set to LIFO is costed exactly like FIFO.
* Valuation — ``stock_cost_expr`` is the same rule as a SQL expression, shared by the
  warehouse KPIs, stock summary, reporting dashboard and Report Center valuation.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from sqlalchemy import and_, case, func
from sqlalchemy.orm import Session

from app.common.enums import StockStatus as S

WEIGHTED_AVERAGE = "weighted_average"
CENT = Decimal("0.01")
AVG_PLACES = Decimal("0.0001")

# Units that are still the company's stock for averaging: on hand anywhere plus
# goods moving between branches (a transfer neither adds nor removes value).
AVERAGE_QTY_STATUSES = (
    S.AVAILABLE.value, S.RESERVED.value, S.FROZEN.value, S.DAMAGED.value,
    S.TRANSFER_PENDING.value, S.RETURN_PENDING.value, S.IN_TRANSIT.value,
)

# Ledger movements that bring stock in at a cost and so re-average a WAC item.
# Transfers, unreserve, undamage, unfreeze and returns from production only move
# stock that is already valued, so they leave the average alone.
AVERAGE_IN_MOVEMENTS = frozenset({
    "receipt", "production_output", "by_product", "manual_create", "count_adjustment", "sale_return",
})

_PENDING_KEY = "_wac_pending_qty"


def _d(value) -> Optional[Decimal]:
    return None if value is None else Decimal(str(value))


def _material(db: Session, material_id: Optional[int]):
    if not material_id:
        return None
    from app.modules.materials.models import Material

    return db.get(Material, material_id)


def is_weighted_average(item) -> bool:
    return item is not None and getattr(item, "inventory_valuation_method", None) == WEIGHTED_AVERAGE


# ───────────────────────────── receipt cost ─────────────────────────────
def receipt_cost(db: Session, po_line) -> Optional[Decimal]:
    """Base-currency cost of one unit received on a PO line (the line's unit price;
    purchase orders carry no foreign currency)."""
    if po_line is None or po_line.unit_price is None:
        return None
    return Decimal(str(po_line.unit_price))


def legacy_unit_cost(db: Session, stock) -> Decimal:
    """The pre-phase-5 rule: captured row cost, else PO line price, else the product's
    (item-only stock: the item's) cost price, else 0."""
    from app.modules.products.models import Product
    from app.modules.purchasing.models import PurchasingOrderItems

    captured = getattr(stock, "unit_cost", None)
    if captured:
        return Decimal(str(captured))
    if getattr(stock, "purchasing_order_items_id", None):
        price = db.query(PurchasingOrderItems.unit_price).filter(
            PurchasingOrderItems.id == stock.purchasing_order_items_id).scalar()
        if price:
            return Decimal(str(price))
    price = None
    if getattr(stock, "product_id", None):
        price = db.query(Product.cost_price).filter(Product.id == stock.product_id).scalar()
    if price is None and getattr(stock, "material_id", None):
        from app.modules.materials.models import Material
        price = db.query(Material.cost_price).filter(Material.id == stock.material_id).scalar()
    return Decimal(str(price or 0))


# ───────────────────────────── issue cost ─────────────────────────────
def issue_unit_cost(db: Session, stock) -> Decimal:
    """Cost of one unit leaving stock: the item's average cost for weighted-average
    items, the row's own cost for FIFO (and LIFO, treated as FIFO) items."""
    item = _material(db, getattr(stock, "material_id", None))
    if is_weighted_average(item) and item.average_cost is not None and Decimal(str(item.average_cost)) > 0:
        return Decimal(str(item.average_cost))
    return legacy_unit_cost(db, stock)


def rows_cost(db: Session, rows) -> Decimal:
    """Total issue cost of stock rows (each row's quantity × its issue unit cost)."""
    return sum((issue_unit_cost(db, r) * Decimal(r.quantity or 1) for r in rows), Decimal("0"))


def default_item_cost(db: Session, material_id: int) -> Decimal:
    """Cost for stock found without a document: average cost, else the item's cost
    price, else its preferred (then any active) supplier's cost."""
    from app.modules.materials.models import MaterialSupplier

    item = _material(db, material_id)
    if item is None:
        return Decimal("0")
    if item.average_cost:
        return Decimal(str(item.average_cost)).quantize(CENT, ROUND_HALF_UP)
    if item.cost_price:
        return Decimal(str(item.cost_price))
    price = (db.query(MaterialSupplier.cost_price)
             .filter(MaterialSupplier.material_id == material_id, MaterialSupplier.active.is_(True))
             .order_by(MaterialSupplier.is_preferred.desc(), MaterialSupplier.id).limit(1).scalar())
    return Decimal(str(price or 0))


# ───────────────────────────── weighted average ─────────────────────────────
def average_qty(db: Session, material_id: int) -> Decimal:
    """Units of the item currently held (flushed state)."""
    from app.modules.inventory.models import SalesStock

    with db.no_autoflush:
        qty = db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
            SalesStock.material_id == material_id, SalesStock.status.in_(AVERAGE_QTY_STATUSES)).scalar()
    return Decimal(qty or 0)


def held_average(db: Session, material_id: int) -> Optional[Decimal]:
    """Quantity-weighted cost of the units of the item held now (flushed state)."""
    from app.modules.inventory.models import SalesStock

    with db.no_autoflush:
        value, qty = db.query(func.sum(SalesStock.quantity * SalesStock.unit_cost),
                              func.sum(SalesStock.quantity)).filter(
            SalesStock.material_id == material_id, SalesStock.status.in_(AVERAGE_QTY_STATUSES),
            SalesStock.unit_cost.isnot(None)).one()
    return (Decimal(value) / Decimal(qty)) if qty else None


def apply_receipt(db: Session, material_id: Optional[int], qty, cost) -> None:
    """Re-average a weighted-average item for ``qty`` units coming in at ``cost``.

    Called from the stock ledger flush hook, before the incoming rows are written:
    the on-hand quantity read from the database excludes them; units already
    averaged earlier in the same flush are added from a per-flush tally."""
    item = _material(db, material_id)
    if not is_weighted_average(item) or cost is None:
        return
    qty, cost = Decimal(qty), Decimal(str(cost))
    if qty <= 0:
        return
    pending = db.info.setdefault(_PENDING_KEY, {})
    on_hand = average_qty(db, material_id) + pending.get(material_id, Decimal("0"))
    avg = _d(item.average_cost)
    if avg is None and on_hand > 0:  # item switched to weighted average: start from what is held
        avg = held_average(db, material_id)
    if avg is None or on_hand <= 0:
        new_avg = cost
    else:
        new_avg = (on_hand * avg + qty * cost) / (on_hand + qty)
    item.average_cost = new_avg.quantize(AVG_PLACES, ROUND_HALF_UP)
    pending[material_id] = pending.get(material_id, Decimal("0")) + qty


def reset_pending(db: Session) -> None:
    db.info.pop(_PENDING_KEY, None)


def apply_landed_cost(db: Session, grn_id: int, po_item_id: int, share: Decimal, qty, *, sign: int = 1) -> int:
    """Add (``sign`` -1: take back) a landed cost share to the GRN line's stock still on hand.

    ``share`` is the voucher amount allocated to the line, ``qty`` the units it was
    allocated over. Each still-held row's unit_cost moves by the per-unit share; a
    weighted-average item's average moves by the value added to its held units.
    Returns the number of rows changed."""
    from app.modules.inventory.models import SalesStock

    qty = Decimal(qty or 0)
    if qty <= 0 or not share:
        return 0
    per_unit = Decimal(str(share)) / qty * sign
    rows = (db.query(SalesStock)
            .filter(SalesStock.good_received_note_id == grn_id,
                    SalesStock.purchasing_order_items_id == po_item_id,
                    SalesStock.status.in_(AVERAGE_QTY_STATUSES))
            .with_for_update().all())
    added_by_item: dict = {}
    for row in rows:
        base = _d(row.unit_cost) if row.unit_cost is not None else legacy_unit_cost(db, row)
        row.unit_cost = max(base + per_unit, Decimal("0")).quantize(CENT, ROUND_HALF_UP)
        if row.material_id:
            added_by_item[row.material_id] = added_by_item.get(row.material_id, Decimal("0")) + per_unit * Decimal(row.quantity or 1)
    for material_id, value in added_by_item.items():
        item = _material(db, material_id)
        if not is_weighted_average(item) or item.average_cost is None:
            continue
        held = average_qty(db, material_id)
        if held > 0:
            item.average_cost = max(Decimal(str(item.average_cost)) + value / held, Decimal("0")).quantize(
                AVG_PLACES, ROUND_HALF_UP)
    return len(rows)


# ───────────────────────────── valuation (SQL) ─────────────────────────────
def stock_cost_expr(stock=None, material=None, product=None):
    """SQL unit cost of a stock row for valuation — the same rule as issue_unit_cost:
    WAC items at the item's average cost, others at the row's captured cost (falling
    back to the product's, then the item's cost price). The query must outer-join
    ``material`` on stock.material_id and ``product`` on stock.product_id."""
    from app.modules.inventory.models import SalesStock
    from app.modules.materials.models import Material
    from app.modules.products.models import Product

    stock = stock if stock is not None else SalesStock
    material = material if material is not None else Material
    product = product if product is not None else Product
    row_cost = func.coalesce(func.nullif(stock.unit_cost, 0), product.cost_price, material.cost_price, 0)
    return case(
        (and_(material.inventory_valuation_method == WEIGHTED_AVERAGE, material.average_cost > 0),
         material.average_cost),
        else_=row_cost,
    )
