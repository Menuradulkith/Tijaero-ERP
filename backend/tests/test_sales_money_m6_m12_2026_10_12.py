"""QA sales-order-money 2026-10-11, M6 (superuser credit override), M10 (partly redeemed gift voucher),
M11 (card service charge income account), M12 (income statement cost of sales)."""
import uuid
from collections import defaultdict
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntryLine

S = "/api/v1/sales"
D = Decimal


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(6):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(max_credit_limit=1000), p


def _body(shop, rep_id, qty=1, price=100.0, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": c.id, "sale_rep_id": rep_id, "payment_method": "cash",
            "cash_amount": price * qty,
            "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0,
                       "warrenty_month": "12"}]}
    body.update(over)
    return body


def _je(db, reference_type, reference_id):
    rows = (db.query(ChartOfAccounts.account_code, JournalEntryLine.debit_amount, JournalEntryLine.credit_amount,
                     JournalEntryLine.journal_entry_id)
            .join(JournalEntryLine, JournalEntryLine.account_id == ChartOfAccounts.id)
            .filter(JournalEntryLine.reference_type == reference_type, JournalEntryLine.reference_id == reference_id)
            .all())
    acc, per_je = defaultdict(lambda: [D(0), D(0)]), defaultdict(lambda: [D(0), D(0)])
    for code, dr, cr, jid in rows:
        for t in (acc[code], per_je[jid]):
            t[0] += D(str(dr or 0))
            t[1] += D(str(cr or 0))
    for jid, (dr, cr) in per_je.items():
        assert dr == cr, f"JE {jid} unbalanced: {dr} != {cr}"
    return {k: tuple(v) for k, v in acc.items()}


def _approval_remark(db, invoice_id):
    from app.modules.common.models import Approvals
    from app.modules.sales.models import Invoice
    inv = db.query(Invoice).get(invoice_id)
    return db.query(Approvals.remark).filter(Approvals.id == inv.approval_id).scalar() or ""


# ---------------------------------------------------------------- M6
class TestSuperuserCreditOverride:
    def _credit(self, superclient, superuser, shop, price, **over):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=price, payment_method="credit",
                                                 cash_amount=0, override_credit_validation=True, **over))
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def test_override_takes_customer_lock(self, db, superclient, superuser, shop, monkeypatch):
        from sqlalchemy.orm import Query
        locked = []
        orig = Query.with_for_update

        def spy(self, *a, **k):
            try:
                locked.append(getattr(self.column_descriptions[0]["entity"], "__name__", None))
            except Exception:  # noqa: BLE001
                pass
            return orig(self, *a, **k)

        monkeypatch.setattr(Query, "with_for_update", spy)
        self._credit(superclient, superuser, shop, 100.0)
        assert "Customer" in locked

    def test_left_credit_tracks_pending_never_negative_and_flags_over_limit(self, db, superclient, superuser, shop):
        c = shop[1]
        o1 = self._credit(superclient, superuser, shop, 600.0)
        db.refresh(c)
        assert c.left_credit_amount == 400  # the pending order already counts (it used to stay at 1000)
        assert "CREDIT LIMIT OVERRIDDEN" not in _approval_remark(db, o1)

        o2 = self._credit(superclient, superuser, shop, 600.0)
        db.refresh(c)
        assert c.left_credit_amount == 0  # clamped; the real exposure (1,200) lives in outstanding
        remark = _approval_remark(db, o2)
        assert "CREDIT LIMIT OVERRIDDEN" in remark and "exceeds limit by Rs. 200.00" in remark
        from app.modules.customers.credit_service import customer_credit_service as cs
        assert cs._calculate_outstanding_credit(db, c.id) == D("1200.00")
        st = cs.get_customer_credit_status(db, c.id)
        assert st["left_credit_amount"] == 0 and st["outstanding_credit"] == D("1200.00")

    def test_left_credit_rounds_half_up_not_truncated(self, db, superclient, superuser, shop):
        c = shop[1]
        self._credit(superclient, superuser, shop, 333.33)
        db.refresh(c)
        assert c.left_credit_amount == 667  # 1000 - 333.33 = 666.67 -> 667 (int() used to give 666)


# ---------------------------------------------------------------- M10
class TestPartlyRedeemedVoucher:
    def test_forfeited_remainder_posts_to_other_income(self, db, superclient, superuser, shop):
        code = "QAV" + uuid.uuid4().hex[:10].upper()
        r = superclient.post("/api/v1/customers/vouchers/", json={
            "barcode_no": code, "amount": 500, "valid_period_in_months": 6, "payment_method": "cash"})
        assert r.status_code == 201, r.text
        v = r.json()
        o = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=300.0, gift_voucher_id=v["id"],
                                                 gift_voucher_amount=100, cash_amount=200.0))
        assert o.status_code == 201, o.text
        sale = _je(db, "Invoice", o.json()["id"])
        assert sale["2510"] == (D("100.00"), D("0"))
        forfeit = _je(db, "GiftVoucherForfeit", v["id"])
        assert forfeit["2510"] == (D("400.00"), D("0"))
        assert forfeit["4190"] == (D("0"), D("400.00"))
        assert "4110" not in forfeit
        sold = _je(db, "GiftVoucherSale", v["id"])
        # 2510 over the voucher life: +500 on sale, -100 redeemed, -400 forfeited => 0
        assert sold["2510"][1] - sale["2510"][0] - forfeit["2510"][0] == D("0")
        from app.modules.customers.models import CustomerGiftVoucher
        row = db.query(CustomerGiftVoucher).get(v["id"])
        assert row.balance == 0 and row.status == "fully_claimed"


# ---------------------------------------------------------------- M11
class TestServiceChargeAccount:
    def test_order_card_service_charge_credits_other_income(self, db, superclient, superuser, shop):
        # 2.7% Visa charge on 1000 = 27.00 (grand total 1027)
        o = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=1000.0, payment_method="card_visa",
                                                 cash_amount=0, card_visa_amount=1027.0))
        assert o.status_code == 201, o.text
        inv = o.json()
        assert inv["service_charge_amount"] == 27.0
        je = _je(db, "Invoice", inv["id"])
        assert je["4190"] == (D("0"), D("27.00"))
        assert "4110" not in je
        assert je["1020"][0] == D("1027.00") and je["4010"][1] == D("1000.00")

    def test_settlement_service_charge_credits_other_income(self, db):
        from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL

        ref = int(uuid.uuid4().hex[:6], 16) + 8_800_000
        settlement = SimpleNamespace(id=ref, customer_id=1, customer_credits_settle_no=f"CCS-QA-{ref}",
                                     created_date=date.today(), branch_code="QA-BR")
        txns = [SimpleNamespace(payment_method="card_visa", payment_amount=D("100.00"),
                                service_charge_amount=D("2.70"))]
        je = PurchaseExpensePayrollGL(db).post_customer_credit_settlement_to_gl(settlement, txns, user_id=1)
        assert je is not None
        lines = _je(db, "CustomerCreditSettlement", ref)
        assert lines["4190"] == (D("0"), D("2.70")) and "4110" not in lines
        assert lines["1020"][0] == D("102.70") and lines["1110"][1] == D("100.00")


# ---------------------------------------------------------------- M12
class TestIncomeStatementCostOfSales:
    def test_cogs_under_cost_of_sales(self, db):
        from app.modules.finance.accounting_service import GeneralLedgerService
        from app.modules.finance.gl_posting_service import GLPostingService

        d = date(2093, 3, 15)
        ref = int(uuid.uuid4().hex[:6], 16) + 9_100_000
        for i, lines in enumerate([[("1010", "700", "0"), ("4010", "0", "700")],
                                   [("5010", "300", "0"), ("1210", "0", "300")]]):
            res = GLPostingService(db).post(
                reference_type="QA", reference_id=ref + i,
                lines=[{"account_code": c, "debit": D(a), "credit": D(b), "description": "qa"} for c, a, b in lines],
                entry_date=d, description="QA M12", branch_code=f"QA{uuid.uuid4().hex[:6]}", user_id=1)
            assert res.posted, res.error_message
        db.flush()
        r = GeneralLedgerService(db).get_income_statement(fiscal_year=2093)
        assert r.cost_of_sales.total == D("300")
        assert r.gross_profit == D("400")
        assert r.operating_expenses.total == D("0")  # COGS is no longer in operating expenses
