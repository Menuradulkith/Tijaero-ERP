"""
Groups/Roles API endpoints
"""

from typing import Annotated, List

from app.auth import schemas, service, user_access
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from fastapi import APIRouter, Depends, Path, Query, status
from sqlalchemy.orm import Session

router = APIRouter(prefix="/groups", tags=["groups"])

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
GroupId = Annotated[int, Path(ge=1, le=2_147_483_647)]


@router.get(
    "/",
    response_model=List[schemas.Group],
    summary="List All Groups",
    dependencies=[Depends(require_permission(*Permissions.GROUP_VIEW))],
)
def list_groups(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_VIEW)),
):
    """Get list of all groups/roles with their permissions."""
    return service.group_service.get_groups(db, skip, limit)


@router.get(
    "/{group_id}",
    response_model=schemas.Group,
    summary="Get Group by ID",
    dependencies=[Depends(require_permission(*Permissions.GROUP_VIEW))],
)
def get_group(
    group_id: GroupId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_VIEW)),
):
    """Get group information by group ID."""
    return service.group_service.get_group(db, group_id)


@router.post(
    "/",
    response_model=schemas.Group,
    status_code=status.HTTP_201_CREATED,
    summary="Create Group",
    dependencies=[Depends(require_permission(*Permissions.GROUP_CREATE))],
)
def create_group(
    group: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_CREATE)),
):
    """Create a new group/role with permissions (only permissions the caller holds)."""
    user_access.assert_can_grant_permissions(
        current_user, user_access.load_permissions(db, group.permission_ids)
    )
    return service.group_service.create_group(db, group, created_by=current_user.id)


@router.put(
    "/{group_id}",
    response_model=schemas.Group,
    summary="Update Group",
    dependencies=[Depends(require_permission(*Permissions.GROUP_UPDATE))],
)
def update_group(
    group_id: GroupId,
    group: schemas.GroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_UPDATE)),
):
    """Update group information and permissions.

    A non-superuser may only change a role whose permissions they fully hold,
    and may only grant permissions they hold themselves."""
    target = service.group_service.get_group(db, group_id)
    user_access.assert_can_edit_role(current_user, target)
    if group.permission_ids is not None:
        user_access.assert_can_grant_permissions(
            current_user, user_access.load_permissions(db, group.permission_ids)
        )
    return service.group_service.update_group(db, group_id, group, updated_by=current_user.id)
