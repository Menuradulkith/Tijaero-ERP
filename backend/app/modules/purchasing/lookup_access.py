"""Supplier lookups for the documents that refer to suppliers.

A purchaser raising a PO, an approver reviewing it, or a storekeeper receiving goods has to
pick/see suppliers without necessarily holding `suppliers:view` (which opens the Suppliers
page). They get the lookup endpoints, but with a trimmed supplier record: no registration/tax
numbers, no logo, no shipping address, no audit names.
"""

from typing import List

from app.auth.models import User
from app.auth.rbac import Permissions as P
from app.auth.rbac import user_has_permission

# Any of these lets a user use the supplier lookups.
SUPPLIER_LOOKUP_PERMISSIONS = (
    P.SUPPLIER_VIEW,
    P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_UPDATE,
    P.PO_APPROVAL_VIEW,
    P.GRN_VIEW, P.GRN_CREATE,
)

# Cleared for users who lack suppliers:view.
TRIMMED_SUPPLIER_FIELDS = (
    "company_registration_number", "tax_registration_number", "logo_path",
    "shipping_address_line1", "shipping_address_line2", "shipping_city", "shipping_state",
    "shipping_postal_code", "shipping_country_id",
    "created_by_name", "updated_by_name",
)


def has_full_supplier_access(user: User) -> bool:
    return user_has_permission(user, *P.SUPPLIER_VIEW)


def trim_suppliers(user: User, suppliers: List) -> List:
    """Return the suppliers as-is for a full viewer, else trimmed copies (never touches the ORM rows)."""
    if has_full_supplier_access(user):
        return suppliers
    from app.modules.purchasing import schemas

    return [
        schemas.Supplier.model_validate(s).model_copy(update={f: None for f in TRIMMED_SUPPLIER_FIELDS})
        for s in suppliers
    ]
