from typing import Annotated, List, Literal, Optional

from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.products.bom_structure_schemas import (
    BomStructureOut, BomStructurePage, BomStructureSave, BomWorkCenter,
)
from app.modules.products.bom_structure_service import bom_structure_service
from app.modules.products.design_brief_schemas import DesignBriefConfirm, DesignBriefReject

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
ProductId = Annotated[int, Path(ge=1, le=2_147_483_647)]

router = APIRouter()

can_view = require_permission(*Permissions.PRODUCT_VIEW)
can_update = require_permission(*Permissions.PRODUCT_UPDATE)


@router.get(
    "/bom-structures/paged",
    response_model=BomStructurePage,
    summary="Paged list of every product's BOM Structure (search, status filter, sort)",
)
def list_bom_structures(
    page: int = Query(0, ge=0, le=1_000_000),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=255),
    status: Optional[Literal["draft", "confirmed", "rejected"]] = Query(None),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("desc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(can_view),
):
    return bom_structure_service.page(db, page=page, size=size, q=q, status=status, sort_by=sort_by, order=order)


@router.get(
    "/bom-structures/work-centers",
    response_model=List[BomWorkCenter],
    summary="Active Manufacturing work centers for BOM routing steps",
)
def list_bom_work_centers(db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return bom_structure_service.work_centers(db)


@router.get(
    "/products/{product_id}/bom-structure",
    response_model=Optional[BomStructureOut],
    summary="Get a Product's BOM Structure (null until first saved)",
)
def get_bom_structure(product_id: ProductId, db: Session = Depends(get_db), current_user: User = Depends(can_view)):
    return bom_structure_service.get(db, product_id)


@router.put(
    "/products/{product_id}/bom-structure",
    response_model=BomStructureOut,
    summary="Save a Product's BOM Structure (draft or rejected only)",
)
def save_bom_structure(
    product_id: ProductId,
    data: BomStructureSave,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return bom_structure_service.save(db, product_id, data, current_user.id)


@router.post(
    "/products/{product_id}/bom-structure/confirm",
    response_model=BomStructureOut,
    summary="Confirm a BOM Structure (locks it permanently)",
)
def confirm_bom_structure(
    product_id: ProductId,
    data: DesignBriefConfirm,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return bom_structure_service.confirm(db, product_id, data, current_user.id)


@router.post(
    "/products/{product_id}/bom-structure/reject",
    response_model=BomStructureOut,
    summary="Reject a BOM Structure (reason required)",
)
def reject_bom_structure(
    product_id: ProductId,
    data: DesignBriefReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(can_update),
):
    return bom_structure_service.reject(db, product_id, data, current_user.id)
