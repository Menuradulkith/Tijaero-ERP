"""Build the Item Catalog item a stocked product sells (central stock phase 2).

Same mapping as the data step of alembic s142_product_item_link: an item named
after the product (an existing item of that name is reused when its category
and brand match, otherwise the name gets a " (product <code>)" suffix), in the
material category named like the product's category (created when missing),
with the product's unit, tracking, tolerances, shelf life, QC flag, cost, tax,
brand, family, certificate and HS code. Writes only flush.
"""

from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.core import timezone as tz
from app.core.concurrency import next_document_number
from app.modules.materials import repository as repo
from app.modules.materials.models import Material, MaterialCategory


def material_category_for(db: Session, product_category) -> MaterialCategory:
    """The material category named like the product category (created when missing)."""
    existing = repo.get_category_by_name(db, product_category.name)
    if existing is not None:
        return existing
    row = MaterialCategory(
        name=product_category.name.strip(),
        category_code=next_document_number(db, MaterialCategory.category_code, repo.CATEGORY_CODE_PREFIX, width=4),
        memo=product_category.memo,
        description=product_category.description,
        active=True,
        created_date=tz.now(),
    )
    db.add(row)
    db.flush()
    return row


def item_for_product(db: Session, product, user_id=None) -> Material:
    """Create (or reuse a matching) item for ``product`` and return it. The caller sets product.material_id."""
    from app.modules.products.models import Category, HsCode

    product_category = db.get(Category, product.category_id)
    category = material_category_for(db, product_category)
    name = re.sub(r"\s+", " ", product.name.strip())
    existing = repo.get_by_name(db, name)
    if existing is not None:
        if existing.category_id == category.id and existing.items_brand_id == product.items_brand_id:
            return existing
        suffix = f" (product {product.item_code})"
        name = name[:255 - len(suffix)] + suffix
    hs = db.get(HsCode, product.hs_code_id) if product.hs_code_id else None
    material = Material(
        name=name,
        item_code=next_document_number(db, Material.item_code, repo.ITEM_CODE_PREFIX, width=6),
        model=product.model,
        item_type="stock_item",
        unit_of_measure=product.unit_of_measure or "pcs",
        tracking_type=product.tracking_type or "serial",
        over_receipt_tolerance_pct=product.over_receipt_tolerance_pct or 0,
        under_receipt_tolerance_pct=product.under_receipt_tolerance_pct or 0,
        shelf_life_days=product.shelf_life_days,
        requires_qc=bool(product.requires_qc),
        description=product.description,
        website_active=False,
        active=bool(product.active),
        cost_price=product.cost_price or 0,
        tax_rate=product.tax_rate or 0,
        created_date=tz.today(),
        added_date=tz.now(),
        category_id=category.id,
        items_brand_id=product.items_brand_id,
        hs_code=(hs.code[:20] if hs and hs.code else None),
        required_certificate=product.required_certificate,
        inventory_valuation_method="fifo",
        stock_issuing_method="fefo" if product.tracking_type == "batch" else "fifo",
        product_family=((product.product_family or "").strip() or product_category.name.strip())[:120],
        check_for_availability=False,
        design_required=False,
        created_by=user_id,
        updated_by=user_id,
    )
    db.add(material)
    db.flush()
    return material
