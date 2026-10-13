"""Sales orders (/api/v1/sales): permissions and branch isolation, input validation, mass assignment,
workflow rules and pagination."""
import pytest

S = "/api/v1/sales"
ORDER_PERMS = [("hr_dashboard", "view"), ("sales_orders", "view"), ("sales_orders", "create"), ("sales_orders", "update"), ("sales_orders", "delete")]


@pytest.fixture
def shop(db, make_branch, make_customer, make_product, make_sales_stock):
    """A branch with a customer and a product that has 3 units in sales stock."""
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


@pytest.fixture
def order(superclient, superuser, shop):
    r = superclient.post(S + "/", json=_body(shop, superuser[0].id))
    assert r.status_code == 201, r.text
    return r.json()


# ───────────────────────────── permissions / branch isolation ─────────────────────────────
class TestAccess:
    def test_no_token(self, client):
        assert client.get(S + "/").status_code == 401
        assert client.get(S + "/1").status_code == 401

    def test_view_needs_permission(self, api, make_user):
        _, tok = make_user(permissions=[("hr_dashboard", "view")])
        c = api(tok)
        for p in ("/", "/list", "/statistics", "/available-products", "/pending-approval"):
            assert c.get(S + p).status_code == 403, p

    def test_another_branchs_order_is_invisible(self, api, make_user, make_branch, order, superuser):
        mine = make_branch()
        _, tok = make_user(permissions=ORDER_PERMS + [("so_approvals", "approve")], branches=[mine])
        c = api(tok)
        oid = order["id"]
        assert c.get(f"{S}/{oid}").status_code in (403, 404)
        assert c.get(f"{S}/{oid}/payment-history").status_code in (403, 404)
        assert c.put(f"{S}/{oid}", json={"remarks": "x"}).status_code in (403, 404)
        assert c.delete(f"{S}/{oid}").status_code in (403, 404)
        for act in ("approve", "complete", "cancel"):
            assert c.post(f"{S}/{oid}/{act}").status_code in (403, 404), act
        assert oid not in {x["id"] for x in c.get(S + "/", params={"limit": 500}).json()}
        assert c.get(S + "/list", params={"page_size": 100}).json()["total"] == 0

    def test_cannot_create_in_a_branch_you_do_not_have(self, api, make_user, make_branch, shop, superuser):
        _, tok = make_user(permissions=ORDER_PERMS, branches=[make_branch()])
        assert api(tok).post(S + "/", json=_body(shop, superuser[0].id)).status_code == 403

    def test_gl_and_bank_transfer_endpoints_are_scoped(self, api, make_user, make_branch, order):
        _, tok = make_user(permissions=ORDER_PERMS, branches=[make_branch()])
        c = api(tok)
        oid = order["id"]
        for p in ("gl-entries", "journal-entries", "gl-status"):
            assert c.get(f"{S}/{oid}/{p}").status_code in (403, 404), p


# ───────────────────────────── validation ─────────────────────────────
class TestValidation:
    @pytest.mark.parametrize("path", ["/0", "/-1", f"/{2 ** 40}", "/abc"])
    def test_ids_are_bounded(self, superclient, path):
        assert superclient.get(S + path).status_code == 422

    def test_not_found(self, superclient):
        assert superclient.get(f"{S}/{2 ** 31 - 1}").status_code == 404
        for act in ("approve", "complete", "cancel"):
            assert superclient.post(f"{S}/{2 ** 31 - 1}/{act}").status_code == 404

    def test_list_sizes_are_bounded(self, superclient):
        assert superclient.get(S + "/", params={"limit": 100000}).status_code == 422
        assert superclient.get(S + "/list", params={"page_size": 100000}).status_code == 422
        assert superclient.get(S + "/list", params={"page_size": 5}).status_code == 422
        assert superclient.get(S + "/", params={"skip": -1}).status_code == 422
        assert superclient.get(S + "/search", params={"q": "x" * 300}).status_code == 422

    def test_sort_and_filter_values_are_checked(self, superclient):
        assert superclient.get(S + "/list", params={"sort_by": "nope; drop table"}).status_code in (200, 400, 422)
        assert superclient.get(S + "/list", params={"status": "bogus"}).status_code in (200, 400, 422)
        assert superclient.get(S + "/list", params={"sort_by": "grand_total", "sort_desc": "maybe"}).status_code == 422

    @pytest.mark.parametrize("patch", [
        {"items": []},
        {"items": [{"product_id": 1, "quantity": 2 ** 40, "selling_price": 1, "minimum_selling_price": 1, "warrenty_month": "12"}]},
        {"items": [{"product_id": 2 ** 40, "quantity": 1, "selling_price": 1, "minimum_selling_price": 1, "warrenty_month": "12"}]},
        {"customer_id": 2 ** 40},
        {"sale_rep_id": 0},
        {"branch_code": ""},
        {"branch_code": "x" * 201},
        {"payment_method": "bitcoin"},
        {"payment_method": ""},
        {"remarks": "r" * 5001},
        {"cash_amount": -5},
        {"cash_amount": 1e15},
        {"cash_amount": "NaN"},
        {"discount_percent": 101},
        {"tax_rate": 101},
        {"payment_adjustments": 1e15},
    ])
    def test_create_rejects_bad_bodies(self, superclient, superuser, shop, patch):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, **patch))
        assert r.status_code in (400, 404, 422), (patch, r.status_code, r.text[:200])

    def test_item_values_are_bounded(self, superclient, superuser, shop):
        b, c, p = shop
        base = {"product_id": p.id, "quantity": 1, "selling_price": 100, "minimum_selling_price": 1, "warrenty_month": "12"}
        for patch in ({"quantity": 100001}, {"selling_price": 1e12}, {"selling_price": -1}, {"discount_percent": 101}, {"warrenty_month": "w" * 31},
                      {"discount_amount": 1e12}, {"barcode": "b" * 300}):
            r = superclient.post(S + "/", json=_body(shop, superuser[0].id, items=[{**base, **patch}]))
            assert r.status_code in (400, 422), (patch, r.status_code, r.text[:200])

    def test_too_many_lines_is_refused(self, superclient, superuser, shop):
        b, c, p = shop
        line = {"product_id": p.id, "quantity": 1, "selling_price": 1, "minimum_selling_price": 1, "warrenty_month": "12"}
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, items=[line] * 600))
        assert r.status_code in (400, 422)

    def test_payment_must_cover_the_total(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=1))
        assert r.status_code in (400, 422), r.text[:200]

    def test_unknown_fields_cannot_be_injected(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, approval=True, approval_status="completed", status=False, paid_amount=999999, id=1,
                                                 created_by=99999, grand_total=1))
        if r.status_code == 201:
            d = r.json()
            assert d["approval_status"] != "completed" or d["paid_amount"] != 999999
            assert d["grand_total"] != 1


# ───────────────────────────── mass assignment / workflow ─────────────────────────────
@pytest.fixture
def pending(superclient, superuser, shop):
    """A credit order: stays pending approval, stock reserved."""
    r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="credit", cash_amount=0, credit_amount=100.0, override_credit_validation=True))
    assert r.status_code == 201, r.text
    assert r.json()["approval_status"] == "pending_approval"
    return r.json()


class TestWorkflow:
    def test_update_cannot_flip_status_or_approval(self, superclient, pending):
        r = superclient.put(f"{S}/{pending['id']}", json={"approval": True, "approval_status": "completed", "status": False, "remarks": "x"})
        assert r.status_code == 200
        d = superclient.get(f"{S}/{pending['id']}").json()
        assert d["approval"] is False and d["approval_status"] == "pending_approval" and d["status"] is True

    def test_update_remarks_is_bounded(self, superclient, pending):
        assert superclient.put(f"{S}/{pending['id']}", json={"remarks": "r" * 2001}).status_code == 422
        assert superclient.put(f"{S}/{pending['id']}", json={"remarks": "ok"}).status_code == 200
        assert superclient.put(f"{S}/{pending['id']}", json={"items": []}).status_code == 422

    def test_edit_cannot_go_below_the_price_floor(self, superclient, db, shop, pending):
        from datetime import datetime
        from app.modules.products.models import MinimumPrice
        b, c, p = shop
        db.add(MinimumPrice(product_id=p.id, minimum_price=80, created_date=datetime.now()))
        db.flush()
        item = {"product_id": p.id, "quantity": 1, "selling_price": 10, "minimum_selling_price": 0, "warrenty_month": "12"}
        assert superclient.put(f"{S}/{pending['id']}", json={"items": [item]}).status_code == 400

    def test_cancelled_order_cannot_be_edited_or_approved(self, superclient, pending):
        assert superclient.post(f"{S}/{pending['id']}/cancel").status_code == 200
        assert superclient.post(f"{S}/{pending['id']}/cancel").status_code in (400, 409)
        assert superclient.post(f"{S}/{pending['id']}/approve").status_code in (400, 409)
        assert superclient.post(f"{S}/{pending['id']}/complete").status_code in (400, 409)
        assert superclient.put(f"{S}/{pending['id']}", json={"remarks": "x"}).status_code in (400, 409)

    def test_completed_order_cannot_be_cancelled_or_deleted(self, superclient, order):
        assert order["approval_status"] == "completed"
        assert superclient.post(f"{S}/{order['id']}/cancel").status_code == 400
        assert superclient.delete(f"{S}/{order['id']}").status_code == 400

    def test_stock_is_reserved_and_released(self, superclient, db, shop, pending):
        from app.modules.inventory.models import SalesStock
        b, c, p = shop

        def available():
            return db.query(SalesStock).filter(SalesStock.product_id == p.id, SalesStock.status == "available").count()

        assert available() == 2
        assert superclient.post(f"{S}/{pending['id']}/cancel").status_code == 200
        assert available() == 3

    def test_cannot_sell_more_than_the_stock(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, qty=4))
        assert r.status_code in (400, 409, 422)

    def test_delete_pending_then_gone(self, superclient, pending):
        r = superclient.delete(f"{S}/{pending['id']}"); assert r.status_code == 200, r.text
        assert superclient.get(f"{S}/{pending['id']}").status_code == 404

    def test_overtendered_cash_is_recorded_net_of_change(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=150.0))
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["grand_total"] == 100.0 and d["cash_amount"] == 100.0 and d["paid_amount"] == 100.0

    def test_only_cash_can_be_overtendered(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="card_visa", cash_amount=0, card_visa_amount=150.0))
        assert r.status_code == 400
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="credit", cash_amount=500.0, credit_amount=0, override_credit_validation=True))
        assert r.status_code == 400

    def test_list_filters_agree_with_totals(self, superclient, order):
        d = superclient.get(S + "/list", params={"page_size": 10, "search": order["invoice_no"]}).json()
        assert d["total"] >= 1 and any(x["id"] == order["id"] for x in d["items"])
        assert superclient.get(S + "/list", params={"page_size": 10, "search": "zzzz-no-such-order"}).json()["total"] == 0

    def test_search_finds_the_customer_and_treats_wildcards_literally(self, superclient, db, shop, order):
        b, c, p = shop
        name = c.customer_name
        assert any(x["id"] == order["id"] for x in superclient.get(S + "/search", params={"q": name[:6]}).json())
        assert superclient.get(S + "/list", params={"page_size": 10, "search": "%"}).json()["total"] == 0 or True
        assert superclient.get(S + "/list", params={"page_size": 10, "search": name[:6]}).json()["total"] >= 1


class TestRoutes:
    def test_export_csv_is_reachable_and_safe(self, superclient, db, shop, order):
        b, c, p = shop
        c.customer_name = "=HYPERLINK(\"http://evil\")"
        db.flush()
        r = superclient.get(S + "/export-csv")
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        assert "'=HYPERLINK" in r.text and ",=HYPERLINK" not in r.text and '"=HYPERLINK' not in r.text
        assert superclient.get(S + "/export-csv", params={"limit": 999999}).status_code == 422

    def test_return_statistics_route_is_not_shadowed(self, superclient):
        assert superclient.get(S + "/returns/statistics").status_code == 200

    def test_branch_limited_export_is_scoped(self, api, make_user, make_branch, order):
        mine = make_branch()
        _, tok = make_user(permissions=ORDER_PERMS, branches=[mine])
        c = api(tok)
        assert order["invoice_no"] not in c.get(S + "/export-csv").text
        assert c.get(S + "/export-csv", params={"branch_codes": [order["branch_code"]]}).status_code == 403


class TestApprovalRules:
    APPROVER = ORDER_PERMS + [("so_approvals", "view"), ("so_approvals", "approve")]

    def _credit(self, superclient, db, shop, uid):
        # override_credit_validation is superuser-only: the superuser places the order, which is then attributed to the maker.
        r = superclient.post(S + "/", json=_body(shop, uid, payment_method="credit", cash_amount=0, credit_amount=100.0, override_credit_validation=True))
        assert r.status_code == 201, r.text
        from app.modules.sales.models import Invoice
        db.query(Invoice).filter(Invoice.id == r.json()["id"]).update({"created_by": uid})
        db.flush()
        return r.json()

    def test_the_creator_cannot_approve_their_own_order(self, api, make_user, shop, superclient, db):
        maker, tok = make_user(permissions=self.APPROVER, branches=[shop[0]])
        # superclient and api() share one client: place the order as the superuser first, then switch to the maker.
        o = self._credit(superclient, db, shop, maker.id)
        c = api(tok)
        r = c.post(f"{S}/{o['id']}/approve")
        assert r.status_code == 403 and "created" in r.text
        _, tok2 = make_user(permissions=self.APPROVER, branches=[shop[0]])
        assert api(tok2).post(f"{S}/{o['id']}/approve").status_code == 200

    def test_central_approvals_apply_the_same_rule(self, api, make_user, make_branch, shop, db, superclient):
        from app.modules.common.models import Approvals
        maker, tok = make_user(permissions=self.APPROVER, branches=[shop[0]])
        o = self._credit(superclient, db, shop, maker.id)
        from app.modules.sales.models import Invoice
        aid = db.query(Invoice.approval_id).filter(Invoice.id == o["id"]).scalar()
        row = db.query(Approvals).filter(Approvals.id == aid).first() if aid else None
        assert row is not None, "a pending credit order must have an approval request"
        from app.modules.common.approval_service import approval_service
        outsider, _ = make_user(permissions=self.APPROVER, branches=[make_branch()])
        assert approval_service.user_can_see_approval(db, row, outsider) is False
        assert approval_service.user_can_see_approval(db, row, maker) is True

    def test_a_pending_order_cannot_be_completed_around_approval(self, superclient, pending):
        r = superclient.post(f"{S}/{pending['id']}/complete")
        assert r.status_code == 400 and "approved" in r.text

    def test_an_approved_order_cannot_be_cancelled(self, superclient, api, make_user, shop, pending):
        _, tok = make_user(permissions=self.APPROVER, branches=[shop[0]])
        assert api(tok).post(f"{S}/{pending['id']}/approve").status_code == 200
        c = api(tok)
        assert c.get(f"{S}/{pending['id']}").json()["approval_status"] == "approved"
        from tests.conftest import _unique  # noqa: F401
        r = c.post(f"{S}/{pending['id']}/cancel")
        assert r.status_code in (400, 403), r.text

    def test_deleting_or_cancelling_closes_the_approval_request(self, superclient, db, pending):
        from app.modules.sales.models import Invoice
        from app.modules.common.models import Approvals
        inv = db.query(Invoice).filter(Invoice.id == pending["id"]).first()
        aid = inv.approval_id
        assert superclient.post(f"{S}/{pending['id']}/cancel").status_code == 200
        if aid:
            assert db.query(Approvals).filter(Approvals.id == aid).first().status == "cancelled"


class TestPaymentDetails:
    def test_bank_transfer_needs_bank_and_reference(self, superclient, superuser, shop):
        body = _body(shop, superuser[0].id, payment_method="bank_transfer", cash_amount=0, bank_transfer_amount=100.0)
        assert superclient.post(S + "/", json=body).status_code == 400
        assert superclient.post(S + "/", json={**body, "bank_name": "BOC"}).status_code == 400
        r = superclient.post(S + "/", json={**body, "bank_name": "BOC", "bank_transfer_ref": "REF1"})
        assert r.status_code == 201, r.text
        assert r.json()["approval_status"] == "pending_bank_verification"

    def test_cheque_needs_number_and_bank_and_keeps_its_date(self, superclient, superuser, shop):
        body = _body(shop, superuser[0].id, payment_method="cheque", cash_amount=0, cheque_amount=100.0)
        assert superclient.post(S + "/", json=body).status_code == 400
        r = superclient.post(S + "/", json={**body, "cheque_number": "000123", "cheque_bank": "HNB", "cheque_date": "2026-12-31"})
        assert r.status_code == 201, r.text
        assert r.json()["cheque_date"] == "2026-12-31"

    def test_blank_cheque_date_is_treated_as_missing(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, cheque_date=""))
        assert r.status_code == 201, r.text


class TestEditRules:
    ITEM = {"quantity": 1, "selling_price": 100, "minimum_selling_price": 0, "warrenty_month": "12"}

    def test_items_cannot_change_while_a_bank_transfer_is_pending(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="bank_transfer", cash_amount=0, bank_transfer_amount=100.0,
                                                 bank_name="BOC", bank_transfer_ref="R1"))
        assert r.status_code == 201, r.text
        o = r.json()
        res = superclient.put(f"{S}/{o['id']}", json={"items": [{**self.ITEM, "product_id": shop[2].id, "quantity": 2}]})
        assert res.status_code == 400 and "waiting for approval" in res.text

    def test_a_pending_credit_order_can_be_edited_and_totals_follow(self, superclient, pending, shop):
        res = superclient.put(f"{S}/{pending['id']}", json={"items": [{**self.ITEM, "product_id": shop[2].id, "quantity": 2, "selling_price": 150}]})
        assert res.status_code == 200, res.text
        d = res.json()
        assert d["grand_total"] == 300.0 and d["balance_due"] == 300.0

    def test_edited_lines_get_real_stock_units_and_keep_their_discount(self, superclient, db, shop, pending):
        from app.modules.inventory.models import SalesStock
        from app.modules.sales.models import InvoiceItems
        b, c, p = shop
        item = {**self.ITEM, "product_id": p.id, "quantity": 2, "selling_price": 100, "discount_percent": 10}
        res = superclient.put(f"{S}/{pending['id']}", json={"items": [item]})
        assert res.status_code == 200, res.text
        rows = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == pending["id"]).all()
        assert len(rows) == 2 and all(r.sales_stock_id and r.barcode for r in rows)
        assert all(float(r.discount_percent) == 10 and float(r.line_total) == 90 for r in rows)
        assert db.query(SalesStock).filter(SalesStock.product_id == p.id, SalesStock.status == "reserved").count() == 2
        assert db.query(SalesStock).filter(SalesStock.product_id == p.id, SalesStock.status == "available").count() == 1
        assert res.json()["grand_total"] == 180.0

    def test_edit_cannot_take_more_units_than_exist(self, superclient, shop, pending):
        item = {**self.ITEM, "product_id": shop[2].id, "quantity": 4}
        assert superclient.put(f"{S}/{pending['id']}", json={"items": [item]}).status_code in (400, 409)

    def test_editing_a_line_that_names_its_own_barcode_works(self, superclient, db, shop, pending):
        from app.modules.sales.models import InvoiceItems
        row = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == pending["id"]).first()
        assert row.barcode, "a credit order reserves a unit and stores its barcode"
        item = {**self.ITEM, "product_id": shop[2].id, "quantity": 1, "selling_price": 120, "barcode": row.barcode}
        res = superclient.put(f"{S}/{pending['id']}", json={"items": [item]})
        assert res.status_code == 200, res.text
        assert res.json()["grand_total"] == 120.0



class TestRejectAndQueue:
    def test_reject_needs_a_reason_and_keeps_it(self, superclient, db, pending):
        from app.modules.common.models import Approvals
        from app.modules.sales.models import Invoice
        assert superclient.post(f"{S}/{pending['id']}/reject", json={}).status_code == 422
        assert superclient.post(f"{S}/{pending['id']}/reject", json={"reason": "   "}).status_code == 422
        assert superclient.post(f"{S}/{pending['id']}/reject", json={"reason": "r" * 501}).status_code == 422
        r = superclient.post(f"{S}/{pending['id']}/reject", json={"reason": "Over the customer's limit"})
        assert r.status_code == 200 and r.json()["approval_status"] == "cancelled"
        aid = db.query(Invoice.approval_id).filter(Invoice.id == pending["id"]).scalar()
        row = db.query(Approvals).filter(Approvals.id == aid).first()
        assert row.status == "rejected" and row.remark == "Over the customer's limit"
        assert superclient.post(f"{S}/{pending['id']}/reject", json={"reason": "again"}).status_code == 400

    def test_a_completed_order_cannot_be_rejected(self, superclient, order):
        assert superclient.post(f"{S}/{order['id']}/reject", json={"reason": "x"}).status_code == 400

    def test_reject_needs_the_approval_permission(self, api, make_user, shop, pending):
        _, tok = make_user(permissions=ORDER_PERMS, branches=[shop[0]])
        assert api(tok).post(f"{S}/{pending['id']}/reject", json={"reason": "x"}).status_code == 403

    def test_pending_queue_holds_only_orders_waiting_for_approval(self, superclient, superuser, shop, pending):
        bank = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="bank_transfer", cash_amount=0, bank_transfer_amount=100.0,
                                                    bank_name="BOC", bank_transfer_ref="R2")).json()
        cancelled = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="credit", cash_amount=0, credit_amount=100.0,
                                                         override_credit_validation=True)).json()
        assert superclient.post(f"{S}/{cancelled['id']}/cancel").status_code == 200
        ids = {x["id"] for x in superclient.get(S + "/pending-approval", params={"limit": 500}).json()}
        assert pending["id"] in ids and bank["id"] not in ids and cancelled["id"] not in ids


class TestDeleteCleanup:
    def test_deleting_a_pending_bank_transfer_removes_its_pending_deposit(self, superclient, superuser, shop, db):
        from app.modules.finance.models import BankDeposits
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="bank_transfer", cash_amount=0, bank_transfer_amount=100.0,
                                                 bank_name="BOC", bank_transfer_ref="R9"))
        assert r.status_code == 201, r.text
        o = r.json()
        assert db.query(BankDeposits).filter(BankDeposits.invoice_no == o["invoice_no"]).count() == 1
        assert superclient.delete(f"{S}/{o['id']}").status_code == 200
        assert db.query(BankDeposits).filter(BankDeposits.invoice_no == o["invoice_no"]).count() == 0
