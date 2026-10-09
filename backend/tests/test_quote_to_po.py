"""Quotation -> procurement queue -> purchase order: approval gate, branch scope, partial quantities, cancel/reject release."""
from datetime import date, timedelta

import pytest

Q = "/api/v1/sales/quotes"
PUR = "/api/v1/purchasing"
A = "/api/v1/common/approvals"


@pytest.fixture
def world(make_branch, make_customer, make_product, make_supplier):
    return {"branch": make_branch(), "other": make_branch(), "customer": make_customer(), "product": make_product(),
            "sup": make_supplier(), "sup2": make_supplier()}


def _quote(c, world, branch=None, qty=5, approve=True, price=300):
    b = branch or world["branch"]
    r = c.post(f"{Q}/", json={
        "branch_code": b.branch_code, "customer_id": world["customer"].id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(),
        "items": [{"product_id": world["product"].id, "quantity": qty, "selling_price": price, "minimum_selling_price": 100, "warrenty_month": "12"}],
    })
    assert r.status_code == 201, r.text
    j = r.json()
    if approve:
        assert c.post(f"{A}/{j['approval_id']}/approve", json={}).status_code == 200
    return c.get(f"{Q}/{j['id']}").json()


def _qi(world, quote, qty=2, price=100, sup=None):
    return {"quote_item_id": quote["items"][0]["id"], "supplier_id": (sup or world["sup"]).id, "quantity": qty, "unit_price": price}


def _group(world, quote, qty=2, price=100, branch=None, sup=None):
    return {
        "branch_code": (branch or world["branch"]).branch_code, "payment_method": "cash",
        "purchasing_order_date": date.today().isoformat(), "good_received_note_date": (date.today() + timedelta(days=5)).isoformat(),
        "first_suppliers_id": (sup or world["sup"]).id, "sales_quote_id": quote["id"],
        "items": [{"product_id": world["product"].id, "quantity": qty, "unit_price": price, "warrenty_month": "12", "quote_item_id": quote["items"][0]["id"]}],
    }


def _batch(c, *groups):
    return c.post(f"{PUR}/orders/batch", json={"groups": list(groups)})


class TestLegacyEndpointRemoved:
    def test_create_po_endpoint_is_gone(self, superclient, world):
        q = _quote(superclient, world)
        r = superclient.post(f"{Q}/{q['id']}/create-po", json={"first_suppliers_id": world["sup"].id, "second_suppliers_id": world["sup2"].id,
                                                               "payment_method": "cash", "purchasing_invoice_no": "X", "good_received_note_date": date.today().isoformat()})
        assert r.status_code in (404, 405)


class TestQueueGate:
    @pytest.mark.parametrize("state", ["pending", "rejected", "cancelled"])
    def test_unapproved_or_closed_quotes_cannot_be_queued(self, superclient, world, state):
        q = _quote(superclient, world, approve=(state == "cancelled"))
        if state == "rejected":
            assert superclient.post(f"{A}/{q['approval_id']}/reject", json={"remarks": "no"}).status_code == 200
        if state == "cancelled":
            assert superclient.patch(f"{Q}/{q['id']}/status", json={"status": "cancelled", "reason": "x"}).status_code == 200
        r = superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, q)]})
        assert r.status_code == 400, r.text

    def test_approved_quote_can_be_queued_and_listed(self, superclient, world):
        q = _quote(superclient, world)
        r = superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, q)]})
        assert r.status_code == 201, r.text
        assert any(e["quote_item_id"] == q["items"][0]["id"] for e in r.json())

    @pytest.mark.parametrize("patch", [
        {"quantity": 0}, {"quantity": -1}, {"quantity": 2 ** 40}, {"supplier_id": 2 ** 40}, {"supplier_id": 0}, {"quote_item_id": 2 ** 40},
        {"unit_price": 0}, {"unit_price": -1}, {"unit_price": 1e30}, {"unit_price": "abc"},
    ])
    def test_item_validation(self, superclient, world, patch):
        q = _quote(superclient, world)
        r = superclient.post(f"{PUR}/procurement-queue", json={"items": [{**_qi(world, q), **patch}]})
        assert r.status_code in (400, 404, 422), (patch, r.text[:200])

    def test_nan_price_and_list_bounds(self, superclient, world):
        q = _quote(superclient, world)
        raw = '{"items":[{"quote_item_id":%d,"supplier_id":%d,"quantity":1,"unit_price":NaN}]}' % (q["items"][0]["id"], world["sup"].id)
        assert superclient.post(f"{PUR}/procurement-queue", content=raw, headers={"content-type": "application/json"}).status_code == 422
        assert superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, q)] * 201}).status_code == 422
        assert superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, q), _qi(world, q)]}).status_code == 422

    def test_price_above_selling_rejected(self, superclient, world):
        q = _quote(superclient, world, price=300)
        assert superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, q, price=5000)]}).status_code == 400

    def test_delete_bounds(self, superclient):
        assert superclient.delete(f"{PUR}/procurement-queue/{2 ** 40}").status_code == 422
        assert superclient.delete(f"{PUR}/procurement-queue/0").status_code == 422
        assert superclient.delete(f"{PUR}/procurement-queue/{2 ** 31 - 1}").status_code == 404


class TestQueueBranchScope:
    def test_other_branch_cannot_queue_or_delete_and_never_sees_foreign_rows(self, superclient, api, make_user, world):
        from app.auth.models import Permission  # noqa: F401  (ensures models are loaded)
        mine, other = world["branch"], world["other"]
        user, token = make_user(permissions=[("purchase_orders", "view"), ("purchase_orders", "create")], branches=[mine])
        qa = _quote(superclient, world, branch=mine)
        qb = _quote(superclient, world, branch=other)
        entry_b = [e for e in superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, qb, qty=1)]}).json() if e["quote_item_id"] == qb["items"][0]["id"]][0]
        c = api(token)
        assert c.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, qb, qty=1)]}).status_code == 403
        ok = c.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, qa, qty=1)]})
        assert ok.status_code == 201, ok.text
        assert {e["branch_code"] for e in ok.json()} <= {mine.branch_code}
        assert c.delete(f"{PUR}/procurement-queue/{entry_b['id']}").status_code == 403


class TestBatchPo:
    def test_group_branch_must_match_the_quotation(self, superclient, world):
        q = _quote(superclient, world)
        r = _batch(superclient, _group(world, q, branch=world["other"]))
        assert r.status_code == 400, r.text

    def test_price_above_selling_rejected(self, superclient, world):
        q = _quote(superclient, world, price=300)
        assert _batch(superclient, _group(world, q, price=5000)).status_code == 400

    def test_partial_order_keeps_the_rest_orderable_and_full_order_closes_the_item(self, superclient, world):
        q = _quote(superclient, world, qty=5)
        r1 = _batch(superclient, _group(world, q, qty=2))
        assert r1.status_code == 201, r1.text
        g = superclient.get(f"{Q}/{q['id']}").json()
        assert g["items"][0]["item_status"] == "procurement" and g["items"][0]["converted_qty"] == 2 and g["status"] == "partially_processed"
        assert _batch(superclient, _group(world, q, qty=4)).status_code == 400  # only 3 left
        r2 = _batch(superclient, _group(world, q, qty=3))
        assert r2.status_code == 201, r2.text
        g = superclient.get(f"{Q}/{q['id']}").json()
        assert g["items"][0]["item_status"] == "po_created" and g["items"][0]["converted_qty"] == 5
        assert _batch(superclient, _group(world, q, qty=1)).status_code == 400

    def test_cancelling_a_po_gives_the_quantity_back(self, superclient, world):
        q = _quote(superclient, world, qty=5)
        po = _batch(superclient, _group(world, q, qty=2)).json()["orders"][0]
        assert superclient.post(f"{PUR}/orders/{po['id']}/cancel", json={"reason": "qa"}).status_code == 200
        g = superclient.get(f"{Q}/{q['id']}").json()
        assert g["items"][0]["converted_qty"] == 0 and g["items"][0]["item_status"] == "pending" and g["status"] == "approved"
        assert _batch(superclient, _group(world, q, qty=5)).status_code == 201

    def test_rejecting_a_po_gives_the_quantity_back(self, superclient, world):
        q = _quote(superclient, world, qty=4)
        po = _batch(superclient, _group(world, q, qty=4)).json()["orders"][0]
        assert superclient.post(f"{A}/{po['approval_id']}/reject", json={"remarks": "no"}).status_code == 200
        g = superclient.get(f"{Q}/{q['id']}").json()
        assert g["items"][0]["converted_qty"] == 0 and g["items"][0]["item_status"] == "pending"
        assert _batch(superclient, _group(world, q, qty=4)).status_code == 201

    def test_queue_entry_is_consumed_by_the_po(self, superclient, world):
        q = _quote(superclient, world, qty=5)
        superclient.post(f"{PUR}/procurement-queue", json={"items": [_qi(world, q, qty=5)]})
        assert _batch(superclient, _group(world, q, qty=2)).status_code == 201
        rows = [e for e in superclient.get(f"{PUR}/procurement-queue").json() if e["quote_item_id"] == q["items"][0]["id"]]
        assert rows == []


class TestSameLineTwice:
    def test_the_same_quotation_line_twice_in_one_po_is_checked_as_a_sum(self, superclient, world):
        q = _quote(superclient, world, qty=5)
        g = _group(world, q, qty=3)
        g["items"] = g["items"] * 2  # 3 + 3 > 5
        assert _batch(superclient, g).status_code == 400
        g["items"] = [{**g["items"][0], "quantity": 2}, {**g["items"][0], "quantity": 3}]
        assert _batch(superclient, g).status_code == 201
