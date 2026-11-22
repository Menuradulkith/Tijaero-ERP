from typing import Annotated, List

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.common import related_history
from app.db.session import get_db
from app.modules.products.price_tier_schemas import PriceTierCreate, PriceTierOut, PriceTierUpdate
from app.modules.products.price_tier_models import ProductPriceTier
from app.modules.products.price_tier_service import price_tier_service

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
ProductId = Annotated[int, Path(ge=1, le=2_147_483_647)]
TierId = ProductId

router = APIRouter()


def _tier_label(r) -> str:
    return f"Price tier: {getattr(r, 'remark', None) or 'Selling ' + str(getattr(r, 'selling_price', ''))}"


def _logged(db, user, action, product_id, run, row_id=None):
    """Run a price-tier change and log it in the product's history."""
    return related_history.logged(db, user, action, "product", product_id, ProductPriceTier, run, _tier_label,
                                  row_id=row_id, skip=("product_id",))


@router.get(
    "/products/{product_id}/price-tiers",
    response_model=List[PriceTierOut],
    summary="List Price Tiers for a Product",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_VIEW))],
)
def list_price_tiers(
    product_id: ProductId,
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
    product_id: ProductId,
    tier_id: TierId,
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
    product_id: ProductId,
    data: PriceTierCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return _logged(db, current_user, "price_tier_added", product_id,
                   lambda: price_tier_service.create_tier(db, product_id, data, current_user.id))


@router.put(
    "/products/{product_id}/price-tiers/{tier_id}",
    response_model=PriceTierOut,
    summary="Update a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def update_price_tier(
    product_id: ProductId,
    tier_id: TierId,
    data: PriceTierUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return _logged(db, current_user, "price_tier_updated", product_id,
                   lambda: price_tier_service.update_tier(db, product_id, tier_id, data, current_user.id), row_id=tier_id)


@router.patch(
    "/products/{product_id}/price-tiers/{tier_id}/toggle",
    response_model=PriceTierOut,
    summary="Toggle Active/Inactive on a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def toggle_price_tier(
    product_id: ProductId,
    tier_id: TierId,
    is_active: bool,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    return _logged(db, current_user, "price_tier_updated", product_id,
                   lambda: price_tier_service.toggle_active(db, product_id, tier_id, is_active, current_user.id), row_id=tier_id)


@router.delete(
    "/products/{product_id}/price-tiers/{tier_id}",
    summary="Delete a Price Tier",
    dependencies=[Depends(require_permission(*Permissions.PRODUCT_UPDATE))],
)
def delete_price_tier(
    product_id: ProductId,
    tier_id: TierId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.PRODUCT_UPDATE)),
):
    before = related_history.snap(db, ProductPriceTier, tier_id, skip=("product_id",))
    result = price_tier_service.delete_tier(db, product_id, tier_id)
    if before:
        from types import SimpleNamespace
        related_history.record(db, current_user, "price_tier_removed", [("product", product_id)],
                               _tier_label(SimpleNamespace(**before)), before, None)
    return result
