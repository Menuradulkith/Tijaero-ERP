"""Peek: a curated, read-only summary of a record that a document refers to.

Example: a purchaser filling in a PO needs the supplier's credit days and contact, but may not
hold `suppliers:view` and so cannot open the Suppliers page. A peek returns only a whitelisted
summary, and is allowed when the user may view/create any document that legitimately refers to
the record (see PEEK_ACCESS). Sensitive fields (bank details, cost prices, IDs...) never appear
here unless the user also holds the full view permission for that entity.
"""

from typing import Any, Callable, Dict, List, Tuple

from fastapi import APIRouter, Depends, HTTPException, Path, status
from sqlalchemy.orm import Session

from app.api.deps import get_current_active_user, get_db
from app.auth.dependencies import validate_branch_access
from app.auth.models import User
from app.auth.rbac import Permissions as P
from app.auth.rbac import user_has_permission
from app.modules.purchasing.lookup_access import SUPPLIER_LOOKUP_PERMISSIONS

router = APIRouter(prefix="/peek", tags=["peek"])

Perm = Tuple[str, str]

# entity -> permissions that unlock a peek. The first is the entity's own view permission, the
# rest are the documents that refer to it.
PEEK_ACCESS: Dict[str, List[Perm]] = {
    "supplier": [
        P.SUPPLIER_VIEW, P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_UPDATE,
        P.PO_APPROVAL_VIEW, P.GRN_VIEW, P.GRN_CREATE, P.SUPPLIER_PAYMENT_VIEW, P.PURCHASE_RETURN_VIEW,
    ],
    "product": [
        P.PRODUCT_VIEW, P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_UPDATE,
        P.PO_APPROVAL_VIEW, P.GRN_VIEW, P.GRN_CREATE, P.QUOTATION_VIEW, P.SALES_ORDER_VIEW,
    ],
    "quotation": [
        P.QUOTATION_VIEW, P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_UPDATE,
        P.PO_APPROVAL_VIEW,
    ],
    "purchase-order": [
        P.PURCHASE_ORDER_VIEW, P.PO_APPROVAL_VIEW, P.GRN_VIEW, P.GRN_CREATE,
        P.SUPPLIER_PAYMENT_VIEW, P.PURCHASE_RETURN_VIEW,
    ],
    "customer": [
        P.CUSTOMER_VIEW, P.QUOTATION_VIEW, P.QUOTATION_CREATE, P.QUOTATION_UPDATE,
        P.QUOTATION_APPROVAL_VIEW, P.SALES_ORDER_VIEW, P.SALES_ORDER_CREATE,
    ],
}

# The entity's own full-view permission: unlocks extra fields and the "open full page" link.
# Credit terms / limits of a supplier are for people who buy from or pay the supplier. Someone who
# only holds GRN / purchase-return permissions still sees who the supplier is and how to reach them.
SUPPLIER_CREDIT_ACCESS: List[Perm] = [
    P.SUPPLIER_VIEW, P.PURCHASE_ORDER_VIEW, P.PURCHASE_ORDER_CREATE, P.PURCHASE_ORDER_UPDATE,
    P.PO_APPROVAL_VIEW, P.SUPPLIER_PAYMENT_VIEW,
]

FULL_VIEW: Dict[str, Perm] = {
    "supplier": P.SUPPLIER_VIEW,
    "product": P.PRODUCT_VIEW,
    "quotation": P.QUOTATION_VIEW,
    "customer": P.CUSTOMER_VIEW,
    "purchase-order": P.PURCHASE_ORDER_VIEW,
}


def _allowed(user: User, entity: str) -> bool:
    return any(user_has_permission(user, r, a) for r, a in PEEK_ACCESS[entity])


def _full(user: User, entity: str) -> bool:
    r, a = FULL_VIEW[entity]
    return user_has_permission(user, r, a)


def _num(value) -> Any:
    return float(value) if value is not None else None


def _supplier(db: Session, user: User, rid: int) -> dict:
    """What the Suppliers page shows for a supplier, so the popup looks like it. Bank / payment-method
    details are never included."""
    from app.modules.purchasing import schemas as ps
    from app.modules.purchasing.models import Supplier
    from app.modules.purchasing.lookup_access import has_full_supplier_access
    from app.modules.purchasing.service import SupplierContactPersonService, SupplierService

    if not db.query(Supplier.id).filter(Supplier.id == rid).first():
        return {}
    supplier = SupplierService(db).get_supplier(rid)  # also stamps the computed lead time + user names
    detail = ps.Supplier.model_validate(supplier).model_dump(mode="json")
    if not has_full_supplier_access(user):
        # registration / tax numbers, logo, audit names stay with people who can open the Suppliers page
        for field in ("company_registration_number", "tax_registration_number", "logo_path", "created_by_name", "updated_by_name"):
            detail[field] = None
    show_payment = any(user_has_permission(user, r, a) for r, a in SUPPLIER_CREDIT_ACCESS)
    if not show_payment:
        for field in ("credit_days", "max_credit_limit", "initial_credit_amount", "left_credit_amount"):
            detail.pop(field, None)
    return {
        "kind": "supplier",
        "title": supplier.company_name,
        "subtitle": supplier.supplier_no,
        "status": "active" if supplier.active else "inactive",
        "supplier": detail,
        "show_payment": show_payment,
        "contact_persons": [
            ps.SupplierContactPerson.model_validate(c).model_dump(mode="json")
            for c in SupplierContactPersonService(db).list_contacts(rid, active_only=True)
        ],
        "fields": [],
    }


def _product(db: Session, user: User, rid: int) -> dict:
    """What the Products page shows for a product (General / Pricing / Suppliers), so the popup looks
    like it. Pricing is only included for users who hold products:view."""
    from app.modules.products import schemas as prs
    from app.modules.products.models import Product
    from app.modules.products.service import product_service
    from app.modules.purchasing import schemas as ps
    from app.modules.purchasing.service import SupplierProductService

    row = db.query(Product).filter(Product.id == rid).first()
    if not row:
        return {}
    product = product_service.get_product(db, rid)  # stamps user names, minimum price, preferred supplier
    detail = prs.Product.model_validate(product).model_dump(mode="json")
    show_pricing = _full(user, "product")
    if not show_pricing:
        for field in ("cost_price", "selling_price", "website_price", "minimum_selling_price", "price_tiers",
                      "preferred_supplier_name"):
            detail.pop(field, None)
    suppliers = [
        ps.SupplierProduct.model_validate(m).model_dump(mode="json")
        for m in SupplierProductService(db).list_by_product(rid)
    ]
    # Supplier purchase costs follow the same rule as GET /products/{id}/suppliers: products:view
    # or a purchasing lookup permission. Sales-side callers (quotations / sales orders) only see
    # which suppliers carry the product.
    show_supplier_costs = show_pricing or any(user_has_permission(user, r, a) for r, a in SUPPLIER_LOOKUP_PERMISSIONS)
    if not show_supplier_costs:
        for s in suppliers:
            s.pop("cost_price", None)
    return {
        "kind": "product",
        "title": product.name,
        "subtitle": product.item_code,
        "status": "active" if product.active else "inactive",
        "product": detail,
        "category_name": row.category.name if row.category else None,
        "brand_name": row.brand.brand_name if row.brand else None,
        "show_pricing": show_pricing,
        "show_supplier_costs": show_supplier_costs,
        "suppliers": suppliers,
        "fields": [],
    }


def _quotation(db: Session, user: User, rid: int) -> dict:
    """What the Quotations page shows for a quotation. Selling prices, discounts, tax and totals
    are only included for users who hold quotations:view; internal margins are never included."""
    from app.auth.models import Branch
    from app.modules.sales import quotation_schemas as qs
    from app.modules.sales.quotation_service import sales_quote_service

    quote = sales_quote_service.repository.get_by_id_with_items(db, rid)
    if not quote:
        return {}
    if not validate_branch_access(user, quote.branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this branch")
    sales_quote_service._attach_related_purchase_orders(db, quote)  # read-only: stamps the PO list

    show_pricing = _full(user, "quotation")
    detail = qs.SalesQuoteWithItems.model_validate(quote).model_dump(mode="json")
    if not show_pricing:
        for field in ("total_amount", "discount_type", "discount_value", "tax_mode", "tax_rate",
                      "advance_payment_id", "advance_amount"):
            detail.pop(field, None)
        for item in detail["items"]:
            for field in ("selling_price", "minimum_selling_price", "discount_percentage"):
                item.pop(field, None)

    names = {
        i.id: (i.product.name if i.product else None) for i in quote.items
    }
    for item in detail["items"]:
        item["product_name"] = names.get(item["id"]) or f"Product #{item['product_id']}"

    branch = db.query(Branch).filter(Branch.branch_code == quote.branch_code).first()
    customer = quote.customer
    summary = sales_quote_service.get_procurement_summary(db, rid)
    return {
        "kind": "quotation",
        "title": quote.quote_no,
        "subtitle": None,
        "status": quote.status,
        "quote": detail,
        "show_pricing": show_pricing,
        "branch_name": f"{branch.branch_code} - {branch.branch_name}" if branch else quote.branch_code,
        "customer_name": (customer.company_name or customer.customer_name) if customer else None,
        "related_purchase_orders": list(getattr(quote, "related_purchase_orders", None) or []),
        "procurement": summary.get("items", []),
        "fields": [],
    }


def _customer(db: Session, user: User, rid: int) -> dict:
    """What the Customers page shows for a customer. Bank details are never included; ID / passport
    and registration numbers only for users who hold customers:view."""
    from app.modules.customers import schemas as cs
    from app.modules.customers.models import Customer
    from app.modules.customers.service import CustomerContactPersonService, customer_service

    if not db.query(Customer.id).filter(Customer.id == rid).first():
        return {}
    customer = customer_service.get_customer(db, rid)
    detail = cs.Customer.model_validate(customer).model_dump(mode="json")
    for field in ("bank_details", "bank_account_name", "bank_name", "bank_account_no", "bank_branch",
                  "bank_branch_code", "bank_swift_code"):
        detail.pop(field, None)
    show_sensitive = _full(user, "customer")
    if not show_sensitive:
        for field in ("id_card_number", "passport_no", "tax_registration_number",
                      "company_registration_number", "created_by_name", "updated_by_name"):
            detail[field] = None
    name = customer.company_name if customer.customer_type == "business" and customer.company_name else customer.customer_name
    return {
        "kind": "customer",
        "title": name,
        "subtitle": customer.customer_no,
        "status": "active" if getattr(customer, "active", True) else "inactive",
        "customer": detail,
        "show_sensitive": show_sensitive,
        "contact_persons": [
            cs.CustomerContactPerson.model_validate(c).model_dump(mode="json")
            for c in CustomerContactPersonService().list_contacts(db, rid)
        ],
        "fields": [],
    }


def _purchase_order(db: Session, user: User, rid: int) -> dict:
    """What the Purchase Orders page shows for a PO. Unit prices, amounts and totals only for users
    who hold purchase_orders:view (a storekeeper receiving goods sees quantities, not costs)."""
    from fastapi.encoders import jsonable_encoder

    from app.auth.models import Branch
    from app.modules.purchasing.api import _enrich_single_purchase_order_with_user_fields
    from app.modules.purchasing.models import PurchasingOrder
    from app.modules.purchasing.service import PurchasingOrderService

    row = db.query(PurchasingOrder).filter(PurchasingOrder.id == rid).first()
    if not row:
        return {}
    if not validate_branch_access(user, row.branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to this branch")
    order = PurchasingOrderService(db).get_order(rid)
    detail = jsonable_encoder(_enrich_single_purchase_order_with_user_fields(db, order))

    show_pricing = _full(user, "purchase-order")
    if not show_pricing:
        for item in detail.get("items", []):
            item.pop("unit_price", None)
        for field in ("total_amount", "paid_amount"):
            detail.pop(field, None)
    # activity / audit data stays on the page itself
    for field in ("created_by_name", "updated_by_name", "approved_by_name", "created_by", "updated_by", "approved_by"):
        detail.pop(field, None)

    products = {i.id: i.product for i in order.items}
    for item in detail.get("items", []):
        product = products.get(item["id"])
        item["product_name"] = product.name if product else f"Product #{item['product_id']}"
        item["uom"] = product.unit_of_measure if product else None

    branch = db.query(Branch).filter(Branch.branch_code == row.branch_code).first()
    return {
        "kind": "purchase-order",
        "title": row.purchasing_order_no,
        "subtitle": None,
        "status": row.status,
        "order": detail,
        "show_pricing": show_pricing,
        "branch_name": f"{branch.branch_code} - {branch.branch_name}" if branch else row.branch_code,
        "fields": [],
    }


BUILDERS: Dict[str, Callable[[Session, User, int], dict]] = {
    "supplier": _supplier, "product": _product, "quotation": _quotation, "customer": _customer,
    "purchase-order": _purchase_order,
}


@router.get("/{entity}/{entity_id}")
def peek(
    entity: str = Path(...),
    entity_id: int = Path(ge=1, le=2_147_483_647),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_active_user),
):
    if entity not in BUILDERS:
        raise HTTPException(status_code=404, detail="Unknown record type")
    if not _allowed(user, entity):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not have access to view this record")
    data = BUILDERS[entity](db, user, entity_id)
    if not data:
        raise HTTPException(status_code=404, detail="Record not found")
    data["entity"] = entity
    data["entity_id"] = entity_id
    return data
