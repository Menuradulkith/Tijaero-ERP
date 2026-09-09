from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.products.price_tier_schemas import PriceTierCreate, PriceTierOut, PriceTierUpdate
from app.modules.products.price_tier_service import price_tier_service

router = APIRouter()


@router.get(
    "/products/{product_id}/price-tiers",
    response_model=List[PriceTierOut],
    summary="List Price Tiers for a Product",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def list_price_tiers(
    product_id: int,
    active_only: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    """
    Returns all price tiers for a product.
    Pass ?active_only=true to get only tiers visible in Quotation/Sales dropdowns.
    """
    return price_tier_service.list_tiers(db, product_id, active_only)


@router.get(
    "/products/{product_id}/price-tiers/{tier_id}",
    response_model=PriceTierOut,
    summary="Get a Single Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def get_price_tier(
    product_id: int,
    tier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_VIEW)),
):
    return price_tier_service.get_tier(db, product_id, tier_id)


@router.post(
    "/products/{product_id}/price-tiers",
    response_model=PriceTierOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def create_price_tier(
    product_id: int,
    data: PriceTierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return price_tier_service.create_tier(db, product_id, data, current_user.id)


@router.put(
    "/products/{product_id}/price-tiers/{tier_id}",
    response_model=PriceTierOut,
    summary="Update a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def update_price_tier(
    product_id: int,
    tier_id: int,
    data: PriceTierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return price_tier_service.update_tier(db, product_id, tier_id, data, current_user.id)


@router.patch(
    "/products/{product_id}/price-tiers/{tier_id}/toggle",
    response_model=PriceTierOut,
    summary="Toggle Active/Inactive on a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def toggle_price_tier(
    product_id: int,
    tier_id: int,
    is_active: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return price_tier_service.toggle_active(db, product_id, tier_id, is_active, current_user.id)


@router.delete(
    "/products/{product_id}/price-tiers/{tier_id}",
    summary="Delete a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def delete_price_tier(
    product_id: int,
    tier_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return price_tier_service.delete_tier(db, product_id, tier_id)
