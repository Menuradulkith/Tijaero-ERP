from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.products.design_brief_schemas import (
    DesignBriefConfirm, DesignBriefItemOption, DesignBriefOut, DesignBriefReject, DesignBriefSave,
)
from app.modules.products.design_brief_service import design_brief_service

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
ProductId = Annotated[int, Path(ge=1, le=2_147_483_647)]

router = APIRouter()

can_view = require_permission(*Permissions.PRODUCT_VIEW)
can_update = require_permission(*Permissions.PRODUCT_UPDATE)


@router.get(
    "/design-brief/item-options",
    response_model=List[DesignBriefItemOption],
    summary="Active Item Catalog items for the Design Brief picker",
)
def list_design_brief_item_options(db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return design_brief_service.item_options(db)


@router.get(
    "/products/{product_id}/design-brief",
    response_model=Optional[DesignBriefOut],
    summary="Get a Product's Design Brief (null until first saved)",
)
def get_design_brief(product_id: ProductId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return design_brief_service.get(db, product_id)


@router.put(
    "/products/{product_id}/design-brief",
    response_model=DesignBriefOut,
    summary="Save a Product's Design Brief (draft or rejected only)",
)
def save_design_brief(
    product_id: ProductId,
    data: DesignBriefSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return design_brief_service.save(db, product_id, data, current_user.id)


@router.post(
    "/products/{product_id}/design-brief/confirm",
    response_model=DesignBriefOut,
    summary="Confirm a Design Brief (locks it permanently)",
)
def confirm_design_brief(
    product_id: ProductId,
    data: DesignBriefConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return design_brief_service.confirm(db, product_id, data, current_user.id)


@router.post(
    "/products/{product_id}/design-brief/reject",
    response_model=DesignBriefOut,
    summary="Reject a Design Brief (reason required)",
)
def reject_design_brief(
    product_id: ProductId,
    data: DesignBriefReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return design_brief_service.reject(db, product_id, data, current_user.id)
