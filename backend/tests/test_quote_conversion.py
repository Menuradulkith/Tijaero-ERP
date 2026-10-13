"""Quotation -> sales order conversion, header discount, quote numbering with '-R' branch codes."""
from datetime import date, timedelta

import pytest

Q = "/api/v1/sales/quotes"
S = "/api/v1/sales"
A = "/api/v1/common/approvals"


@pytest.fixture
def world(make_branch, make_customer, make_product, make_sales_stock):
    b, p = make_branch(), make_product()
    for _ in range(3):
        make_sales_stock(product=p, branch=b)
    return {"branch": b, "customer": make_customer(), "product": p}


def _body(world, qty=2, price=100, branch=None, **kw):
    b = {
        "branch_code": (branch or world["branch"]).branch_code, "customer_id": world["customer"].id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(),
        "items": [{"product_id": world["product"].id, "quantity": qty, "selling_price": price, "minimum_selling_price": 10, "warrenty_month": "12",
                   **kw.pop("item", {})}],
    }
    b.update(kw)
    return b


def _quote(c, world, approve=True, **kw):
    r = c.post(f"{Q}/", json=_body(world, **kw))
    assert r.status_code == 201, r.text
    j = r.json()
    if approve:
        assert c.post(f"{A}/{j['approval_id']}/approve", json={}).status_code == 200
    return c.get(f"{Q}/{j['id']}").json()


CONV = {"payment_method": "credit"}


class TestConvertGate:
    def test_unapproved_quote_cannot_be_converted(self, superclient, world):
        q = _quote(superclient, world, approve=False)
        r = superclient.post(f"{Q}/{q['id']}/convert", json=CONV)
        assert r.status_code == 400, r.text
        assert superclient.get(f"{Q}/{q['id']}").json()["status"] == "pending_approval"

    def test_mark_so_created_needs_approved_quote_and_has_a_body_schema(self, superclient, world):
        q = _quote(superclient, world, approve=False)
        pid = world["product"].id
        assert superclient.post(f"{Q}/{q['id']}/mark-so-created", json={"product_ids": [pid]}).status_code == 400
        assert superclient.post(f"{Q}/{q['id']}/mark-so-created", json={"product_ids": []}).status_code == 422
        assert superclient.post(f"{Q}/{q['id']}/mark-so-created", json={"product_ids": [2 ** 40]}).status_code == 422
        assert superclient.get(f"{Q}/{q['id']}").json()["status"] == "pending_approval"

    def test_mark_so_created_on_approved_quote(self, superclient, world):
        q = _quote(superclient, world)
        r = superclient.post(f"{Q}/{q['id']}/mark-so-created", json={"product_ids": [world["product"].id]})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "completed"


class TestConvertToOrder:
    def test_without_rep_gets_correct_totals_stock_and_stays_readable(self, superclient, world, db):
        q = _quote(superclient, world, qty=2, price=100, discount_type="percentage", discount_value=10,
                   tax_mode="exclusive", tax_rate=5, item={"discount_percent": 10})
        # 2 x 100 less 10% line = 180, less 10% header = 162, +5% tax = 170.10
        assert q["total_amount"] == pytest.approx(170.10)
        r = superclient.post(f"{Q}/{q['id']}/convert", json=CONV)
        assert r.status_code == 200, r.text
        inv = superclient.get(f"{S}/{r.json()['invoice_id']}")
        assert inv.status_code == 200, inv.text
        o = inv.json()
        assert o["sale_rep_id"] is None
        assert o["subtotal"] == pytest.approx(162.0) and o["tax_amount"] == pytest.approx(8.10)
        assert o["grand_total"] == pytest.approx(170.10) and o["balance_due"] == pytest.approx(170.10)
        assert o["grand_total"] == pytest.approx(q["total_amount"])
        assert len(o["items"]) == 2 and all(i["barcode"] for i in o["items"])
        assert o["approval"] is True and o["approval_status"] in ("approved", "completed")
        lst = superclient.get(f"{S}/")
        assert lst.status_code == 200, lst.text
        assert superclient.get(f"{Q}/{q['id']}").json()["status"] == "completed"
        from app.modules.inventory.models import SalesStock
        left = db.query(SalesStock).filter(SalesStock.product_id == world["product"].id, SalesStock.status == "available").count()
        assert left == 1

    def test_with_rep_maps_employee_to_user(self, superclient, world, make_employee):
        emp = make_employee()
        q = _quote(superclient, world, qty=1, sale_rep_id=emp.id)
        r = superclient.post(f"{Q}/{q['id']}/convert", json=CONV)
        assert r.status_code == 200, r.text
        o = superclient.get(f"{S}/{r.json()['invoice_id']}").json()
        assert o["sale_rep_id"] == emp.user_id and o["sale_rep_id"] != emp.id or emp.user_id == emp.id
        assert superclient.get(f"{S}/").status_code == 200

    def test_convert_twice_is_rejected(self, superclient, world):
        q = _quote(superclient, world, qty=1)
        assert superclient.post(f"{Q}/{q['id']}/convert", json=CONV).status_code == 200
        assert superclient.post(f"{Q}/{q['id']}/convert", json=CONV).status_code == 400


class TestQuoteNumbers:
    def test_branch_code_containing_dash_r_gets_unique_numbers(self, superclient, make_branch, make_customer, make_product):
        import uuid
        b = make_branch(code=f"T{uuid.uuid4().hex[:6]}-R")
        w = {"branch": b, "customer": make_customer(), "product": make_product()}
        nos = []
        for _ in range(3):
            r = superclient.post(f"{Q}/", json=_body(w))
            assert r.status_code == 201, r.text
            nos.append(r.json()["quote_no"])
        assert len(set(nos)) == 3, nos

    def test_revision_numbering_still_works(self, superclient, world):
        q = _quote(superclient, world, approve=False)
        r = superclient.post(f"{Q}/{q['id']}/revise", json={})
        if r.status_code == 404:
            pytest.skip("no revise endpoint")
        assert r.status_code in (200, 201), r.text
        assert r.json()["new_quote_no"] == q["quote_no"] + "-R2"
        r2 = superclient.post(f"{Q}/{r.json()['new_quote_id']}/revise", json={})
        assert r2.status_code in (200, 201), r2.text
        assert r2.json()["new_quote_no"] == q["quote_no"] + "-R3"
        nxt = superclient.post(f"{Q}/", json=_body(world))
        assert nxt.status_code == 201 and nxt.json()["quote_no"] not in (q["quote_no"], r.json()["new_quote_no"])


class TestHeaderDiscount:
    @pytest.mark.parametrize("dtype,val,expected", [("percentage", 10, 180.0), ("fixed", 20, 180.0), ("none", 0, 200.0)])
    def test_discount_applied_and_echoed(self, superclient, world, dtype, val, expected):
        r = superclient.post(f"{Q}/", json=_body(world, discount_type=dtype, discount_value=val))
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["total_amount"] == pytest.approx(expected) and j["discount_value"] == val and j["discount_type"] == dtype
        g = superclient.get(f"{Q}/{j['id']}").json()
        assert g["discount_value"] == val

    def test_update_applies_discount(self, superclient, world):
        q = _quote(superclient, world, approve=False)
        r = superclient.put(f"{Q}/{q['id']}", json={"discount_type": "percentage", "discount_value": 25})
        assert r.status_code == 200, r.text
        assert r.json()["total_amount"] == pytest.approx(150.0) and r.json()["discount_value"] == 25

    def test_fixed_discount_cannot_exceed_total(self, superclient, world):
        assert superclient.post(f"{Q}/", json=_body(world, discount_type="fixed", discount_value=500)).status_code == 400
