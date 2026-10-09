"""Quotations and quotation approvals: validation, approval gate, branch scope, maker-checker, listing."""
from datetime import date, timedelta

import pytest

Q = "/api/v1/sales/quotes"
A = "/api/v1/common/approvals"


def _item(world, **kw):
    return {"product_id": world["product"].id, "quantity": 2, "selling_price": 100, "minimum_selling_price": 80, "warrenty_month": "12", **kw}


def _body(world, branch=None, **kw):
    b = {
        "branch_code": (branch or world["branch"]).branch_code, "customer_id": world["customer"].id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(), "items": [_item(world)],
    }
    b.update(kw)
    return b


@pytest.fixture
def world(make_branch, make_customer, make_product):
    return {"branch": make_branch(), "other": make_branch(), "customer": make_customer(), "product": make_product()}


@pytest.fixture
def quote(superclient, world):
    r = superclient.post(f"{Q}/", json=_body(world))
    assert r.status_code == 201, r.text
    return r.json()


class TestCreateValidation:
    @pytest.mark.parametrize("patch", [
        {"items": []}, {"valid_until": "2000-01-01"}, {"valid_until": "2999-01-01"}, {"valid_until": "2026-02-30"},
        {"expected_delivery_date": "2000-01-01"}, {"tax_mode": "weird"}, {"tax_rate": 101},
        {"discount_type": "percentage", "discount_value": 150}, {"discount_value": "NaN"}, {"discount_type": "fixed", "discount_value": -1},
        {"remarks": "R" * 2001}, {"terms_conditions": "T" * 5001}, {"customer_notes": "N" * 2001},
        {"customer_id": 2 ** 40}, {"customer_id": 0}, {"sale_rep_id": 2 ** 40}, {"customer_agent_id": 2 ** 40}, {"branch_code": " "},
        {"branch_code": "B" * 201}, {"quote_type": "invoice"},
    ])
    def test_header_rejected(self, superclient, world, patch):
        r = superclient.post(f"{Q}/", json=_body(world, **patch))
        assert r.status_code == 422, (patch, r.text[:200])

    @pytest.mark.parametrize("patch", [
        {"quantity": 0}, {"quantity": -1}, {"quantity": 2 ** 40}, {"selling_price": 0}, {"selling_price": -1}, {"selling_price": 1e30},
        {"selling_price": "NaN"}, {"selling_price": 50, "minimum_selling_price": 80}, {"warrenty_month": "forever"}, {"warrenty_month": "9" * 10000},
        {"remark": "r" * 501}, {"description": "d" * 1001}, {"discount_percent": 101}, {"product_id": 2 ** 40}, {"product_id": 0},
        {"price_tier_id": 2 ** 40}, {"min_price": 10, "max_price": 5},
    ])
    def test_line_rejected(self, superclient, world, patch):
        r = superclient.post(f"{Q}/", json=_body(world, items=[_item(world, **patch)]))
        assert r.status_code == 422, (patch, r.text[:200])

    def test_agent_cannot_be_the_customer_and_fixed_discount_is_bounded(self, superclient, world):
        assert superclient.post(f"{Q}/", json=_body(world, customer_agent_id=world["customer"].id)).status_code == 422
        r = superclient.post(f"{Q}/", json=_body(world, discount_type="fixed", discount_value=1e8))
        assert r.status_code == 400

    def test_valid_create_records_the_creator_and_ignores_mass_assignment(self, superclient, superuser, world):
        r = superclient.post(f"{Q}/", json=_body(world, status="approved", approval=True, quote_no="HACK", total_amount=1, created_by=99))
        assert r.status_code == 201, r.text
        j = r.json()
        assert j["status"] == "pending_approval" and j["approval"] is False and j["quote_no"] != "HACK" and j["total_amount"] == 200
        assert j["version"]
        assert superclient.get(f"{Q}/{j['id']}").json()["created_by_name"]

    def test_unknown_references(self, superclient, world):
        assert superclient.post(f"{Q}/", json=_body(world, customer_id=99999999)).status_code == 404
        assert superclient.post(f"{Q}/", json=_body(world, branch_code="NO-SUCH")).status_code in (400, 404)


class TestUpdateRules:
    @pytest.mark.parametrize("patch", [
        {"items": []}, {"branch_code": None}, {"customer_id": None}, {"valid_until": "2000-01-01"}, {"remarks": "R" * 2001},
        {"discount_type": "percentage", "discount_value": 150}, {"items": [_item({"product": type("P", (), {"id": 1})()}, quantity=-1)]},
    ])
    def test_rejected(self, superclient, quote, patch):
        assert superclient.put(f"{Q}/{quote['id']}", json=patch).status_code == 422

    def test_unknown_branch_is_refused_not_stored(self, superclient, quote):
        assert superclient.put(f"{Q}/{quote['id']}", json={"branch_code": "NO-SUCH"}).status_code in (400, 404)
        assert superclient.get(f"{Q}/{quote['id']}").json()["branch_code"] == quote["branch_code"]

    def test_stale_version_is_409(self, superclient, quote):
        assert superclient.put(f"{Q}/{quote['id']}", json={"remarks": "a", "expected_version": quote["version"]}).status_code == 200
        assert superclient.put(f"{Q}/{quote['id']}", json={"remarks": "b", "expected_version": quote["version"]}).status_code == 409

    def test_ids_are_bounded(self, superclient):
        assert superclient.get(f"{Q}/{2 ** 31}").status_code == 422
        assert superclient.put(f"{Q}/{2 ** 40}", json={}).status_code == 422
        assert superclient.delete(f"{Q}/{2 ** 40}").status_code == 422
        assert superclient.patch(f"{Q}/{2 ** 40}/status", json={"status": "cancelled"}).status_code == 422
        assert superclient.get(f"{Q}/0").status_code == 422


class TestApprovalGate:
    @pytest.fixture
    def manager(self, make_user, world):
        return make_user(permissions=[("quotations", "view"), ("quotations", "create"), ("quotations", "update"), ("quotations", "delete")], branches=[world["branch"]])

    def test_status_patch_cannot_approve_or_complete(self, superclient, api, manager, world):
        _u, token = manager
        c = api(token)
        mine = c.post(f"{Q}/", json=_body(world)).json()
        for target in ("approved", "completed", "rejected", "pending_approval", "revised", "so_created", "partially_processed", "sent"):
            assert c.patch(f"{Q}/{mine['id']}/status", json={"status": target}).status_code == 400, target
        assert c.post(f"{Q}/{mine['id']}/accept").status_code == 400
        assert c.patch(f"{Q}/{mine['id']}/status", json={"status": "bogus"}).status_code == 422
        got = c.get(f"{Q}/{mine['id']}").json()
        assert got["status"] == "pending_approval" and got["approval"] is False

    def test_customer_facing_actions_need_internal_approval(self, superclient, quote):
        qid = quote["id"]
        for path in ("accept", "submit-to-customer", "customer-approve", "under-review", "send"):
            assert superclient.post(f"{Q}/{qid}/{path}", json={}).status_code == 400, path
        assert superclient.get(f"{Q}/{qid}").json()["status"] == "pending_approval"

    def test_after_the_real_approval_the_flow_works(self, superclient, quote):
        assert superclient.post(f"{A}/{quote['approval_id']}/approve", json={}).status_code == 200
        qid = quote["id"]
        assert superclient.get(f"{Q}/{qid}").json()["status"] == "approved"
        assert superclient.post(f"{Q}/{qid}/send").status_code == 200
        assert superclient.post(f"{Q}/{qid}/accept").status_code == 200

    def test_revising_a_pending_quote_closes_its_approval(self, superclient, quote):
        r = superclient.post(f"{Q}/{quote['id']}/revise", json={})
        assert r.status_code == 200, r.text
        assert superclient.get(f"{A}/{quote['approval_id']}").json()["status"] == "cancelled"
        assert superclient.post(f"{Q}/{quote['id']}/revise", json={}).status_code == 400  # already revised

    def test_cancel_needs_a_reason_and_closes_the_approval(self, superclient, quote):
        assert superclient.post(f"{Q}/{quote['id']}/cancel").status_code == 422
        assert superclient.post(f"{Q}/{quote['id']}/cancel", params={"reason": "   "}).status_code == 422
        assert superclient.post(f"{Q}/{quote['id']}/cancel", params={"reason": "x" * 501}).status_code == 422
        assert superclient.post(f"{Q}/{quote['id']}/cancel", params={"reason": "customer withdrew"}).status_code == 200
        assert superclient.get(f"{A}/{quote['approval_id']}").json()["status"] == "cancelled"

    def test_delete_closes_the_approval_and_refuses_processed_quotes(self, superclient, db, quote, world):
        keep = superclient.post(f"{Q}/", json=_body(world)).json()
        from app.modules.sales.quotation_models import SalesQuote

        db.query(SalesQuote).filter(SalesQuote.id == keep["id"]).update({"converted_to_invoice_id": None, "linked_po_id": None})
        row = db.query(SalesQuote).filter(SalesQuote.id == keep["id"]).first()
        item = row.items[0]
        item.item_status = "so_created"
        db.flush()
        assert superclient.delete(f"{Q}/{keep['id']}").status_code == 400
        assert superclient.delete(f"{Q}/{quote['id']}").status_code == 204
        assert superclient.get(f"{A}/{quote['approval_id']}").json()["status"] == "cancelled"

    def test_pending_quote_cannot_be_rejected_outside_approvals(self, superclient, quote):
        assert superclient.post(f"{Q}/{quote['id']}/reject-quote", json={"reason": "x"}).status_code == 400


class TestBranchScope:
    @pytest.fixture
    def officer(self, make_user, world):
        return make_user(permissions=[("quotations", "view"), ("quotations", "create"), ("quotations", "update"), ("quotations", "delete")], branches=[world["branch"]])

    def test_other_branch_quotes_are_off_limits(self, superclient, api, officer, world):
        other = superclient.post(f"{Q}/", json=_body(world, world["other"])).json()
        _u, token = officer
        c = api(token)
        oid = other["id"]
        assert c.get(f"{Q}/{oid}").status_code == 403
        assert c.put(f"{Q}/{oid}", json={"remarks": "idor"}).status_code == 403
        assert c.delete(f"{Q}/{oid}").status_code == 403
        assert c.post(f"{Q}/{oid}/cancel", params={"reason": "idor"}).status_code == 403
        assert c.patch(f"{Q}/{oid}/status", json={"status": "cancelled"}).status_code == 403
        assert c.post(f"{Q}/{oid}/revise", json={}).status_code == 403
        assert c.get(f"{Q}/{oid}/stock-availability").status_code == 403
        assert c.post(f"{Q}/", json=_body(world, world["other"])).status_code == 403
        assert c.get(f"{Q}/", params={"branch_code": world["other"].branch_code}).status_code == 403
        rows = c.get(f"{Q}/", params={"per_page": 200}).json()["items"]
        assert all(r["branch_code"] == world["branch"].branch_code for r in rows)
        assert c.get(f"{Q}/{oid}").json()["detail"].startswith("Access denied")

    def test_own_branch_works_and_cannot_move_elsewhere(self, api, officer, world):
        _u, token = officer
        c = api(token)
        mine = c.post(f"{Q}/", json=_body(world))
        assert mine.status_code == 201, mine.text
        assert c.get(f"{Q}/{mine.json()['id']}").status_code == 200
        assert c.put(f"{Q}/{mine.json()['id']}", json={"branch_code": world["other"].branch_code}).status_code == 403
        assert c.put(f"{Q}/{mine.json()['id']}", json={"remarks": "mine"}).status_code == 200

    def test_approvals_respect_branch_and_maker_checker(self, superclient, superuser, api, make_user, world):
        other = superclient.post(f"{Q}/", json=_body(world, world["other"])).json()
        approver, token = make_user(permissions=[("quotation_approvals", "approve"), ("quotation_approvals", "view"), ("quotations", "view"), ("quotations", "create"), ("common", "view")], branches=[world["branch"]])
        c = api(token)
        assert c.post(f"{A}/{other['approval_id']}/approve", json={}).status_code == 403
        assert c.post(f"{A}/{other['approval_id']}/reject", json={"remarks": "idor"}).status_code == 403
        assert all(a["id"] != other["approval_id"] for a in c.get(f"{A}/pending", params={"approval_type": "sales_quote"}).json())
        mine = c.post(f"{Q}/", json=_body(world)).json()
        assert c.post(f"{A}/{mine['approval_id']}/approve", json={}).status_code == 403  # creator cannot approve
        assert api(superuser[1]).post(f"{A}/{mine['approval_id']}/approve", json={}).status_code == 200


class TestListing:
    def test_total_is_the_real_count_and_search_is_literal(self, superclient, quote):
        full = superclient.get(f"{Q}/", params={"per_page": 200}).json()
        assert full["total"] == len(full["items"]) or full["total"] > len(full["items"])
        assert superclient.get(f"{Q}/", params={"per_page": 1}).json()["total"] == full["total"] >= 1
        assert superclient.get(f"{Q}/", params={"search": "%"}).json()["total"] == 0
        assert superclient.get(f"{Q}/", params={"search": quote["quote_no"]}).json()["total"] == 1

    def test_search_by_customer_name_sort_and_bounds(self, superclient, world, quote):
        name = world["customer"].customer_name
        assert superclient.get(f"{Q}/", params={"search": name}).json()["total"] >= 1
        d = superclient.get(f"{Q}/", params={"sort_by": "quote_no", "order": "asc", "per_page": 200}).json()["items"]
        nos = [x["quote_no"] for x in d]
        assert nos == sorted(nos)
        assert superclient.get(f"{Q}/", params={"sort_by": "x; drop table sales_quotes"}).status_code == 200
        for params in ({"per_page": 201}, {"per_page": 0}, {"page": 0}, {"customer_id": 2 ** 40}, {"status": "bogus"}, {"search": "a" * 300}):
            assert superclient.get(f"{Q}/", params=params).status_code == 422, params
        assert superclient.get(f"{Q}/expiring", params={"days": 10 ** 9}).status_code == 422
