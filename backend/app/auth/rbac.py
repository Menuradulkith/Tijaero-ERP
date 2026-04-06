from typing import List

from app.auth.dependencies import get_current_active_user
from app.auth.models import Permission, User
from fastapi import Depends, HTTPException, status


def user_has_permission(user: User, resource: str, action: str) -> bool:

    if user.is_superuser:
        return True

    for permission in user.permissions:
        if permission.resource == resource and permission.action == action:
            return True

    for group in user.groups:
        for permission in group.permissions:
            if permission.resource == resource and permission.action == action:
                return True

    return False


def require_permission(resource: str, action: str):

    def permission_checker(current_user: User = Depends(get_current_active_user)):
        if not user_has_permission(current_user, resource, action):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required: {resource}:{action}",
            )
        return current_user

    return permission_checker


class Permissions:

    CUSTOMER_VIEW = ("customers", "view")
    CUSTOMER_CREATE = ("customers", "create")
    CUSTOMER_UPDATE = ("customers", "update")
    CUSTOMER_DELETE = ("customers", "delete")

    SALES_VIEW = ("sales", "view")
    SALES_CREATE = ("sales", "create")
    SALES_UPDATE = ("sales", "update")
    SALES_DELETE = ("sales", "delete")
    SALES_APPROVE = ("sales", "approve")
    SALES_MANAGE = ("sales", "manage")  # Manage sales settings (payment cards, etc.)

    INVENTORY_VIEW = ("inventory", "view")
    INVENTORY_CREATE = ("inventory", "create")
    INVENTORY_UPDATE = ("inventory", "update")
    INVENTORY_DELETE = ("inventory", "delete")

    USER_VIEW = ("users", "view")
    USER_CREATE = ("users", "create")
    USER_UPDATE = ("users", "update")
    USER_DELETE = ("users", "delete")

    GROUP_VIEW = ("groups", "view")
    GROUP_CREATE = ("groups", "create")
    GROUP_UPDATE = ("groups", "update")
    GROUP_DELETE = ("groups", "delete")

    BRANCH_VIEW = ("branches", "view")
    BRANCH_CREATE = ("branches", "create")
    BRANCH_UPDATE = ("branches", "update")
    BRANCH_DELETE = ("branches", "delete")

    HR_VIEW = ("hr", "view")
    HR_CREATE = ("hr", "create")
    HR_UPDATE = ("hr", "update")
    HR_DELETE = ("hr", "delete")

    COMMON_VIEW = ("common", "view")
    COMMON_CREATE = ("common", "create")
    COMMON_UPDATE = ("common", "update")
    COMMON_DELETE = ("common", "delete")

    REPORTING_VIEW = ("reporting", "view")
    DASHBOARD_VIEW = ("dashboard", "view")
