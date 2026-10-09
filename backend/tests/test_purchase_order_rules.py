"""Purchase orders and PO approvals: validation, branch scope, maker-checker, paging, route order."""
from datetime import date, timedelta

import pytest

P = "/api/v1/purchasing"
A = "/api/v1/common/approvals"


def _body(branch, supplier, product, **kw):
    today = date.today().isoformat()
    b = {
        "branch_code": branch.branch_code, "payment_method": "Non-credit", "purchasing_order_date": today,
        "good_received_note_date": today, "first_suppliers_id": supplier.id,
        "items": [{"product_id": product.id, "quantity": 2, "unit_price": 10, "warrenty_month": "12"}],
    }
    b.update(kw)
    return b


@pytest.fixture
def world(make_branch, make_supplier, make_product):
    return {"branch": make_branch(), "other": make_branch(), "supplier": make_supplier(), "product": make_product()}


@pytest.fixture
def po(superclient, world):
    r = superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"]))
    assert r.status_code == 201, r.text
    return r.json()


def _item(world, **kw):
    return {"product_id": world["product"].id, "quantity": 2, "unit_price": 10, "warrenty_month": "12", **kw}


class TestCreateValidation:
    @pytest.mark.parametrize("patch", [
        {"items": []}, {"payment_method": "bitcoin"}, {"payment_method": " "}, {"payment_method": "P" * 31},
        {"purchasing_order_date": "1999-01-01"}, {"purchasing_order_date": "2999-01-01"}, {"purchasing_order_date": "2026-02-30"},
        {"credit_date": -1}, {"credit_date": 2 ** 40}, {"remarks": "R" * 2001}, {"purchasing_invoice_no": "I" * 201},
        {"first_suppliers_id": 2 ** 40}, {"first_suppliers_id": 0}, {"branch_code": " "}, {"branch_code": "B" * 201},
        {"sales_quote_id": 2 ** 40},
    ])
    def test_header_rejected(self, superclient, world, patch):
        r = superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], **patch))
        assert r.status_code == 422, (patch, r.text[:200])

    @pytest.mark.parametrize("patch", [
        {"quantity": 0}, {"quantity": -3}, {"quantity": 2 ** 40}, {"unit_price": 0}, {"unit_price": -5}, {"unit_price": 1e30},
        {"warrenty_month": ""}, {"warrenty_month": "forever"}, {"warrenty_month": "9" * 10000}, {"remark": "r" * 501},
        {"product_id": 2 ** 40}, {"product_id": 0},
    ])
    def test_line_rejected(self, superclient, world, patch):
        r = superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], items=[_item(world, **patch)]))
        assert r.status_code == 422, (patch, r.text[:200])

    def test_cross_field_rules(self, superclient, world):
        today = date.today()
        b = lambda **k: superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], **k)).status_code
        assert b(good_received_note_date=(today - timedelta(days=5)).isoformat()) == 422
        assert b(required_date=(today - timedelta(days=5)).isoformat()) == 422
        assert b(second_suppliers_id=world["supplier"].id) == 422
        assert b(items=[_item(world), _item(world, unit_price=11)]) == 201  # the same product on two lines is allowed

    def test_prices_round_to_two_decimals_and_zero_second_supplier_means_none(self, superclient, world):
        r = superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], second_suppliers_id=0,
                                                       items=[_item(world, unit_price=10.555)]))
        assert r.status_code == 201, r.text
        assert r.json()["second_suppliers_id"] is None
        assert r.json()["total_amount"] in ("21.12", "21.10", "21.1")  # 2 x 10.56 (banker's or half-up), never 21.11

    def test_unknown_branch_or_supplier(self, superclient, world):
        assert superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], branch_code="NO-SUCH")).status_code in (400, 404)
        assert superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], first_suppliers_id=99999999)).status_code == 404

    def test_client_cannot_set_status_or_totals(self, superclient, world):
        r = superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"], status="approved", total_amount=1, paid_amount=99, created_by=99))
        assert r.status_code == 201
        j = r.json()
        assert j["status"] == "pending_approval" and j["paid_amount"] == "0.00" and j["created_by"] != 99


class TestUpdateRules:
    def test_status_cannot_be_patched(self, superclient, po):
        r = superclient.patch(f"{P}/orders/{po['id']}", json={"status": "completed", "remarks": "x"})
        assert r.status_code == 200
        assert superclient.get(f"{P}/orders/{po['id']}").json()["status"] == "pending_approval"

    @pytest.mark.parametrize("patch", [
        {"branch_code": None}, {"payment_method": " "}, {"payment_method": "bitcoin"}, {"items": []}, {"items": [{"product_id": 1, "quantity": -1, "unit_price": 1, "warrenty_month": "1"}]},
        {"credit_date": -1}, {"first_suppliers_id": 2 ** 40}, {"purchasing_order_date": "x"}, {"remarks": "R" * 2001}, {"purchasing_order_date": None},
    ])
    def test_rejected(self, superclient, po, patch):
        assert superclient.patch(f"{P}/orders/{po['id']}", json=patch).status_code == 422

    def test_dates_stay_consistent_after_merge(self, superclient, po):
        old = (date.today() - timedelta(days=30)).isoformat()
        assert superclient.patch(f"{P}/orders/{po['id']}", json={"good_received_note_date": old}).status_code == 422

    def test_cancelled_po_is_read_only(self, superclient, po):
        assert superclient.post(f"{P}/orders/{po['id']}/cancel", json={"reason": "qa"}).status_code == 200
        assert superclient.patch(f"{P}/orders/{po['id']}", json={"remarks": "x"}).status_code == 400

    def test_cancel_and_short_close_reasons(self, superclient, po):
        for body in ({}, {"reason": " "}, {"reason": "x" * 501}):
            assert superclient.post(f"{P}/orders/{po['id']}/cancel", json=body).status_code == 422
            assert superclient.post(f"{P}/orders/{po['id']}/short-close", json=body).status_code == 422


class TestBoundsAndParams:
    def test_ids_and_query_params(self, superclient, po):
        assert superclient.get(f"{P}/orders/{2 ** 31}").status_code == 422
        assert superclient.patch(f"{P}/orders/{2 ** 40}", json={}).status_code == 422
        assert superclient.post(f"{P}/orders/{2 ** 40}/cancel", json={"reason": "x"}).status_code == 422
        assert superclient.get(f"{P}/orders/0").status_code == 422
        for params in ({"date_from": "nope"}, {"supplier_id": 2 ** 40}, {"skip": 2 ** 40}, {"limit": 0}):
            assert superclient.get(f"{P}/orders", params=params).status_code == 422, params
        assert superclient.get(f"{P}/orders", params={"status": "bogus"}).json() == []

    def test_helper_endpoints(self, superclient, world):
        code = world["branch"].branch_code
        assert superclient.get(f"{P}/orders/daily-limit/{code}", params={"check_date": "nope"}).status_code == 422
        assert superclient.get(f"{P}/orders/daily-limit/{code}").status_code == 200
        assert superclient.get(f"{P}/orders/available-stock", params={"product_ids": "a,b", "branch_code": code}).status_code == 422
        assert superclient.get(f"{P}/orders/available-stock", params={"product_ids": ",".join(map(str, range(1, 300))), "branch_code": code}).status_code == 422
        s = world["supplier"].id
        for params in ({"po_value": -5}, {"po_value": "nan"}, {"po_value": 1e30}, {"supplier_id": 2 ** 40, "po_value": 1}):
            q = {"supplier_id": s, **params}
            assert superclient.post(f"{P}/orders/check-credit", params=q).status_code == 422, params
        assert superclient.post(f"{P}/orders/check-credit", params={"supplier_id": s, "po_value": 100}).status_code == 200

    def test_daily_limit_of_five(self, superclient, world):
        codes = [superclient.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"])).status_code for _ in range(7)]
        assert codes.count(201) == 5 and codes.count(400) == 2


class TestBranchScope:
    @pytest.fixture
    def officer(self, make_user, world):
        return make_user(permissions=[("purchase_orders", "view"), ("purchase_orders", "update"), ("purchase_orders", "create")], branches=[world["branch"]])

    def test_other_branch_orders_are_off_limits(self, superclient, api, officer, world):
        other_po = superclient.post(f"{P}/orders", json=_body(world["other"], world["supplier"], world["product"])).json()
        _u, token = officer
        c = api(token)
        assert c.get(f"{P}/orders/{other_po['id']}").status_code == 403
        assert c.patch(f"{P}/orders/{other_po['id']}", json={"remarks": "idor"}).status_code == 403
        assert c.post(f"{P}/orders/{other_po['id']}/cancel", json={"reason": "idor"}).status_code == 403
        assert c.post(f"{P}/orders/{other_po['id']}/short-close", json={"reason": "idor"}).status_code == 403
        assert c.get(f"{P}/orders", params={"branch_code": world["other"].branch_code}).status_code == 403
        assert c.get(f"{P}/orders/paged", params={"branch_code": world["other"].branch_code}).status_code == 403
        assert c.post(f"{P}/orders", json=_body(world["other"], world["supplier"], world["product"])).status_code == 403
        assert c.get(f"{P}/orders/daily-limit/{world['other'].branch_code}").status_code == 403
        assert all(o["branch_code"] == world["branch"].branch_code for o in c.get(f"{P}/orders", params={"limit": 1000}).json())

    def test_own_branch_works_and_cannot_move_a_po_elsewhere(self, superclient, api, officer, world):
        _u, token = officer
        c = api(token)
        mine = c.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"]))
        assert mine.status_code == 201, mine.text
        oid = mine.json()["id"]
        assert c.get(f"{P}/orders/{oid}").status_code == 200
        assert c.patch(f"{P}/orders/{oid}", json={"branch_code": world["other"].branch_code}).status_code == 403
        assert c.patch(f"{P}/orders/{oid}", json={"remarks": "mine"}).status_code == 200


class TestApprovals:
    def test_static_routes_are_reachable(self, superclient, po):
        r = superclient.get(f"{A}/pending", params={"approval_type": "purchase_order"})
        assert r.status_code == 200, r.text
        assert any(a["id"] == po["approval_id"] for a in r.json())
        assert superclient.get(f"{A}/statistics").status_code == 200
        assert "purchase_order" in superclient.get(f"{A}/types").json()
        assert superclient.get(f"{A}/pending", params={"approval_type": "bogus"}).status_code == 422
        assert superclient.get(f"{A}/pending", params={"limit": 0}).status_code == 422

    def test_reject_needs_a_real_reason_and_bounded_input(self, superclient, po):
        aid = po["approval_id"]
        for body in ({}, {"remarks": "   "}):
            assert superclient.post(f"{A}/{aid}/reject", json=body).status_code == 400
        assert superclient.post(f"{A}/{aid}/reject", json={"remarks": "x" * 501}).status_code == 422
        assert superclient.post(f"{A}/{aid}/approve", json={"remarks": "x" * 501}).status_code == 422
        assert superclient.post(f"{A}/{2 ** 40}/approve", json={}).status_code == 422
        assert superclient.get(f"{A}/{2 ** 40}").status_code == 422
        assert superclient.post(f"{A}/{aid}/approve", json={"approver_username": "admin"}).status_code == 400
        assert superclient.post(f"{A}/{aid}/reject", json={"remarks": "no stock"}).status_code == 200
        assert superclient.get(f"{P}/orders/{po['id']}").json()["status"] == "rejected"
        assert superclient.post(f"{A}/{aid}/approve", json={}).status_code == 400

    def test_creator_cannot_approve_their_own_po(self, superclient, superuser, api, make_user, world):
        approver, token = make_user(permissions=[("purchase_orders", "view"), ("purchase_orders", "create"), ("po_approvals", "approve"), ("po_approvals", "view")], branches=[world["branch"]])
        c = api(token)
        mine = c.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"]))
        assert mine.status_code == 201, mine.text
        assert c.post(f"{A}/{mine.json()['approval_id']}/approve", json={}).status_code == 403
        assert c.get(f"{P}/orders/{mine.json()['id']}").json()["status"] == "pending_approval"
        # a different approver (here the superuser) can
        assert api(superuser[1]).post(f"{A}/{mine.json()['approval_id']}/approve", json={}).status_code == 200

    def test_approver_of_another_branch_is_refused(self, superclient, api, make_user, world):
        po = superclient.post(f"{P}/orders", json=_body(world["other"], world["supplier"], world["product"])).json()
        _u, token = make_user(permissions=[("po_approvals", "approve"), ("po_approvals", "view"), ("purchase_orders", "view"), ("common", "view")], branches=[world["branch"]])
        c = api(token)
        assert c.post(f"{A}/{po['approval_id']}/approve", json={}).status_code == 403
        assert c.post(f"{A}/{po['approval_id']}/reject", json={"remarks": "idor"}).status_code == 403
        assert all(a["id"] != po["approval_id"] for a in c.get(f"{A}/pending", params={"approval_type": "purchase_order"}).json())

    def test_permission_still_required(self, api, make_user, world):
        _u, token = make_user(permissions=[("purchase_orders", "create"), ("purchase_orders", "view")], branches=[world["branch"]])
        c = api(token)
        po = c.post(f"{P}/orders", json=_body(world["branch"], world["supplier"], world["product"])).json()
        assert c.post(f"{A}/{po['approval_id']}/approve", json={}).status_code == 403


class TestPaged:
    def test_paging_search_sort_status(self, superclient, make_branch, make_supplier, make_product):
        sup, prod = make_supplier(company_name="ZZ Pager Supplier"), make_product()
        branches = [make_branch() for _ in range(2)]
        for b in branches:
            for _ in range(3):
                assert superclient.post(f"{P}/orders", json=_body(b, sup, prod)).status_code == 201
        tag = {"supplier_id": sup.id}
        p0 = superclient.get(f"{P}/orders/paged", params={**tag, "size": 4, "page": 0}).json()
        assert p0["total"] == 6 and p0["pages"] == 2 and len(p0["items"]) == 4
        ids = [o["id"] for pg in (0, 1) for o in superclient.get(f"{P}/orders/paged", params={**tag, "size": 4, "page": pg}).json()["items"]]
        assert len(ids) == 6 and len(set(ids)) == 6
        assert superclient.get(f"{P}/orders/paged", params={**tag, "q": "Pager"}).json()["total"] == 6
        assert superclient.get(f"{P}/orders/paged", params={**tag, "q": "%"}).json()["total"] == 0
        assert superclient.get(f"{P}/orders/paged", params={**tag, "status": "approved"}).json()["total"] == 0
        assert superclient.get(f"{P}/orders/paged", params={**tag, "branch_code": branches[0].branch_code}).json()["total"] == 3
        d = superclient.get(f"{P}/orders/paged", params={**tag, "sort_by": "purchasing_order_no", "order": "asc", "size": 6}).json()["items"]
        nos = [o["purchasing_order_no"] for o in d]
        assert nos == sorted(nos)
        assert superclient.get(f"{P}/orders/paged", params={"sort_by": "x; drop table purchasing_orders"}).status_code == 200
        assert superclient.get(f"{P}/orders/paged", params={"size": 0}).status_code == 422

    def test_unfiltered_total_matches_list(self, superclient, po):
        full = superclient.get(f"{P}/orders", params={"limit": 100000}).json()
        assert superclient.get(f"{P}/orders/paged", params={"size": 1}).json()["total"] == len(full)
