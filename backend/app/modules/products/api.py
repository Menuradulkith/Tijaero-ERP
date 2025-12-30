from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth.rbac import require_permission, Permissions
from app.modules.products import schemas, service

router = APIRouter()

# Product Endpoints
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
    """Get list of all products with pagination."""
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
    """Search products by name, item code, or model."""
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
    """Get product information by product ID."""
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
    """Create a new product."""
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
    """Update product information."""
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
    """Delete a product by ID."""
    return service.product_service.delete_product(db, product_id)

# Category Endpoints
@router.get(
    "/categories/",
    response_model=List[schemas.Category],
    summary="List All Categories",
    dependencies=[Depends(require_permission(*Permissions.INVENTORY_VIEW))]
)
def list_categories(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.INVENTORY_VIEW))
):
    """Get list of all categories."""
    return service.category_service.get_all_categories(db, skip, limit)

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
    """Get category information by category ID."""
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
    """Create a new category."""
    return service.category_service.create_category(db, category, current_user.id)

# Brand Endpoints
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
    """Get list of all brands."""
    return service.brand_service.get_all_brands(db, skip, limit)

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
    """Create a new brand."""
    return service.brand_service.create_brand(db, brand)
