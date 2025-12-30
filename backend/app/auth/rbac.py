from typing import List
from fastapi import Depends, HTTPException, status
from app.auth.models import User, Permission
from app.auth.dependencies import get_current_active_user

def user_has_permission(user: User, resource: str, action: str) -> bool:
    """Check if user has specific permission"""
    if user.is_superuser:
        return True
    
    # Check direct user permissions
    for permission in user.permissions:
        if permission.resource == resource and permission.action == action:
            return True
    
    # Check group permissions
    for group in user.groups:
        for permission in group.permissions:
            if permission.resource == resource and permission.action == action:
                return True
    
    return False

def require_permission(resource: str, action: str):
    """Dependency to check if user has required permission"""
    def permission_checker(current_user: User = Depends(get_current_active_user)):
        if not user_has_permission(current_user, resource, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required: {resource}:{action}"
            )
        return current_user
    return permission_checker

# Permission constants
class Permissions:
    # Customer permissions
    CUSTOMER_VIEW = ("customers", "view")
    CUSTOMER_CREATE = ("customers", "create")
    CUSTOMER_UPDATE = ("customers", "update")
    CUSTOMER_DELETE = ("customers", "delete")
    
    # Sales permissions
    SALES_VIEW = ("sales", "view")
    SALES_CREATE = ("sales", "create")
    SALES_UPDATE = ("sales", "update")
    SALES_DELETE = ("sales", "delete")
    SALES_APPROVE = ("sales", "approve")
    
    # Inventory permissions
    INVENTORY_VIEW = ("inventory", "view")
    INVENTORY_CREATE = ("inventory", "create")
    INVENTORY_UPDATE = ("inventory", "update")
    INVENTORY_DELETE = ("inventory", "delete")
    
    # User management permissions
    USER_VIEW = ("users", "view")
    USER_CREATE = ("users", "create")
    USER_UPDATE = ("users", "update")
    USER_DELETE = ("users", "delete")
    
    # Group management permissions
    GROUP_VIEW = ("groups", "view")
    GROUP_CREATE = ("groups", "create")
    GROUP_UPDATE = ("groups", "update")
    GROUP_DELETE = ("groups", "delete")
