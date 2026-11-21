"""Stock is found through a product's Item Catalog item (central stock phase 2).

A product (sales part) may point at the item (``materials``) it sells via
``products.material_id``; several products can share one item. Sellable stock
for a product is then every ``sales_stock`` row of that item, whichever product
it was received / made under. A product without an item (service, or not linked
yet) keeps finding its stock by ``product_id``.

Use ``stock_key_filter(db, product_id)`` wherever a query looks for a product's
stock, and ``available_qty_by_product`` for batched per-product quantities.
"""

from __future__ import annotations

from typing import Dict, Iterable, Optional, Sequence

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock


def product_material_id(db: Session, product_id: Optional[int]) -> Optional[int]:
    """The item linked to the product, or None."""
    if not product_id:
        return None
    from app.modules.products.models import Product

    return db.query(Product.material_id).filter(Product.id == product_id).scalar()


def stock_key_condition(product_id: Optional[int], material_id: Optional[int]):
    """SalesStock condition for a product whose item link is already known."""
    if material_id:
        return SalesStock.material_id == material_id
    return SalesStock.product_id == product_id


def stock_key_filter(db: Session, product_id: Optional[int]):
    """SalesStock condition selecting the stock a product can sell: its item's
    rows when linked, else the product's own rows."""
    return stock_key_condition(product_id, product_material_id(db, product_id))


def material_ids_for_products(db: Session, product_ids: Iterable[int]) -> Dict[int, Optional[int]]:
    """{product_id: material_id or None} in one query."""
    from app.modules.products.models import Product

    ids = {int(p) for p in product_ids if p}
    if not ids:
        return {}
    return {pid: mid for pid, mid in db.query(Product.id, Product.material_id).filter(Product.id.in_(ids))}


def available_qty_by_product(
    db: Session,
    product_ids: Iterable[int],
    branch_codes: Optional[Sequence[str]] = None,
    statuses: Sequence = (StockStatus.AVAILABLE,),
    by_branch: bool = False,
) -> dict:
    """Active stock quantity per product, counted through each product's item.

    Returns {product_id: qty}, or {(product_id, branch_code): qty} when
    ``by_branch``. Two queries at most (linked items, unlinked products)."""
    links = material_ids_for_products(db, product_ids)
    if not links:
        return {}
    base = [SalesStock.status.in_(list(statuses)), SalesStock.is_active.is_(True)]
    if branch_codes is not None:
        base.append(SalesStock.branch_code.in_(list(branch_codes)))

    def grouped(key_col, keys):
        cols = [key_col] + ([SalesStock.branch_code] if by_branch else [])
        rows = (
            db.query(*cols, func.coalesce(func.sum(SalesStock.quantity), 0))
            .filter(key_col.in_(keys), *base)
            .group_by(*cols)
            .all()
        )
        return {(tuple(r[:-1]) if by_branch else r[0]): int(r[-1]) for r in rows}

    material_ids = {m for m in links.values() if m}
    unlinked = [p for p, m in links.items() if not m]
    by_material = grouped(SalesStock.material_id, material_ids) if material_ids else {}
    by_product = grouped(SalesStock.product_id, unlinked) if unlinked else {}

    out: dict = {}
    for pid, mid in links.items():
        source, key = (by_material, mid) if mid else (by_product, pid)
        if by_branch:
            for (k, branch), qty in source.items():
                if k == key:
                    out[(pid, branch)] = qty
        elif key in source:
            out[pid] = source[key]
    return out
