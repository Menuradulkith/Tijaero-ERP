"""Sales order money fixes (QA sales-order-money-2026-10-11): C1 revenue JE, C5 voucher amount without voucher,
C6 gift voucher sale JE, H11 paid + balance == grand_total, H2 GRN posts inventory."""
from decimal import Decimal
from collections import defaultdict
import uuid

import pytest

from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntry, JournalEntryLine

S = "/api/v1/sales"
D = Decimal


@pytest.fixture
def shop(db, make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(6):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(), p


def _body(shop, rep_id, qty=1, price=100.0, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": c.id, "sale_rep_id": rep_id, "payment_method": "cash",
            "cash_amount": price * qty,
            "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0, "warrenty_month": "12"}]}
    body.update(over)
    return body


def _je(db, reference_type, reference_id):
    """{account_code: [debit, credit]} summed over every JE posted for the document, plus total debit/credit."""
    rows = (
        db.query(ChartOfAccounts.account_code, JournalEntryLine.debit_amount, JournalEntryLine.credit_amount,
                 JournalEntryLine.journal_entry_id)
        .join(JournalEntryLine, JournalEntryLine.account_id == ChartOfAccounts.id)
        .filter(JournalEntryLine.reference_type == reference_type, JournalEntryLine.reference_id == reference_id)
        .all()
    )
    acc = defaultdict(lambda: [D("0"), D("0")])
    per_je = defaultdict(lambda: [D("0"), D("0")])
    for code, dr, cr, jid in rows:
        acc[code][0] += D(str(dr or 0))
        acc[code][1] += D(str(cr or 0))
        per_je[jid][0] += D(str(dr or 0))
        per_je[jid][1] += D(str(cr or 0))
    for jid, (dr, cr) in per_je.items():
        assert dr == cr, f"JE {jid} unbalanced: {dr} != {cr}"
    return {k: tuple(v) for k, v in acc.items()}, len(per_je)


def _post(superclient, shop, rep, **over):
    r = superclient.post(S + "/", json=_body(shop, rep, **over))
    assert r.status_code == 201, r.text
    return r.json()


def _revenue(je):
    return je.get("4010", (D(0), D(0)))[1]


class TestRevenueJournalIsNet:
    """C1: stored subtotal is already net of discount/coupon; the JE must not deduct it a second time."""

    def test_percent_header_discount(self, db, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, qty=1, price=250.0, discount_percent=10, cash_amount=225.0)
        assert o["grand_total"] == 225.0
        je, n = _je(db, "Invoice", o["id"])
        assert je["1010"] == (D("225.00"), D("0"))
        assert je["4010"] == (D("0"), D("225.00"))
        assert "5160" not in je  # discount netted once, no contra pair

    def test_fixed_discount(self, db, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=200.0, discount_amount=20, cash_amount=180.0)
        je, _ = _je(db, "Invoice", o["id"])
        assert je["1010"][0] == D("180.00") and _revenue(je) == D("180.00") and "5160" not in je

    def test_line_discount_and_tax_exclusive(self, db, superclient, superuser, shop):
        b, c, p = shop
        body = _body(shop, superuser[0].id, qty=2, price=100.0, tax_rate=5, cash_amount=189.0)
        body["items"][0]["discount_percent"] = 10
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 201, r.text
        o = r.json()
        je, _ = _je(db, "Invoice", o["id"])
        assert je["1010"][0] == D("189.00")
        assert _revenue(je) == D("180.00")
        assert je["2210"][1] == D("9.00")

    def test_tax_inclusive(self, db, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=105.0, tax_rate=5, is_tax_invoice=True, cash_amount=105.0)
        je, _ = _je(db, "Invoice", o["id"])
        assert je["1010"][0] == D("105.00") and _revenue(je) == D("100.00") and je["2210"][1] == D("5.00")

    def test_discount_plus_tax_split_tender(self, db, superclient, superuser, shop):
        # net 180 + 5% tax 9 = 189, paid 100 cash + 89 card
        o = _post(superclient, shop, superuser[0].id, price=200.0, discount_percent=10, tax_rate=5,
                  payment_method="cash", cash_amount=100.0, card_visa_amount=89.0)
        je, _ = _je(db, "Invoice", o["id"])
        assert je["1010"][0] == D("100.00") and je["1020"][0] == D("89.00")
        assert _revenue(je) == D("180.00") and je["2210"][1] == D("9.00")

    def test_credit_order_with_discount_posts_receivable_on_approve(self, db, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=250.0, payment_method="credit", cash_amount=0,
                  discount_percent=10, override_credit_validation=True)
        assert o["grand_total"] == 225.0
        assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
        je, _ = _je(db, "Invoice", o["id"])
        assert je["1110"][0] == D("225.00") and je["4020"][1] == D("225.00") and "5160" not in je

    def test_post_to_gl_endpoint_is_idempotent(self, db, superclient, superuser, shop):
        o = _post(superclient, shop, superuser[0].id, price=250.0, discount_percent=10, cash_amount=225.0)
        _, n1 = _je(db, "Invoice", o["id"])
        superclient.post(f"{S}/{o['id']}/post-to-gl")
        _, n2 = _je(db, "Invoice", o["id"])
        assert n1 == n2


def _make_voucher(superclient, amount=50, method="cash"):
    code = "QAV" + uuid.uuid4().hex[:10].upper()
    r = superclient.post("/api/v1/customers/vouchers/", json={
        "barcode_no": code, "amount": amount, "valid_period_in_months": 6, "payment_method": method})
    assert r.status_code == 201, r.text
    return r.json()


class TestVoucherAmounts:
    def test_voucher_amount_without_voucher_is_refused(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=200.0, gift_voucher_amount=50, cash_amount=150.0))
        assert r.status_code == 400, r.text

    def test_voucher_amount_with_unknown_voucher_is_refused(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=200.0, gift_voucher_id=99999999,
                                                 gift_voucher_amount=50, cash_amount=150.0))
        assert r.status_code == 400, r.text

    def test_voucher_redemption_over_balance_is_refused(self, superclient, superuser, shop):
        v = _make_voucher(superclient, 50)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=200.0, cash_amount=100.0,
                                                 voucher_redemptions=[{"voucher_id": v["id"], "amount_to_redeem": 100}]))
        assert r.status_code == 400, r.text

    def test_cash_plus_voucher_journal_and_reconciliation(self, db, superclient, superuser, shop):
        v = _make_voucher(superclient, 100)
        o = _post(superclient, shop, superuser[0].id, price=200.0, cash_amount=100.0,
                  voucher_redemptions=[{"voucher_id": v["id"], "amount_to_redeem": 100}])
        assert o["grand_total"] == 100.0
        je, _ = _je(db, "Invoice", o["id"])
        assert je["1010"][0] == D("100.00") and je["2510"][0] == D("100.00") and _revenue(je) == D("200.00")
        assert D(str(o["paid_amount"])) + D(str(o["balance_due"])) == D(str(o["grand_total"]))


class TestGiftVoucherSaleJournal:
    """C6: selling a voucher posts Dr cash/bank / Cr 2510 in the same transaction."""

    def test_cash_voucher_sale_posts_je(self, db, superclient, superuser):
        v = _make_voucher(superclient, 350, "cash")
        je, n = _je(db, "GiftVoucherSale", v["id"])
        assert n == 1
        assert je["1010"] == (D("350.00"), D("0")) and je["2510"] == (D("0"), D("350.00"))

    def test_bank_voucher_sale_posts_je(self, db, superclient, superuser):
        v = _make_voucher(superclient, 80, "card")
        je, _ = _je(db, "GiftVoucherSale", v["id"])
        assert je["1020"][0] == D("80.00") and je["2510"][1] == D("80.00")

    def test_redemption_clears_liability(self, db, superclient, superuser, shop):
        v = _make_voucher(superclient, 100)
        o = _post(superclient, shop, superuser[0].id, price=100.0, cash_amount=0,
                  voucher_redemptions=[{"voucher_id": v["id"], "amount_to_redeem": 100}])
        sale, _ = _je(db, "GiftVoucherSale", v["id"])
        redeem, _ = _je(db, "Invoice", o["id"])
        assert sale["2510"][1] - redeem["2510"][0] == D("0.00")


class TestPaidPlusBalanceEqualsGrandTotal:
    """H11: grand_total is net of voucher/credit note, so paid_amount counts tenders only."""

    @pytest.mark.parametrize("cash,expect_paid,expect_bal", [(0.0, "0.00", "100.00"), (40.0, "40.00", "60.00")])
    def test_credit_order_with_voucher(self, superclient, superuser, shop, cash, expect_paid, expect_bal):
        v = _make_voucher(superclient, 100)
        o = _post(superclient, shop, superuser[0].id, price=200.0, payment_method="credit", cash_amount=cash,
                  override_credit_validation=True,
                  voucher_redemptions=[{"voucher_id": v["id"], "amount_to_redeem": 100}])
        assert D(str(o["grand_total"])) == D("100.00")
        assert D(str(o["paid_amount"])) == D(expect_paid) and D(str(o["balance_due"])) == D(expect_bal)
        assert D(str(o["paid_amount"])) + D(str(o["balance_due"])) == D(str(o["grand_total"]))
        got = superclient.get(f"{S}/{o['id']}").json()
        assert D(str(got["paid_amount"])) + D(str(got["balance_due"])) == D(str(got["grand_total"]))

    def test_cash_order_with_voucher_unchanged(self, superclient, superuser, shop):
        v = _make_voucher(superclient, 100)
        o = _post(superclient, shop, superuser[0].id, price=200.0, cash_amount=100.0,
                  voucher_redemptions=[{"voucher_id": v["id"], "amount_to_redeem": 100}])
        assert D(str(o["paid_amount"])) == D("100.00") and D(str(o["balance_due"])) == D("0")
