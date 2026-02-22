from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional
from app.db.session import get_db
from app.auth.models import User
from app.core.security import decode_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    try:
        user_id = int(user_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    # Eager load branches relationship for branch-based access control
    user = db.query(User).options(joinedload(User.branches)).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user

def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user")
    return current_user


def get_user_branch_codes(user: User) -> List[str]:
    """
    Get list of branch codes the user has access to.
    Superusers have access to all branches (returns empty list to indicate no filtering).
    """
    if user.is_superuser:
        return []  # Empty list means no filtering (access to all)
    return [branch.branch_code for branch in user.branches]


def get_user_branch_filter(current_user: User = Depends(get_current_active_user)) -> Optional[List[str]]:
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
            detail="User has no branch access. Please contact administrator."
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
                detail=f"Access denied to branch: {branch_code}"
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
