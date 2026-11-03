"""QA audit fixes (2026-11-03), purchasing + inventory.

A refused request ends the test's transaction, so each test makes at most one
refused call, and makes it last.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta

import pytest

from app.modules.inventory.models import SalesStock
from app.modules.purchasing.models import GoodReceivedNote, PurchasingOrder
from tests.integration.test_workflows.test_grn_receive_cancel import P, _body, _uid, world  # noqa: F401

I = "/api/v1/inventory"
TODAY = str(date.today())


def _receive(client, w, qty=10, **over):
    r = client.post(f"{P}/grn/receive", json=_body(
        w, [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": qty}],
        supplier_invoice_no=_uid("INV"), **over))
    assert r.status_code == 201, r.text
    return r.json()["grn"]


def _invoice_body(w, grn, qty=10, price=10.0, payment_type="non_credit", **over):
    body = {
        "supplier_invoice_no": _uid("SI"), "supplier_invoice_date": TODAY, "supplier_id": w["po"].first_suppliers_id,
        "branch_code": w["branch"].branch_code, "received_date": TODAY, "due_date": TODAY,
        "payment_type": payment_type, "subtotal": qty * price, "tax_amount": 0, "discount_amount": 0,
        "total_amount": qty * price,
        "items": [{"grn_id": grn["id"], "purchasing_order_id": w["po"].id, "product_id": w["products"]["none"].id,
                   "quantity": qty, "unit_price": price, "line_total": qty * price}],
    }
    body.update(over)
    return body


def _invoice(client, w, grn, **kw):
    r = client.post(f"{P}/invoices", json=_invoice_body(w, grn, **kw))
    assert r.status_code == 201, r.text
    return r.json()


def _pay_body(w, invoice_id, amount, **over):
    body = {"supplier_id": w["po"].first_suppliers_id, "payment_date": TODAY, "payment_method": "Cash",
            "payment_amount": amount, "branch_code": w["branch"].branch_code,
            "allocations": [{"purchase_invoice_id": invoice_id, "allocated_amount": amount}]}
    body.update(over)
    return body


def _lot(db, grn_id):
    return db.query(SalesStock).filter(SalesStock.good_received_note_id == grn_id).first()


# ── PUR-01 / PUR-02 / PUR-14: a receipt belongs to its PO's branch and date ──────────────────────
class TestReceiptBranch:
    def test_other_branch_on_the_payload_is_refused(self, superclient, world, make_branch, make_location):  # noqa: F811
        other = make_branch()
        r = superclient.post(f"{P}/grn/receive", json=_body(
            world, [{"purchasing_order_items_id": world["items"]["none"].id, "quantity": 1}],
            branch_code=other.branch_code, good_received_locations_id=make_location(branch=other).id))
        assert r.status_code == 400 and "belongs to branch" in r.text, r.text

    def test_location_of_another_branch_is_refused(self, superclient, world, make_location):  # noqa: F811
        r = superclient.post(f"{P}/grn/receive", json=_body(
            world, [{"purchasing_order_items_id": world["items"]["none"].id, "quantity": 1}],
            good_received_locations_id=make_location().id))
        assert r.status_code == 400 and "is not in branch" in r.text, r.text

    def test_user_without_the_po_branch_cannot_receive(self, api, make_user, make_branch, world):  # noqa: F811
        mine = make_branch()
        _u, tok = make_user(permissions=[("grn", "create"), ("sales_stock", "create")], branches=[mine])
        r = api(tok).post(f"{P}/grn/receive", json=_body(
            world, [{"purchasing_order_items_id": world["items"]["none"].id, "quantity": 1}]))
        assert r.status_code == 403, r.text

    def test_receipt_cannot_predate_the_po(self, superclient, db, world):  # noqa: F811
        world["po"].purchasing_order_date = date.today()
        db.flush()
        r = superclient.post(f"{P}/grn/receive", json=_body(
            world, [{"purchasing_order_items_id": world["items"]["none"].id, "quantity": 1}],
            good_received_date=str(date.today() - timedelta(days=3))))
        assert r.status_code == 400 and "before the purchase order date" in r.text, r.text


# ── PUR-03: legacy line-by-line receipt ───────────────────────────────────────────────────────
class TestLegacyReceipt:
    def _cancelled_grn(self, db, w):
        grn = GoodReceivedNote(
            good_received_no=_uid("GRN"), good_received_date=date.today(), supplier_invoice_no=_uid("SI"),
            supplier_invoice_date=date.today(), branch_code=w["branch"].branch_code, created_date=date.today(),
            good_received_locations_id=w["location"].id, purchasingorders_id=w["po"].id,
            added_date=datetime.utcnow(), status="cancelled")
        db.add(grn)
        db.flush()
        return grn

    def test_grn_item_on_a_cancelled_grn_is_refused(self, superclient, db, world):  # noqa: F811
        grn = self._cancelled_grn(db, world)
        r = superclient.post(f"{P}/grn-items", json={
            "good_received_note": grn.good_received_no, "branch_code": world["branch"].branch_code,
            "purchasing_order_items_id": world["items"]["none"].id, "quantity": 1})
        assert r.status_code == 400 and "cancelled" in r.text, r.text

    def test_grn_item_needs_the_grn_branch(self, api, make_user, make_branch, db, world):  # noqa: F811
        grn = self._cancelled_grn(db, world)
        _u, tok = make_user(permissions=[("grn", "create")], branches=[make_branch()])
        r = api(tok).post(f"{P}/grn-items", json={
            "good_received_note": grn.good_received_no, "branch_code": world["branch"].branch_code,
            "purchasing_order_items_id": world["items"]["none"].id, "quantity": 1})
        assert r.status_code == 403, r.text

    def test_stock_on_a_cancelled_grn_is_refused(self, superclient, db, world):  # noqa: F811
        grn = self._cancelled_grn(db, world)
        r = superclient.post(f"{I}/sales-stock", json={
            "product_id": world["products"]["none"].id, "branch_code": world["branch"].branch_code,
            "good_received_note_id": grn.id, "purchasing_order_items_id": world["items"]["none"].id, "quantity": 1})
        assert r.status_code == 400 and "cancelled" in r.text, r.text

    def test_stock_in_another_branch_than_the_grn_is_refused(self, superclient, db, world, make_branch):  # noqa: F811
        grn = _receive(superclient, world, qty=1)
        other = make_branch()
        r = superclient.post(f"{I}/sales-stock", json={
            "product_id": world["products"]["none"].id, "branch_code": other.branch_code,
            "good_received_note_id": grn["id"], "purchasing_order_items_id": world["items"]["none"].id, "quantity": 1})
        assert r.status_code == 400 and "belongs to branch" in r.text, r.text


# ── PUR-04 / PUR-16: invoice edit uses the create checks; empty / zero invoices refused ───────
class TestInvoiceEdit:
    def test_valid_edit_still_works(self, superclient, world):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world))
        r = superclient.patch(f"{P}/invoices/{inv['id']}", json={"remarks": "edited"})
        assert r.status_code == 200, r.text
        assert float(r.json()["total_amount"]) == 100.0

    @pytest.mark.parametrize("patch", [
        {"total_amount": 1},
        {"due_date": "2020-01-01"},
        {"supplier_invoice_no": ""},
    ])
    def test_edit_breaking_a_create_rule_is_refused(self, superclient, world, patch):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world))
        assert superclient.patch(f"{P}/invoices/{inv['id']}", json=patch).status_code == 400

    def test_edit_cannot_invoice_more_than_received(self, superclient, world):  # noqa: F811
        grn = _receive(superclient, world, qty=10)
        inv = _invoice(superclient, world, grn, qty=5, price=10.0)
        items = _invoice_body(world, grn, qty=11)["items"]
        r = superclient.patch(f"{P}/invoices/{inv['id']}", json={"items": items})
        assert r.status_code == 400, r.text

    def test_edit_replacing_own_lines_within_received_is_fine(self, superclient, world):  # noqa: F811
        grn = _receive(superclient, world, qty=10)
        inv = _invoice(superclient, world, grn, qty=10)
        items = _invoice_body(world, grn, qty=8)["items"]
        r = superclient.patch(f"{P}/invoices/{inv['id']}", json={"items": items})
        assert r.status_code == 200, r.text
        assert float(r.json()["total_amount"]) == 80.0 and float(r.json()["balance_due"]) == 80.0

    def test_zero_quantity_invoice_is_refused(self, superclient, world):  # noqa: F811
        grn = _receive(superclient, world)
        r = superclient.post(f"{P}/invoices", json=_invoice_body(world, grn, qty=0))
        assert r.status_code == 400, r.text


# ── PUR-06: returned goods are not invoiceable ───────────────────────────────────────────────
class TestReturnedGoodsNotInvoiceable:
    def _return(self, client, db, w, grn, qty):
        lot = _lot(db, grn["id"])
        r = client.post(f"{P}/returns", json={
            "branch_code": w["branch"].branch_code, "goodreceivednote_id": grn["id"], "reason": "Quality issue",
            "remark": "x", "require_approval": True,
            "items": [{"product_id": w["products"]["none"].id, "purchasing_price": 10, "return_price": 10,
                       "sales_stock_id": lot.id, "quantity": qty}]})
        assert r.status_code == 201, r.text

    def test_invoiceable_list_and_invoice_exclude_returned_units(self, superclient, db, world):  # noqa: F811
        grn = _receive(superclient, world, qty=10)
        self._return(superclient, db, world, grn, 4)
        rows = superclient.get(f"{P}/invoices/supplier/{world['po'].first_suppliers_id}/invoiceable-grns").json()
        row = next(r for r in rows if r["grn_id"] == grn["id"])
        assert row["remaining_qty"] == 6 and row["products"][0]["quantity"] == 6
        assert superclient.post(f"{P}/invoices", json=_invoice_body(world, grn, qty=10)).status_code == 400

    def test_the_rest_can_be_invoiced(self, superclient, db, world):  # noqa: F811
        grn = _receive(superclient, world, qty=10)
        self._return(superclient, db, world, grn, 4)
        assert superclient.post(f"{P}/invoices", json=_invoice_body(world, grn, qty=6)).status_code == 201


# ── PUR-05 / 07 / 08 / 09 / 10 / 25: supplier payments ───────────────────────────────────────
class TestSupplierPayments:
    def _po_payment(self, client, w, amount, **over):
        body = {"supplier_id": w["po"].first_suppliers_id, "purchasing_order_id": w["po"].id, "payment_date": TODAY,
                "payment_method": "cash", "payment_amount": amount, "branch_code": w["branch"].branch_code,
                "payment_for": "PO"}
        body.update(over)
        return client.post(f"{P}/supplier-payments", json=body)

    def test_payment_above_the_po_value_is_refused(self, superclient, world):  # noqa: F811
        # PO value: 3x10 + 100x10 + 50x10 = 1530
        assert self._po_payment(superclient, world, 99_999_999).status_code == 400

    def test_payment_for_a_po_of_another_branch_is_refused(self, superclient, world, make_branch):  # noqa: F811
        r = self._po_payment(superclient, world, 10, branch_code=make_branch().branch_code)
        assert r.status_code == 400 and "belongs to branch" in r.text, r.text

    def test_amount_edit_is_held_to_the_po_limit(self, superclient, world):  # noqa: F811
        pay = self._po_payment(superclient, world, 50).json()
        ok = superclient.patch(f"{P}/supplier-payments/{pay['id']}", json={"payment_amount": 60})
        assert ok.status_code == 200 and float(ok.json()["payment_amount"]) == 60.0
        assert superclient.patch(f"{P}/supplier-payments/{pay['id']}", json={"payment_amount": 5000}).status_code == 400

    def test_status_cannot_be_patched(self, superclient, world):  # noqa: F811
        pay = self._po_payment(superclient, world, 50).json()
        assert superclient.patch(f"{P}/supplier-payments/{pay['id']}", json={"status": "verified"}).status_code == 400

    def test_allocated_payment_amount_is_locked(self, superclient, world):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world), payment_type="credit",
                       due_date=str(date.today() + timedelta(days=30)))
        pay = superclient.post(f"{P}/invoices/pay", json=_pay_body(world, inv["id"], 50)).json()
        assert pay["status"] == "pending"
        r = superclient.patch(f"{P}/supplier-payments/{pay['payment_id']}", json={"payment_amount": 5000})
        assert r.status_code == 400 and "allocated" in r.text, r.text

    def test_allocated_payment_cannot_be_deleted(self, superclient, world):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world), payment_type="credit",
                       due_date=str(date.today() + timedelta(days=30)))
        pay = superclient.post(f"{P}/invoices/pay", json=_pay_body(world, inv["id"], 50)).json()
        r = superclient.delete(f"{P}/supplier-payments/{pay['payment_id']}")
        assert r.status_code == 400 and "cancel it instead" in r.text, r.text

    def test_pending_payment_does_not_reduce_the_statement(self, superclient, world):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world), payment_type="credit",
                       due_date=str(date.today() + timedelta(days=30)))
        sid = world["po"].first_suppliers_id
        before = superclient.get(f"{P}/suppliers/{sid}/statement").json()["current_balance"]
        pay = superclient.post(f"{P}/invoices/pay", json=_pay_body(world, inv["id"], 50)).json()
        assert pay["status"] == "pending"
        assert superclient.get(f"{P}/suppliers/{sid}/statement").json()["current_balance"] == before

    def test_invoice_payment_in_the_future_is_refused(self, superclient, world):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world))
        r = superclient.post(f"{P}/invoices/pay", json=_pay_body(world, inv["id"], 10, payment_date="2099-01-01"))
        assert r.status_code == 400, r.text

    def test_invoice_payment_with_an_unknown_method_is_refused(self, superclient, world):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world))
        r = superclient.post(f"{P}/invoices/pay", json=_pay_body(world, inv["id"], 10, payment_method="Bitcoin"))
        assert r.status_code == 422, r.text

    def test_invoice_paid_from_another_branch_is_refused(self, superclient, world, make_branch):  # noqa: F811
        inv = _invoice(superclient, world, _receive(superclient, world))
        r = superclient.post(f"{P}/invoices/pay", json=_pay_body(world, inv["id"], 10, branch_code=make_branch().branch_code))
        assert r.status_code == 400, r.text


# ── PUR-12 / PUR-13: purchase returns ────────────────────────────────────────────────────────
class TestPurchaseReturns:
    def _body(self, stock, branch, **item):
        line = {"product_id": stock.product_id, "purchasing_price": 100, "return_price": 100, "barcode": stock.barcode}
        line.update(item)
        return {"branch_code": branch.branch_code, "goodreceivednote_id": stock.good_received_note_id,
                "reason": "Quality issue", "remark": "x", "require_approval": False, "items": [line]}

    def test_user_who_cannot_approve_cannot_skip_approval(self, api, make_user, make_branch, make_sales_stock):
        branch = make_branch()
        stock = make_sales_stock(branch=branch)
        _u, tok = make_user(permissions=[("purchase_returns", "create")], branches=[branch])
        r = api(tok).post(f"{P}/returns", json=self._body(stock, branch))
        assert r.status_code == 201, r.text
        assert r.json()["status"] == "pending"

    def test_line_product_must_match_the_unit(self, superclient, make_branch, make_sales_stock, make_product):
        branch = make_branch()
        stock = make_sales_stock(branch=branch)
        r = superclient.post(f"{P}/returns", json=self._body(stock, branch, product_id=make_product().id))
        assert r.status_code == 400 and "does not match" in r.text, r.text


# ── PUR-15 / 17 / 20 / 22: purchase orders ──────────────────────────────────────────────────
class TestPurchaseOrders:
    def test_empty_patch_keeps_an_approved_po_approved(self, superclient, world):  # noqa: F811
        r = superclient.patch(f"{P}/orders/{world['po'].id}", json={})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "approved"

    def test_edit_with_an_inactive_product_is_refused(self, superclient, world, make_product):  # noqa: F811
        p = make_product(active=False)
        r = superclient.patch(f"{P}/orders/{world['po'].id}", json={"items": [
            {"product_id": p.id, "quantity": 1, "unit_price": 10, "warrenty_month": "0"}]})
        assert r.status_code == 400 and "inactive" in r.text, r.text

    def test_cancelled_po_does_not_count_against_the_daily_limit(self, db, world):  # noqa: F811
        from app.modules.purchasing.repository import PurchasingOrderRepository

        repo = PurchasingOrderRepository(db)
        branch = world["branch"].branch_code
        before = repo.count_daily_orders_by_branch(branch, date.today())
        db.add(PurchasingOrder(
            purchasing_order_no=_uid("PO"), branch_code=branch, payment_method="credit",
            purchasing_order_date=date.today(), good_received_note_date=date.today(), created_date=date.today(),
            first_suppliers_id=world["po"].first_suppliers_id, added_date=datetime.now(), status="cancelled"))
        db.flush()
        assert repo.count_daily_orders_by_branch(branch, date.today()) == before

    def test_approved_unreceived_po_can_be_short_closed(self, superclient, world):  # noqa: F811
        r = superclient.post(f"{P}/orders/{world['po'].id}/short-close", json={"reason": "supplier cannot deliver"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "short_closed"


# ── PUR-19: landed cost voucher date ─────────────────────────────────────────────────────────
def test_future_landed_cost_voucher_is_refused(superclient, world):  # noqa: F811
    grn = _receive(superclient, world)
    r = superclient.post(f"{P}/grn/{grn['id']}/landed-costs", json={
        "charge_type": "freight", "amount": 10, "payment_method": "cash", "voucher_date": "2099-01-01"})
    assert r.status_code == 400, r.text


# ── PUR-23 / INV-03: reads by id stay inside the user's branches ─────────────────────────────
class TestBranchScopedReads:
    # The api/superclient fixtures share one client: switch to the outsider's token
    # only after the superuser set-up calls.
    @pytest.fixture
    def outsider(self, api, make_user, make_branch):
        _u, tok = make_user(
            permissions=[("grn", "view"), ("supplier_payments", "view"), ("sales_stock", "view")],
            branches=[make_branch()])
        return lambda: api(tok)

    def test_grn_items_by_po(self, superclient, world, outsider):  # noqa: F811
        assert outsider().get(f"{P}/grn-items/by-po/{world['po'].id}").status_code == 403

    def test_grn_payment_history(self, superclient, world, outsider):  # noqa: F811
        grn = _receive(superclient, world)
        assert outsider().get(f"{P}/grn/{grn['id']}/payment-history").status_code == 403

    def test_stock_by_grn(self, superclient, world, outsider):  # noqa: F811
        grn = _receive(superclient, world)
        assert outsider().get(f"{I}/sales-stock/grn/{grn['id']}").status_code == 403

    def test_stock_tracking(self, make_sales_stock, outsider):
        stock = make_sales_stock()
        assert outsider().get(f"{I}/sales-stock/{stock.id}/tracking").status_code == 403

    def test_stock_by_barcode(self, make_sales_stock, outsider):
        stock = make_sales_stock()
        assert outsider().get(f"{I}/sales-stock/barcode/{stock.barcode}").status_code == 403


# ── INV-01 / 02 / 04 / 05: catalog ───────────────────────────────────────────────────────────
class TestCatalog:
    def _product_body(self, make_product, **over):
        ref = make_product()
        body = {"name": _uid("Prod"), "item_type": "inventory", "tracking_type": "none", "cost_price": 100,
                "selling_price": 150, "minimum_selling_price": 120, "category_id": ref.category_id,
                "items_brand_id": ref.items_brand_id}
        body.update(over)
        return body

    def test_default_tier_uses_the_minimum_and_follows_edits(self, superclient, make_product):
        prod = superclient.post(f"{I}/products/", json=self._product_body(make_product))
        assert prod.status_code == 201, prod.text
        pid = prod.json()["id"]
        tier = superclient.get(f"{I}/products/{pid}/price-tiers").json()[0]
        assert float(tier["minimum_selling_price"]) == 120.0
        r = superclient.put(f"{I}/products/{pid}", json={"cost_price": 110, "selling_price": 160})
        assert r.status_code == 200, r.text
        tier = superclient.get(f"{I}/products/{pid}/price-tiers").json()[0]
        assert float(tier["cost_price"]) == 110.0 and float(tier["selling_price"]) == 160.0
        assert float(tier["minimum_selling_price"]) == 120.0

    def test_last_active_tier_cannot_be_deleted(self, superclient, make_product):
        pid = superclient.post(f"{I}/products/", json=self._product_body(make_product)).json()["id"]
        default = superclient.get(f"{I}/products/{pid}/price-tiers").json()[0]
        t2 = superclient.post(f"{I}/products/{pid}/price-tiers", json={
            "cost_price": 100, "minimum_selling_price": 120, "selling_price": 150, "is_active": False}).json()
        assert t2["is_active"] is False
        assert superclient.delete(f"{I}/products/{pid}/price-tiers/{default['id']}").status_code == 400

    def test_category_in_use_cannot_be_deactivated(self, superclient, make_product):
        p = make_product()
        r = superclient.put(f"{I}/categories/{p.category_id}", json={"active": False})
        assert r.status_code == 400 and "active product" in r.text, r.text

    def test_brand_in_use_cannot_be_deactivated(self, superclient, make_product):
        p = make_product()
        r = superclient.put(f"{I}/brands/{p.items_brand_id}", json={"active": False})
        assert r.status_code == 400 and "active product" in r.text, r.text

    def test_product_with_stock_cannot_be_deactivated(self, superclient, make_sales_stock):
        stock = make_sales_stock()
        r = superclient.put(f"{I}/products/{stock.product_id}", json={"active": False})
        assert r.status_code == 400 and "stock on hand" in r.text, r.text


# ── PUR-24: create responses carry the same derived fields as the lists ───────────────────────
class TestCreateResponses:
    def test_receive_response_has_value_po_and_supplier(self, superclient, world):  # noqa: F811
        g = _receive(superclient, world, qty=4)
        assert float(g["total_value"]) == 40.0 and g["units_received"] == 4
        assert g["po_no"] == world["po"].purchasing_order_no and g["supplier_name"]

    def test_return_response_has_grn_po_supplier_and_totals(self, superclient, make_branch, make_sales_stock):
        branch = make_branch()
        stock = make_sales_stock(branch=branch)
        r = superclient.post(f"{P}/returns", json={
            "branch_code": branch.branch_code, "goodreceivednote_id": stock.good_received_note_id,
            "reason": "Quality issue", "remark": "x", "require_approval": True,
            "items": [{"product_id": stock.product_id, "purchasing_price": 100, "return_price": 80,
                       "barcode": stock.barcode}]})
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["grn_no"] and body["po_no"] and body["supplier_name"]
        assert body["total_quantity"] == 1 and float(body["total_amount"]) == 80.0 and len(body["items"]) == 1
