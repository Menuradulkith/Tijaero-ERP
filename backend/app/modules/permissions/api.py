"""
Permissions API endpoints
"""

from typing import List

from app.auth import schemas, service
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

router = APIRouter(prefix="/permissions", tags=["permissions"])


@router.get(
    "/",
    response_model=List[schemas.Permission],
    summary="List All Permissions",
    dependencies=[Depends(require_permission(*Permissions.GROUP_VIEW))],
)
def list_permissions(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_VIEW)),
):
    """Get list of all available permissions."""
    return service.permission_service.get_permissions(db)


@router.post(
    "/",
    response_model=schemas.Permission,
    status_code=status.HTTP_201_CREATED,
    summary="Create Permission",
    dependencies=[Depends(require_permission(*Permissions.GROUP_CREATE))],
)
def create_permission(
    permission: schemas.PermissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.GROUP_CREATE)),
):
    """Create a new permission."""
    return service.permission_service.create_permission(db, permission)
    return service.permission_service.create_permission(db, permission)
