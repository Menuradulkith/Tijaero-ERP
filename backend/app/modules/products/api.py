from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from app.modules.products import schemas, service

router = APIRouter()

@router.get(
    "/products/",
    response_model=List[schemas.Product],
    summary="List All Products",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def list_products(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    active_only: bool = Query(True),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.product_service.get_all_products(db, skip, limit, active_only)

@router.get(
    "/products/search",
    response_model=List[schemas.Product],
    summary="Search Products",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def search_products(
    q: str = Query(..., min_length=1),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.product_service.search_products(db, q, skip, limit)

@router.get(
    "/products/{product_id}",
    response_model=schemas.Product,
    summary="Get Product by ID",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def get_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.product_service.get_product(db, product_id)

@router.post(
    "/products/",
    response_model=schemas.Product,
    status_code=status.HTTP_201_CREATED,
    summary="Create Product",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_CREATE))]
)
def create_product(
    product: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_CREATE))
):
    return service.product_service.create_product(db, product, current_user.id)

@router.put(
    "/products/{product_id}",
    response_model=schemas.Product,
    summary="Update Product",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_UPDATE))]
)
def update_product(
    product_id: int,
    product: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_UPDATE))
):
    return service.product_service.update_product(db, product_id, product, current_user.id)

@router.delete(
    "/products/{product_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Product",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_DELETE))]
)
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_DELETE))
):
    return service.product_service.delete_product(db, product_id)

@router.get(
    "/categories/",
    response_model=List[schemas.Category],
    summary="List All Categories",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def list_categories(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.category_service.get_all_categories(db, skip, limit, active_only)

@router.get(
    "/categories/{category_id}",
    response_model=schemas.Category,
    summary="Get Category by ID",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def get_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.category_service.get_category(db, category_id)

@router.post(
    "/categories/",
    response_model=schemas.Category,
    status_code=status.HTTP_201_CREATED,
    summary="Create Category",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_CREATE))]
)
def create_category(
    category: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_CREATE))
):
    return service.category_service.create_category(db, category, current_user.id)

@router.put(
    "/categories/{category_id}",
    response_model=schemas.Category,
    summary="Update Category",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_UPDATE))]
)
def update_category(
    category_id: int,
    category: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_UPDATE))
):
    return service.category_service.update_category(db, category_id, category, current_user.id)

@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Category",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_DELETE))]
)
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_DELETE))
):
    return service.category_service.delete_category(db, category_id)

@router.get(
    "/brands/",
    response_model=List[schemas.Brand],
    summary="List All Brands",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def list_brands(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.brand_service.get_all_brands(db, skip, limit)

@router.get(
    "/brands/{brand_id}",
    response_model=schemas.Brand,
    summary="Get Brand",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def get_brand(
    brand_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.brand_service.get_brand(db, brand_id)

@router.post(
    "/brands/",
    response_model=schemas.Brand,
    status_code=status.HTTP_201_CREATED,
    summary="Create Brand",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_CREATE))]
)
def create_brand(
    brand: schemas.BrandCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_CREATE))
):
    return service.brand_service.create_brand(db, brand)

@router.put(
    "/brands/{brand_id}",
    response_model=schemas.Brand,
    summary="Update Brand",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_UPDATE))]
)
def update_brand(
    brand_id: int,
    brand: schemas.BrandUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_UPDATE))
):
    return service.brand_service.update_brand(db, brand_id, brand)

@router.delete(
    "/brands/{brand_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Brand",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_DELETE))]
)
def delete_brand(
    brand_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_DELETE))
):
    return service.brand_service.delete_brand(db, brand_id)

@router.get(
    "/products/{product_id}/minimum-prices",
    response_model=List[schemas.MinimumPrice],
    summary="Get Product Minimum Price History",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def get_product_minimum_price_history(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    return service.minimum_price_service.get_product_price_history(db, product_id)

@router.get(
    "/products/{product_id}/minimum-prices/current",
    response_model=schemas.MinimumPrice,
    summary="Get Current Minimum Price",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def get_current_minimum_price(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    price = service.minimum_price_service.get_current_minimum_price(db, product_id)
    if not price:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="No minimum price set for this product")
    return price

@router.post(
    "/products/{product_id}/minimum-prices",
    response_model=schemas.MinimumPrice,
    status_code=status.HTTP_201_CREATED,
    summary="Set Product Minimum Price",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_UPDATE))]
)
def set_product_minimum_price(
    product_id: int,
    price_data: schemas.MinimumPriceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_UPDATE))
):
    return service.minimum_price_service.set_minimum_price(db, product_id, price_data.minimum_price)

@router.delete(
    "/minimum-prices/{price_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Minimum Price",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_DELETE))]
)
def delete_minimum_price(
    price_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_DELETE))
):
    return service.minimum_price_service.delete_minimum_price(db, price_id)
