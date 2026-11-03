"""Regression tests for the 2026-11-03 Sales + Customers QA audit (SAL-01..30)."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

S = "/api/v1/sales"
C = "/api/v1/customers"
Q = "/api/v1/sales/quotes"
A = "/api/v1/common/approvals"


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(8):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(), p


def _order(shop, qty=1, price=100.0, customer=None, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": (customer or c).id,
            "payment_method": "cash", "cash_amount": price * qty,
            "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0,
                       "warrenty_month": "12"}]}
    body.update(over)
    return body


def _credit(superclient, shop, qty=1, price=100.0, customer=None):
    r = superclient.post(S + "/", json=_order(shop, qty, price, customer, payment_method="credit", cash_amount=0,
                                              override_credit_validation=True))
    assert r.status_code == 201, r.text
    return r.json()


def _items(shop, qty, price=100.0):
    return [{"product_id": shop[2].id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0,
             "warrenty_month": "12"}]


def _revenue_lines(db, invoice_id):
    from app.modules.finance.accounting_models import JournalEntry, JournalEntryLine

    return (db.query(JournalEntryLine).join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(JournalEntry.description.like(f"Auto GL - Sale Revenue%Invoice ID: {invoice_id}")).all())


# ---------------------------------------------------------------- SAL-01 / SAL-02
class TestCreditOrderEdit:
    def test_edit_keeps_credit_amount_and_journal_in_step(self, db, superclient, shop):
        o = _credit(superclient, shop, qty=1)
        r = superclient.put(f"{S}/{o['id']}", json={"items": _items(shop, 2)})
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["grand_total"] == pytest.approx(200.0) and j["credit_amount"] == pytest.approx(200.0)
        from app.modules.finance.models import CreditPayments
        from app.modules.sales.models import Invoice
        cp = db.query(CreditPayments).filter(CreditPayments.id == db.get(Invoice, o["id"]).credit_payment_id).first()
        assert Decimal(str(cp.amount)) == Decimal("200")

        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        lines = _revenue_lines(db, o["id"])
        assert lines, "the revenue journal entry must be posted"
        assert sum(Decimal(str(l.debit_amount or 0)) for l in lines) == sum(Decimal(str(l.credit_amount or 0)) for l in lines)
        st = superclient.get(f"{S}/{o['id']}/gl-status").json()
        assert st["gl_posted"] is True and st["revenue_posted"] is True

    def test_edit_beyond_credit_limit_is_refused(self, superclient, shop, make_customer):
        low = make_customer(max_credit_limit=300)
        o = _credit(superclient, shop, qty=1, customer=low)
        r = superclient.put(f"{S}/{o['id']}", json={"items": _items(shop, 4)})
        assert r.status_code == 400 and "Credit limit exceeded" in r.json()["detail"]
        # lowering the order is always allowed
        assert superclient.put(f"{S}/{o['id']}", json={"items": _items(shop, 1, 90.0)}).status_code == 200

    def test_gl_status_is_false_without_revenue(self, superclient, shop):
        o = _credit(superclient, shop)
        st = superclient.get(f"{S}/{o['id']}/gl-status").json()
        assert st["gl_posted"] is False and st["revenue_posted"] is False


# ---------------------------------------------------------------- SAL-03
class TestBankTransferMustCoverOrder:
    def test_short_transfer_refused(self, superclient, shop):
        r = superclient.post(S + "/", json=_order(shop, qty=1, payment_method="bank_transfer", cash_amount=0,
                                                  bank_transfer_amount=50, bank_name="BOC", bank_transfer_ref="QA-SHORT"))
        assert r.status_code == 400, r.text

    def test_full_transfer_accepted(self, superclient, shop):
        r = superclient.post(S + "/", json=_order(shop, qty=1, payment_method="bank_transfer", cash_amount=0,
                                                  bank_transfer_amount=100, bank_name="BOC", bank_transfer_ref="QA-FULL"))
        assert r.status_code == 201, r.text

    def test_verify_refuses_legacy_short_order(self, db, superclient, shop):
        r = superclient.post(S + "/", json=_order(shop, qty=1, payment_method="bank_transfer", cash_amount=0,
                                                  bank_transfer_amount=100, bank_name="BOC", bank_transfer_ref="QA-LEG"))
        from app.modules.sales.models import Invoice
        inv = db.get(Invoice, r.json()["id"])
        inv.bank_transfer_amount = 50  # a row created before the create-time check
        db.flush()
        v = superclient.post(f"{S}/{inv.id}/bank-transfer/verify")
        assert v.status_code == 400, v.text


# ---------------------------------------------------------------- SAL-04
def _approved_quote(c, shop, customer=None, qty=1, price=100):
    b, cust, p = shop
    r = c.post(f"{Q}/", json={
        "branch_code": b.branch_code, "customer_id": (customer or cust).id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(),
        "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 10, "warrenty_month": "12"}],
    })
    assert r.status_code == 201, r.text
    assert c.post(f"{A}/{r.json()['approval_id']}/approve", json={}).status_code == 200
    return r.json()


class TestQuoteConversionUsesOrderRules:
    def test_underpaid_cash_conversion_refused(self, superclient, shop):
        q = _approved_quote(superclient, shop)
        r = superclient.post(f"{Q}/{q['id']}/convert", json={"payment_method": "cash", "cash_amount": 10})
        assert r.status_code == 400 and "Insufficient payment" in r.json()["detail"]
        assert superclient.get(f"{Q}/{q['id']}").json()["status"] != "completed"

    def test_credit_conversion_checks_customer_eligibility(self, superclient, shop):
        q = _approved_quote(superclient, shop)  # make_customer has no e-mail: not eligible for credit
        r = superclient.post(f"{Q}/{q['id']}/convert", json={"payment_method": "credit"})
        assert r.status_code == 400, r.text

    def test_paid_conversion_posts_revenue(self, db, superclient, shop):
        q = _approved_quote(superclient, shop)
        r = superclient.post(f"{Q}/{q['id']}/convert", json={"payment_method": "cash", "cash_amount": 100})
        assert r.status_code == 200, r.text
        inv = superclient.get(f"{S}/{r.json()['invoice_id']}").json()
        assert inv["approval_status"] == "completed" and inv["payment_status"] == "paid"
        assert _revenue_lines(db, inv["id"])
        assert superclient.get(f"{Q}/{q['id']}").json()["status"] == "completed"
        assert superclient.post(f"{Q}/{q['id']}/convert", json={"payment_method": "cash", "cash_amount": 100}).status_code == 400


# ---------------------------------------------------------------- SAL-06 / SAL-18 / SAL-26
class TestCustomerSettlement:
    def _approved_credit(self, superclient, shop):
        o = _credit(superclient, shop)
        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        return o

    def test_multi_line_settlement_is_all_or_nothing(self, superclient, shop):
        o = self._approved_credit(superclient, shop)
        cash = superclient.post(S + "/", json=_order(shop)).json()
        body = {"branch_code": shop[0].branch_code, "customer_id": shop[1].id, "transactions": [
            {"payment_method": "cash", "cheque_date": date.today().isoformat(), "payment_amount": 40, "invoice_id": o["id"]},
            {"payment_method": "cash", "cheque_date": date.today().isoformat(), "payment_amount": 10, "invoice_id": cash["id"]},
        ]}
        r = superclient.post(f"{C}/{shop[1].id}/credit-settlements", json=body)
        assert r.status_code == 400, r.text
        assert superclient.get(f"{S}/{o['id']}").json()["balance_due"] == pytest.approx(100.0)

    def test_bad_method_in_second_line_writes_nothing(self, superclient, shop):
        o = self._approved_credit(superclient, shop)
        body = {"branch_code": shop[0].branch_code, "customer_id": shop[1].id, "transactions": [
            {"payment_method": "cash", "cheque_date": date.today().isoformat(), "payment_amount": 40, "invoice_id": o["id"]},
            {"payment_method": "bitcoin", "cheque_date": date.today().isoformat(), "payment_amount": 10, "invoice_id": o["id"]},
        ]}
        assert superclient.post(f"{C}/{shop[1].id}/credit-settlements", json=body).status_code == 400
        assert superclient.get(f"{S}/{o['id']}").json()["balance_due"] == pytest.approx(100.0)

    def test_cheque_settlement_needs_number_and_bank(self, superclient, shop):
        o = self._approved_credit(superclient, shop)
        r = superclient.post(f"{S}/{o['id']}/settle-payment", json={
            "payment_method": "cheque", "payment_amount": 10, "payment_date": date.today().isoformat()})
        assert r.status_code == 400, r.text
        ok = superclient.post(f"{S}/{o['id']}/settle-payment", json={
            "payment_method": "cheque", "payment_amount": 10, "payment_date": date.today().isoformat(),
            "cheque_number": "123456", "cheque_bank": "BOC"})
        assert ok.status_code == 200, ok.text

    def test_settlement_of_another_customer_is_not_found(self, superclient, shop, make_customer):
        o = self._approved_credit(superclient, shop)
        r = superclient.post(f"{S}/{o['id']}/settle-payment", json={
            "payment_method": "cash", "payment_amount": 10, "payment_date": date.today().isoformat()})
        sid = r.json()["settlement_record_id"]
        other = make_customer()
        assert superclient.get(f"{C}/{shop[1].id}/credit-settlements/{sid}").status_code == 200
        assert superclient.get(f"{C}/{other.id}/credit-settlements/{sid}").status_code == 404


# ---------------------------------------------------------------- SAL-07 / SAL-11 / SAL-12 / SAL-25
class TestSaleReturns:
    def _sold(self, superclient, shop, make_location):
        o = superclient.post(S + "/", json=_order(shop, qty=1)).json()
        loc = make_location(branch_code=shop[0].branch_code)
        return o, loc

    def _ret(self, o, loc, items, branch=None):
        return {"branch_code": branch or o["branch_code"], "invoice_id": o["id"], "good_received_locations_id": loc.id,
                "payment_method": "cash", "items": items}

    def test_empty_return_refused(self, superclient, shop, make_location):
        o, loc = self._sold(superclient, shop, make_location)
        assert superclient.post(f"{S}/returns/", json=self._ret(o, loc, [])).status_code == 400

    def test_return_branch_must_be_invoice_branch(self, superclient, shop, make_location, make_branch):
        o, loc = self._sold(superclient, shop, make_location)
        it = o["items"][0]
        item = {"barcode": it["barcode"], "return_price": 100, "sold_price": 100, "branch_code": o["branch_code"], "invoice_item_id": it["id"]}
        other = make_branch()
        r = superclient.post(f"{S}/returns/", json=self._ret(o, loc, [item], branch=other.branch_code))
        assert r.status_code == 400, r.text

    def test_branch_user_cannot_return_other_branch_invoice(self, api, superclient, shop, make_location, make_branch, make_user):
        o, loc = self._sold(superclient, shop, make_location)
        mine = make_branch()
        _u, tok = make_user(permissions=[("sales_returns", "create")], branches=[mine])
        it = o["items"][0]
        item = {"barcode": it["barcode"], "return_price": 100, "sold_price": 100, "branch_code": mine.branch_code, "invoice_item_id": it["id"]}
        r = api(tok).post(f"{S}/returns/", json=self._ret(o, loc, [item], branch=mine.branch_code))
        assert r.status_code == 404, r.text

    def test_foreign_barcode_refused(self, superclient, shop, make_location, make_sales_stock):
        o, loc = self._sold(superclient, shop, make_location)
        stray = make_sales_stock(product=shop[2], branch=shop[0])
        it = o["items"][0]
        item = {"barcode": stray.barcode, "return_price": 100, "sold_price": 100, "branch_code": o["branch_code"], "invoice_item_id": it["id"]}
        r = superclient.post(f"{S}/returns/", json=self._ret(o, loc, [item]))
        assert r.status_code == 400, r.text
        good = dict(item, barcode=it["barcode"])
        assert superclient.post(f"{S}/returns/", json=self._ret(o, loc, [good])).status_code == 201

    def test_return_statistics_scoped(self, api, make_user, make_branch):
        b = make_branch()
        _u, tok = make_user(permissions=[("sales_returns", "view")], branches=[b])
        r = api(tok).get(f"{S}/returns/statistics")
        assert r.status_code == 200 and r.json()["total_returns"] == 0


# ---------------------------------------------------------------- SAL-08 / SAL-19 / SAL-20 / SAL-27
class TestCommissions:
    def _comm(self, superclient, inv, agent, customer_id, amount=5):
        return superclient.post(f"{C}/commissions/", json={
            "invoice_id": inv["id"], "customer_agent_id": agent.id, "represented_customer_id": customer_id,
            "invoice_amount": inv["grand_total"], "commission_type": "AMOUNT", "commission_amount": amount})

    def test_status_is_not_editable(self, superclient, shop, make_customer):
        agent = make_customer(is_customer_agent=True)
        inv = superclient.post(S + "/", json=_order(shop)).json()
        c = self._comm(superclient, inv, agent, shop[1].id)
        assert c.status_code == 201, c.text
        r = superclient.put(f"{C}/commissions/{c.json()['id']}", json={"status": "paid"})
        assert r.status_code == 400
        assert superclient.get(f"{C}/commissions/{c.json()['id']}").json()["status"] == "pending"

    def test_represented_customer_must_be_invoice_customer(self, superclient, shop, make_customer):
        agent = make_customer(is_customer_agent=True)
        inv = superclient.post(S + "/", json=_order(shop)).json()
        assert self._comm(superclient, inv, agent, make_customer().id).status_code == 400

    def test_other_branch_invoice_not_found(self, api, superclient, shop, make_customer, make_user, make_branch):
        agent = make_customer(is_customer_agent=True)
        inv = superclient.post(S + "/", json=_order(shop)).json()
        _u, tok = make_user(permissions=[("agent_commissions", "create")], branches=[make_branch()])
        assert self._comm(api(tok), inv, agent, shop[1].id).status_code == 404

    def test_payment_response_has_a_body(self, superclient, shop, make_customer):
        agent = make_customer(is_customer_agent=True)
        inv = superclient.post(S + "/", json=_order(shop)).json()
        cid = self._comm(superclient, inv, agent, shop[1].id).json()["id"]
        assert superclient.post(f"{C}/commissions/{cid}/approve").status_code == 200
        r = superclient.post(f"{C}/commissions/payments/", json={
            "customer_agent_id": agent.id, "payment_date": date.today().isoformat(), "payment_method": "Cash",
            "payment_amount": 5, "branch_code": shop[0].branch_code, "items": [{"commission_id": cid, "paid_amount": 5}]})
        assert r.status_code == 201, r.text
        assert r.json()["id"] and r.json()["status"] == "pending"
        v = superclient.post(f"{C}/commissions/payments/{r.json()['id']}/verify")
        assert v.status_code == 200 and v.json()["status"] == "verified"


# ---------------------------------------------------------------- SAL-09 / SAL-17
class TestCustomerReportsScoped:
    def test_branch_user_sees_only_own_branch(self, api, superclient, shop, make_user, make_branch):
        o = _credit(superclient, shop)
        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        _u, tok = make_user(permissions=[("customers", "view")], branches=[make_branch()])
        c = api(tok)
        st = c.get(f"{C}/{shop[1].id}/statement")
        assert st.status_code == 200 and st.json()["statement_lines"] == []
        od = c.get(f"{C}/outstanding-documents", params={"customer_id": shop[1].id})
        assert od.status_code == 200 and od.json()["items"] == []
        assert c.get(f"{C}/outstanding-documents", params={"branch_code": shop[0].branch_code}).status_code == 403
        assert c.get(f"{C}/{shop[1].id}/credit-settlements").json() == []

    def test_bad_report_date_is_422(self, superclient):
        assert superclient.get(f"{C}/payments/report", params={"date_from": "not-a-date"}).status_code == 422
        assert superclient.get(f"{C}/payments/report", params={"date_from": "2026-12-01", "date_to": "2026-01-01"}).status_code == 400


# ---------------------------------------------------------------- SAL-10 / SAL-22
class TestCoupons:
    def _new(self, superclient, **over):
        import uuid
        body = {"cupon_code": f"QA-{uuid.uuid4().hex[:8]}", "discount_type": "PERCENT", "discount_value": 10,
                "valid_until_date": (date.today() + timedelta(days=30)).isoformat()}
        body.update(over)
        return superclient.post(f"{C}/coupons/", json=body)

    def test_update_applies_create_rules(self, superclient):
        cid = self._new(superclient).json()["id"]
        assert superclient.put(f"{C}/coupons/{cid}", json={"discount_value": 500}).status_code == 400
        assert superclient.put(f"{C}/coupons/{cid}", json={"discount_type": "BOGUS"}).status_code == 400
        assert superclient.put(f"{C}/coupons/{cid}", json={"discount_value": 15}).status_code == 200

    def test_create_checks(self, superclient):
        code = self._new(superclient).json()["cupon_code"]
        assert self._new(superclient, cupon_code=code.lower()).status_code == 400
        assert self._new(superclient, cupon_code="   ").status_code == 400
        assert self._new(superclient, valid_until_date="2020-01-01").status_code == 400
        assert self._new(superclient, limit_by_usage=1, limit_for_customer=5).status_code == 400
        assert self._new(superclient, product_ids=[2_000_000_000]).status_code == 400


# ---------------------------------------------------------------- SAL-13 / SAL-14
class TestVouchers:
    def test_amount_cannot_change(self, superclient):
        import uuid
        v = superclient.post(f"{C}/vouchers/", json={"barcode_no": f"QA-{uuid.uuid4().hex[:8]}", "amount": 1000})
        assert v.status_code == 201, v.text
        r = superclient.put(f"{C}/vouchers/{v.json()['id']}", json={"amount": 1500})
        assert r.status_code == 400
        assert superclient.get(f"{C}/vouchers/{v.json()['id']}").json()["amount"] in ("1000.00", 1000, "1000")

    def test_voucher_for_other_branch_refused(self, api, make_user, make_branch):
        import uuid
        mine, other = make_branch(), make_branch()
        _u, tok = make_user(permissions=[("gift_vouchers", "create")], branches=[mine])
        r = api(tok).post(f"{C}/vouchers/", json={"barcode_no": f"QA-{uuid.uuid4().hex[:8]}", "amount": 100,
                                                   "branch_code": other.branch_code})
        assert r.status_code == 403


# ---------------------------------------------------------------- SAL-15
class TestQuoteUpdate:
    def test_discount_cap_and_tax_saved(self, superclient, shop):
        b, cust, p = shop
        r = superclient.post(f"{Q}/", json={
            "branch_code": b.branch_code, "customer_id": cust.id, "discount_type": "percentage", "discount_value": 5,
            "valid_until": (date.today() + timedelta(days=14)).isoformat(),
            "items": [{"product_id": p.id, "quantity": 1, "selling_price": 100, "minimum_selling_price": 10, "warrenty_month": "12"}]})
        qid = r.json()["id"]
        assert superclient.put(f"{Q}/{qid}", json={"discount_value": 500}).status_code == 400
        u = superclient.put(f"{Q}/{qid}", json={"tax_mode": "exclusive", "tax_rate": 10})
        assert u.status_code == 200, u.text
        g = superclient.get(f"{Q}/{qid}").json()
        assert g["tax_mode"] == "exclusive" and float(g["tax_rate"]) == 10


# ---------------------------------------------------------------- SAL-21 / SAL-24 / SAL-28
class TestSmallRules:
    def test_payment_card_names(self, superclient):
        import uuid
        name = f"QA Card {uuid.uuid4().hex[:6]}"
        assert superclient.post(f"{S}/settings/payment-cards", json={"card_name": "  ", "card_type": "credit"}).status_code == 422
        assert superclient.post(f"{S}/settings/payment-cards", json={"card_name": name, "card_type": "credit"}).status_code == 201
        assert superclient.post(f"{S}/settings/payment-cards", json={"card_name": name.upper(), "card_type": "credit"}).status_code == 400

    def test_client_invoice_no_refused(self, superclient, shop):
        assert superclient.post(S + "/", json=_order(shop, invoice_no="MY-OWN-1")).status_code == 422
        assert superclient.post(S + "/", json=_order(shop, invoice_no="")).status_code == 201

    def test_customer_with_receivable_stays_active(self, superclient, shop):
        _credit(superclient, shop)
        r = superclient.put(f"{C}/{shop[1].id}", json={"active": False})
        assert r.status_code == 400, r.text


# ---------------------------------------------------------------- PUR-18
class TestCogsUsesStockCost:
    def test_cogs_is_po_line_cost_not_product_cost(self, db, superclient, shop):
        from app.modules.sales.accounting_integration import SalesAccountingIntegration
        from app.modules.sales.models import InvoiceItems

        shop[2].cost_price = 7
        db.flush()
        o = superclient.post(S + "/", json=_order(shop, qty=1)).json()
        item = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == o["id"]).first()
        assert SalesAccountingIntegration(db)._unit_cost_for_invoice_item(item) == Decimal("100")  # PO unit_price
