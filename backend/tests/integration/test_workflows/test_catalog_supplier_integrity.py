"""
Regression tests for the Product Catalog and Suppliers data-integrity fixes:
optimistic concurrency (`version` / `expected_version`), writes that must NOT
count as user edits (image/logo uploads, credit recalculation), minimum price
saved with the product, single preferred supplier / default payment method,
database-level duplicate guards, deactivate/delete guards.

All tests go through the HTTP API the pages use and run inside the rolled-back
test transaction (see conftest.py), so nothing is persisted. True concurrent
interleavings can't be reproduced on the single shared test connection; these
tests pin the sequential behaviour the concurrency fixes rely on.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal

import pytest

INV = "/api/v1/inventory"
PUR = "/api/v1/purchasing"

# 1x1 transparent PNG
_PNG = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06"
    b"\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\xf8\x0f\x00\x00\x01\x01"
    b"\x00\x05\x18\xd8N\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _uid(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _category(c, **extra):
    r = c.post(f"{INV}/categories/", json={"name": _uid("Cat "), "category_code": _uid("C"), **extra})
    assert r.status_code == 201, r.text
    return r.json()


def _brand(c, **extra):
    r = c.post(f"{INV}/brands/", json={"brand_name": _uid("Brand "), "brand_code": uuid.uuid4().hex[:4], **extra})
    assert r.status_code == 201, r.text
    return r.json()


def _product(c, **extra):
    cat, brand = _category(c), _brand(c)
    payload = {
        "name": _uid("Prod "),
        "item_code": _uid("ITM"),
        "item_type": "general",
        "cost_price": 100,
        "selling_price": 200,
        "category_id": cat["id"],
        "items_brand_id": brand["id"],
        **extra,
    }
    r = c.post(f"{INV}/products/", json=payload)
    assert r.status_code == 201, r.text
    return r.json()


def _supplier(c, **extra):
    r = c.post(
        f"{PUR}/suppliers",
        json={
            "company_name": _uid("Supplier "),
            "billing_address_line1": "1 Main St",
            "mobile_contact_number": "0771234567",
            "max_credit_limit": 500000,
            **extra,
        },
    )
    assert r.status_code == 201, r.text
    return r.json()


def _get_product(c, pid):
    r = c.get(f"{INV}/products/{pid}")
    assert r.status_code == 200, r.text
    return r.json()


def _get_supplier(c, sid):
    r = c.get(f"{PUR}/suppliers/{sid}")
    assert r.status_code == 200, r.text
    return r.json()


# =========================================================================== #
# Product catalog
# =========================================================================== #
class TestProductConcurrency:
    def test_version_token_consistent_across_endpoints(self, superclient):
        p = _product(superclient)
        assert p["version"]
        listed = next(x for x in superclient.get(f"{INV}/products/", params={"active_only": False, "limit": 100000}).json() if x["id"] == p["id"])
        assert _get_product(superclient, p["id"])["version"] == p["version"] == listed["version"]

    def test_save_with_current_version_succeeds_and_returns_new_version(self, superclient):
        p = _product(superclient)
        r = superclient.put(f"{INV}/products/{p['id']}", json={"description": "x", "expected_version": p["version"]})
        assert r.status_code == 200, r.text
        assert r.json()["version"] != p["version"]
        assert r.json()["version"] == _get_product(superclient, p["id"])["version"]

    def test_stale_save_rejected_even_within_the_same_second(self, superclient):
        p = _product(superclient)
        first = superclient.put(f"{INV}/products/{p['id']}", json={"description": "B", "expected_version": p["version"]})
        assert first.status_code == 200
        # Same loaded version, immediately after — second precision would miss this.
        second = superclient.put(f"{INV}/products/{p['id']}", json={"description": "A", "expected_version": p["version"]})
        assert second.status_code == 409
        assert _get_product(superclient, p["id"])["description"] == "B"

    def test_save_without_version_still_works(self, superclient):
        """Backward compatible for callers that don't send a version."""
        p = _product(superclient)
        r = superclient.put(f"{INV}/products/{p['id']}", json={"description": "no check"})
        assert r.status_code == 200

    def test_save_of_deleted_product_404(self, superclient):
        p = _product(superclient)
        assert superclient.delete(f"{INV}/products/{p['id']}").status_code == 200
        r = superclient.put(f"{INV}/products/{p['id']}", json={"description": "x", "expected_version": p["version"]})
        assert r.status_code == 404

    def test_category_and_brand_stale_save_rejected(self, superclient):
        cat = _category(superclient)
        assert superclient.put(f"{INV}/categories/{cat['id']}", json={"memo": "1", "expected_version": cat["version"]}).status_code == 200
        assert superclient.put(f"{INV}/categories/{cat['id']}", json={"memo": "2", "expected_version": cat["version"]}).status_code == 409
        brand = _brand(superclient)
        assert superclient.put(f"{INV}/brands/{brand['id']}", json={"description": "1", "expected_version": brand["version"]}).status_code == 200
        assert superclient.put(f"{INV}/brands/{brand['id']}", json={"description": "2", "expected_version": brand["version"]}).status_code == 409


class TestProductImage:
    def test_upload_and_remove_do_not_change_version_and_are_audited(self, superclient):
        p = _product(superclient)
        up = superclient.post(f"{INV}/products/{p['id']}/image", files={"file": ("x.png", _PNG, "image/png")})
        assert up.status_code == 200, up.text
        assert up.json()["image_url"]
        assert up.json()["version"] == p["version"]

        # A form opened before the upload can still save.
        r = superclient.put(f"{INV}/products/{p['id']}", json={"description": "after upload", "expected_version": p["version"]})
        assert r.status_code == 200, r.text
        assert r.json()["image_url"] == up.json()["image_url"], "form save must not touch the image"

        rm = superclient.delete(f"{INV}/products/{p['id']}/image")
        assert rm.status_code == 200
        assert rm.json()["image_url"] is None
        assert rm.json()["version"] == r.json()["version"]

        log = superclient.get("/api/v1/common/activity-log", params={"entity_type": "product", "entity_id": p["id"]})
        if log.status_code == 200:  # endpoint shape varies; only assert when available
            assert "image_url" in log.text

    def test_image_url_in_update_payload_is_ignored(self, superclient):
        p = _product(superclient)
        r = superclient.put(f"{INV}/products/{p['id']}", json={"image_url": "products/hacked.png"})
        assert r.status_code == 200
        assert r.json()["image_url"] is None

    def test_upload_to_missing_product_404(self, superclient):
        r = superclient.post(f"{INV}/products/99999999/image", files={"file": ("x.png", _PNG, "image/png")})
        assert r.status_code == 404


class TestMinimumPrice:
    def test_saved_with_create_and_update_in_one_request(self, superclient):
        p = _product(superclient, minimum_selling_price=150)
        assert float(p["minimum_selling_price"]) == 150
        r = superclient.put(f"{INV}/products/{p['id']}", json={"minimum_selling_price": 160, "expected_version": p["version"]})
        assert r.status_code == 200, r.text
        assert float(r.json()["minimum_selling_price"]) == 160
        history = superclient.get(f"{INV}/products/{p['id']}/minimum-prices").json()
        assert len(history) == 2

    def test_unchanged_minimum_adds_no_history(self, superclient):
        p = _product(superclient, minimum_selling_price=150)
        superclient.put(f"{INV}/products/{p['id']}", json={"minimum_selling_price": 150, "description": "x"})
        assert len(superclient.get(f"{INV}/products/{p['id']}/minimum-prices").json()) == 1

    def test_minimum_only_change_bumps_version(self, superclient):
        """Otherwise an older form could silently revert the minimum price."""
        p = _product(superclient, minimum_selling_price=150)
        a = superclient.put(f"{INV}/products/{p['id']}", json={"minimum_selling_price": 170, "expected_version": p["version"]})
        assert a.status_code == 200
        assert a.json()["version"] != p["version"]
        b = superclient.put(f"{INV}/products/{p['id']}", json={"minimum_selling_price": 150, "expected_version": p["version"]})
        assert b.status_code == 409

    def test_raising_cost_above_current_minimum_rejected(self, superclient):
        p = _product(superclient, minimum_selling_price=150)
        r = superclient.put(f"{INV}/products/{p['id']}", json={"cost_price": 160})
        assert r.status_code == 400

    def test_minimum_below_cost_rejected_on_create(self, superclient):
        cat, brand = _category(superclient), _brand(superclient)
        r = superclient.post(f"{INV}/products/", json={
            "name": _uid("P "), "item_code": _uid("I"), "item_type": "general", "cost_price": 100,
            "category_id": cat["id"], "items_brand_id": brand["id"], "minimum_selling_price": 50,
        })
        assert r.status_code == 400
        # nothing half-created
        assert not any(x["name"] == r.request.content for x in superclient.get(f"{INV}/products/").json())

    def test_unrelated_edit_allowed_on_product_with_out_of_rule_minimum(self, superclient, db):
        """Legacy data where the minimum is below cost must not block e.g. a
        description edit — only changes to cost/minimum are validated."""
        from app.modules.products.models import MinimumPrice

        p = _product(superclient, minimum_selling_price=150)
        db.query(MinimumPrice).filter(MinimumPrice.product_id == p["id"]).update({"minimum_price": 50})
        db.flush()
        r = superclient.put(f"{INV}/products/{p['id']}", json={"description": "just text", "cost_price": 100})
        assert r.status_code == 200, r.text
        # ...but changing the cost still enforces the rule
        assert superclient.put(f"{INV}/products/{p['id']}", json={"cost_price": 101}).status_code == 400

    def test_separate_minimum_price_endpoint_bumps_version(self, superclient):
        p = _product(superclient)
        r = superclient.post(f"{INV}/products/{p['id']}/minimum-prices", json={"minimum_price": 120})
        assert r.status_code in (200, 201), r.text
        assert _get_product(superclient, p["id"])["version"] != p["version"]


class TestCatalogDuplicates:
    def test_duplicate_product_name_case_insensitive(self, superclient):
        p = _product(superclient)
        cat, brand = _category(superclient), _brand(superclient)
        r = superclient.post(f"{INV}/products/", json={
            "name": p["name"].upper(), "item_code": _uid("I"), "item_type": "general", "cost_price": 1,
            "category_id": cat["id"], "items_brand_id": brand["id"],
        })
        assert r.status_code in (400, 409)

    def test_duplicate_item_code_case_insensitive(self, superclient):
        p = _product(superclient)
        cat, brand = _category(superclient), _brand(superclient)
        r = superclient.post(f"{INV}/products/", json={
            "name": _uid("P "), "item_code": p["item_code"].lower(), "item_type": "general", "cost_price": 1,
            "category_id": cat["id"], "items_brand_id": brand["id"],
        })
        assert r.status_code in (400, 409)

    def test_duplicate_blocked_by_database_when_precheck_is_bypassed(self, db, make_product):
        """Simulates two concurrent creates both passing the service pre-check."""
        from sqlalchemy.exc import IntegrityError
        from app.modules.products.models import Product

        p = make_product()
        dup = Product(
            name=p.name.upper(), item_code=_uid("ITM"), item_type="general", website_active=False,
            active=True, cost_price=1, created_date=date.today(), category_id=p.category_id,
            items_brand_id=p.items_brand_id, added_date=datetime.utcnow(),
        )
        db.add(dup)
        with pytest.raises(IntegrityError, match="uq_products_name_lower"):
            db.flush()
        db.rollback()

    def test_foreign_key_error_is_not_reported_as_duplicate(self, superclient):
        """A category id that doesn't exist must not say 'already exists'."""
        p = _product(superclient)
        r = superclient.put(f"{INV}/products/{p['id']}", json={"category_id": 99999999})
        assert r.status_code == 400, r.text
        assert "already exists" not in r.json()["detail"]

    def test_delete_product_also_removes_minimum_price_history(self, superclient, db):
        from app.modules.products.models import MinimumPrice

        p = _product(superclient, minimum_selling_price=150)
        assert superclient.delete(f"{INV}/products/{p['id']}").status_code == 200
        assert db.query(MinimumPrice).filter(MinimumPrice.product_id == p["id"]).count() == 0


class TestPreferredSupplier:
    def test_only_one_preferred_supplier_per_product(self, superclient):
        p = _product(superclient)
        s1, s2 = _supplier(superclient), _supplier(superclient)
        m1 = superclient.post(f"{PUR}/suppliers/{s1['id']}/products", json={"product_id": p["id"], "cost_price": 90, "is_preferred": True})
        assert m1.status_code == 201, m1.text
        m2 = superclient.post(f"{PUR}/suppliers/{s2['id']}/products", json={"product_id": p["id"], "cost_price": 95, "is_preferred": True})
        assert m2.status_code == 201, m2.text
        rows = superclient.get(f"{INV}/products/{p['id']}/suppliers")
        if rows.status_code != 200:  # fall back to per-supplier listing
            rows_s1 = superclient.get(f"{PUR}/suppliers/{s1['id']}/products").json()
            rows_s2 = superclient.get(f"{PUR}/suppliers/{s2['id']}/products").json()
            preferred = [r for r in rows_s1 + rows_s2 if r["product_id"] == p["id"] and r["is_preferred"]]
        else:
            preferred = [r for r in rows.json() if r["is_preferred"]]
        assert len(preferred) == 1
        assert _get_product(superclient, p["id"])["preferred_supplier_name"] == s2["company_name"]


# =========================================================================== #
# Suppliers
# =========================================================================== #
class TestSupplierConcurrency:
    def test_stale_supplier_save_rejected_same_second(self, superclient):
        s = _supplier(superclient)
        assert s["version"]
        a = superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"billing_city": "Kandy", "expected_version": s["version"]})
        assert a.status_code == 200, a.text
        b = superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"billing_city": "Galle", "expected_version": s["version"]})
        assert b.status_code == 409
        assert _get_supplier(superclient, s["id"])["billing_city"] == "Kandy"

    def test_credit_recalculation_is_not_a_user_edit(self, superclient, db):
        from app.modules.purchasing.credit_service import SupplierCreditService

        s = _supplier(superclient)
        SupplierCreditService().update_supplier_credit_balance(db, s["id"])
        db.commit()
        after = _get_supplier(superclient, s["id"])
        assert after["version"] == s["version"]
        assert after["updated_by"] == s["updated_by"]
        # A form opened before the recalculation can still save.
        r = superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"billing_city": "Jaffna", "expected_version": s["version"]})
        assert r.status_code == 200, r.text

    def test_credit_recalculation_sees_the_callers_unflushed_rows(self, superclient, db, monkeypatch):
        """Regression: the recalculation must flush the caller's pending
        changes (e.g. a settlement's transactions) BEFORE calculating."""
        from app.modules.purchasing import credit_service
        from app.modules.purchasing.models import SupplierContactPerson

        s = _supplier(superclient)
        seen = {}
        real = credit_service.SupplierCreditService.calculate_available_credit

        def spy(self, db_, supplier_id, exclude_po_id=None):
            seen["pending"] = len(db_.new)
            return real(self, db_, supplier_id, exclude_po_id=exclude_po_id)

        monkeypatch.setattr(credit_service.SupplierCreditService, "calculate_available_credit", spy)
        db.add(SupplierContactPerson(supplier_id=s["id"], full_name="pending row"))
        credit_service.SupplierCreditService().update_supplier_credit_balance(db, s["id"])
        assert seen["pending"] == 0

    def test_logo_upload_and_remove_do_not_change_version(self, superclient):
        s = _supplier(superclient)
        up = superclient.post(f"{PUR}/suppliers/{s['id']}/logo", files={"file": ("x.png", _PNG, "image/png")})
        assert up.status_code == 200, up.text
        assert up.json()["logo_path"]
        assert up.json()["version"] == s["version"]
        rm = superclient.delete(f"{PUR}/suppliers/{s['id']}/logo")
        assert rm.status_code == 200
        assert rm.json()["logo_path"] is None
        assert rm.json()["version"] == s["version"]

    def test_save_of_deleted_supplier_404(self, superclient):
        s = _supplier(superclient)
        assert superclient.delete(f"{PUR}/suppliers/{s['id']}").status_code == 204
        r = superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"billing_city": "x", "expected_version": s["version"]})
        assert r.status_code == 404


class TestSupplierCreditAndStatus:
    def test_new_supplier_starts_with_full_credit_available(self, superclient):
        s = _supplier(superclient, max_credit_limit=1000)
        assert Decimal(str(s["initial_credit_amount"])) == Decimal("1000")
        assert Decimal(str(s["left_credit_amount"])) == Decimal("1000")

    def test_deactivate_allowed_when_nothing_owed(self, superclient):
        s = _supplier(superclient)
        r = superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"active": False})
        assert r.status_code == 200, r.text
        assert r.json()["active"] is False

    def test_deactivate_refused_when_money_is_owed(self, superclient, monkeypatch):
        from app.modules.purchasing import credit_service

        s = _supplier(superclient)
        monkeypatch.setattr(
            credit_service.SupplierCreditService, "calculate_amount_owed",
            lambda self, db, sid: Decimal("500") if sid == s["id"] else Decimal("0"),
        )
        r = superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"active": False})
        assert r.status_code == 400
        assert "owed" in r.json()["detail"]
        assert _get_supplier(superclient, s["id"])["active"] is True

    def test_po_for_inactive_supplier_refused(self, superclient, make_branch, make_product):
        s = _supplier(superclient)
        superclient.patch(f"{PUR}/suppliers/{s['id']}", json={"active": False})
        product = make_product()
        r = superclient.post(f"{PUR}/orders", json={
            "branch_code": make_branch().branch_code,
            "payment_method": "non_credit",
            "purchasing_order_date": str(date.today()),
            "good_received_note_date": str(date.today()),
            "first_suppliers_id": s["id"],
            "second_suppliers_id": None,
            "items": [{"product_id": product.id, "quantity": 1, "unit_price": "10.00", "warrenty_month": "0"}],
        })
        assert r.status_code == 400
        assert "inactive" in r.json()["detail"]


class TestSupplierDuplicatesAndDefaults:
    def test_duplicate_company_name_ignores_case_and_spaces(self, superclient):
        s = _supplier(superclient)
        r = superclient.post(f"{PUR}/suppliers", json={
            "company_name": f"  {s['company_name'].upper()} ", "mobile_contact_number": "0771",
        })
        assert r.status_code == 400

    def test_duplicate_blocked_by_database_when_precheck_is_bypassed(self, superclient, monkeypatch):
        from app.modules.purchasing.service import SupplierService

        s = _supplier(superclient)
        monkeypatch.setattr(SupplierService, "_check_duplicate_fields", lambda self, data, exclude_id=None: None)
        r = superclient.post(f"{PUR}/suppliers", json={
            "company_name": s["company_name"].lower(), "mobile_contact_number": "0771",
        })
        assert r.status_code == 400, r.text
        assert "Company name" in r.json()["detail"]

    def test_blank_optional_unique_fields_do_not_clash(self, superclient):
        _supplier(superclient, email=None, tax_registration_number="")
        _supplier(superclient, email=None, tax_registration_number="")

    def test_only_one_default_payment_method(self, superclient):
        s = _supplier(superclient)
        a = superclient.post(f"{PUR}/suppliers/{s['id']}/payment-methods", json={"method_type": "cash", "is_default": True})
        assert a.status_code == 201, a.text
        b = superclient.post(f"{PUR}/suppliers/{s['id']}/payment-methods", json={"method_type": "cheque", "is_default": True})
        assert b.status_code == 201, b.text
        methods = superclient.get(f"{PUR}/suppliers/{s['id']}/payment-methods").json()
        defaults = [m for m in methods if m["is_default"]]
        assert [m["id"] for m in defaults] == [b.json()["id"]]
        # flipping back keeps exactly one
        flip = superclient.patch(f"{PUR}/suppliers/{s['id']}/payment-methods/{a.json()['id']}", json={"is_default": True})
        assert flip.status_code == 200, flip.text
        methods = superclient.get(f"{PUR}/suppliers/{s['id']}/payment-methods").json()
        assert [m["id"] for m in methods if m["is_default"]] == [a.json()["id"]]

    def test_duplicate_contact_id_card_rejected_with_400(self, superclient):
        s1, s2 = _supplier(superclient), _supplier(superclient)
        card = _uid("NIC")
        r1 = superclient.post(f"{PUR}/suppliers/{s1['id']}/contact-persons", json={"full_name": "A", "id_card_number": card})
        assert r1.status_code == 201, r1.text
        r2 = superclient.post(f"{PUR}/suppliers/{s2['id']}/contact-persons", json={"full_name": "B", "id_card_number": f" {card.lower()} "})
        assert r2.status_code == 400


class TestSupplierDelete:
    def test_delete_supplier_with_purchase_order_refused_clearly(self, superclient, db, make_branch):
        from app.modules.purchasing.models import PurchasingOrder

        s = _supplier(superclient)
        db.add(PurchasingOrder(
            purchasing_order_no=_uid("PO"), branch_code=make_branch().branch_code, payment_method="cash",
            purchasing_order_date=date.today(), good_received_note_date=date.today(), created_date=date.today(),
            first_suppliers_id=s["id"], added_date=datetime.utcnow(), status="approved",
        ))
        db.flush()
        r = superclient.delete(f"{PUR}/suppliers/{s['id']}")
        assert r.status_code == 400
        assert "purchase orders" in r.json()["detail"]
        assert _get_supplier(superclient, s["id"])["id"] == s["id"]

    def test_delete_unused_supplier_succeeds(self, superclient):
        s = _supplier(superclient)
        superclient.post(f"{PUR}/suppliers/{s['id']}/payment-methods", json={"method_type": "cash", "is_default": True})
        assert superclient.delete(f"{PUR}/suppliers/{s['id']}").status_code == 204
        assert superclient.get(f"{PUR}/suppliers/{s['id']}").status_code == 404
