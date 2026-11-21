from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Path
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.products.design_brief_schemas import DesignBriefConfirm, DesignBriefReject
from app.modules.products.design_detail_schemas import DesignDetailOut, DesignDetailSave
from app.modules.products.design_detail_service import design_detail_service

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
ProductId = Annotated[int, Path(ge=1, le=2_147_483_647)]

router = APIRouter()

can_view = require_permission(*Permissions.PRODUCT_VIEW)
can_update = require_permission(*Permissions.PRODUCT_UPDATE)


@router.get(
    "/products/{product_id}/design-detail",
    response_model=Optional[DesignDetailOut],
    summary="Get a Product's Design Detail (null until first saved)",
)
def get_design_detail(product_id: ProductId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return design_detail_service.get(db, product_id)


@router.put(
    "/products/{product_id}/design-detail",
    response_model=DesignDetailOut,
    summary="Save a Product's Design Detail (brief confirmed; detail draft or rejected)",
)
def save_design_detail(
    product_id: ProductId,
    data: DesignDetailSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return design_detail_service.save(db, product_id, data, current_user.id)


@router.post(
    "/products/{product_id}/design-detail/confirm",
    response_model=DesignDetailOut,
    summary="Confirm a Design Detail (locks it permanently)",
)
def confirm_design_detail(
    product_id: ProductId,
    data: DesignBriefConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return design_detail_service.confirm(db, product_id, data, current_user.id)


@router.post(
    "/products/{product_id}/design-detail/reject",
    response_model=DesignDetailOut,
    summary="Reject a Design Detail (reason required)",
)
def reject_design_detail(
    product_id: ProductId,
    data: DesignBriefReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return design_detail_service.reject(db, product_id, data, current_user.id)
