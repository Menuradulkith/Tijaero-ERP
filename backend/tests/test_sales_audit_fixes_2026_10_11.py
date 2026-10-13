"""Regression tests for the 2026-10-11 sales order / sale return audit (rows 7, 8, 9, 15, 16, 17)."""
import pytest

S = "/api/v1/sales"
APPROVALS = "/api/v1/common/approvals"
ORDER_PERMS = [("hr_dashboard", "view"), ("sales_orders", "view"), ("sales_orders", "create"), ("sales_orders", "update"),
               ("sales_returns", "view"), ("sales_returns", "create"), ("sales_returns", "update")]
RET_APPROVER = [("sales_return_approvals", "view"), ("sales_return_approvals", "approve")]


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(3):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(), p


def _body(shop, rep_id, qty=1, price=100.0, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": c.id, "sale_rep_id": rep_id, "payment_method": "cash", "cash_amount": price * qty,
            "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0, "warrenty_month": "12"}]}
    body.update(over)
    return body


# ---- #7 branch-scoped stock ----
class TestBranchStock:
    def test_other_branch_units_are_not_available(self, superclient, superuser, shop, make_branch, make_sales_stock):
        b, c, p = shop
        other = make_branch()
        for _ in range(5):
            make_sales_stock(product=p, branch=other)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, qty=4))  # branch b has only 3
        assert r.status_code in (400, 409), r.text

    def test_allocation_uses_only_the_orders_branch(self, db, superclient, superuser, shop, make_branch, make_sales_stock):
        from app.modules.inventory.models import SalesStock
        b, c, p = shop
        other = make_branch()
        foreign = [make_sales_stock(product=p, branch=other) for _ in range(3)]
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, qty=3))
        assert r.status_code == 201, r.text
        assert all(s.status == "available" for s in foreign)
        assert db.query(SalesStock).filter(SalesStock.product_id == p.id, SalesStock.branch_code == b.branch_code,
                                           SalesStock.status == "available").count() == 0

    def test_barcode_of_another_branch_is_rejected(self, superclient, superuser, shop, make_branch, make_sales_stock):
        b, c, p = shop
        other = make_branch()
        foreign = make_sales_stock(product=p, branch=other, barcode="QA-FOREIGN-BC")
        body = _body(shop, superuser[0].id)
        body["items"][0]["barcode"] = foreign.barcode
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 409, r.text
        assert foreign.status == "available"


# ---- #8 / #9 credit ----
class TestCreditRules:
    def test_override_flag_is_superuser_only(self, api, make_user, shop):
        user, tok = make_user(permissions=ORDER_PERMS, branches=[shop[0]])
        r = api(tok).post(S + "/", json=_body(shop, user.id, payment_method="credit", cash_amount=0, override_credit_validation=True))
        assert r.status_code == 403 and "superuser" in r.text

    def test_superuser_may_override(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="credit", cash_amount=0, override_credit_validation=True))
        assert r.status_code == 201, r.text

    def test_credit_amount_is_computed_server_side(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=400.0, payment_method="credit", cash_amount=100.0,
                                                 credit_amount=1.0, override_credit_validation=True))
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["credit_amount"] == 300.0 and d["balance_due"] == 300.0

    def test_client_credit_cannot_underreport_full_credit_order(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=400.0, payment_method="credit", cash_amount=0,
                                                 credit_amount=1.0, override_credit_validation=True))
        assert r.status_code == 201, r.text
        assert r.json()["credit_amount"] == 400.0


# ---- #17 sale return schema bounds ----
class TestReturnSchemas:
    def test_return_full_rejects_oversized_or_out_of_range_input(self, superclient, superuser, shop):
        o = superclient.post(S + "/", json=_body(shop, superuser[0].id))
        assert o.status_code == 201, o.text
        url = f"{S}/{o.json()['id']}/return-full"
        base = {"payment_method": "cash"}
        assert superclient.post(url, json={**base, "return_reason": "x" * 100_000}).status_code == 422
        assert superclient.post(url, json={**base, "remark": "x" * 100_000}).status_code == 422
        assert superclient.post(url, json={**base, "good_received_locations_id": 2 ** 40}).status_code == 422

    def test_create_return_rejects_out_of_range_ids(self, superclient, shop):
        body = {"branch_code": shop[0].branch_code, "invoice_id": 2 ** 40, "good_received_locations_id": 1, "payment_method": "cash", "items": []}
        assert superclient.post(S + "/returns/", json=body).status_code == 422
        body.update(invoice_id=1, good_received_locations_id=2 ** 40)
        assert superclient.post(S + "/returns/", json=body).status_code == 422
        body.update(good_received_locations_id=1, return_reason="x" * 600)
        assert superclient.post(S + "/returns/", json=body).status_code == 422


# ---- #15 / #16 sale return approval and processing ----
@pytest.fixture
def pending_return(db, superclient, superuser, shop, make_location):
    """A cash order and a pending full return."""
    o = superclient.post(S + "/", json=_body(shop, superuser[0].id))
    assert o.status_code == 201, o.text
    loc = make_location(branch_code=shop[0].branch_code)
    r = superclient.post(f"{S}/{o.json()['id']}/return-full", json={"payment_method": "cash", "good_received_locations_id": loc.id})
    assert r.status_code == 201, r.text
    from app.modules.sales.models import SaleReturn
    return db.query(SaleReturn).filter(SaleReturn.id == r.json()["id"]).first()


class TestSaleReturnApproval:
    def test_maker_cannot_approve_own_return(self, db, api, make_user, shop, pending_return):
        row = pending_return
        maker, mtok = make_user(permissions=RET_APPROVER, branches=[shop[0]])
        row.created_by = maker.id
        db.flush()
        r = api(mtok).post(f"{APPROVALS}/{row.approval_id}/approve", json={})
        assert r.status_code == 403 and "created" in r.text
        _, tok = make_user(permissions=RET_APPROVER, branches=[shop[0]])
        assert api(tok).post(f"{APPROVALS}/{row.approval_id}/approve", json={}).status_code == 200

    def test_other_branch_approver_is_refused(self, api, make_user, make_branch, pending_return):
        row = pending_return
        _, tok = make_user(permissions=RET_APPROVER, branches=[make_branch()])
        assert api(tok).post(f"{APPROVALS}/{row.approval_id}/approve", json={}).status_code == 403
        assert api(tok).post(f"{APPROVALS}/{row.approval_id}/reject", json={"remarks": "x"}).status_code == 403


class TestProcessReturn:
    def test_process_survives_a_failing_cashbook_function_and_twice_is_400(self, superclient, pending_return, monkeypatch):
        """fn_insert_cashbook_entry is missing on drifted DBs: the failure must not abort the request."""
        from sqlalchemy import text as sa_text
        from app.modules.sales import service as svc

        row = pending_return
        assert superclient.post(f"{APPROVALS}/{row.approval_id}/approve", json={}).status_code == 200
        monkeypatch.setattr(svc, "text", lambda sql: sa_text(str(sql).replace("fn_insert_cashbook_entry", "fn_qa_missing_function")))
        r = superclient.post(f"{S}/returns/{row.id}/process")
        assert r.status_code == 200, r.text
        assert superclient.post(f"{S}/returns/{row.id}/process").status_code == 400
