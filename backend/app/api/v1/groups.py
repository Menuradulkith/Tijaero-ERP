from typing import List
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.auth.models import User
from app.auth import schemas, service
from app.auth.rbac import require_permission, Permissions

router = APIRouter()

@router.get(
    "/",
    response_model=List[schemas.Group],
    summary="List All Groups",
    dependencies=[Depends(require_permission(*Permissions.GROUP_VIEW))]
)
def list_groups(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_VIEW))
):
    """Get list of all groups/roles with their permissions."""
    return service.group_service.get_groups(db, skip, limit)

@router.get(
    "/{group_id}",
    response_model=schemas.Group,
    summary="Get Group by ID",
    dependencies=[Depends(require_permission(*Permissions.GROUP_VIEW))]
)
def get_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_VIEW))
):
    """Get group information by group ID."""
    return service.group_service.get_group(db, group_id)

@router.post(
    "/",
    response_model=schemas.Group,
    status_code=status.HTTP_201_CREATED,
    summary="Create Group",
    dependencies=[Depends(require_permission(*Permissions.GROUP_CREATE))]
)
def create_group(
    group: schemas.GroupCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_CREATE))
):
    """Create a new group/role with permissions."""
    return service.group_service.create_group(db, group)

@router.put(
    "/{group_id}",
    response_model=schemas.Group,
    summary="Update Group",
    dependencies=[Depends(require_permission(*Permissions.GROUP_UPDATE))]
)
def update_group(
    group_id: int,
    group: schemas.GroupUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_UPDATE))
):
    """Update group information and permissions."""
    return service.group_service.update_group(db, group_id, group)

@router.delete(
    "/{group_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete Group",
    dependencies=[Depends(require_permission(*Permissions.GROUP_DELETE))]
)
def delete_group(
    group_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_DELETE))
):
    """Delete a group by ID."""
    return service.group_service.delete_group(db, group_id)
