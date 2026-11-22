"""Material master API (/materials). Mirrors the product catalog endpoints
under /inventory/products so the same UI shapes work for both."""
import csv
import io
from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Path, Query, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import Permissions, require_any_permission, require_permission
from app.common import related_history
from app.db.session import get_db
from app.modules.materials import schemas, service
from app.modules.materials.models import MaterialMinimumPrice, MaterialSupplier
from app.utils.csv_export import csv_safe

RowId = Annotated[int, Path(ge=1, le=2_147_483_647)]

router = APIRouter(prefix="/materials", tags=["materials"])

can_view = require_permission(*Permissions.MATERIAL_VIEW)
can_create = require_permission(*Permissions.MATERIAL_CREATE)
can_edit = require_any_permission(Permissions.MATERIAL_CREATE, Permissions.MATERIAL_UPDATE)
can_update = require_permission(*Permissions.MATERIAL_UPDATE)
can_delete = require_permission(*Permissions.MATERIAL_DELETE)


@router.get("/items/", response_model=List[schemas.Material], summary="List All Materials")
def list_materials(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    return service.list_materials(db, skip, limit, active_only)


@router.get("/items/search", response_model=List[schemas.Material], summary="Search Materials")
def search_materials(
    q: str = Query(..., min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    return service.search_materials(db, q, skip, limit)


@router.get("/items/paged", response_model=schemas.Page[schemas.Material], summary="Paged list (server-side search, filter, sort)")
def page_materials(
    page: int = Query(0, ge=0, le=1_000_000),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=255),
    active: Optional[bool] = Query(None),
    category_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    brand_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    supplier_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    return service.materials_page(
        db, page, size, q=q, active=active, category_id=category_id, brand_id=brand_id,
        supplier_id=supplier_id, sort_by=sort_by, order=order,
    )


@router.get("/items/export-csv", summary="Export Materials to CSV")
def export_materials_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    rows = service.list_materials(db, skip, limit, active_only)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "Item Code", "Name", "Model", "Item Type", "Description", "Cost Price", "Selling Price",
        "Website Price", "Active", "Website Active", "Added Date", "Created At", "Updated At",
    ])
    for m in rows:
        writer.writerow([
            csv_safe(m.item_code), csv_safe(m.name), csv_safe(m.model), csv_safe(m.item_type),
            csv_safe(m.description), m.cost_price or 0, m.selling_price or 0, m.website_price or 0,
            "Yes" if m.active else "No", "Yes" if m.website_active else "No", m.added_date or "",
            m.created_at.isoformat() if m.created_at else "", m.updated_at.isoformat() if m.updated_at else "",
        ])
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=materials.csv"
    return response


@router.get("/items/{material_id}", response_model=schemas.Material, summary="Get Material by ID")
def get_material(material_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return service.get_material(db, material_id)


@router.post("/items/", response_model=schemas.Material, status_code=status.HTTP_201_CREATED, summary="Create Material")
def create_material(data: schemas.MaterialCreate, db: Session = Depends(get_db), current_user: User = Depends(can_create)):
    return service.create_material(db, data, current_user.id)


@router.put("/items/{material_id}", response_model=schemas.Material, summary="Update Material")
def update_material(
    material_id: RowId, data: schemas.MaterialUpdate, db: Session = Depends(get_db), current_user: User = Depends(can_edit),
):
    return service.update_material(db, material_id, data, current_user.id)


@router.post("/items/{material_id}/image", response_model=schemas.Material, summary="Upload Material Image")
def upload_material_image(
    material_id: RowId, file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(can_edit),
):
    from app.common.file_storage import save_image

    relative_path = save_image(file, subdir="materials")
    return service.set_image(db, material_id, relative_path, current_user.id)


@router.delete("/items/{material_id}/image", response_model=schemas.Material, summary="Remove Material Image")
def remove_material_image(material_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_update)):
    return service.set_image(db, material_id, None, current_user.id)


@router.get("/items/{material_id}/minimum-prices", response_model=List[schemas.MaterialMinimumPrice],
            summary="Get Material Minimum Price History")
def minimum_price_history(material_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return service.minimum_price_history(db, material_id)


@router.get("/items/{material_id}/minimum-prices/current", response_model=Optional[schemas.MaterialMinimumPrice],
            summary="Get Current Minimum Price")
def current_minimum_price(material_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    """Returns null when the material has no minimum price yet."""
    return service.current_minimum_price(db, material_id)


@router.post("/items/{material_id}/minimum-prices", response_model=schemas.MaterialMinimumPrice,
             status_code=status.HTTP_201_CREATED, summary="Set Material Minimum Price")
def set_minimum_price(
    material_id: RowId, data: schemas.MinimumPriceCreate, db: Session = Depends(get_db), current_user: User = Depends(can_update),
):
    current = service.repo.current_minimum_price(db, material_id)
    before = {"minimum_price": current.minimum_price} if current else None
    result = service.set_minimum_price(db, material_id, data.minimum_price)
    related_history.record(db, current_user, "minimum_price_set", [("material", material_id)], "Minimum selling price",
                           before, {"minimum_price": data.minimum_price})
    return result


@router.delete("/minimum-prices/{price_id}", summary="Delete Material Minimum Price")
def delete_minimum_price(price_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_delete)):
    row = db.get(MaterialMinimumPrice, price_id)
    gone = (row.material_id, row.minimum_price) if row else None
    result = service.delete_minimum_price(db, price_id)
    if gone:
        related_history.record(db, current_user, "minimum_price_removed", [("material", gone[0])], "Minimum selling price",
                               {"minimum_price": gone[1]}, None)
    return result


@router.get("/items/{material_id}/suppliers", response_model=List[schemas.MaterialSupplier],
            summary="List Suppliers For Material")
def list_material_suppliers(material_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return service.list_suppliers(db, material_id)


@router.post("/items/{material_id}/suppliers", response_model=schemas.MaterialSupplier,
             status_code=status.HTTP_201_CREATED, summary="Link Supplier To Material")
def add_material_supplier(
    material_id: RowId, data: schemas.MaterialSupplierCreate, db: Session = Depends(get_db), current_user: User = Depends(can_edit),
):
    return related_history.logged(
        db, current_user, "supplier_link_added", "material", material_id, MaterialSupplier,
        lambda: service.add_supplier(db, material_id, data),
        lambda r: f"Supplier: {related_history.label(db, 'supplier', r.supplier_id)}",
        other=lambda r: ("supplier", r.supplier_id, f"Item: {related_history.label(db, 'materials', material_id)}"),
        skip=("material_id",))


@router.put("/items/{material_id}/suppliers/{link_id}", response_model=schemas.MaterialSupplier,
            summary="Update Material Supplier Link")
def update_material_supplier(
    material_id: RowId, link_id: RowId, data: schemas.MaterialSupplierUpdate,
    db: Session = Depends(get_db), current_user: User = Depends(can_edit),
):
    return related_history.logged(
        db, current_user, "supplier_link_updated", "material", material_id, MaterialSupplier,
        lambda: service.update_supplier(db, material_id, link_id, data),
        lambda r: f"Supplier: {related_history.label(db, 'supplier', r.supplier_id)}", row_id=link_id,
        other=lambda r: ("supplier", r.supplier_id, f"Item: {related_history.label(db, 'materials', material_id)}"),
        skip=("material_id",))


# ---- material categories (own list; mirrors /inventory/categories) ----------------

@router.get("/categories/", response_model=List[schemas.MaterialCategory], summary="List Material Categories")
def list_material_categories(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    return service.list_categories(db, skip, limit, active_only)


@router.get("/categories/paged", response_model=schemas.Page[schemas.MaterialCategory],
            summary="Paged list (server-side search, filter, sort)")
def page_material_categories(
    page: int = Query(0, ge=0, le=1_000_000),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=255),
    active: Optional[bool] = Query(None),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    return service.categories_page(db, page, size, q=q, active=active, sort_by=sort_by, order=order)


@router.get("/categories/{category_id}", response_model=schemas.MaterialCategory, summary="Get Material Category")
def get_material_category(category_id: RowId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return service.get_category(db, category_id)


@router.post("/categories/", response_model=schemas.MaterialCategory, status_code=status.HTTP_201_CREATED,
             summary="Create Material Category")
def create_material_category(
    data: schemas.MaterialCategoryCreate, db: Session = Depends(get_db), current_user: User = Depends(can_create),
):
    return service.create_category(db, data, current_user.id)


@router.put("/categories/{category_id}", response_model=schemas.MaterialCategory, summary="Update Material Category")
def update_material_category(
    category_id: RowId, data: schemas.MaterialCategoryUpdate, db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return service.update_category(db, category_id, data, current_user.id)
