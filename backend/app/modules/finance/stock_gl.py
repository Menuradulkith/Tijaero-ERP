"""
GL postings for stock movements that used to post nothing (finance blueprint phase D).

Stock is valued the way the GRN put it into the books: the PO line's unit
price, falling back to the product's cost price.

    branch transfer received      at the source branch:       Dr 1220 Goods in Transit / Cr 1210 Inventory
                                  at the destination branch:  Dr 1210 Inventory        / Cr 1220 Goods in Transit
    stock marked damaged          Dr 5186 Stock Write-offs  / Cr 1210 Inventory
    damaged stock made sellable   Dr 1210 Inventory         / Cr 5186 Stock Write-offs
    stock moved to company assets Dr 1310 Equipment         / Cr 1210 Inventory   (and back on return)

A transfer posts when the goods are received (dispatch is optional in the
warehouse flow), so nothing is ever left hanging in 1220. Moves within one
branch post nothing. Every call happens inside the caller's transaction, so a
failed document change also discards its entry.
"""
from __future__ import annotations

import logging
import uuid
from decimal import Decimal
from typing import Iterable, Optional, Tuple

from sqlalchemy.orm import Session

from app.core import timezone as tz

from .gl_posting_service import GLPostingService
from .posting_rules import posting_ref

logger = logging.getLogger(__name__)
CENT = Decimal("0.01")


def unit_cost(db: Session, stock) -> Decimal:
    """Cost of one unit of a stock row (PO price, else product cost price, else 0)."""
    from app.modules.products.models import Product
    from app.modules.purchasing.models import PurchasingOrderItems

    if getattr(stock, "purchasing_order_items_id", None):
        price = db.query(PurchasingOrderItems.unit_price).filter(
            PurchasingOrderItems.id == stock.purchasing_order_items_id).scalar()
        if price:
            return Decimal(str(price))
    price = db.query(Product.cost_price).filter(Product.id == stock.product_id).scalar()
    return Decimal(str(price or 0))


def _qty(stock) -> Decimal:
    return Decimal(str(getattr(stock, "quantity", None) or 1))


def _post(db: Session, *, reference_type: str, reference_id: int, reference_no: Optional[str], lines, on,
          description: str, branch_code: Optional[str], user_id: int, marker: str) -> None:
    lines = [l for l in lines if l["debit"] or l["credit"]]
    if len(lines) < 2:
        return
    result = GLPostingService(db).post(
        reference_type=reference_type, reference_id=reference_id, reference_no=reference_no, lines=lines,
        entry_date=on, description=description, branch_code=branch_code, user_id=user_id or 0,
        transaction_type="StockMovement", je_prefix="JE-STK", source_module="inventory", marker=marker,
    )
    if result.failed:
        logger.error("Stock GL posting failed for %s#%s: %s", reference_type, reference_id, result.error_message)


def _pair(debit, credit, amount: Decimal, desc: str):
    return [
        {"account_code": debit, "debit": amount, "credit": Decimal("0"), "description": desc},
        {"account_code": credit, "debit": Decimal("0"), "credit": amount, "description": desc},
    ]


def post_damage(db: Session, stock, user_id: int, *, quantity: Optional[Decimal] = None, reverse: bool = False) -> None:
    """Write off (or, with ``reverse``, write back) a stock row marked damaged."""
    qty = Decimal(str(quantity)) if quantity is not None else _qty(stock)
    amount = (unit_cost(db, stock) * qty).quantize(CENT)
    if amount <= 0:
        return
    label = stock.barcode or f"stock #{stock.id}"
    if reverse:
        lines = _pair(posting_ref("INVENTORY"), posting_ref("INVENTORY_WRITE_OFF"), amount, f"Damaged stock back in sale - {label}")
    else:
        lines = _pair(posting_ref("INVENTORY_WRITE_OFF"), posting_ref("INVENTORY"), amount, f"Stock marked damaged - {label}")
    _post(
        db, reference_type="SalesStock", reference_id=stock.id, reference_no=stock.barcode, lines=lines, on=tz.today(),
        description=f"Auto GL - Stock {'undamaged' if reverse else 'damaged'} | {label} | qty {qty}",
        branch_code=stock.branch_code, user_id=user_id,
        # each status flip is its own event: never deduplicated against an earlier flip
        marker=f"StockStatus {stock.id} {uuid.uuid4().hex[:8]}",
    )


def post_transfer_receipt(db: Session, note, moves: Iterable[Tuple[object, Decimal, Optional[str], Optional[str]]],
                          user_id: int) -> None:
    """Move received stock value from the source branch to the destination branch.

    ``moves``: (stock row, quantity, source branch, destination branch)."""
    by_branches = {}
    for stock, qty, src, dest in moves:
        if not src or not dest or src == dest:
            continue
        amount = (unit_cost(db, stock) * Decimal(str(qty))).quantize(CENT)
        if amount > 0:
            by_branches[(src, dest)] = by_branches.get((src, dest), Decimal("0")) + amount
    no = getattr(note, "item_transfer_note", None) or f"ITN#{note.id}"
    batch = uuid.uuid4().hex[:8]  # partial receipts: one pair of entries per receipt
    for (src, dest), amount in by_branches.items():
        _post(
            db, reference_type="ItemTransferNote", reference_id=note.id, reference_no=no,
            lines=_pair(posting_ref("GOODS_IN_TRANSIT"), posting_ref("INVENTORY"), amount, f"Stock sent to {dest} - {no}"),
            on=tz.today(), description=f"Auto GL - Branch transfer out | {no} | {src} -> {dest}",
            branch_code=src, user_id=user_id, marker=f"TransferOut {note.id} {batch} {src}>{dest}",
        )
        _post(
            db, reference_type="ItemTransferNote", reference_id=note.id, reference_no=no,
            lines=_pair(posting_ref("INVENTORY"), posting_ref("GOODS_IN_TRANSIT"), amount, f"Stock received from {src} - {no}"),
            on=tz.today(), description=f"Auto GL - Branch transfer in | {no} | {src} -> {dest}",
            branch_code=dest, user_id=user_id, marker=f"TransferIn {note.id} {batch} {src}>{dest}",
        )


def post_asset_reclass(db: Session, stock, user_id: int, *, to_asset: bool) -> None:
    """Stock taken out of sale for the company's own use (or returned to sale)."""
    amount = (unit_cost(db, stock) * _qty(stock)).quantize(CENT)
    if amount <= 0:
        return
    label = stock.barcode or f"stock #{stock.id}"
    if to_asset:
        lines = _pair(posting_ref("COMPANY_ASSETS"), posting_ref("INVENTORY"), amount, f"Moved to company assets - {label}")
    else:
        lines = _pair(posting_ref("INVENTORY"), posting_ref("COMPANY_ASSETS"), amount, f"Returned to sales stock - {label}")
    _post(
        db, reference_type="SalesStock", reference_id=stock.id, reference_no=stock.barcode, lines=lines, on=tz.today(),
        description=f"Auto GL - Stock {'to' if to_asset else 'from'} company assets | {label}",
        branch_code=stock.branch_code, user_id=user_id, marker=f"AssetReclass {stock.id} {uuid.uuid4().hex[:8]}",
    )
