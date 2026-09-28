"""
QA suite — Purchasing process.

Covers the supplier and purchase-order business rules at the service layer
(direct, deterministic) plus a few API/RBAC checks.  Every test runs inside the
auto-rolled-back ``db`` session from the root conftest, so nothing is persisted.

Process rules verified
----------------------
Suppliers:
* create / fetch (404) / update
* cannot deactivate a supplier that has pending purchase orders
* delete of a non-existent supplier raises 404

Purchase Orders (create_order):
* happy path -> status PENDING_APPROVAL, approval record linked, items persisted
* second supplier is OPTIONAL (None) and ``0`` is normalised to NULL  (regression)
* a valid second supplier is stored
* inactive / missing first supplier -> error
* inactive second supplier -> error
* inactive branch -> error
* daily-limit helper reports availability

API / RBAC:
* supplier create requires the suppliers:create permission
* supplier list requires the suppliers:view permission
* creating a PO for a branch the user cannot access -> 403
"""

from datetime import date

import pytest
from fastapi import HTTPException

from app.common.enums import PurchaseOrderStatus
from app.modules.purchasing import schemas, service


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _po_create(branch_code, first_supplier_id, product_id, *, second_supplier_id=None,
               payment_method="non_credit", qty=2, unit_price="150.00"):
    from decimal import Decimal

    return schemas.PurchasingOrderCreate(
        branch_code=branch_code,
        payment_method=payment_method,
        purchasing_order_date=date.today(),
        good_received_note_date=date.today(),
        first_suppliers_id=first_supplier_id,
        second_suppliers_id=second_supplier_id,
        items=[
            schemas.PurchasingOrderItemCreate(
                product_id=product_id,
                quantity=qty,
                unit_price=Decimal(unit_price),
                warrenty_month="12",
            )
        ],
    )


# --------------------------------------------------------------------------- #
# Suppliers — service layer
# --------------------------------------------------------------------------- #
class TestSupplierService:
    def _supplier_payload(self, **over):
        base = dict(
            company_name="Acme Distributors",
            billing_address_line1="1 Market St",
            mobile_contact_number="0771234567",
            credit_days=30,
            max_credit_limit=500000,
            active=True,
        )
        base.update(over)
        return schemas.SupplierCreate(**base)

    def test_create_supplier(self, db):
        svc = service.SupplierService(db)
        created = svc.create_supplier(self._supplier_payload())
        assert created.id is not None
        assert created.active is True
        assert created.company_name == "Acme Distributors"

    def test_get_missing_supplier_raises_404(self, db):
        svc = service.SupplierService(db)
        with pytest.raises(HTTPException) as exc:
            svc.get_supplier(99_999_999)
        assert exc.value.status_code == 404

    def test_update_supplier_name(self, db, make_supplier):
        supplier = make_supplier(company_name="Old Name")
        svc = service.SupplierService(db)
        updated = svc.update_supplier(
            supplier.id, schemas.SupplierUpdate(company_name="New Name")
        )
        assert updated.company_name == "New Name"

    def test_cannot_deactivate_supplier_with_pending_po(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        # Create a PO so the supplier has a pending order.
        order_svc = service.PurchasingOrderService(db)
        order_svc.create_order(
            _po_create(branch.branch_code, supplier.id, product.id), created_by=1
        )

        svc = service.SupplierService(db)
        with pytest.raises(HTTPException) as exc:
            svc.update_supplier(supplier.id, schemas.SupplierUpdate(active=False))
        assert exc.value.status_code == 400
        assert "pending purchase order" in exc.value.detail.lower()

    def test_delete_missing_supplier_raises_404(self, db):
        svc = service.SupplierService(db)
        with pytest.raises(HTTPException) as exc:
            svc.delete_supplier(99_999_999)
        assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Purchase Orders — service layer
# --------------------------------------------------------------------------- #
class TestPurchaseOrderCreate:
    def test_happy_path(self, db, make_branch, make_supplier, make_product):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)

        order = svc.create_order(
            _po_create(branch.branch_code, supplier.id, product.id), created_by=1
        )

        assert order.id is not None
        assert order.status == PurchaseOrderStatus.PENDING_APPROVAL
        assert order.approval_id is not None
        assert order.second_suppliers_id is None
        assert len(order.items) == 1
        assert order.purchasing_order_no.startswith("PO-")

    def test_second_supplier_is_optional(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)

        order = svc.create_order(
            _po_create(
                branch.branch_code, supplier.id, product.id, second_supplier_id=None
            ),
            created_by=1,
        )
        assert order.second_suppliers_id is None

    def test_second_supplier_zero_is_normalised_to_null(
        self, db, make_branch, make_supplier, make_product
    ):
        """Regression: a ``0`` second-supplier id must be stored as NULL, not
        trigger a foreign-key violation."""
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)

        order = svc.create_order(
            _po_create(
                branch.branch_code, supplier.id, product.id, second_supplier_id=0
            ),
            created_by=1,
        )
        assert order.second_suppliers_id is None

    def test_valid_second_supplier_is_stored(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        first = make_supplier()
        second = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)

        order = svc.create_order(
            _po_create(
                branch.branch_code, first.id, product.id, second_supplier_id=second.id
            ),
            created_by=1,
        )
        assert order.second_suppliers_id == second.id

    def test_missing_first_supplier_raises_404(
        self, db, make_branch, make_product
    ):
        branch = make_branch()
        product = make_product()
        svc = service.PurchasingOrderService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_order(
                _po_create(branch.branch_code, 99_999_999, product.id), created_by=1
            )
        assert exc.value.status_code == 404

    def test_inactive_first_supplier_raises_400(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier(active=False)
        product = make_product()
        svc = service.PurchasingOrderService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_order(
                _po_create(branch.branch_code, supplier.id, product.id), created_by=1
            )
        assert exc.value.status_code == 400
        assert "inactive" in exc.value.detail.lower()

    def test_inactive_second_supplier_raises_400(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        first = make_supplier()
        second = make_supplier(active=False)
        product = make_product()
        svc = service.PurchasingOrderService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_order(
                _po_create(
                    branch.branch_code, first.id, product.id, second_supplier_id=second.id
                ),
                created_by=1,
            )
        assert exc.value.status_code == 400

    def test_inactive_branch_raises(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch(active=False)
        supplier = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_order(
                _po_create(branch.branch_code, supplier.id, product.id), created_by=1
            )
        # Branch validation rejects inactive branches with a 4xx error.
        assert 400 <= exc.value.status_code < 500


class TestDailyLimit:
    def test_limit_available_initially(self, db, make_branch):
        branch = make_branch()
        svc = service.PurchasingOrderService(db)
        result = svc.check_daily_limit(branch.branch_code)
        assert result.can_create is True
        assert result.count == 0
        assert result.remaining == result.limit

    def test_count_increments_after_create(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)
        svc.create_order(
            _po_create(branch.branch_code, supplier.id, product.id), created_by=1
        )
        result = svc.check_daily_limit(branch.branch_code)
        assert result.count == 1


# --------------------------------------------------------------------------- #
# API / RBAC
# --------------------------------------------------------------------------- #
class TestPurchasingRBAC:
    _SUPPLIER_BODY = dict(
        company_name="API Supplier",
        billing_address_line1="addr",
        mobile_contact_number="0770000000",
        credit_days=30,
        max_credit_limit=100000,
        active=True,
    )

    def test_create_supplier_requires_permission(self, client, make_user):
        _user, token = make_user()  # no permissions
        client.headers.update({"Authorization": f"Bearer {token}"})
        resp = client.post("/api/v1/purchasing/suppliers", json=self._SUPPLIER_BODY)
        assert resp.status_code == 403

    def test_create_supplier_with_permission(self, client, make_user):
        _user, token = make_user(permissions=[("suppliers", "create")])
        client.headers.update({"Authorization": f"Bearer {token}"})
        resp = client.post("/api/v1/purchasing/suppliers", json=self._SUPPLIER_BODY)
        assert resp.status_code == 201
        assert resp.json()["company_name"] == "API Supplier"

    def test_list_suppliers_requires_permission(self, client, make_user):
        _user, token = make_user()
        client.headers.update({"Authorization": f"Bearer {token}"})
        resp = client.get("/api/v1/purchasing/suppliers")
        assert resp.status_code == 403

    def test_create_po_denied_for_inaccessible_branch(
        self, client, make_user, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        # Regular user with NO branch assignments cannot post to this branch.
        _user, token = make_user()
        client.headers.update({"Authorization": f"Bearer {token}"})
        body = {
            "branch_code": branch.branch_code,
            "payment_method": "non_credit",
            "purchasing_order_date": date.today().isoformat(),
            "good_received_note_date": date.today().isoformat(),
            "first_suppliers_id": supplier.id,
            "items": [
                {
                    "product_id": product.id,
                    "quantity": 1,
                    "unit_price": "100.00",
                    "warrenty_month": "12",
                }
            ],
        }
        resp = client.post("/api/v1/purchasing/orders", json=body)
        assert resp.status_code == 403

    def test_total_amount_is_computed_from_line_items(
        self, client, make_user, make_branch, make_supplier, make_product
    ):
        """Regression: PurchasingOrder has no total_amount column of its own
        — it must be derived from line items in the API response, not left
        at the schema's Decimal("0.00") default (which showed every PO's
        total as 0 in the browse table)."""
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        _user, token = make_user(
            permissions=[("purchase_orders", "create"), ("purchase_orders", "view")],
            branches=[branch],
        )
        client.headers.update({"Authorization": f"Bearer {token}"})

        body = {
            "branch_code": branch.branch_code,
            "payment_method": "non_credit",
            "purchasing_order_date": date.today().isoformat(),
            "good_received_note_date": date.today().isoformat(),
            "first_suppliers_id": supplier.id,
            "items": [
                {"product_id": product.id, "quantity": 3, "unit_price": "150.00", "warrenty_month": "12"},
                {"product_id": product.id, "quantity": 2, "unit_price": "25.50", "warrenty_month": "12"},
            ],
        }
        expected_total = 3 * 150.00 + 2 * 25.50

        create_resp = client.post("/api/v1/purchasing/orders", json=body)
        assert create_resp.status_code == 201, create_resp.text
        assert float(create_resp.json()["total_amount"]) == expected_total

        order_id = create_resp.json()["id"]

        get_resp = client.get(f"/api/v1/purchasing/orders/{order_id}")
        assert get_resp.status_code == 200
        assert float(get_resp.json()["total_amount"]) == expected_total

        list_resp = client.get("/api/v1/purchasing/orders")
        assert list_resp.status_code == 200
        listed = next(o for o in list_resp.json() if o["id"] == order_id)
        assert float(listed["total_amount"]) == expected_total

    def test_total_quantity_is_computed_and_required_date_is_order_level(
        self, client, make_user, make_branch, make_supplier, make_product
    ):
        """total_quantity sums every line's quantity. required_date is a
        single field on the order itself (set once per generated PO, e.g.
        per supplier group in the product-first creation wizard) — not
        derived from line items."""
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        _user, token = make_user(
            permissions=[("purchase_orders", "create"), ("purchase_orders", "view")],
            branches=[branch],
        )
        client.headers.update({"Authorization": f"Bearer {token}"})

        needed_by = date.today()

        body = {
            "branch_code": branch.branch_code,
            "payment_method": "non_credit",
            "purchasing_order_date": date.today().isoformat(),
            "good_received_note_date": date.today().isoformat(),
            "required_date": needed_by.isoformat(),
            "first_suppliers_id": supplier.id,
            "items": [
                {"product_id": product.id, "quantity": 3, "unit_price": "100.00", "warrenty_month": "0"},
                {"product_id": product.id, "quantity": 5, "unit_price": "100.00", "warrenty_month": "0"},
                {"product_id": product.id, "quantity": 2, "unit_price": "100.00", "warrenty_month": "0"},
            ],
        }

        create_resp = client.post("/api/v1/purchasing/orders", json=body)
        assert create_resp.status_code == 201, create_resp.text
        payload = create_resp.json()
        assert payload["total_quantity"] == 3 + 5 + 2
        assert payload["required_date"] == needed_by.isoformat()

        list_resp = client.get("/api/v1/purchasing/orders")
        assert list_resp.status_code == 200
        listed = next(o for o in list_resp.json() if o["id"] == payload["id"])
        assert listed["total_quantity"] == 10
        assert listed["required_date"] == needed_by.isoformat()

    def test_required_date_is_null_when_not_set(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        svc = service.PurchasingOrderService(db)

        order = svc.create_order(
            _po_create(branch.branch_code, supplier.id, product.id), created_by=1
        )
        assert order.required_date is None
        assert order.total_quantity == 2  # _po_create's default qty


# --------------------------------------------------------------------------- #
# Purchase Orders — product-first, multi-supplier batch checkout
# --------------------------------------------------------------------------- #
class TestPurchaseOrderBatchCreate:
    def test_happy_path_creates_one_po_per_supplier(
        self, db, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier_a = make_supplier()
        supplier_b = make_supplier()
        rice = make_product()
        oil = make_product()
        svc = service.PurchasingOrderService(db)

        groups = [
            _po_create(branch.branch_code, supplier_a.id, rice.id, qty=50, unit_price="220.00"),
            _po_create(branch.branch_code, supplier_b.id, oil.id, qty=10, unit_price="900.00"),
        ]

        batch_id, orders = svc.create_order_batch(groups, created_by=1)

        assert batch_id
        assert len(orders) == 2
        assert {o.first_suppliers_id for o in orders} == {supplier_a.id, supplier_b.id}
        assert all(o.purchase_batch_id == batch_id for o in orders)
        assert all(o.status == PurchaseOrderStatus.PENDING_APPROVAL for o in orders)
        assert all(o.approval_id is not None for o in orders)
        assert all(o.purchasing_order_no.startswith("PO-") for o in orders)
        # Distinct PO numbers, one per created order.
        assert len({o.purchasing_order_no for o in orders}) == 2

    def test_inactive_supplier_in_one_group_rolls_back_whole_batch(
        self, db, make_branch, make_supplier, make_product
    ):
        """If any group in the batch is invalid, no PO from the batch should
        be created — the checkout is all-or-nothing."""
        branch = make_branch()
        good_supplier = make_supplier()
        bad_supplier = make_supplier(active=False)
        product = make_product()
        svc = service.PurchasingOrderService(db)

        groups = [
            _po_create(branch.branch_code, good_supplier.id, product.id),
            _po_create(branch.branch_code, bad_supplier.id, product.id),
        ]

        with pytest.raises(HTTPException) as exc:
            svc.create_order_batch(groups, created_by=1)
        assert exc.value.status_code == 400

        # Nothing should have been persisted from the valid group either.
        remaining = svc.check_daily_limit(branch.branch_code)
        assert remaining.count == 0

    def test_daily_limit_counts_every_po_the_batch_would_create(
        self, db, make_branch, make_supplier, make_product
    ):
        from app.modules.purchasing.service import DAILY_PO_LIMIT_PER_BRANCH

        branch = make_branch()
        product = make_product()
        svc = service.PurchasingOrderService(db)

        # Fill the branch up to one below the daily limit with ordinary POs.
        for _ in range(DAILY_PO_LIMIT_PER_BRANCH - 1):
            svc.create_order(
                _po_create(branch.branch_code, make_supplier().id, product.id), created_by=1
            )

        # A 2-supplier batch now exceeds the single remaining slot.
        groups = [
            _po_create(branch.branch_code, make_supplier().id, product.id),
            _po_create(branch.branch_code, make_supplier().id, product.id),
        ]
        with pytest.raises(HTTPException) as exc:
            svc.create_order_batch(groups, created_by=1)
        assert exc.value.status_code == 400

    def test_api_batch_endpoint_happy_path(
        self, client, make_user, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier_a = make_supplier()
        supplier_b = make_supplier()
        rice = make_product()
        oil = make_product()
        _user, token = make_user(
            permissions=[("purchase_orders", "create")], branches=[branch]
        )
        client.headers.update({"Authorization": f"Bearer {token}"})

        body = {
            "groups": [
                {
                    "branch_code": branch.branch_code,
                    "payment_method": "non_credit",
                    "purchasing_order_date": date.today().isoformat(),
                    "good_received_note_date": date.today().isoformat(),
                    "first_suppliers_id": supplier_a.id,
                    "items": [
                        {
                            "product_id": rice.id,
                            "quantity": 50,
                            "unit_price": "220.00",
                            "warrenty_month": "0",
                        }
                    ],
                },
                {
                    "branch_code": branch.branch_code,
                    "payment_method": "non_credit",
                    "purchasing_order_date": date.today().isoformat(),
                    "good_received_note_date": date.today().isoformat(),
                    "first_suppliers_id": supplier_b.id,
                    "items": [
                        {
                            "product_id": oil.id,
                            "quantity": 10,
                            "unit_price": "900.00",
                            "warrenty_month": "0",
                        }
                    ],
                },
            ]
        }
        resp = client.post("/api/v1/purchasing/orders/batch", json=body)
        assert resp.status_code == 201, resp.text
        payload = resp.json()
        assert payload["purchase_batch_id"]
        assert len(payload["orders"]) == 2
        assert {o["first_suppliers_id"] for o in payload["orders"]} == {supplier_a.id, supplier_b.id}
        assert all(o["purchase_batch_id"] == payload["purchase_batch_id"] for o in payload["orders"])

    def test_api_batch_denied_for_inaccessible_branch(
        self, client, make_user, make_branch, make_supplier, make_product
    ):
        branch = make_branch()
        supplier = make_supplier()
        product = make_product()
        _user, token = make_user(permissions=[("purchase_orders", "create")])  # no branch access
        client.headers.update({"Authorization": f"Bearer {token}"})

        body = {
            "groups": [
                {
                    "branch_code": branch.branch_code,
                    "payment_method": "non_credit",
                    "purchasing_order_date": date.today().isoformat(),
                    "good_received_note_date": date.today().isoformat(),
                    "first_suppliers_id": supplier.id,
                    "items": [
                        {
                            "product_id": product.id,
                            "quantity": 1,
                            "unit_price": "100.00",
                            "warrenty_month": "0",
                        }
                    ],
                }
            ]
        }
        resp = client.post("/api/v1/purchasing/orders/batch", json=body)
        assert resp.status_code == 403
