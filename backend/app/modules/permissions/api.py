"""
Permissions API endpoints
"""

from typing import List

from app.auth import schemas, service
from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from fastapi import APIRouter, Depends, HTTPException, status
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


def _require_superuser(current_user: User = Depends(get_current_active_user)) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only a superuser can add permissions to the catalog",
        )
    return current_user


@router.post(
    "/",
    response_model=schemas.Permission,
    status_code=status.HTTP_201_CREATED,
    summary="Create Permission (superuser only)",
)
def create_permission(
    permission: schemas.PermissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(_require_superuser),
):
    """Add a permission to the catalog. The catalog is normally seeded
    (scripts/seed_permissions.py); only a superuser may extend it at runtime."""
    return service.permission_service.create_permission(db, permission)
