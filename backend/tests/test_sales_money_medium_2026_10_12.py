"""Regression tests for the MEDIUM findings of the 2026-10-11 sales money audit:
M1 half-up rounding + footing documents, M2 zero-price / zero-total orders, M3 partial payment_status,
M4 cancelled credit order owes nothing, M5 settlement payment_date, M7 order total bound,
M8 POST /customers/{id}/credit-settlements, M9 printed invoice foots."""
import re
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

D = Decimal
S = "/api/v1/sales"
CUST = "/api/v1/customers"


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(8):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(), p


def _body(shop, rep_id, qty=1, price=100.0, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": c.id, "sale_rep_id": rep_id, "payment_method": "cash",
            "cash_amount": float(D(str(price)) * qty),
            "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0,
                       "warrenty_month": "12"}]}
    body.update(over)
    return body


def _post(superclient, shop, rep, expect=201, **over):
    r = superclient.post(S + "/", json=_body(shop, rep, **over))
    assert r.status_code == expect, r.text
    return r.json()


def _credit(superclient, shop, rep, price=200.0, **over):
    return _post(superclient, shop, rep, price=price, payment_method="credit", cash_amount=over.pop("cash_amount", 0),
                 override_credit_validation=True, **over)


def _items(db, order_id):
    from app.modules.sales.models import InvoiceItems
    return [D(str(i.line_total)) for i in db.query(InvoiceItems).filter(InvoiceItems.invoice_id == order_id).all()]


def _je_lines_for(db, marker):
    from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntry, JournalEntryLine
    rows = (db.query(JournalEntry, JournalEntryLine, ChartOfAccounts.account_code)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .join(ChartOfAccounts, ChartOfAccounts.id == JournalEntryLine.account_id)
            .filter(JournalEntry.description.like(marker)).all())
    return rows


# ---------------------------------------------------------------- M1
class TestRounding:
    @pytest.mark.parametrize("price,expected", [(1.005, "1.01"), (0.025, "0.03"), (10.125, "10.13")])
    def test_half_up_line_total(self, superclient, superuser, shop, price, expected):
        o = _post(superclient, shop, superuser[0].id, price=price, cash_amount=float(expected))
        assert D(str(o["subtotal"])) == D(expected) and D(str(o["grand_total"])) == D(expected)

    def test_tax_half_up_on_10_10(self, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=10.10, tax_rate=5, cash_amount=10.61)
        assert D(str(o["tax_amount"])) == D("0.51") and D(str(o["grand_total"])) == D("10.61")

    def test_tax_half_up_on_30_x_0_35(self, superclient, superuser, shop):
        # 30 x 0.35 = 10.50, 5% = 0.525 -> 0.53 (a single 10.50 line stands in for 30 x 0.35)
        o = _post(superclient, shop, superuser[0].id, price=10.50, tax_rate=5, cash_amount=11.03)
        assert D(str(o["tax_amount"])) == D("0.53") and D(str(o["grand_total"])) == D("11.03")

    def test_discounted_lines_foot_with_tax(self, db, superclient, superuser, shop):
        # 7 x (19.99 less 10%) at 12%: unit 17.99 -> lines sum 125.93, tax 15.11, grand 141.04
        body = _body(shop, superuser[0].id, qty=7, price=19.99, tax_rate=12, cash_amount=141.04)
        body["items"][0]["discount_percent"] = 10
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 201, r.text
        o = r.json()
        assert D(str(o["subtotal"])) == D("125.93") and D(str(o["tax_amount"])) == D("15.11")
        assert D(str(o["grand_total"])) == D("141.04")
        lines = _items(db, o["id"])
        assert sum(lines) == D("125.93") and set(lines) == {D("17.99")}

    def test_subtotal_is_sum_of_rounded_rows(self, db, superclient, superuser, shop):
        # 3 x 32.404 less 10%: printed unit 29.16 -> rows 29.16 x 3 = 87.48 (an unrounded sum would give 87.49)
        body = _body(shop, superuser[0].id, qty=3, price=32.404, cash_amount=87.48)
        body["items"][0]["discount_percent"] = 10
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 201, r.text
        o = r.json()
        assert D(str(o["subtotal"])) == D("87.48") == sum(_items(db, o["id"]))

    def test_header_discount_rounds_half_up(self, superclient, superuser, shop):
        # 10% of 10.05 = 1.005 -> 1.01, net 9.04
        o = _post(superclient, shop, superuser[0].id, price=10.05, discount_percent=10, cash_amount=9.04)
        assert D(str(o["discount_amount"])) == D("1.01") and D(str(o["subtotal"])) == D("9.04")

    def test_edit_keeps_footing(self, db, superclient, superuser, shop):
        o = _credit(superclient, shop, superuser[0].id, price=100)
        b, c, p = shop
        item = {"product_id": p.id, "quantity": 7, "selling_price": 19.99, "minimum_selling_price": 1.0,
                "warrenty_month": "12", "discount_percent": 10}
        r = superclient.put(f"{S}/{o['id']}", json={"items": [item]})
        assert r.status_code == 200, r.text
        assert D(str(r.json()["subtotal"])) == D("125.93") == sum(_items(db, o["id"]))


# ---------------------------------------------------------------- M2
class TestZeroPrice:
    @pytest.mark.parametrize("price", [0, 0.004, -1])
    def test_zero_or_tiny_price_refused(self, superclient, superuser, shop, price):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=price, cash_amount=0))
        assert r.status_code in (400, 422), r.text

    def test_one_cent_is_the_minimum(self, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=0.01, cash_amount=0.01)
        assert D(str(o["grand_total"])) == D("0.01")

    def test_header_discount_to_zero_is_refused(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=100, discount_percent=100, cash_amount=0))
        assert r.status_code == 400 and "greater than zero" in r.text

    def test_credit_note_covering_exactly_is_allowed(self, db, superclient, superuser, shop):
        from datetime import datetime as dt
        from app.modules.customers.models import CustomerCreditNotes
        db.add(CustomerCreditNotes(customer_id=shop[1].id, date=dt.utcnow(), amount=D("100"), remark="QA"))
        db.flush()
        o = _post(superclient, shop, superuser[0].id, price=100, cash_amount=0, credit_note_amount=100)
        assert D(str(o["grand_total"])) == D("0.00") and D(str(o["paid_amount"])) == D("0.00")


# ---------------------------------------------------------------- M3 / M4
class TestPaymentStatus:
    def test_credit_order_with_some_paid_is_partial(self, db, superclient, superuser, shop):
        o = _credit(superclient, shop, superuser[0].id, price=200, cash_amount=50)
        assert o["payment_status"] == "partial"
        assert D(str(o["paid_amount"])) == D("50.00") and D(str(o["balance_due"])) == D("150.00")
        # list and get agree
        assert superclient.get(f"{S}/{o['id']}").json()["payment_status"] == "partial"
        lst = superclient.get(S + "/list", params={"search": o["invoice_no"]}).json()["items"]
        assert [i["payment_status"] for i in lst if i["id"] == o["id"]] == ["partial"]
        # approve keeps it, a settlement of the rest makes it paid
        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        assert superclient.get(f"{S}/{o['id']}").json()["payment_status"] == "partial"
        r = superclient.post(f"{S}/{o['id']}/settle-payment", json={
            "payment_method": "cash", "payment_amount": 150, "payment_date": date.today().isoformat()})
        assert r.status_code == 200, r.text
        assert superclient.get(f"{S}/{o['id']}").json()["payment_status"] == "paid"

    def test_credit_order_nothing_paid_is_unpaid(self, superclient, superuser, shop):
        o = _credit(superclient, shop, superuser[0].id, price=200)
        assert o["payment_status"] == "unpaid" and D(str(o["balance_due"])) == D("200.00")

    def test_cancelled_credit_order_owes_nothing(self, db, superclient, superuser, shop):
        from app.modules.customers.credit_service import customer_credit_service
        o = _credit(superclient, shop, superuser[0].id, price=200, cash_amount=50)
        assert customer_credit_service._calculate_outstanding_credit(db, shop[1].id) == D("150.00")
        r = superclient.post(f"{S}/{o['id']}/cancel")
        assert r.status_code == 200, r.text
        got = superclient.get(f"{S}/{o['id']}").json()
        assert got["approval_status"] == "cancelled" and got["payment_status"] == "cancelled"
        assert D(str(got["balance_due"])) == D("0.00") and D(str(got["credit_amount"])) == D("0.00")
        lst = superclient.get(S + "/list", params={"search": o["invoice_no"]}).json()["items"]
        row = [i for i in lst if i["id"] == o["id"]][0]
        assert row["payment_status"] == "cancelled" and D(str(row["balance_due"])) == D("0.00")
        assert customer_credit_service._calculate_outstanding_credit(db, shop[1].id) == D("0")


# ---------------------------------------------------------------- M5
class TestSettlementDate:
    def _approved(self, superclient, superuser, shop, price=200):
        o = _credit(superclient, shop, superuser[0].id, price=price)
        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        return o

    def _settle(self, superclient, oid, day, amount=50):
        return superclient.post(f"{S}/{oid}/settle-payment", json={
            "payment_method": "cash", "payment_amount": amount, "payment_date": day.isoformat()})

    def test_future_and_ancient_dates_refused(self, superclient, superuser, shop):
        o = self._approved(superclient, superuser, shop)
        for bad in (date.today() + timedelta(days=1), date(2027, 11, 15), date(2020, 1, 1), date(1, 1, 1)):
            r = self._settle(superclient, o["id"], bad)
            assert r.status_code in (400, 422), (bad, r.text)
        assert D(str(superclient.get(f"{S}/{o['id']}").json()["balance_due"])) == D("200.00")

    def test_transaction_and_journal_use_the_same_date(self, db, superclient, superuser, shop):
        from app.modules.customers.models import CustomerCreditsSettleTransaction
        from app.modules.sales.models import Invoice
        o = self._approved(superclient, superuser, shop)
        inv = db.query(Invoice).filter(Invoice.id == o["id"]).first()
        inv.created_date = date.today() - timedelta(days=10)
        db.flush()
        day = date.today() - timedelta(days=3)
        r = self._settle(superclient, o["id"], day, 80)
        assert r.status_code == 200, r.text
        sid = r.json()["settlement_record_id"]
        txn = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.customer_credit_settle_id == sid).one()
        assert txn.created_date.date() == day if isinstance(txn.created_date, datetime) else txn.created_date == day
        rows = _je_lines_for(db, f"%CustomerCreditSettlement ID: {sid}")
        assert rows, "settlement JE missing"
        assert {je.entry_date.date() if isinstance(je.entry_date, datetime) else je.entry_date for je, _, _ in rows} == {day}
        assert sum(D(str(l.debit_amount or 0)) for _, l, _ in rows) == sum(D(str(l.credit_amount or 0)) for _, l, _ in rows) == D("80.00")

    def test_before_the_order_date_refused(self, superclient, superuser, shop):
        o = self._approved(superclient, superuser, shop)
        r = self._settle(superclient, o["id"], date.today() - timedelta(days=1))
        assert r.status_code == 400 and "before the order date" in r.text

    def test_today_is_accepted(self, superclient, superuser, shop):
        o = self._approved(superclient, superuser, shop)
        assert self._settle(superclient, o["id"], date.today()).status_code == 200


# ---------------------------------------------------------------- M7
class TestOrderBound:
    def test_total_above_bound_refused(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, qty=101, price=999999999.99, cash_amount=0,
                                                  payment_method="credit", override_credit_validation=True))
        assert r.status_code == 400 and "maximum" in r.text

    def test_huge_credit_order_never_500s_on_approve(self, superclient, superuser, shop, make_sales_stock):
        for _ in range(12):
            make_sales_stock(product=shop[2], branch=shop[0])
        # the audit's order: 20 x 999,999,999.99 = 19,999,999,999.80 on a customer with a 1,000,000 limit
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, qty=20, price=999999999.99, cash_amount=0,
                                                  payment_method="credit", override_credit_validation=True))
        assert r.status_code == 201, r.text
        assert D(str(r.json()["grand_total"])) == D("19999999999.80")
        a = superclient.post(f"{S}/{r.json()['id']}/approve")
        assert a.status_code == 200, a.text


# ---------------------------------------------------------------- M8
class TestCustomerCreditSettlements:
    def _approved(self, superclient, superuser, shop, price=200):
        o = _credit(superclient, shop, superuser[0].id, price=price)
        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        return o

    def _body(self, shop, oid, amount, method="cash"):
        return {"branch_code": shop[0].branch_code, "customer_id": shop[1].id,
                "transactions": [{"payment_method": method, "cheque_date": date.today().isoformat(),
                                  "payment_amount": amount, "invoice_id": oid}]}

    def test_settlement_updates_invoice_credit_and_gl(self, db, superclient, superuser, shop):
        from app.modules.customers.credit_service import customer_credit_service
        o = self._approved(superclient, superuser, shop)
        r = superclient.post(f"{CUST}/{shop[1].id}/credit-settlements", json=self._body(shop, o["id"], 80))
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        got = superclient.get(f"{S}/{o['id']}").json()
        assert D(str(got["paid_amount"])) == D("80.00") and D(str(got["balance_due"])) == D("120.00")
        assert got["payment_status"] == "partial"
        assert customer_credit_service._calculate_outstanding_credit(db, shop[1].id) == D("120.00")
        rows = _je_lines_for(db, f"%CustomerCreditSettlement ID: {sid}")
        codes = {(c, D(str(l.debit_amount or 0)), D(str(l.credit_amount or 0))) for _, l, c in rows}
        assert codes == {("1010", D("80.00"), D("0.00")), ("1110", D("0.00"), D("80.00"))}

    def test_over_settlement_and_repeat_refused(self, superclient, superuser, shop):
        o = self._approved(superclient, superuser, shop)
        url = f"{CUST}/{shop[1].id}/credit-settlements"
        assert superclient.post(url, json=self._body(shop, o["id"], 200.01)).status_code == 400
        assert superclient.post(url, json=self._body(shop, o["id"], 200)).status_code == 201
        again = superclient.post(url, json=self._body(shop, o["id"], 200))
        assert again.status_code == 400
        got = superclient.get(f"{S}/{o['id']}").json()
        assert D(str(got["balance_due"])) == D("0.00") and got["payment_status"] == "paid"

    def test_other_customers_invoice_and_url_mismatch_refused(self, superclient, superuser, shop, make_customer):
        o = self._approved(superclient, superuser, shop)
        other = make_customer()
        body = self._body(shop, o["id"], 10)
        assert superclient.post(f"{CUST}/{other.id}/credit-settlements", json=body).status_code == 400
        body["customer_id"] = other.id
        assert superclient.post(f"{CUST}/{other.id}/credit-settlements", json=body).status_code == 400


# ---------------------------------------------------------------- M9
def _print_data(superclient, oid):
    r = superclient.get(f"/api/v1/reporting/documents/invoice/{oid}")
    assert r.status_code == 200, r.text
    html = r.text
    grab = lambda key: re.search(key + r":\s+'([^']*)'", html).group(1)  # noqa: E731
    adj = re.search(r"adjustments:\s+(\[.*?\]),\n", html, re.S).group(1)
    import json
    return {"subTotal": D(grab("subTotal")), "netTotal": D(grab("netTotal")), "vat": D(grab("vat") or "0"),
            "adjustments": json.loads(adj)}


class TestPrintFoots:
    def test_header_discount_lines_discount_total(self, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=250, discount_percent=10, cash_amount=225)
        d = _print_data(superclient, o["id"])
        assert d["subTotal"] == D("250.00") and d["netTotal"] == D("225.00")
        assert d["adjustments"] == [{"label": "Discount", "amount": "-25.00"}]

    def test_credit_note_line(self, db, superclient, superuser, shop):
        from app.modules.customers.models import CustomerCreditNotes
        db.add(CustomerCreditNotes(customer_id=shop[1].id, date=datetime.utcnow(), amount=D("100"), remark="QA"))
        db.flush()
        o = _post(superclient, shop, superuser[0].id, price=200, cash_amount=100, credit_note_amount=100)
        d = _print_data(superclient, o["id"])
        assert d["subTotal"] == D("200.00") and d["netTotal"] == D("100.00")
        assert d["adjustments"] == [{"label": "Credit note", "amount": "-100.00"}]
        assert d["subTotal"] - D("100.00") == d["netTotal"]

    def test_discount_tax_and_foots(self, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=250, discount_percent=10, tax_rate=10, cash_amount=247.5)
        d = _print_data(superclient, o["id"])
        # 250 - 25 discount + 22.50 tax = 247.50
        assert d["subTotal"] == D("250.00") and d["vat"] == D("22.50") and d["netTotal"] == D("247.50")
        assert d["subTotal"] - D("25.00") + d["vat"] == d["netTotal"]
