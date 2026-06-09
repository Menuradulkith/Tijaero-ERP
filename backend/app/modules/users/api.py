"""
Users API endpoints
"""

from typing import List

from app.auth import schemas, service
from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from fastapi import APIRouter, Depends, Query, Security, status
from sqlalchemy.orm import Session

router = APIRouter(prefix="/users", tags=["users"])


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
    user_id: int,
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
    return service.auth_service.create_user(db, user)


@router.put(
    "/{user_id}",
    response_model=schemas.User,
    summary="Update User",
    dependencies=[Depends(require_permission(*Permissions.USER_UPDATE))],
)
def update_user(
    user_id: int,
    user: schemas.UserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_UPDATE)),
):
    """Update user information, branches, and groups."""
    return service.auth_service.update_user(db, user_id, user)


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_200_OK,
    summary="Delete User",
    dependencies=[Depends(require_permission(*Permissions.USER_DELETE))],
)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission(*Permissions.USER_DELETE)),
):
    """Delete a user by ID."""
    return service.auth_service.delete_user(db, user_id)
