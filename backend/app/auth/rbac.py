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
    """
    Central permission registry for the entire ERP.
    Every module defines CRUD + any special actions.
    Tuples are (resource, action) — consumed by require_permission().
    """

    # ── Customers ────────────────────────────────────────────────────
    CUSTOMER_VIEW = ("customers", "view")
    CUSTOMER_CREATE = ("customers", "create")
    CUSTOMER_UPDATE = ("customers", "update")
    CUSTOMER_DELETE = ("customers", "delete")

    # ── Sales ────────────────────────────────────────────────────────
    SALES_VIEW = ("sales", "view")
    SALES_CREATE = ("sales", "create")
    SALES_UPDATE = ("sales", "update")
    SALES_DELETE = ("sales", "delete")
    SALES_APPROVE = ("sales", "approve")
    SALES_MANAGE = ("sales", "manage")

    # ── Purchasing ───────────────────────────────────────────────────
    PURCHASING_VIEW = ("purchasing", "view")
    PURCHASING_CREATE = ("purchasing", "create")
    PURCHASING_UPDATE = ("purchasing", "update")
    PURCHASING_DELETE = ("purchasing", "delete")
    PURCHASING_APPROVE = ("purchasing", "approve")

    # ── Inventory / Products ─────────────────────────────────────────
    INVENTORY_VIEW = ("inventory", "view")
    INVENTORY_CREATE = ("inventory", "create")
    INVENTORY_UPDATE = ("inventory", "update")
    INVENTORY_DELETE = ("inventory", "delete")

    # ── Finance ──────────────────────────────────────────────────────
    FINANCE_VIEW = ("finance", "view")
    FINANCE_CREATE = ("finance", "create")
    FINANCE_UPDATE = ("finance", "update")
    FINANCE_DELETE = ("finance", "delete")
    FINANCE_APPROVE = ("finance", "approve")

    # ── HR ────────────────────────────────────────────────────────────
    HR_VIEW = ("hr", "view")
    HR_CREATE = ("hr", "create")
    HR_UPDATE = ("hr", "update")
    HR_DELETE = ("hr", "delete")
    HR_APPROVE = ("hr", "approve")

    # ── Warehouse / Sales Stock ──────────────────────────────────────
    WAREHOUSE_VIEW = ("warehouse", "view")
    WAREHOUSE_CREATE = ("warehouse", "create")
    WAREHOUSE_UPDATE = ("warehouse", "update")
    WAREHOUSE_DELETE = ("warehouse", "delete")
    WAREHOUSE_APPROVE = ("warehouse", "approve")

    # ── Support ──────────────────────────────────────────────────────
    SUPPORT_VIEW = ("support", "view")
    SUPPORT_CREATE = ("support", "create")
    SUPPORT_UPDATE = ("support", "update")
    SUPPORT_DELETE = ("support", "delete")

    # ── Reporting ────────────────────────────────────────────────────
    REPORTING_VIEW = ("reporting", "view")
    REPORTING_GENERATE = ("reporting", "generate")

    # ── Dashboard ────────────────────────────────────────────────────
    DASHBOARD_VIEW = ("dashboard", "view")

    # ── User Management ──────────────────────────────────────────────
    USER_VIEW = ("users", "view")
    USER_CREATE = ("users", "create")
    USER_UPDATE = ("users", "update")
    USER_DELETE = ("users", "delete")

    # ── Group / Role Management ──────────────────────────────────────
    GROUP_VIEW = ("groups", "view")
    GROUP_CREATE = ("groups", "create")
    GROUP_UPDATE = ("groups", "update")
    GROUP_DELETE = ("groups", "delete")

    # ── Branches ─────────────────────────────────────────────────────
    BRANCH_VIEW = ("branches", "view")
    BRANCH_CREATE = ("branches", "create")
    BRANCH_UPDATE = ("branches", "update")
    BRANCH_DELETE = ("branches", "delete")

    # ── Common / Reference Data ──────────────────────────────────────
    COMMON_VIEW = ("common", "view")
    COMMON_CREATE = ("common", "create")
    COMMON_UPDATE = ("common", "update")
    COMMON_DELETE = ("common", "delete")

    # ── Settings ─────────────────────────────────────────────────────
    SETTINGS_VIEW = ("settings", "view")
    SETTINGS_UPDATE = ("settings", "update")
