"""Purchasing buys Item Catalog items (central stock phase 3).

New PO lines, GRN stock, purchase returns and supplier invoices carry
``material_id``. Lines created before phase 3 keep their ``product_id`` (and
were backfilled with the product's item); every reader takes the item first
and falls back to the product for such old lines.

Helpers here are flush-only; callers commit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Iterable, Optional

from sqlalchemy.orm import Session

NO_SUPPLIER_LINK = "Add this supplier on the item's Suppliers tab first"


@dataclass
class LinePart:
    """What a PO line buys, read from the item (or the product on an old line)."""
    name: str
    code: Optional[str]
    tracking_type: str
    over_pct: float
    under_pct: float
    unit_of_measure: Optional[str]


def part_key(material_id: Optional[int], product_id: Optional[int]):
    """Key matching document lines of the same part: the item when known, else the product."""
    if material_id:
        return ("m", int(material_id))
    if product_id:
        return ("p", int(product_id))
    return None


def line_parts(db: Session, lines: Iterable) -> Dict[int, LinePart]:
    """{po_line.id: LinePart} for PO lines (two queries at most)."""
    from app.modules.materials.models import Material
    from app.modules.products.models import Product

    lines = list(lines)
    mids = {l.material_id for l in lines if getattr(l, "material_id", None)}
    pids = {l.product_id for l in lines if not getattr(l, "material_id", None) and l.product_id}
    mats = {m.id: m for m in db.query(Material).filter(Material.id.in_(mids)).all()} if mids else {}
    prods = {p.id: p for p in db.query(Product).filter(Product.id.in_(pids)).all()} if pids else {}
    out: Dict[int, LinePart] = {}
    for l in lines:
        src = mats.get(l.material_id) if getattr(l, "material_id", None) else prods.get(l.product_id)
        if src is None:
            out[l.id] = LinePart(f"line {l.id}", None, "serial", 0, 0, None)
            continue
        out[l.id] = LinePart(
            name=src.name,
            code=src.item_code,
            tracking_type=src.tracking_type or "serial",
            over_pct=float(src.over_receipt_tolerance_pct or 0),
            under_pct=float(src.under_receipt_tolerance_pct or 0),
            unit_of_measure=getattr(src, "unit_of_measure", None),
        )
    return out


def stock_product_for_material(db: Session, material_id: Optional[int]) -> Optional[int]:
    """The product stock of this item is filed under: the item's only linked
    product, else None (item-only stock, or several products sell it)."""
    if not material_id:
        return None
    from app.modules.products.models import Product

    ids = [pid for (pid,) in db.query(Product.id).filter(Product.material_id == material_id).limit(2).all()]
    return ids[0] if len(ids) == 1 else None


def supplier_link(db: Session, supplier_id: int, material_id: int, active_only: bool = True):
    from app.modules.materials.models import MaterialSupplier

    q = db.query(MaterialSupplier).filter(
        MaterialSupplier.supplier_id == supplier_id, MaterialSupplier.material_id == material_id
    )
    if active_only:
        q = q.filter(MaterialSupplier.active.is_(True))
    return q.first()


def copy_product_supplier_links(db: Session, product_id: int, material_id: int) -> int:
    """Give the item the product's supplier price list (links it does not have yet)."""
    from app.modules.materials.models import MaterialSupplier
    from app.modules.purchasing.models import SupplierProduct

    existing = {
        s for (s,) in db.query(MaterialSupplier.supplier_id).filter(MaterialSupplier.material_id == material_id)
    }
    has_preferred = db.query(MaterialSupplier.id).filter(
        MaterialSupplier.material_id == material_id, MaterialSupplier.is_preferred.is_(True)
    ).first() is not None
    added = 0
    for sp in (
        db.query(SupplierProduct).filter(SupplierProduct.product_id == product_id)
        .order_by(SupplierProduct.is_preferred.desc(), SupplierProduct.id).all()
    ):
        if sp.supplier_id in existing or not sp.cost_price or sp.cost_price <= 0:
            continue
        preferred = bool(sp.is_preferred) and not has_preferred
        has_preferred = has_preferred or preferred
        db.add(MaterialSupplier(
            supplier_id=sp.supplier_id, material_id=material_id, supplier_sku=sp.supplier_sku,
            cost_price=sp.cost_price, minimum_order_qty=sp.minimum_order_qty, is_preferred=preferred,
            active=sp.active,
        ))
        existing.add(sp.supplier_id)
        added += 1
    if added:
        db.flush()
    return added


def ensure_product_item(db: Session, product, user_id: Optional[int] = None) -> Optional[int]:
    """The item a product sells. A stocked (inventory) product without one gets it
    created from its data (as on product create, phase 2) with its supplier links;
    other products (services, general) return None."""
    if product is None:
        return None
    if product.material_id:
        return product.material_id
    from app.modules.products.service import STOCKED_ITEM_TYPE

    if product.item_type != STOCKED_ITEM_TYPE:
        return None
    from app.modules.materials.from_product import item_for_product

    material = item_for_product(db, product, user_id)
    product.material_id = material.id
    db.flush()
    copy_product_supplier_links(db, product.id, material.id)
    return material.id
