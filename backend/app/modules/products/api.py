from typing import Annotated, List, Literal, Optional

from app.auth.models import User
from app.auth.rbac import Permissions, require_any_permission, require_permission
from app.db.session import get_db
from app.modules.products import schemas, service
from app.modules.purchasing.schemas import SupplierProduct as SupplierProductSchema
from app.utils.csv_export import csv_safe
from fastapi import APIRouter, Depends, File, Path, Query, UploadFile, status
from sqlalchemy.orm import Session

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
ProductId = Annotated[int, Path(ge=1, le=2_147_483_647)]
CategoryId = ProductId
BrandId = ProductId
PriceId = ProductId

router = APIRouter()


@router.get(
    "/products/",
    response_model=List[schemas.Product],
    summary="List All Products",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def list_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    return service.product_service.get_all_products(db, skip, limit, active_only)


@router.get(
    "/products/search",
    response_model=List[schemas.Product],
    summary="Search Products",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def search_products(
    q: str = Query(..., min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    return service.product_service.search_products(db, q, skip, limit)


@router.get(
    "/products/paged",
    response_model=schemas.Page[schemas.Product],
    summary="Paged list (server-side search, filter, sort)",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def list_products(
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
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    return service.product_service.products_page(
        db, page, size, q=q, active=active, category_id=category_id, brand_id=brand_id, supplier_id=supplier_id, sort_by=sort_by, order=order
    )


@router.get(
    "/products/export-csv",
    summary="Export Products to CSV",
)
def export_products_csv(
    skip: int = Query(0, ge=0),
    limit: int = Query(100000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    products = service.product_service.get_all_products(db, skip, limit, active_only)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "Item Code",
            "Name",
            "Model",
            "Item Type",
            "Description",
            "Cost Price",
            "Selling Price",
            "Website Price",
            "Active",
            "Website Active",
            "Added Date",
            "Created At",
            "Updated At",
        ]
    )
    for p in products:
        writer.writerow(
            [
                csv_safe(p.item_code),
                csv_safe(p.name),
                csv_safe(p.model),
                csv_safe(p.item_type),
                csv_safe(p.description),
                p.cost_price or 0,
                p.selling_price or 0,
                p.website_price or 0,
                "Yes" if p.active else "No",
                "Yes" if p.website_active else "No",
                p.added_date or "",
                p.created_at.isoformat() if getattr(p, "created_at", None) else "",
                p.updated_at.isoformat() if getattr(p, "updated_at", None) else "",
            ]
        )
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=products.csv"
    return response


@router.get(
    "/products/{product_id}",
    response_model=schemas.Product,
    summary="Get Product by ID",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def get_product(
    product_id: ProductId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    return service.product_service.get_product(db, product_id)


@router.get(
    "/products/{product_id}/suppliers",
    response_model=List[SupplierProductSchema],
    summary="List Suppliers For Product",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def list_product_suppliers(
    product_id: ProductId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    """Read-only reciprocal view of the approved-vendor mapping — which
    suppliers can supply this product, and at what cost/lead time."""
    from app.modules.purchasing.service import SupplierProductService

    return SupplierProductService(db).list_by_product(product_id)


@router.post(
    "/products/",
    response_model=schemas.Product,
    status_code=status.HTTP_201_CREATED,
    summary="Create Product",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_CREATE))],
)
def create_product(
    product: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_CREATE)),
):
    return service.product_service.create_product(db, product, current_user.id)


@router.put(
    "/products/{product_id}",
    response_model=schemas.Product,
    summary="Update Product",
)
def update_product(
    product_id: ProductId,
    product: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_any_permission(Permissions.PRODUCT_CREATE, Permissions.PRODUCT_UPDATE)
    ),
):
    return service.product_service.update_product(
        db, product_id, product, current_user.id
    )


@router.post(
    "/products/{product_id}/image",
    response_model=schemas.Product,
    summary="Upload Product Image",
)
def upload_product_image(
    product_id: ProductId,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_any_permission(Permissions.PRODUCT_CREATE, Permissions.PRODUCT_UPDATE)
    ),
):
    from app.common.file_storage import save_image

    relative_path = save_image(file, subdir="products")
    return service.product_service.update_image(db, product_id, relative_path, user_id=current_user.id)


@router.delete(
    "/products/{product_id}/image",
    response_model=schemas.Product,
    summary="Remove Product Image",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def remove_product_image(
    product_id: ProductId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return service.product_service.remove_image(db, product_id, user_id=current_user.id)


@router.get(
    "/categories/",
    response_model=List[schemas.Category],
    summary="List All Categories",
    dependencies=[Depends(require_permission(*Permissions.CATEGORY_VIEW))],
)
def list_categories(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CATEGORY_VIEW)),
):
    return service.category_service.get_all_categories(db, skip, limit, active_only)


@router.get(
    "/categories/paged",
    response_model=schemas.Page[schemas.Category],
    summary="Paged list (server-side search, filter, sort)",
    dependencies=[Depends(require_permission(*Permissions.CATEGORY_VIEW))],
)
def list_categories(
    page: int = Query(0, ge=0, le=1_000_000),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=255),
    active: Optional[bool] = Query(None),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CATEGORY_VIEW)),
):
    return service.category_service.categories_page(
        db, page, size, q=q, active=active, sort_by=sort_by, order=order
    )


@router.get(
    "/categories/{category_id}",
    response_model=schemas.Category,
    summary="Get Category by ID",
    dependencies=[Depends(require_permission(*Permissions.CATEGORY_VIEW))],
)
def get_category(
    category_id: CategoryId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CATEGORY_VIEW)),
):
    return service.category_service.get_category(db, category_id)


@router.post(
    "/categories/",
    response_model=schemas.Category,
    status_code=status.HTTP_201_CREATED,
    summary="Create Category",
    dependencies=[Depends(require_permission(*Permissions.CATEGORY_CREATE))],
)
def create_category(
    category: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CATEGORY_CREATE)),
):
    return service.category_service.create_category(db, category, current_user.id)


@router.put(
    "/categories/{category_id}",
    response_model=schemas.Category,
    summary="Update Category",
    dependencies=[Depends(require_permission(*Permissions.CATEGORY_UPDATE))],
)
def update_category(
    category_id: CategoryId,
    category: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.CATEGORY_UPDATE)),
):
    return service.category_service.update_category(
        db, category_id, category, current_user.id
    )


@router.get(
    "/brands/",
    response_model=List[schemas.Brand],
    summary="List All Brands",
    dependencies=[Depends(require_permission(*Permissions.BRAND_VIEW))],
)
def list_brands(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BRAND_VIEW)),
):
    return service.brand_service.get_all_brands(db, skip, limit, active_only)


@router.get(
    "/brands/paged",
    response_model=schemas.Page[schemas.Brand],
    summary="Paged list (server-side search, filter, sort)",
    dependencies=[Depends(require_permission(*Permissions.BRAND_VIEW))],
)
def list_brands(
    page: int = Query(0, ge=0, le=1_000_000),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=255),
    active: Optional[bool] = Query(None),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BRAND_VIEW)),
):
    return service.brand_service.brands_page(
        db, page, size, q=q, active=active, sort_by=sort_by, order=order
    )


@router.get(
    "/brands/{brand_id}",
    response_model=schemas.Brand,
    summary="Get Brand",
    dependencies=[Depends(require_permission(*Permissions.BRAND_VIEW))],
)
def get_brand(
    brand_id: BrandId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BRAND_VIEW)),
):
    return service.brand_service.get_brand(db, brand_id)


@router.post(
    "/brands/",
    response_model=schemas.Brand,
    status_code=status.HTTP_201_CREATED,
    summary="Create Brand",
    dependencies=[Depends(require_permission(*Permissions.BRAND_CREATE))],
)
def create_brand(
    brand: schemas.BrandCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BRAND_CREATE)),
):
    return service.brand_service.create_brand(db, brand, user_id=current_user.id)


@router.put(
    "/brands/{brand_id}",
    response_model=schemas.Brand,
    summary="Update Brand",
    dependencies=[Depends(require_permission(*Permissions.BRAND_UPDATE))],
)
def update_brand(
    brand_id: BrandId,
    brand: schemas.BrandUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.BRAND_UPDATE)),
):
    return service.brand_service.update_brand(db, brand_id, brand, user_id=current_user.id)


@router.get(
    "/products/{product_id}/minimum-prices",
    response_model=List[schemas.MinimumPrice],
    summary="Get Product Minimum Price History",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def get_product_minimum_price_history(
    product_id: ProductId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    return service.minimum_price_service.get_product_price_history(db, product_id)


@router.get(
    "/products/{product_id}/minimum-prices/current",
    response_model=schemas.MinimumPrice,
    summary="Get Current Minimum Price",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def get_current_minimum_price(
    product_id: ProductId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    price = service.minimum_price_service.get_current_minimum_price(db, product_id)
    if not price:
        from fastapi import HTTPException

        raise HTTPException(
            status_code=404, detail="No minimum price set for this product"
        )
    return price


@router.post(
    "/products/{product_id}/minimum-prices",
    response_model=schemas.MinimumPrice,
    status_code=status.HTTP_201_CREATED,
    summary="Set Product Minimum Price",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def set_product_minimum_price(
    product_id: ProductId,
    price_data: schemas.MinimumPriceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return service.minimum_price_service.set_minimum_price(
        db, product_id, price_data.minimum_price
    )


@router.delete(
    "/minimum-prices/{price_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Minimum Price",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_DELETE))],
)
def delete_minimum_price(
    price_id: PriceId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_DELETE)),
):
    return service.minimum_price_service.delete_minimum_price(db, price_id)


import csv
import io

from fastapi.responses import StreamingResponse
