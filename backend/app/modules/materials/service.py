"""Material master business rules — the product catalog's rules minus anything
that depends on stock, sales or price tiers (materials have none of those)."""
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.common.audit import diff_changes, log_audit
from app.common.concurrency import ensure_not_stale, integrity_error_detail, is_unique_violation
from app.modules.materials import repository as repo
from app.modules.materials import schemas
from app.modules.materials.models import Material, MaterialCategory, MaterialMinimumPrice, MaterialSupplier
from app.modules.products.models import ItemsBrand
from app.modules.products.service import _attach_user_names, _duplicate_error, _lock_row, _touch, _validate_minimum_price

ENTITY = "material"
CATEGORY_ENTITY = "material_category"
CATEGORY_UNIQUE_MESSAGES = {
    "uq_material_categories_name_ci": "A material category with this name already exists.",
    "uq_material_categories_code_ci": "A material category with this code already exists.",
}
UNIQUE_MESSAGES = {
    "uq_materials_name_ci": "A material with this name already exists.",
    "uq_materials_item_code_ci": "A material with this item code already exists.",
    "materials_item_code_key": "A material with this item code already exists.",
}


def _not_found(material_id: int) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Material with id {material_id} not found")


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _require_active_refs(db: Session, category_id: Optional[int], brand_id: Optional[int]) -> None:
    if category_id is not None:
        # Materials have their own categories: a product category id is not valid here.
        category = db.query(MaterialCategory).filter(MaterialCategory.id == category_id).first()
        if category is None:
            raise _bad(f"Material category with id {category_id} not found.")
        if not category.active:
            raise _bad(f"Category '{category.name.strip()}' is inactive and cannot be assigned to a material.")
    if brand_id is not None:
        brand = db.query(ItemsBrand).filter(ItemsBrand.id == brand_id).first()
        if brand is None:
            raise _bad(f"Brand with id {brand_id} not found.")
        if not brand.active:
            raise _bad(f"Brand '{brand.brand_name.strip()}' is inactive and cannot be assigned to a material.")


def _check_prices(cost, selling, website) -> None:
    if selling is not None and float(selling) < float(cost):
        raise _bad("Selling price cannot be less than cost price.")
    if website is not None and float(website) > 0 and float(website) < float(cost):
        raise _bad("Website price cannot be less than cost price.")


def _decorate(db: Session, rows: List[Material], with_names: bool = False) -> List[Material]:
    """Stamp the display-only fields the Product response carries."""
    _attach_user_names(db, rows)
    ids = [r.id for r in rows]
    mins = repo.current_minimum_prices(db, ids)
    preferred = repo.preferred_supplier_names(db, ids)
    for r in rows:
        r.minimum_selling_price = mins.get(r.id)
        r.preferred_supplier_name = preferred.get(r.id)
        if with_names:
            r.category_name = r.category.name if r.category else None
            r.brand_name = r.brand.brand_name if r.brand else None
    return rows


def _get_or_404(db: Session, material_id: int) -> Material:
    material = repo.get_by_id(db, material_id)
    if not material:
        raise _not_found(material_id)
    return material


# ---- materials ----------------------------------------------------------------

def get_material(db: Session, material_id: int) -> Material:
    from app.modules.products.models import Product

    material = _decorate(db, [_get_or_404(db, material_id)])[0]
    # Products that sell this item (central stock): single-item view only.
    material.linked_products = (
        db.query(Product).filter(Product.material_id == material_id).order_by(Product.item_code).all()
    )
    return material


def list_materials(db: Session, skip: int, limit: int, active_only: bool) -> List[Material]:
    return _decorate(db, repo.get_all(db, skip, limit, active_only))


def search_materials(db: Session, q: str, skip: int, limit: int) -> List[Material]:
    return _decorate(db, repo.search(db, q, skip, limit))


def materials_page(db: Session, page: int, size: int, **filters) -> dict:
    rows, total = repo.materials_page(db, page=page, size=size, **filters)
    _decorate(db, rows, with_names=True)
    return {"items": rows, "total": total, "page": page, "size": size, "pages": -(-total // size)}


def create_material(db: Session, data: schemas.MaterialCreate, user_id: int) -> Material:
    if repo.get_by_name(db, data.name):
        raise _bad(f"Material with name '{data.name}' already exists")
    _check_prices(data.cost_price, data.selling_price, data.website_price)
    _validate_minimum_price(data.minimum_selling_price, data.cost_price, data.selling_price)
    _require_active_refs(db, data.category_id, data.items_brand_id)
    try:
        created = repo.create(db, data)
        if data.minimum_selling_price is not None:
            repo.add_minimum_price(db, created.id, data.minimum_selling_price)
        log_audit(db, user_id=user_id or 0, action="create", entity_type=ENTITY, entity_id=created.id,
                  changes={"name": created.name, "item_code": created.item_code})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _duplicate_error(exc, UNIQUE_MESSAGES, "A material with this name or item code already exists.")
    db.refresh(created)
    return _decorate(db, [created])[0]


def update_material(db: Session, material_id: int, data: schemas.MaterialUpdate, user_id: int) -> Material:
    current = _lock_row(db, Material, material_id)
    if not current:
        raise _not_found(material_id)
    ensure_not_stale(current.updated_at, data.expected_updated_at, f"Material '{current.name}'", data.expected_version)

    if data.name:
        existing = repo.get_by_name(db, data.name)
        if existing and existing.id != material_id:
            raise _bad(f"Material with name '{data.name}' already exists")

    new_cost = data.cost_price if data.cost_price is not None else current.cost_price
    new_selling = data.selling_price if data.selling_price is not None else current.selling_price
    new_website = data.website_price if data.website_price is not None else current.website_price
    _check_prices(new_cost, new_selling, new_website)

    current_min = repo.current_minimum_price(db, material_id)
    current_min_value = current_min.minimum_price if current_min else None
    min_changed = data.minimum_selling_price is not None and (
        current_min_value is None or float(current_min_value) != float(data.minimum_selling_price)
    )
    cost_changed = data.cost_price is not None and float(data.cost_price) != float(current.cost_price or 0)
    selling_changed = data.selling_price is not None and (
        current.selling_price is None or float(data.selling_price) != float(current.selling_price)
    )
    if cost_changed or min_changed or selling_changed:
        effective_min = data.minimum_selling_price if data.minimum_selling_price is not None else current_min_value
        _validate_minimum_price(effective_min, new_cost, new_selling)

    submitted = data.model_fields_set
    if "website_active" in submitted or "website_price" in submitted:
        site_active = data.website_active if data.website_active is not None else current.website_active
        if site_active and not new_website:
            raise _bad("Website price is required when the material is active on the website.")

    # Only a changed category/brand has to be active.
    _require_active_refs(
        db,
        data.category_id if data.category_id not in (None, current.category_id) else None,
        data.items_brand_id if data.items_brand_id not in (None, current.items_brand_id) else None,
    )

    fields = data.model_dump(exclude_unset=True, exclude=schemas.NON_COLUMN_UPDATE_FIELDS)
    before = {f: getattr(current, f) for f in fields}
    if min_changed:
        fields["minimum_selling_price"] = data.minimum_selling_price
        before["minimum_selling_price"] = current_min_value
    try:
        updated = repo.update(db, current, data)
        if min_changed:
            repo.add_minimum_price(db, material_id, data.minimum_selling_price)
            _touch(updated)  # the minimum lives in its own table; keep the stale check meaningful
        changes = diff_changes(before, fields)
        if changes:
            log_audit(db, user_id=user_id or 0, action="update", entity_type=ENTITY, entity_id=material_id, changes=changes)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _duplicate_error(exc, UNIQUE_MESSAGES, "A material with this name already exists.")
    db.refresh(updated)
    return _decorate(db, [updated])[0]


def set_image(db: Session, material_id: int, new_path: Optional[str], user_id: Optional[int]) -> Material:
    """Same approach as ProductService._set_image: row lock, direct UPDATE that
    leaves updated_at alone (no false stale-check conflicts), audit row, and
    cleanup of the replaced file."""
    from app.common.file_storage import delete_file

    material = _lock_row(db, Material, material_id)
    if not material:
        db.rollback()
        if new_path:
            delete_file(new_path)
        raise _not_found(material_id)
    old_path = material.image_url
    db.query(Material).filter(Material.id == material_id).update(
        {"image_url": new_path, "updated_at": Material.updated_at}, synchronize_session=False,
    )
    changes = diff_changes({"image_url": old_path}, {"image_url": new_path})
    if changes:
        log_audit(db, user_id=user_id or 0, action="update", entity_type=ENTITY, entity_id=material_id, changes=changes)
    db.commit()
    db.refresh(material)
    if old_path and old_path != new_path and not old_path.startswith("http"):
        delete_file(old_path)
    return _decorate(db, [material])[0]


# ---- material categories --------------------------------------------------------

def _category_or_404(db: Session, category_id: int) -> MaterialCategory:
    row = repo.get_category(db, category_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Category with id {category_id} not found")
    return row


def get_category(db: Session, category_id: int) -> MaterialCategory:
    row = _category_or_404(db, category_id)
    _attach_user_names(db, [row])
    return row


def list_categories(db: Session, skip: int, limit: int, active_only: bool) -> List[MaterialCategory]:
    rows = repo.list_categories(db, skip, limit, active_only)
    _attach_user_names(db, rows)
    return rows


def categories_page(db: Session, page: int, size: int, **filters) -> dict:
    rows, total = repo.categories_page(db, page=page, size=size, **filters)
    _attach_user_names(db, rows)
    return {"items": rows, "total": total, "page": page, "size": size, "pages": -(-total // size)}


def _duplicate_category(name: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Category with name '{name}' already exists")


def create_category(db: Session, data: schemas.MaterialCategoryCreate, user_id: int) -> MaterialCategory:
    if repo.get_category_by_name(db, data.name):
        raise _duplicate_category(data.name)
    try:
        created = repo.create_category(db, data)
        log_audit(db, user_id=user_id or 0, action="create", entity_type=CATEGORY_ENTITY, entity_id=created.id,
                  changes={"name": created.name, "category_code": created.category_code})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _duplicate_error(exc, CATEGORY_UNIQUE_MESSAGES, f"Category with name '{data.name}' already exists")
    db.refresh(created)
    _attach_user_names(db, [created])
    return created


def update_category(db: Session, category_id: int, data: schemas.MaterialCategoryUpdate, user_id: int) -> MaterialCategory:
    current = _lock_row(db, MaterialCategory, category_id)
    if not current:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Category with id {category_id} not found")
    ensure_not_stale(current.updated_at, data.expected_updated_at, f"Category '{current.name}'", data.expected_version)
    if data.name:
        existing = repo.get_category_by_name(db, data.name)
        if existing and existing.id != category_id:
            raise _duplicate_category(data.name)
    # An in-use category stays active: active materials must be moved or deactivated first.
    if data.active is False and current.active:
        count = db.query(Material.id).filter(Material.category_id == category_id, Material.active == True).count()  # noqa: E712
        if count:
            raise _bad(f"{count} active material(s) use this category. Move or deactivate them before deactivating the category.")

    fields = data.model_dump(exclude_unset=True, exclude=schemas.NON_COLUMN_UPDATE_FIELDS)
    before = {f: getattr(current, f) for f in fields}
    try:
        updated = repo.update_category(db, current, data)
        changes = diff_changes(before, fields)
        if changes:
            log_audit(db, user_id=user_id or 0, action="update", entity_type=CATEGORY_ENTITY, entity_id=category_id, changes=changes)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _duplicate_error(exc, CATEGORY_UNIQUE_MESSAGES, "A category with this name or code already exists.")
    db.refresh(updated)
    _attach_user_names(db, [updated])
    return updated


# ---- minimum prices -------------------------------------------------------------

def minimum_price_history(db: Session, material_id: int) -> List[MaterialMinimumPrice]:
    _get_or_404(db, material_id)
    return repo.minimum_prices(db, material_id)


def current_minimum_price(db: Session, material_id: int) -> Optional[MaterialMinimumPrice]:
    _get_or_404(db, material_id)
    return repo.current_minimum_price(db, material_id)


def set_minimum_price(db: Session, material_id: int, minimum_price: float) -> MaterialMinimumPrice:
    material = _lock_row(db, Material, material_id)
    if not material:
        raise _not_found(material_id)
    _validate_minimum_price(minimum_price, material.cost_price, material.selling_price)
    row = repo.add_minimum_price(db, material_id, minimum_price)
    _touch(material)
    db.commit()
    db.refresh(row)
    return row


def delete_minimum_price(db: Session, price_id: int) -> dict:
    row = db.query(MaterialMinimumPrice).filter(MaterialMinimumPrice.id == price_id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Minimum price with id {price_id} not found")
    material = _lock_row(db, Material, row.material_id)
    db.delete(row)
    if material:
        _touch(material)
    db.commit()
    return {"message": "Minimum price deleted successfully"}


# ---- supplier links ---------------------------------------------------------------

def _commit_link(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if not is_unique_violation(exc):
            raise _bad(integrity_error_detail(exc))
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This material was changed by someone else at the same time "
                   "(duplicate supplier or preferred supplier). Refresh and try again.",
        )


def list_suppliers(db: Session, material_id: int) -> List[MaterialSupplier]:
    _get_or_404(db, material_id)
    return repo.stamp_link_display_fields(db, repo.supplier_links(db, material_id))


def add_supplier(db: Session, material_id: int, data: schemas.MaterialSupplierCreate) -> MaterialSupplier:
    from app.modules.purchasing.models import Supplier

    # Lock the material: serializes concurrent "make preferred" requests.
    if not _lock_row(db, Material, material_id):
        raise _not_found(material_id)
    if not db.query(Supplier.id).filter(Supplier.id == data.supplier_id).first():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier with id {data.supplier_id} not found")
    exists = db.query(MaterialSupplier.id).filter(
        MaterialSupplier.supplier_id == data.supplier_id, MaterialSupplier.material_id == material_id
    ).first()
    if exists:
        raise _bad("This material is already mapped to this supplier")
    if data.is_preferred:
        repo.clear_preferred(db, material_id)
    link = MaterialSupplier(material_id=material_id, **data.model_dump())
    db.add(link)
    _commit_link(db)
    db.refresh(link)
    return repo.stamp_link_display_fields(db, [link])[0]


def update_supplier(db: Session, material_id: int, link_id: int, data: schemas.MaterialSupplierUpdate) -> MaterialSupplier:
    if not _lock_row(db, Material, material_id):
        raise _not_found(material_id)
    link = db.query(MaterialSupplier).filter(MaterialSupplier.id == link_id).first()
    if not link or link.material_id != material_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Material supplier with id {link_id} not found for this material",
        )
    values = data.model_dump(exclude_unset=True)
    if values.get("is_preferred"):
        repo.clear_preferred(db, material_id, exclude_id=link.id)
    for field, value in values.items():
        setattr(link, field, value)
    _commit_link(db)
    db.refresh(link)
    return repo.stamp_link_display_fields(db, [link])[0]
