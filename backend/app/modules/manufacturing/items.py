"""Manufacturing works on Item Catalog items (central stock phase 4).

A BOM makes an item from component items and may yield by-product items; production
orders, their component and by-product lines, material transactions and reorder rules
carry ``material_id``. Rows made before phase 4 keep their ``product_id`` (and were
backfilled with the product's item by alembic s144), so every reader takes the item
and shows the product only for such old rows.

A product made in-house is a product linked to the finished item (``products.material_id``);
output stock is filed under that product when the item has exactly one.
"""

from __future__ import annotations

from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Iterable, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.modules.materials.models import Material
from app.modules.products.models import Product

D = Decimal
CENT = D("0.01")


def _money(v) -> Decimal:
    return D(str(v or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def product_standard_cost(product: Optional[Product]) -> Decimal:
    """The cost a product's inventory moves at: the latest active price tier's cost (what a
    sale relieves inventory at, see SalesAccountingIntegration), else Product.cost_price."""
    if product is None:
        return D("0")
    tiers = [t for t in (product.price_tiers or []) if t.is_active]
    if tiers:
        return _money(max(tiers, key=lambda t: (t.created_at or datetime.min, t.id)).cost_price)
    return _money(product.cost_price)


def item_standard_cost(db: Session, material: Optional[Material]) -> Decimal:
    """Standard cost of an item: its cost price, else its preferred (else cheapest) active
    supplier cost, else the standard cost of the one product that sells it."""
    if material is None:
        return D("0")
    if material.cost_price and D(str(material.cost_price)) > 0:
        return _money(material.cost_price)
    links = [l for l in (material.supplier_links or []) if l.active and l.cost_price and D(str(l.cost_price)) > 0]
    if links:
        best = min(links, key=lambda l: (0 if l.is_preferred else 1, D(str(l.cost_price))))
        return _money(best.cost_price)
    return product_standard_cost(single_products(db, [material.id]).get(material.id))


def get_item(db: Session, material_id: int, label: str = "Item") -> Material:
    item = db.get(Material, material_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{label} #{material_id} does not exist")
    return item


def single_products(db: Session, material_ids: Iterable[Optional[int]]) -> Dict[int, Product]:
    """{material_id: product} for items sold by exactly one product."""
    ids = {int(m) for m in material_ids if m}
    if not ids:
        return {}
    found: Dict[int, list] = {}
    for p in db.query(Product).filter(Product.material_id.in_(ids)).all():
        found.setdefault(p.material_id, []).append(p)
    return {mid: ps[0] for mid, ps in found.items() if len(ps) == 1}


def item_ids_for_product(db: Session, product_id: Optional[int]) -> Optional[int]:
    """The item a product sells (for filters that still take a product)."""
    if not product_id:
        return None
    return db.query(Product.material_id).filter(Product.id == product_id).scalar()


def item_fields(item: Optional[Material], product: Optional[Product] = None) -> dict:
    """Response fields of the item on a row (unit from the item, else the old row's product)."""
    return dict(
        material_id=item.id if item else None,
        material_item_code=item.item_code if item else None,
        material_name=item.name if item else None,
        unit_of_measure=(item.unit_of_measure if item else None) or (product.unit_of_measure if product else None),
    )


def line_fields(row) -> dict:
    """Item and (old rows only) product fields of a BOM / order line."""
    p = getattr(row, "product", None)
    return dict(
        product_id=getattr(row, "product_id", None),
        product_name=p.name if p else None,
        product_code=p.item_code if p else None,
        **item_fields(getattr(row, "item", None), p),
    )


def header_fields(row, linked: Dict[int, Product]) -> dict:
    """Item fields of a BOM / production order plus its product: the old row's product, else
    the finished item's single linked product (so sales and make-to-order links keep working)."""
    p = getattr(row, "product", None) or linked.get(row.material_id)
    return dict(
        product_id=p.id if p else None,
        product_name=p.name if p else None,
        product_code=p.item_code if p else None,
        **item_fields(getattr(row, "item", None), p),
    )


def item_label(row) -> str:
    """Display name of a row's part: the item, else the old row's product."""
    item = getattr(row, "item", None)
    if item is not None:
        return item.name
    p = getattr(row, "product", None)
    if p is not None:
        return p.name
    return f"item #{getattr(row, 'material_id', None)}"


def tracking_of(row) -> str:
    item = getattr(row, "item", None)
    src = item if item is not None else getattr(row, "product", None)
    return (getattr(src, "tracking_type", None) or "serial") if src is not None else "serial"
