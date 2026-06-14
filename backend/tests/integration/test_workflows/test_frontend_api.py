"""
QA suite — Frontend API endpoint verification.

These tests simulate exactly what the frontend does: HTTP requests to the REST API
with JWT auth tokens. This verifies the full stack from HTTP route → permission
check → service → DB and back, ensuring the frontend will get correct responses.

Covers:
* Products CRUD (categories, brands, products) — /api/v1/inventory/...
* Purchasing PO lifecycle — /api/v1/purchasing/...
* Finance expenses lifecycle — /api/v1/finance/expenses/...
* Sales invoice validation — /api/v1/sales/...
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest


def _uid(prefix=""):
    return f"{prefix}{uuid.uuid4().hex[:8]}"


# =========================================================================== #
# PRODUCTS — Frontend CRUD via HTTP
# =========================================================================== #
class TestProductsAPI:
    """Frontend product catalog endpoints."""

    PREFIX = "/api/v1/inventory"

    def test_create_category(self, superclient):
        r = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "TVs", "category_code": _uid("CAT"), "active": True},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["name"] == "TVs"
        assert data["id"] is not None

    def test_list_categories(self, superclient):
        superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "Audio", "category_code": _uid("CAT")},
        )
        r = superclient.get(f"{self.PREFIX}/categories/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_get_category_by_id(self, superclient):
        cr = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "Phones", "category_code": _uid("CAT")},
        )
        cat_id = cr.json()["id"]
        r = superclient.get(f"{self.PREFIX}/categories/{cat_id}")
        assert r.status_code == 200
        assert r.json()["name"] == "Phones"

    def test_get_category_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/categories/999999")
        assert r.status_code == 404

    def test_update_category(self, superclient):
        cr = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "Old", "category_code": _uid("CAT")},
        )
        cat_id = cr.json()["id"]
        r = superclient.put(
            f"{self.PREFIX}/categories/{cat_id}", json={"name": "New"}
        )
        assert r.status_code == 200
        assert r.json()["name"] == "New"

    def test_delete_category(self, superclient):
        cr = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "Temp", "category_code": _uid("CAT")},
        )
        cat_id = cr.json()["id"]
        r = superclient.delete(f"{self.PREFIX}/categories/{cat_id}")
        assert r.status_code == 200

    def test_create_brand(self, superclient):
        r = superclient.post(
            f"{self.PREFIX}/brands/",
            json={"brand_name": "Sony", "brand_code": _uid("")[:4]},
        )
        assert r.status_code == 201
        assert r.json()["brand_name"] == "Sony"

    def test_duplicate_brand_code_409(self, superclient):
        code = _uid("")[:4]
        superclient.post(
            f"{self.PREFIX}/brands/",
            json={"brand_name": "A", "brand_code": code},
        )
        r = superclient.post(
            f"{self.PREFIX}/brands/",
            json={"brand_name": "B", "brand_code": code},
        )
        assert r.status_code == 409

    def test_get_brand_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/brands/999999")
        assert r.status_code == 404

    def test_create_product(self, superclient):
        # Create prerequisites
        cat = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "ProdCat", "category_code": _uid("CAT")},
        ).json()
        brand = superclient.post(
            f"{self.PREFIX}/brands/",
            json={"brand_name": "ProdBrand", "brand_code": _uid("")[:4]},
        ).json()
        r = superclient.post(
            f"{self.PREFIX}/products/",
            json={
                "name": "Widget",
                "item_code": _uid("ITM"),
                "item_type": "general",
                "cost_price": 100,
                "category_id": cat["id"],
                "items_brand_id": brand["id"],
            },
        )
        assert r.status_code == 201
        assert r.json()["name"] == "Widget"

    def test_create_product_duplicate_item_code_rejected(self, superclient):
        cat = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "DupCat", "category_code": _uid("CAT")},
        ).json()
        brand = superclient.post(
            f"{self.PREFIX}/brands/",
            json={"brand_name": "DupBr", "brand_code": _uid("")[:4]},
        ).json()
        code = _uid("ITM")
        superclient.post(
            f"{self.PREFIX}/products/",
            json={
                "name": "First",
                "item_code": code,
                "item_type": "general",
                "cost_price": 100,
                "category_id": cat["id"],
                "items_brand_id": brand["id"],
            },
        )
        r = superclient.post(
            f"{self.PREFIX}/products/",
            json={
                "name": "Second",
                "item_code": code,
                "item_type": "general",
                "cost_price": 100,
                "category_id": cat["id"],
                "items_brand_id": brand["id"],
            },
        )
        assert r.status_code == 400

    def test_update_product_price_below_cost_rejected(self, superclient):
        cat = superclient.post(
            f"{self.PREFIX}/categories/",
            json={"name": "PCat", "category_code": _uid("CAT")},
        ).json()
        brand = superclient.post(
            f"{self.PREFIX}/brands/",
            json={"brand_name": "PBr", "brand_code": _uid("")[:4]},
        ).json()
        prod = superclient.post(
            f"{self.PREFIX}/products/",
            json={
                "name": "Expensive",
                "item_code": _uid("ITM"),
                "item_type": "general",
                "cost_price": 500,
                "category_id": cat["id"],
                "items_brand_id": brand["id"],
            },
        ).json()
        r = superclient.put(
            f"{self.PREFIX}/products/{prod['id']}",
            json={"selling_price": 200},
        )
        assert r.status_code == 400
        assert "cost price" in r.json()["detail"].lower()

    def test_get_product_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/products/999999")
        assert r.status_code == 404

    def test_list_products(self, superclient):
        r = superclient.get(f"{self.PREFIX}/products/")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# =========================================================================== #
# PURCHASING — Frontend PO endpoints
# =========================================================================== #
class TestPurchasingAPI:
    """Frontend purchasing endpoints."""

    PREFIX = "/api/v1/purchasing"

    def _create_supplier(self, superclient):
        r = superclient.post(
            f"{self.PREFIX}/suppliers",
            json={
                "title": "Mr",
                "full_name": f"Supplier {_uid()}",
                "postal_address": "1 Main St",
                "permenent_address": "1 Main St",
                "gender": "male",
                "civil_status": "single",
                "no_of_kids": "0",
                "mobile_contact_number": "0771234567",
                "credit_days": 30,
                "max_credit_limit": 500000,
                "active": True,
            },
        )
        assert r.status_code == 201, f"Supplier create failed: {r.text}"
        return r.json()

    def _create_po(self, superclient, make_branch, make_product, db):
        supplier = self._create_supplier(superclient)
        branch = make_branch()
        product = make_product()
        r = superclient.post(
            f"{self.PREFIX}/orders",
            json={
                "branch_code": branch.branch_code,
                "payment_method": "non_credit",
                "purchasing_order_date": str(date.today()),
                "good_received_note_date": str(date.today()),
                "first_suppliers_id": supplier["id"],
                "second_suppliers_id": None,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 5,
                        "unit_price": "200.00",
                        "warrenty_month": "12",
                    }
                ],
            },
        )
        return r, supplier, branch, product

    def test_create_supplier(self, superclient):
        sup = self._create_supplier(superclient)
        assert sup["id"] is not None
        assert sup["active"] is True

    def test_get_supplier(self, superclient):
        sup = self._create_supplier(superclient)
        r = superclient.get(f"{self.PREFIX}/suppliers/{sup['id']}")
        assert r.status_code == 200
        assert r.json()["full_name"] == sup["full_name"]

    def test_get_supplier_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/suppliers/999999")
        assert r.status_code == 404

    def test_create_po(self, superclient, make_branch, make_product, db):
        r, *_ = self._create_po(superclient, make_branch, make_product, db)
        assert r.status_code == 201, f"PO create failed: {r.text}"
        assert r.json()["id"] is not None

    def test_get_po(self, superclient, make_branch, make_product, db):
        cr, *_ = self._create_po(superclient, make_branch, make_product, db)
        po_id = cr.json()["id"]
        r = superclient.get(f"{self.PREFIX}/orders/{po_id}")
        assert r.status_code == 200
        assert r.json()["id"] == po_id

    def test_get_po_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/orders/999999")
        assert r.status_code == 404

    def test_update_po(self, superclient, make_branch, make_product, db):
        cr, *_ = self._create_po(superclient, make_branch, make_product, db)
        po_id = cr.json()["id"]
        r = superclient.patch(
            f"{self.PREFIX}/orders/{po_id}", json={"remarks": "Updated via API"}
        )
        assert r.status_code == 200
        assert r.json()["remarks"] == "Updated via API"

    def test_list_suppliers(self, superclient):
        self._create_supplier(superclient)
        r = superclient.get(f"{self.PREFIX}/suppliers")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        assert len(r.json()) > 0


# =========================================================================== #
# FINANCE — Frontend expense endpoints
# =========================================================================== #
class TestFinanceExpenseAPI:
    """Frontend finance expense endpoints."""

    PREFIX = "/api/v1/finance"

    def _create_expense(self, superclient, make_branch):
        branch = make_branch()
        r = superclient.post(
            f"{self.PREFIX}/expenses",
            json={
                "expense_type": "operational",
                "expense_category": "travel",
                "expenses_method": "cash",
                "expense_amount": "5000.00",
                "expense_date": str(date.today()),
                "vendor_name": "Taxi Co",
                "description": "Airport trip",
                "branch_code": branch.branch_code,
            },
        )
        return r, branch

    def test_create_expense(self, superclient, make_branch):
        r, _ = self._create_expense(superclient, make_branch)
        assert r.status_code == 201
        assert r.json()["status"] == "pending"

    def test_get_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        r = superclient.get(f"{self.PREFIX}/expenses/{exp_id}")
        assert r.status_code == 200
        assert float(r.json()["expense_amount"]) == 5000.0

    def test_get_expense_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/expenses/999999")
        assert r.status_code == 404

    def test_update_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        r = superclient.put(
            f"{self.PREFIX}/expenses/{exp_id}",
            json={"vendor_name": "New Vendor"},
        )
        assert r.status_code == 200
        assert r.json()["vendor_name"] == "New Vendor"

    def test_submit_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        r = superclient.post(f"{self.PREFIX}/expenses/{exp_id}/submit")
        assert r.status_code == 200
        assert r.json()["status"] == "submitted"

    def test_approve_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        superclient.post(f"{self.PREFIX}/expenses/{exp_id}/submit")
        r = superclient.post(
            f"{self.PREFIX}/expenses/{exp_id}/approve", json={"remarks": "OK"}
        )
        assert r.status_code == 200
        assert r.json()["status"] == "approved"

    def test_reject_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        superclient.post(f"{self.PREFIX}/expenses/{exp_id}/submit")
        r = superclient.post(
            f"{self.PREFIX}/expenses/{exp_id}/reject",
            json={"rejection_reason": "No receipt"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"

    def test_cannot_approve_pending_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        r = superclient.post(
            f"{self.PREFIX}/expenses/{exp_id}/approve", json={"remarks": "OK"}
        )
        assert r.status_code == 400

    def test_delete_pending_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        r = superclient.delete(f"{self.PREFIX}/expenses/{exp_id}")
        assert r.status_code == 200

    def test_cannot_delete_submitted_expense(self, superclient, make_branch):
        cr, _ = self._create_expense(superclient, make_branch)
        exp_id = cr.json()["id"]
        superclient.post(f"{self.PREFIX}/expenses/{exp_id}/submit")
        r = superclient.delete(f"{self.PREFIX}/expenses/{exp_id}")
        assert r.status_code == 400

    def test_list_expenses(self, superclient, make_branch):
        self._create_expense(superclient, make_branch)
        r = superclient.get(f"{self.PREFIX}/expenses")
        assert r.status_code == 200


# =========================================================================== #
# SALES — Frontend invoice endpoint validation
# =========================================================================== #
class TestSalesAPI:
    """Frontend sales endpoints."""

    PREFIX = "/api/v1/sales"

    def test_create_invoice_missing_customer_404(
        self, superclient, make_branch, make_product
    ):
        branch = make_branch()
        product = make_product()
        r = superclient.post(
            f"{self.PREFIX}/",
            json={
                "branch_code": branch.branch_code,
                "customer_id": 999999,
                "sale_rep_id": 1,
                "payment_method": "cash",
                "cash_amount": 1000,
                "card_visa_amount": 0,
                "card_mastercard_amount": 0,
                "card_amex_amount": 0,
                "cheque_amount": 0,
                "bank_transfer_amount": 0,
                "credit_amount": 0,
                "is_tax_invoice": False,
                "tax_rate": 0,
                "discount_percent": 0,
                "discount_amount": 0,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 1,
                        "selling_price": 500,
                        "minimum_selling_price": 400,
                        "warrenty_month": "12",
                    }
                ],
            },
        )
        assert r.status_code == 404

    def test_create_invoice_inactive_customer_rejected(
        self, superclient, make_branch, make_customer, make_product
    ):
        branch = make_branch()
        customer = make_customer(active=False)
        product = make_product()
        r = superclient.post(
            f"{self.PREFIX}/",
            json={
                "branch_code": branch.branch_code,
                "customer_id": customer.id,
                "sale_rep_id": 1,
                "payment_method": "cash",
                "cash_amount": 1000,
                "card_visa_amount": 0,
                "card_mastercard_amount": 0,
                "card_amex_amount": 0,
                "cheque_amount": 0,
                "bank_transfer_amount": 0,
                "credit_amount": 0,
                "is_tax_invoice": False,
                "tax_rate": 0,
                "discount_percent": 0,
                "discount_amount": 0,
                "items": [
                    {
                        "product_id": product.id,
                        "quantity": 1,
                        "selling_price": 500,
                        "minimum_selling_price": 400,
                        "warrenty_month": "12",
                    }
                ],
            },
        )
        assert r.status_code == 400

    def test_get_invoice_404(self, superclient):
        r = superclient.get(f"{self.PREFIX}/999999")
        assert r.status_code == 404

    def test_cancel_invoice_404(self, superclient):
        r = superclient.post(f"{self.PREFIX}/999999/cancel")
        assert r.status_code == 404


# =========================================================================== #
# AUTH — Unauthenticated requests should be rejected
# =========================================================================== #
class TestUnauthenticatedRejection:
    """Frontend should get 401/403 when token is missing/invalid."""

    def test_products_requires_auth(self, client):
        r = client.get("/api/v1/inventory/products/")
        assert r.status_code in (401, 403)

    def test_categories_requires_auth(self, client):
        r = client.get("/api/v1/inventory/categories/")
        assert r.status_code in (401, 403)

    def test_purchasing_requires_auth(self, client):
        r = client.get("/api/v1/purchasing/suppliers")
        assert r.status_code in (401, 403)

    def test_finance_requires_auth(self, client):
        r = client.get("/api/v1/finance/expenses")
        assert r.status_code in (401, 403)

    def test_sales_requires_auth(self, client):
        r = client.get("/api/v1/sales/statistics")
        assert r.status_code in (401, 403)


# =========================================================================== #
# COMMON APPROVALS — RBAC Validation
# =========================================================================== #
class TestCommonApprovalsAPI:
    """Centralized approvals permission checks."""

    def test_po_approver_can_approve(self, db, make_user, make_branch, make_supplier, api):
        # Create prerequisites
        branch = make_branch()
        supplier = make_supplier()
        
        # Create a PO in draft/pending
        from app.modules.purchasing.models import PurchasingOrder
        from app.modules.common.models import Approvals
        from datetime import date, datetime
        
        po = PurchasingOrder(
            purchasing_order_no="TEST-PO-RBAC-1",
            branch_code=branch.branch_code,
            payment_method="cash",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            created_date=date.today(),
            first_suppliers_id=supplier.id,
            status="pending_approval",
            added_date=datetime.utcnow(),
        )
        db.add(po)
        db.flush()
        
        approval = Approvals(
            approval_for=f"purchase_order:{po.id}:{po.purchasing_order_no}",
            status="pending",
            remark="PO needing approval",
        )
        db.add(approval)
        db.flush()
        
        po.approval_id = approval.id
        db.flush()
        db.commit()
        
        # Create user with po_approvals:approve permission
        _user, token = make_user(permissions=[("po_approvals", "approve")])
        authed_client = api(token)
        
        # Approve request
        r = authed_client.post(
            f"/api/v1/common/approvals/{approval.id}/approve",
            json={"remarks": "Looks good"}
        )
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        
        # Verify PO status updated
        db.refresh(po)
        assert po.status == "approved"

    def test_unauthorized_user_cannot_approve(self, db, make_user, make_branch, make_supplier, api):
        # Create prerequisites
        branch = make_branch()
        supplier = make_supplier()
        
        # Create a PO in draft/pending
        from app.modules.purchasing.models import PurchasingOrder
        from app.modules.common.models import Approvals
        from datetime import date, datetime
        
        po = PurchasingOrder(
            purchasing_order_no="TEST-PO-RBAC-2",
            branch_code=branch.branch_code,
            payment_method="cash",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            created_date=date.today(),
            first_suppliers_id=supplier.id,
            status="pending_approval",
            added_date=datetime.utcnow(),
        )
        db.add(po)
        db.flush()
        
        approval = Approvals(
            approval_for=f"purchase_order:{po.id}:{po.purchasing_order_no}",
            status="pending",
            remark="PO needing approval",
        )
        db.add(approval)
        db.flush()
        
        po.approval_id = approval.id
        db.flush()
        db.commit()
        
        # Create user without po_approvals:approve permission (only view suppliers)
        _user, token = make_user(permissions=[("suppliers", "view")])
        authed_client = api(token)
        
        # Approve request should fail
        r = authed_client.post(
            f"/api/v1/common/approvals/{approval.id}/approve",
            json={"remarks": "Try to approve"}
        )
        assert r.status_code == 403
