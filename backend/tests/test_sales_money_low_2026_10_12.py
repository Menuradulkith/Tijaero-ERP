"""Regression tests for the LOW findings of the 2026-10-11 sales money audit:
L1 payment tolerance, L2 cheques in hand, L4 strict numeric types on order / return request bodies."""
from decimal import Decimal

import pytest

D = Decimal
S = "/api/v1/sales"


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(6):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(), p


def _body(shop, rep_id, price=200.0, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": c.id, "sale_rep_id": rep_id, "payment_method": "cash",
            "cash_amount": price,
            "items": [{"product_id": p.id, "quantity": 1, "selling_price": price, "minimum_selling_price": 1.0,
                       "warrenty_month": "12"}]}
    body.update(over)
    return body


def _je_lines(db, invoice_id, ref_type="Invoice"):
    from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntryLine
    rows = (db.query(JournalEntryLine, ChartOfAccounts.account_code)
            .join(ChartOfAccounts, ChartOfAccounts.id == JournalEntryLine.account_id)
            .filter(JournalEntryLine.reference_type == ref_type, JournalEntryLine.reference_id == invoice_id).all())
    return [(code, D(str(l.debit_amount or 0)), D(str(l.credit_amount or 0))) for l, code in rows]


class TestPaymentTolerance:
    @pytest.mark.parametrize("paid", [199.96, 199.99, 199.95])
    def test_short_cash_is_refused(self, superclient, superuser, shop, paid):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=paid))
        assert r.status_code == 400 and "short by" in r.text

    def test_short_card_is_refused(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="card_visa", cash_amount=0,
                                                 card_visa_amount=199.97))
        assert r.status_code == 400

    @pytest.mark.parametrize("paid,change", [(200.04, "0.04"), (205.0, "5.00"), (200.01, "0.01")])
    def test_cash_over_tender_returns_change_and_books_payable(self, db, superclient, superuser, shop, paid, change):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=paid))
        assert r.status_code == 201, r.text
        o = r.json()
        assert D(str(o["change_due"])) == D(change)
        assert D(str(o["cash_amount"])) == D("200.00") and D(str(o["paid_amount"])) == D("200.00")
        lines = _je_lines(db, o["id"])
        assert sum(l[1] for l in lines) == sum(l[2] for l in lines)
        assert not any(code == "5900" for code, _, _ in lines)
        assert sum(d for code, d, _ in lines if code == "1010") == D("200.00")

    def test_exact_payment_has_no_change(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id))
        assert r.status_code == 201 and r.json()["change_due"] == 0

    def test_card_over_tender_is_refused(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="card_visa", cash_amount=0,
                                                 card_visa_amount=200.03))
        assert r.status_code == 400


class TestChequesInHand:
    def _cheque_sale(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="cheque", cash_amount=0,
                                                 cheque_amount=200.0, cheque_number="QA-CHQ-L2", cheque_bank="QA Bank"))
        assert r.status_code == 201, r.text
        return r.json()

    def test_cheque_sale_debits_cheques_in_hand_not_bank(self, db, superclient, superuser, shop):
        o = self._cheque_sale(superclient, superuser, shop)
        lines = _je_lines(db, o["id"])
        assert sum(d for c, d, _ in lines if c == "1040") == D("200.00")
        assert not any(c == "1020" and d > 0 for c, d, _ in lines)
        assert sum(l[1] for l in lines) == sum(l[2] for l in lines)

    def test_deposit_confirmation_moves_cheque_to_bank(self, db, superclient, superuser, shop):
        from app.modules.finance.models import BankDeposits
        o = self._cheque_sale(superclient, superuser, shop)
        dep = db.query(BankDeposits).filter(BankDeposits.invoice_no == o["invoice_no"]).one()
        r = superclient.patch(f"/api/v1/finance/bank-deposits/{dep.id}/verify")
        assert r.status_code == 200, r.text
        got = sorted(_je_lines(db, dep.id, "BankDeposit"))
        assert got == [("1020", D("200.00"), D("0")), ("1040", D("0"), D("200.00"))]


class TestStrictTypes:
    def _post(self, superclient, shop, rep, mutate):
        body = _body(shop, rep)
        mutate(body)
        return superclient.post(S + "/", json=body)

    @pytest.mark.parametrize("mutate", [
        lambda b: b["items"][0].update(selling_price=True),
        lambda b: b["items"][0].update(quantity="2"),
        lambda b: b["items"][0].update(quantity=True),
        lambda b: b["items"][0].update(selling_price="100"),
        lambda b: b["items"][0].update(discount_percent="5"),
        lambda b: b.update(tax_rate=100),
        lambda b: b.update(tax_rate=50.5),
        lambda b: b.update(tax_rate="5"),
        lambda b: b.update(tax_rate=True),
        lambda b: b.update(cash_amount="200"),
        lambda b: b.update(cash_amount=True),
        lambda b: b.update(discount_amount="1"),
        lambda b: b.update(customer_id="1"),
    ])
    def test_malformed_create_is_422(self, superclient, superuser, shop, mutate):
        assert self._post(superclient, shop, superuser[0].id, mutate).status_code == 422

    def test_ints_and_floats_still_accepted(self, superclient, superuser, shop):
        # JSON `300` (int) for a float field and tax at the bound are valid
        r = self._post(superclient, shop, superuser[0].id, lambda b: b.update(tax_rate=50, cash_amount=300))
        assert r.status_code == 201, r.text
        assert D(str(r.json()["grand_total"])) == D("300.00")

    def test_update_items_strict(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, payment_method="credit", cash_amount=0,
                                                 override_credit_validation=True))
        assert r.status_code == 201, r.text
        oid = r.json()["id"]
        item = {"product_id": shop[2].id, "quantity": "2", "selling_price": 10, "minimum_selling_price": 1,
                "warrenty_month": "12"}
        assert superclient.put(f"{S}/{oid}", json={"items": [item]}).status_code == 422
        item.update(quantity=2, selling_price=True)
        assert superclient.put(f"{S}/{oid}", json={"items": [item]}).status_code == 422

    def test_sale_return_strict(self, superclient, superuser, shop):
        body = {"branch_code": shop[0].branch_code, "invoice_id": 1, "good_received_locations_id": 1,
                "payment_method": "cash",
                "items": [{"barcode": "X", "return_price": True, "sold_price": 1, "branch_code": shop[0].branch_code}]}
        assert superclient.post(f"{S}/returns/", json=body).status_code == 422
        body["items"][0].update(return_price=1, quantity="1")
        assert superclient.post(f"{S}/returns/", json=body).status_code == 422
