"""Quantity-aware helpers for sales_stock rows.

A sales_stock row represents ``quantity`` units: always 1 for serial-tracked
stock, the lot size for batch/none-tracked stock. Consuming part of a lot
(sale, return, transfer) *splits* the lot: the consumed units become their own
row that the caller then moves through the normal status flow
(available -> sold / reserved / ...), so every downstream path that follows a
``sales_stock_id`` keeps working unchanged.
"""

from __future__ import annotations

from typing import List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.modules.inventory.models import SalesStock
from app.core import timezone as tz

# First-expiry-first-out; lots without an expiry (and serial units) follow in
# receipt order. Identical to the previous `ORDER BY id` for serial stock.
FEFO_ORDER = (SalesStock.expiry_date.asc().nulls_last(), SalesStock.id.asc())


def split_lot(db: Session, row: SalesStock, qty: int) -> SalesStock:
    """Detach ``qty`` units of ``row`` into their own row and return it.

    Returns ``row`` itself when it is consumed whole. The new row copies the
    lot's identity (product, branch, GRN link, batch, expiry, status,
    reservation) so the caller can set its status independently of the
    remainder, which stays on ``row``.
    """
    if qty < 1:
        raise ValueError("Quantity to take must be at least 1.")
    if qty > row.quantity:
        raise ValueError(f"Cannot take {qty} unit(s) from a lot of {row.quantity}.")
    if qty == row.quantity:
        return row

    row.quantity -= qty
    part = SalesStock(
        product_id=row.product_id,
        barcode=None,  # only serial rows carry a barcode, and those are never split
        quantity=qty,
        batch_no=row.batch_no,
        expiry_date=row.expiry_date,
        branch_code=row.branch_code,
        location_id=row.location_id,
        good_received_note_id=row.good_received_note_id,
        purchasing_order_items_id=row.purchasing_order_items_id,
        production_order_id=row.production_order_id,
        consumed_by_production_order_id=row.consumed_by_production_order_id,
        warranty_month=row.warranty_month,
        status=row.status,
        is_active=row.is_active,
        reserved_for_quote_item_id=row.reserved_for_quote_item_id,
        added_date=row.added_date or tz.now(),
    )
    db.add(part)
    db.flush()
    return part


def take_units(db: Session, rows: List[SalesStock], needed: int) -> List[SalesStock]:
    """Consume ``needed`` units from already-locked, ordered ``rows``.

    Returns the rows (split off where a lot is only partly used) that now hold
    exactly the consumed units, in order. If the rows hold fewer than
    ``needed`` units, as many as exist are returned; callers compare
    ``sum(r.quantity)`` against ``needed`` to detect a shortfall.
    """
    taken: List[SalesStock] = []
    remaining = needed
    for row in rows:
        if remaining <= 0:
            break
        take = min(row.quantity, remaining)
        taken.append(split_lot(db, row, take))
        remaining -= take
    return taken


def units_in(rows: List[SalesStock]) -> int:
    return sum(r.quantity for r in rows)


def sum_quantity(db: Session, *filters) -> int:
    """SUM(quantity) of the rows matching ``filters`` (0 when none)."""
    return int(db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(*filters).scalar() or 0)


def find_grn_item(db: Session, grn_no: str, unit: SalesStock):
    """The good_received_items row a stock unit came from: matched by barcode
    for serial units, by PO line + batch for batch/none lots."""
    from app.modules.purchasing.models import GoodReceivedItems as G

    query = db.query(G).filter(G.good_received_note == grn_no)
    if unit.barcode:
        query = query.filter(G.barcode == unit.barcode)
    else:
        query = query.filter(
            G.barcode.is_(None),
            G.purchasing_order_items_id == unit.purchasing_order_items_id,
            G.batch_no == unit.batch_no,
        )
    return query.first()
