from typing import List, Optional

from app.auth.models import Group, User
from app.core.security import decode_token, get_password_marker
from app.db.session import get_db
from fastapi import Depends, HTTPException, Query, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload, selectinload

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")


def _resolve_token(request: Request, token: Optional[str] = None) -> str:
    """Extract the bearer token from either the Authorization header or a
    `token` query parameter.  The query-parameter path is used by print-
    preview iframes which cannot send custom HTTP headers."""
    # 1. Explicit token param (from iframe URL)
    if token:
        return token
    # 2. Standard Authorization header
    auth_header = request.headers.get("authorization", "")
    if auth_header.lower().startswith("bearer "):
        return auth_header[7:]
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> User:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    from app.core.audit_context import current_user_id
    current_user_id.set(user_id)
    # Eager load relationships for access control and serialization
    user = (
        db.query(User)
        .options(
            joinedload(User.branches),
            selectinload(User.groups).selectinload(Group.permissions),
            selectinload(User.permissions),
        )
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    token_password_marker = payload.get("pwd")
    current_password_marker = get_password_marker(user.hashed_password)
    if not token_password_marker or token_password_marker != current_password_marker:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired due to password change. Please log in again.",
        )
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )
    return current_user


def get_current_user_flexible(
    request: Request,
    token: Optional[str] = Query(
        None, description="JWT token (for iframe/print preview)"
    ),
    db: Session = Depends(get_db),
) -> User:
    """Authenticate via Authorization header OR ?token= query parameter.
    Used by document report endpoints that are loaded in iframes."""
    resolved = _resolve_token(request, token)
    payload = decode_token(resolved)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )
    from app.core.audit_context import current_user_id
    current_user_id.set(user_id)
    # Eager load groups + permissions so RBAC checks work for flexible/iframe auth
    user = (
        db.query(User)
        .options(
            joinedload(User.branches),
            selectinload(User.groups).selectinload(Group.permissions),
            selectinload(User.permissions),
        )
        .filter(User.id == user_id)
        .first()
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )
    token_password_marker = payload.get("pwd")
    current_password_marker = get_password_marker(user.hashed_password)
    if not token_password_marker or token_password_marker != current_password_marker:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired due to password change. Please log in again.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user"
        )
    return user


def get_user_branch_codes(user: User) -> List[str]:
    """
    Get list of branch codes the user has access to.
    Superusers have access to all branches (returns empty list to indicate no filtering).
    """
    if user.is_superuser:
        return []  # Empty list means no filtering (access to all)
    return [branch.branch_code for branch in user.branches]


def get_user_branch_filter(
    current_user: User = Depends(get_current_active_user),
) -> Optional[List[str]]:
    """
    Dependency that returns user's allowed branch codes for filtering.
    Returns None for superusers (no filtering needed).
    Returns list of branch codes for regular users.
    """
    if current_user.is_superuser:
        return None  # No filtering for superusers
    branch_codes = [branch.branch_code for branch in current_user.branches]
    if not branch_codes:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User has no branch access. Please contact administrator.",
        )
    return branch_codes


def validate_branch_access(user: User, branch_code: str) -> bool:
    """
    Check if user has access to a specific branch.
    Superusers have access to all branches.
    """
    if user.is_superuser:
        return True
    user_branch_codes = [branch.branch_code for branch in user.branches]
    return branch_code in user_branch_codes


def require_branch_access(branch_code: str):
    """
    Dependency factory to check if user has access to a specific branch.
    Usage: Depends(require_branch_access(branch_code))
    """

    def branch_checker(current_user: User = Depends(get_current_active_user)):
        if not validate_branch_access(current_user, branch_code):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )
        return current_user

    return branch_checker


def require_permission(resource: str, action: str):
    """Dependency factory that enforces RBAC permission checks.

    Delegates to app.auth.rbac.require_permission which is the canonical
    implementation.  This wrapper exists so that modules that imported
    require_permission from dependencies.py continue to work correctly.
    """
    from app.auth.rbac import require_permission as _rbac_require_permission

    return _rbac_require_permission(resource, action)


def require_permission_flexible(resource: str, action: str):
    """Like ``require_permission`` but also accepts a ``?token=`` query parameter
    in addition to the Authorization header.

    Used by document / print-preview endpoints that are loaded inside iframes
    (which cannot set custom HTTP headers).  Enforces the same RBAC check so
    sensitive documents (payroll, journal entries, invoices, …) are not
    viewable by any authenticated user — only by users with the relevant
    view permission.
    """

    def permission_checker(
        current_user: User = Depends(get_current_user_flexible),
    ) -> User:
        from app.auth.rbac import user_has_permission

        if not user_has_permission(current_user, resource, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required: {resource}:{action}",
            )
        return current_user

    return permission_checker
