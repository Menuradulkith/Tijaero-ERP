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
            title="Mr",
            full_name="Acme Distributors",
            postal_address="1 Market St",
            permenent_address="1 Market St",
            gender="male",
            civil_status="single",
            no_of_kids="0",
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
        assert created.full_name == "Acme Distributors"

    def test_get_missing_supplier_raises_404(self, db):
        svc = service.SupplierService(db)
        with pytest.raises(HTTPException) as exc:
            svc.get_supplier(99_999_999)
        assert exc.value.status_code == 404

    def test_update_supplier_name(self, db, make_supplier):
        supplier = make_supplier(full_name="Old Name")
        svc = service.SupplierService(db)
        updated = svc.update_supplier(
            supplier.id, schemas.SupplierUpdate(full_name="New Name")
        )
        assert updated.full_name == "New Name"

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
        title="Mr",
        full_name="API Supplier",
        postal_address="addr",
        permenent_address="addr",
        gender="male",
        civil_status="single",
        no_of_kids="0",
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
        assert resp.json()["full_name"] == "API Supplier"

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
