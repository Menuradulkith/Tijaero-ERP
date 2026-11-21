"""Material master data access. Like the product repository, writes here only
flush: the service owns the transaction and commits once."""
from typing import List, Optional

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

from app.core import timezone as tz
from app.core.concurrency import next_document_number
from app.modules.materials.models import Material, MaterialCategory, MaterialMinimumPrice, MaterialSupplier
from app.modules.materials.schemas import (
    NON_COLUMN_UPDATE_FIELDS, MaterialCategoryCreate, MaterialCategoryUpdate, MaterialCreate, MaterialUpdate,
)
from app.modules.products.models import ItemsBrand
from app.modules.products.repository import _like_pattern, _page_query, _sort_cols

ITEM_CODE_PREFIX = "MAT"
CATEGORY_CODE_PREFIX = "MCAT"


def get_by_id(db: Session, material_id: int) -> Optional[Material]:
    return db.query(Material).filter(Material.id == material_id).first()


def get_by_name(db: Session, name: str) -> Optional[Material]:
    return db.query(Material).filter(func.lower(func.btrim(Material.name)) == (name or "").strip().lower()).first()


def get_all(db: Session, skip: int = 0, limit: int = 100, active_only: bool = True) -> List[Material]:
    query = db.query(Material)
    if active_only:
        query = query.filter(Material.active == True)  # noqa: E712
    return query.order_by(Material.id).offset(skip).limit(limit).all()


def _text_filter(pattern: str):
    return or_(
        Material.name.ilike(pattern, escape="\\"),
        Material.item_code.ilike(pattern, escape="\\"),
        Material.model.ilike(pattern, escape="\\"),
    )


def search(db: Session, query: str, skip: int = 0, limit: int = 100) -> List[Material]:
    pattern = _like_pattern(query)
    q = db.query(Material)
    if pattern:
        q = q.filter(_text_filter(pattern))
    return q.order_by(Material.id).offset(skip).limit(limit).all()


def create(db: Session, data: MaterialCreate) -> Material:
    item_code = next_document_number(db, Material.item_code, ITEM_CODE_PREFIX, width=6)
    material = Material(
        **data.model_dump(exclude=NON_COLUMN_UPDATE_FIELDS),
        item_code=item_code,
        created_date=tz.today(),
        added_date=tz.now(),
    )
    db.add(material)
    db.flush()
    return material


def update(db: Session, material: Material, data: MaterialUpdate) -> Material:
    for field, value in data.model_dump(exclude_unset=True, exclude=NON_COLUMN_UPDATE_FIELDS).items():
        setattr(material, field, value)
    db.flush()
    return material


MATERIAL_SORTS = {
    "item_code": (Material.item_code, True),
    "name": (Material.name, True),
    "model": (Material.model, True),
    "category_name": (MaterialCategory.name, True),
    "brand_name": (ItemsBrand.brand_name, True),
    "cost_price": (Material.cost_price, False),
    "selling_price": (Material.selling_price, False),
    "active": (Material.active, False),
}


def materials_page(db: Session, *, page: int, size: int, q=None, active=None, category_id=None,
                   brand_id=None, supplier_id=None, sort_by=None, order="asc"):
    query = (
        db.query(Material)
        .join(MaterialCategory, Material.category_id == MaterialCategory.id)
        .outerjoin(ItemsBrand, Material.items_brand_id == ItemsBrand.id)  # brand is optional
        .options(joinedload(Material.category), joinedload(Material.brand))
    )
    pattern = _like_pattern(q)
    if pattern:
        query = query.filter(_text_filter(pattern))
    if active is not None:
        query = query.filter(Material.active == active)
    if category_id:
        query = query.filter(Material.category_id == category_id)
    if brand_id:
        query = query.filter(Material.items_brand_id == brand_id)
    if supplier_id:
        query = query.filter(Material.id.in_(
            db.query(MaterialSupplier.material_id).filter(MaterialSupplier.supplier_id == supplier_id)
        ))
    return _page_query(query, _sort_cols(MATERIAL_SORTS, "item_code", sort_by, order), Material.id, page, size)


# ---- material categories ----------------------------------------------------

def get_category(db: Session, category_id: int) -> Optional[MaterialCategory]:
    return db.query(MaterialCategory).filter(MaterialCategory.id == category_id).first()


def get_category_by_name(db: Session, name: str) -> Optional[MaterialCategory]:
    return (
        db.query(MaterialCategory)
        .filter(func.lower(func.btrim(MaterialCategory.name)) == (name or "").strip().lower())
        .first()
    )


def list_categories(db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[MaterialCategory]:
    query = db.query(MaterialCategory)
    if active_only:
        query = query.filter(MaterialCategory.active == True)  # noqa: E712
    return query.order_by(MaterialCategory.id).offset(skip).limit(limit).all()


def create_category(db: Session, data: MaterialCategoryCreate) -> MaterialCategory:
    code = next_document_number(db, MaterialCategory.category_code, CATEGORY_CODE_PREFIX, width=4)
    row = MaterialCategory(**data.model_dump(), category_code=code, created_date=tz.now())
    db.add(row)
    db.flush()
    return row


def update_category(db: Session, row: MaterialCategory, data: MaterialCategoryUpdate) -> MaterialCategory:
    for field, value in data.model_dump(exclude_unset=True, exclude=NON_COLUMN_UPDATE_FIELDS).items():
        setattr(row, field, value)
    db.flush()
    return row


CATEGORY_SORTS = {
    "name": (MaterialCategory.name, True),
    "category_code": (MaterialCategory.category_code, True),
    "active": (MaterialCategory.active, False),
}


def categories_page(db: Session, *, page: int, size: int, q=None, active=None, sort_by=None, order="asc"):
    query = db.query(MaterialCategory)
    pattern = _like_pattern(q)
    if pattern:
        query = query.filter(or_(
            MaterialCategory.name.ilike(pattern, escape="\\"),
            MaterialCategory.category_code.ilike(pattern, escape="\\"),
        ))
    if active is not None:
        query = query.filter(MaterialCategory.active == active)
    return _page_query(query, _sort_cols(CATEGORY_SORTS, "name", sort_by, order), MaterialCategory.id, page, size)


# ---- minimum prices ---------------------------------------------------------

def minimum_prices(db: Session, material_id: int) -> List[MaterialMinimumPrice]:
    return (
        db.query(MaterialMinimumPrice)
        .filter(MaterialMinimumPrice.material_id == material_id)
        .order_by(MaterialMinimumPrice.created_date.desc(), MaterialMinimumPrice.id.desc())
        .all()
    )


def current_minimum_price(db: Session, material_id: int) -> Optional[MaterialMinimumPrice]:
    return (
        db.query(MaterialMinimumPrice)
        .filter(MaterialMinimumPrice.material_id == material_id)
        .order_by(MaterialMinimumPrice.created_date.desc(), MaterialMinimumPrice.id.desc())
        .first()
    )


def current_minimum_prices(db: Session, material_ids: List[int]) -> dict:
    """Latest minimum price per material, in one query."""
    if not material_ids:
        return {}
    rows = (
        db.query(MaterialMinimumPrice)
        .filter(MaterialMinimumPrice.material_id.in_(material_ids))
        .order_by(MaterialMinimumPrice.material_id, MaterialMinimumPrice.created_date.desc(), MaterialMinimumPrice.id.desc())
        .distinct(MaterialMinimumPrice.material_id)
        .all()
    )
    return {row.material_id: row.minimum_price for row in rows}


def add_minimum_price(db: Session, material_id: int, minimum_price) -> MaterialMinimumPrice:
    row = MaterialMinimumPrice(material_id=material_id, minimum_price=minimum_price, created_date=tz.now())
    db.add(row)
    db.flush()
    return row


# ---- supplier links ---------------------------------------------------------

def supplier_links(db: Session, material_id: int) -> List[MaterialSupplier]:
    return (
        db.query(MaterialSupplier)
        .filter(MaterialSupplier.material_id == material_id)
        .order_by(MaterialSupplier.is_preferred.desc(), MaterialSupplier.id)
        .all()
    )


def preferred_supplier_names(db: Session, material_ids: List[int]) -> dict:
    """Preferred supplier's company name per material, in one query (one preferred per material)."""
    from app.modules.purchasing.models import Supplier

    if not material_ids:
        return {}
    rows = (
        db.query(MaterialSupplier.material_id, Supplier.company_name)
        .join(Supplier, Supplier.id == MaterialSupplier.supplier_id)
        .filter(MaterialSupplier.material_id.in_(material_ids), MaterialSupplier.is_preferred.is_(True))
        .all()
    )
    return {material_id: name for material_id, name in rows}


def stamp_link_display_fields(db: Session, links: List[MaterialSupplier]) -> List[MaterialSupplier]:
    """Attach material/supplier display names, one batched query each."""
    from app.modules.purchasing.models import Supplier

    material_ids = {r.material_id for r in links}
    supplier_ids = {r.supplier_id for r in links}
    materials = {m.id: m for m in db.query(Material).filter(Material.id.in_(material_ids)).all()} if material_ids else {}
    suppliers = {s.id: s for s in db.query(Supplier).filter(Supplier.id.in_(supplier_ids)).all()} if supplier_ids else {}
    for row in links:
        material = materials.get(row.material_id)
        supplier = suppliers.get(row.supplier_id)
        row.material_name = material.name if material else None
        row.material_item_code = material.item_code if material else None
        row.supplier_company_name = supplier.company_name if supplier else None
    return links


def clear_preferred(db: Session, material_id: int, exclude_id: Optional[int] = None) -> None:
    """Only one preferred supplier per material. The caller has locked the material row."""
    query = db.query(MaterialSupplier).filter(
        MaterialSupplier.material_id == material_id,
        MaterialSupplier.is_preferred.is_(True),
    )
    if exclude_id is not None:
        query = query.filter(MaterialSupplier.id != exclude_id)
    query.update({"is_preferred": False}, synchronize_session=False)
