"""
Users API endpoints
"""

from typing import Annotated, List, Literal, Optional

from app.auth import schemas, service, user_access
from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from fastapi import APIRouter, Depends, File, Path, Query, Security, UploadFile, status
from sqlalchemy.orm import Session

router = APIRouter(prefix="/users", tags=["users"])

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
UserId = Annotated[int, Path(ge=1, le=2_147_483_647)]


@router.get(
    "/me",
    response_model=schemas.User,
    summary="Get Current User",
    description="Retrieve the currently authenticated user's information",
    responses={
        200: {"description": "Current user information"},
        401: {"description": "Not authenticated"},
    },
    dependencies=[Security(get_current_active_user)],
)
def read_users_me(current_user: User = Depends(get_current_active_user)):
    """
    Get current authenticated user details.

    Click the 'Authorize' button at the top to login first.
    """
    return current_user


@router.get(
    "/",
    response_model=List[schemas.UserList],
    summary="List All Users",
    dependencies=[Depends(require_permission(*Permissions.USER_VIEW))],
)
def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_VIEW)),
):
    """Get list of all users with pagination."""
    return service.auth_service.get_users(db, skip, limit)


@router.get(
    "/paged",
    response_model=schemas.Page[schemas.UserList],
    summary="Paged user list (server-side search, filter, sort)",
    dependencies=[Depends(require_permission(*Permissions.USER_VIEW))],
)
def list_users_paged(
    page: int = Query(0, ge=0, le=1_000_000),
    size: int = Query(25, ge=1, le=200),
    q: Optional[str] = Query(None, max_length=255),
    active: Optional[bool] = None,
    branch_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    group_id: Optional[int] = Query(None, ge=1, le=2_147_483_647),
    sort_by: Optional[str] = Query(None, max_length=40),
    order: Literal["asc", "desc"] = Query("asc"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_VIEW)),
):
    return service.auth_service.get_users_page(
        db, page=page, size=size, q=q, active=active, branch_id=branch_id, group_id=group_id,
        sort_by=sort_by, order=order,
    )


@router.get(
    "/check-username/{username}",
    summary="Check if username exists",
    dependencies=[Depends(require_permission(*Permissions.USER_CREATE))],
)
def check_username_exists(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_CREATE)),
):
    """Check if a username already exists."""
    exists = service.auth_service.check_username_exists(db, username)
    return {"exists": exists, "username": username}


@router.get(
    "/check-email/{email}",
    summary="Check if email exists",
    dependencies=[Depends(require_permission(*Permissions.USER_CREATE))],
)
def check_email_exists(
    email: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_CREATE)),
):
    """Check if an email already exists."""
    exists = service.auth_service.check_email_exists(db, email)
    return {"exists": exists, "email": email}


@router.get(
    "/check-employee-id/{employee_id}",
    summary="Check if employee ID exists",
    dependencies=[Depends(require_permission(*Permissions.USER_CREATE))],
)
def check_employee_id_exists(
    employee_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_CREATE)),
):
    """Check if an employee ID already exists."""
    exists = service.auth_service.check_employee_id_exists(db, employee_id)
    return {"exists": exists, "employee_id": employee_id}


@router.get(
    "/{user_id}",
    response_model=schemas.User,
    summary="Get User by ID",
    dependencies=[Depends(require_permission(*Permissions.USER_VIEW))],
)
def get_user(
    user_id: UserId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_VIEW)),
):
    """Get user information by user ID."""
    return service.auth_service.get_user(db, user_id)


@router.post(
    "/",
    response_model=schemas.User,
    status_code=status.HTTP_201_CREATED,
    summary="Create User",
    dependencies=[Depends(require_permission(*Permissions.USER_CREATE))],
)
def create_user(
    user: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_CREATE)),
):
    """Create a new user with employee record, branches, and groups."""
    user_access.assert_can_assign_groups(db, current_user, user.group_ids)
    user_access.assert_can_assign_branches(db, current_user, user.branch_ids)
    return service.auth_service.create_user(db, user, created_by=current_user.id)


@router.put(
    "/{user_id}",
    response_model=schemas.User,
    summary="Update User",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))],
)
def update_user(
    user_id: UserId,
    user: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE)),
):
    """Update user information, branches, and groups."""
    target = service.auth_service.get_user(db, user_id)
    user_access.assert_can_manage_user(current_user, target)
    if user.group_ids is not None:
        user_access.assert_can_assign_groups(db, current_user, user.group_ids, target=target)
    if user.branch_ids is not None:
        user_access.assert_can_assign_branches(db, current_user, user.branch_ids, target=target)
    if user.is_active is not None:
        user_access.assert_can_set_active(db, current_user, target, user.is_active)
    return service.auth_service.update_user(db, user_id, user, updated_by=current_user.id)


@router.post(
    "/{user_id}/unblock",
    response_model=schemas.User,
    summary="Unblock User",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))],
)
def unblock_user(
    user_id: UserId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE)),
):
    """Clear a user's blocked flag (e.g. after too many failed login attempts)."""
    user_access.assert_can_manage_user(current_user, service.auth_service.get_user(db, user_id))
    return service.auth_service.unblock_user(db, user_id, updated_by=current_user.id)


@router.post(
    "/{user_id}/force-password-reset",
    response_model=schemas.User,
    summary="Force Password Reset",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))],
)
def force_password_reset(
    user_id: UserId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE)),
):
    """Require the user to set a new password the next time they log in."""
    user_access.assert_can_manage_user(current_user, service.auth_service.get_user(db, user_id))
    return service.auth_service.force_password_reset(db, user_id, updated_by=current_user.id)


@router.post(
    "/{user_id}/profile-picture",
    response_model=schemas.User,
    summary="Upload Profile Picture",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))],
)
def upload_profile_picture(
    user_id: UserId,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE)),
):
    from app.common.file_storage import save_image

    # Look the user up first so a bad id never leaves an orphan file behind.
    user_access.assert_can_manage_user(current_user, service.auth_service.get_user(db, user_id))
    # Avatars are raster only: SVG can carry script.
    relative_path = save_image(file, subdir="users", allow_svg=False)
    return service.auth_service.upload_profile_picture(db, user_id, relative_path)


@router.delete(
    "/{user_id}/profile-picture",
    response_model=schemas.User,
    summary="Remove Profile Picture",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))],
)
def remove_profile_picture(
    user_id: UserId,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE)),
):
    user_access.assert_can_manage_user(current_user, service.auth_service.get_user(db, user_id))
    return service.auth_service.remove_profile_picture(db, user_id)
