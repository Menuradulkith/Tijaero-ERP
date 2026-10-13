"""QA fixes 2026-10-12 (docs/qa/e2e-balancing-2026-10-12.md) - sales / customers / finance / reporting.

F1b(b) gift-voucher expiry commits its breakage JE; F6 list endpoints tolerate legacy rows;
F7 money inputs capped (MAX_MONEY, no NaN/Infinity); F8 a new customer advance is wholly
unapplied; F11 sales report == GL revenue; F12 report totals keep full precision and the
pre-close check refuses pending posting failures / a missing period; F13 GL reports and AR
aging take a branch filter and honour branch scope; F15 day-end hint is direction-aware.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.auth.rbac import Permissions
from app.modules.finance.accounting_models import (
    AccountingPeriod,
    ChartOfAccounts,
    GeneralLedger,
    GLPostingFailure,
)
from app.modules.sales import schemas as sales_schemas
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn
from app.modules.sales.service import sales_service
from tests.integration.test_workflows.test_sales_guardrails import _location

S = "/api/v1/sales"
F = "/api/v1/finance"
C = "/api/v1/customers"
D = Decimal
TODAY = date.today()


def _uid(p="QA"):
    return f"{p}{uuid.uuid4().hex[:10].upper()}"


@pytest.fixture
def shop(db, make_branch, make_customer, make_product, make_sales_stock):
    """A branch with a quantity-tracked lot of 100 units, a customer with credit, a location."""
    branch, product = make_branch(), make_product()
    product.tracking_type = "none"
    lot = make_sales_stock(product=product, branch=branch)
    lot.barcode = None
    lot.quantity = 100
    customer = make_customer()
    customer.max_credit_limit = 100000
    customer.left_credit_amount = 100000
    db.flush()
    return branch, customer, product, _location(db, branch)


def _order(shop, rep_id, qty=1, price=100.0, **over):
    branch, customer, product, _ = shop
    body = {
        "branch_code": branch.branch_code, "customer_id": customer.id, "sale_rep_id": rep_id,
        "payment_method": "cash", "cash_amount": price * qty,
        "items": [{"product_id": product.id, "quantity": qty, "selling_price": price,
                   "minimum_selling_price": 1.0, "warrenty_month": "0"}],
    }
    body.update(over)
    return body


def _place(client, shop, rep_id, **kw):
    r = client.post(S + "/", json=_order(shop, rep_id, **kw))
    assert r.status_code == 201, r.text
    return r.json()


def _raw_post(client, url, body):
    """POST a JSON body that may contain NaN/Infinity literals (httpx refuses to encode them;
    Python's json, which the server uses, accepts them)."""
    import json
    return client.post(url, content=json.dumps(body), headers={"Content-Type": "application/json"})


def _account(db, code):
    return db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).one()


def _gl_row(db, code, branch_code, debit="0", credit="0", on=TODAY):
    db.add(GeneralLedger(
        transaction_date=on, posting_date=on, account_id=_account(db, code).id,
        debit_amount=D(debit), credit_amount=D(credit), transaction_type="Adjustment",
        reference_type="QA", reference_no="QA-TEST", branch_code=branch_code,
        fiscal_year=on.year, fiscal_period=on.month,
    ))
    db.flush()


# ═══════════════════════════════════════ F1b(b) voucher expiry ═══════════════════════════════════════
class TestVoucherExpiryCommitsBreakage:
    def _expired_voucher(self, db, make_branch):
        from app.modules.customers.models import CustomerGiftVoucher
        v = CustomerGiftVoucher(
            barcode_no=_uid("QAEXP"), amount=D("100.00"), balance=D("100.00"),
            date=TODAY - timedelta(days=400), valid_period_in_months=1, status="active",
            branch_code=make_branch().branch_code, payment_method="cash",
        )
        db.add(v)
        db.flush()
        return v

    def test_breakage_je_is_committed_after_posting(self, db, make_branch, monkeypatch):
        """get_db never commits: the breakage JE must be committed AFTER it is posted.
        The transactional fixture would hide a missing commit, so record the call order."""
        from app.modules.customers import schemas as cs
        from app.modules.customers.service import voucher_service
        from app.modules.sales.accounting_integration import SalesAccountingIntegration

        v = self._expired_voucher(db, make_branch)
        events = []
        real_commit = db.commit
        monkeypatch.setattr(db, "commit", lambda: (events.append("commit"), real_commit())[1])
        real_post = SalesAccountingIntegration.post_gift_voucher_expiry_to_gl

        def spy_post(self, *a, **k):
            events.append("post")
            return real_post(self, *a, **k)

        monkeypatch.setattr(SalesAccountingIntegration, "post_gift_voucher_expiry_to_gl", spy_post)
        res = voucher_service.validate_voucher(db, cs.VoucherValidationRequest(barcode_no=v.barcode_no, invoice_amount_due=10))
        assert res.valid is False and "expired" in res.message.lower()
        assert "post" in events, events
        assert "commit" in events[events.index("post") + 1:], f"breakage JE never committed: {events}"
        lines = db.query(GeneralLedger).filter(
            GeneralLedger.reference_type == "GiftVoucherExpiry", GeneralLedger.reference_id == v.id).all()
        assert sum(D(str(l.debit_amount)) for l in lines) == D("100.00")

    def test_failed_breakage_post_rolls_back_and_is_recorded(self, db, make_branch, monkeypatch):
        from app.modules.customers import schemas as cs
        from app.modules.customers.service import voucher_service
        from app.modules.finance import gl_posting_service
        from app.modules.sales.accounting_integration import SalesAccountingIntegration

        v = self._expired_voucher(db, make_branch)
        recorded = []
        monkeypatch.setattr(gl_posting_service, "record_gl_commit_failure",
                            lambda db_, **kw: recorded.append(kw))

        def boom(self, *a, **k):
            raise RuntimeError("commit failed")

        monkeypatch.setattr(SalesAccountingIntegration, "post_gift_voucher_expiry_to_gl", boom)
        res = voucher_service.validate_voucher(db, cs.VoucherValidationRequest(barcode_no=v.barcode_no, invoice_amount_due=10))
        assert res.valid is False
        assert recorded and recorded[0]["reference_type"] == "GiftVoucherExpiry" and recorded[0]["reference_id"] == v.id


# ═══════════════════════════════════════ F6 legacy rows in lists ═══════════════════════════════════════
class TestListsTolerateLegacyRows:
    def test_sale_return_with_long_remark_does_not_break_the_list(self, db, superclient, superuser, shop, make_user):
        branch = shop[0]
        inv = _place(superclient, shop, superuser[0].id)
        db.add(SaleReturn(
            sale_return_no=_uid("QASR"), branch_code=branch.branch_code, remark="x" * 2500,
            added_date=TODAY, good_received_locations_id=shop[3].id, invoice_id=inv["id"],
            cheque_date=TODAY, payment_method="cash", status="pending", subtotal=0, tax_refund=0,
            total_refund=0, refund_status="pending", refund_amount=0,
        ))
        db.flush()
        _u, token = make_user(permissions=[Permissions.SALES_RETURN_VIEW], branches=[branch])
        superclient.headers.update({"Authorization": f"Bearer {token}"})
        r = superclient.get(S + "/returns/")
        assert r.status_code == 200, r.text
        assert any(len(x["remark"] or "") == 2500 for x in r.json())

    def test_zero_amount_voucher_does_not_break_the_list(self, db, superclient):
        from app.modules.customers.models import CustomerGiftVoucher
        code = _uid("QAZERO")
        db.add(CustomerGiftVoucher(barcode_no=code, amount=D("0.00"), balance=D("0.00"), date=TODAY,
                                   valid_period_in_months=12, status="fully_claimed"))
        db.flush()
        r = superclient.get(C + "/vouchers/", params={"limit": 5})
        assert r.status_code == 200, r.text
        assert code in {v["barcode_no"] for v in r.json()}


# ═══════════════════════════════════════ F7 money caps ═══════════════════════════════════════
BAD = [1e30, float("nan"), float("inf"), "NaN"]


class TestMoneyCaps:
    @pytest.mark.parametrize("amount", BAD)
    def test_customer_advance(self, superclient, shop, amount):
        branch, customer, _, _ = shop
        r = _raw_post(superclient, F + "/advance-payments", {
            "customer_id": customer.id, "payment_method": "cash", "branch_code": branch.branch_code,
            "payment_amount": amount, "cheque_date": str(TODAY)})
        assert r.status_code == 422, r.text

    @pytest.mark.parametrize("amount", BAD + [0])
    def test_credit_note(self, superclient, shop, amount):
        r = _raw_post(superclient, F + "/credit-notes", {"customer_id": shop[1].id, "amount": amount, "remark": "QA"})
        assert r.status_code == 422, r.text

    @pytest.mark.parametrize("amount", BAD + [0])
    def test_gift_voucher(self, superclient, amount):
        r = _raw_post(superclient, C + "/vouchers/", {"barcode_no": _uid("QAV"), "amount": amount, "payment_method": "cash"})
        assert r.status_code == 422, r.text

    @pytest.mark.parametrize("field", ["cash_amount", "selling_price"])
    @pytest.mark.parametrize("amount", [1e30, float("nan")])
    def test_sale(self, superclient, superuser, shop, field, amount):
        body = _order(shop, superuser[0].id)
        if field == "selling_price":
            body["items"][0]["selling_price"] = amount
        else:
            body[field] = amount
        r = _raw_post(superclient, S + "/", body)
        assert r.status_code == 422, r.text

    def test_max_money_is_accepted_boundary(self):
        from app.core.money import MAX_MONEY
        from app.modules.finance import schemas as fs
        ok = fs.CustomerCreditNoteCreate(customer_id=1, amount=MAX_MONEY, remark="x")
        assert ok.amount == MAX_MONEY
        with pytest.raises(Exception):
            fs.CustomerCreditNoteCreate(customer_id=1, amount=MAX_MONEY + D("0.01"), remark="x")

    def test_manual_journal_line_cap(self):
        from app.modules.finance import accounting_schemas as a
        with pytest.raises(Exception):
            a.JournalEntryCreateInput(entry_date=TODAY, description="x", lines=[
                {"line_number": 1, "account_id": 1, "debit_amount": "1e30"},
                {"line_number": 2, "account_id": 2, "credit_amount": "1e30"}])

    def test_coupon_percent_over_100_refused(self):
        from app.modules.customers import schemas as cs
        with pytest.raises(Exception):
            cs.CustomerCuponCodesCreate(cupon_code="X", discount_type="PERCENT", discount_value=150,
                                        valid_until_date=TODAY)


# ═══════════════════════════════════════ F8 advance remaining ═══════════════════════════════════════
class TestAdvanceRemaining:
    def test_new_advance_is_wholly_unapplied(self, superclient, shop):
        branch, customer, _, _ = shop
        r = superclient.post(F + "/advance-payments", json={
            "customer_id": customer.id, "payment_method": "cash", "branch_code": branch.branch_code,
            "payment_amount": "300.00", "cheque_date": str(TODAY)})
        assert r.status_code == 201, r.text
        adv = r.json()
        assert D(str(adv["remaining_amount"])) == D("300.00")
        assert D(str(adv["applied_amount"])) == D("0") and adv["is_fully_applied"] is False


# ═══════════════════════════════════════ F11 sales report == GL ═══════════════════════════════════════
def _gl_net_revenue(db, branch_code):
    rows = (
        db.query(ChartOfAccounts.account_code, GeneralLedger.debit_amount, GeneralLedger.credit_amount)
        .join(GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id)
        .filter(ChartOfAccounts.account_code.in_(["4010", "4020", "4030"]),
                GeneralLedger.branch_code == branch_code, GeneralLedger.posting_date == TODAY)
        .all()
    )
    return sum((D(str(c or 0)) - D(str(d or 0)) for _, d, c in rows), D("0"))


class TestSalesReportMatchesLedger:
    def test_report_equals_gl_revenue(self, db, superclient, superuser, shop):
        from app.modules.customers.models import CustomerCreditNotes
        from app.modules.reporting import schemas as rs
        from app.modules.reporting.service import ReportingService

        rep = superuser[0]
        branch, customer, product, loc = shop
        # 1. voucher sale: 200 = 100 cash + 100 voucher (grand_total 100, revenue 200)
        v = superclient.post(C + "/vouchers/", json={"barcode_no": _uid("QAV"), "amount": 100, "payment_method": "cash"})
        assert v.status_code == 201, v.text
        _place(superclient, shop, rep.id, price=200.0, cash_amount=100.0,
               voucher_redemptions=[{"voucher_id": v.json()["id"], "amount_to_redeem": 100}])
        # 2. credit-note sale: 100 fully paid by a credit note (grand_total 0, revenue 100)
        db.add(CustomerCreditNotes(customer_id=customer.id, date=datetime.utcnow(), amount=D("100"), remark="QA"))
        db.flush()
        _place(superclient, shop, rep.id, price=100.0, cash_amount=0, credit_note_amount=100)
        # 3. discount sale: 250 - 10% = 225
        _place(superclient, shop, rep.id, price=250.0, discount_percent=10, cash_amount=225.0)
        # 4. cancelled order: never revenue
        o = _place(superclient, shop, rep.id, qty=2, price=100.0, payment_method="credit", cash_amount=0,
                   credit_amount=200.0, override_credit_validation=True)
        assert superclient.post(f"{S}/{o['id']}/cancel").status_code == 200
        # 5. cash sale of 2 x 100 with a processed partial return of 1
        sold = _place(superclient, shop, rep.id, qty=2, price=100.0)
        inv = db.query(Invoice).filter(Invoice.id == sold["id"]).one()
        item = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == inv.id).one()
        ret = sales_service.create_sale_return(db, sales_schemas.SaleReturnCreate(
            branch_code=inv.branch_code, invoice_id=inv.id, good_received_locations_id=loc.id,
            payment_method="cash", items=[sales_schemas.SaleReturnItemCreate(
                barcode="", return_price=float(item.selling_price), sold_price=float(item.selling_price),
                branch_code=inv.branch_code, invoice_item_id=item.id, quantity=1)]), user_id=rep.id)
        ret.status = "approved"
        db.flush()
        sales_service.process_sale_return(db, ret.id, user_id=rep.id)

        gl = _gl_net_revenue(db, branch.branch_code)
        assert gl == D("625.00"), gl  # 200 + 100 + 225 + 200 - 100

        report = ReportingService(db).get_sales_report(rs.SalesReportRequest(
            start_date=TODAY, end_date=TODAY, branch_code=branch.branch_code))
        assert D(str(report.total_sales)).quantize(D("0.01")) == gl
        assert report.total_orders == 4  # cancelled order excluded
        assert [p["product_name"] for p in report.top_products] == [product.name]
        assert D(str(report.top_products[0]["revenue"])) == gl
        assert report.top_products[0]["quantity_sold"] == 1 + 1 + 1 + 2 - 1
        assert D(str(sum(d["revenue"] for d in report.sales_by_date))).quantize(D("0.01")) == gl
        assert [(b["branch_code"], D(str(b["revenue"]))) for b in report.sales_by_branch] == [(branch.branch_code, gl)]

        # top_products respects the customer filter (another customer sees nothing)
        other = ReportingService(db).get_sales_report(rs.SalesReportRequest(
            start_date=TODAY, end_date=TODAY, branch_code=branch.branch_code, customer_id=customer.id + 10_000_000))
        assert other.top_products == [] and other.total_sales == 0


# ═══════════════════════════════════════ F12 / F13 GL reports ═══════════════════════════════════════
BIG = D("100000000000000000000000000.03")  # 27 integer digits: the cents need 29+ significant digits
BIG_LESS_3C = D("100000000000000000000000000.00")
TOTAL = D("100000000000000000000000000.06")  # literal: BIG + 0.03 would itself round in the default context


@pytest.fixture
def big_branch(db, make_branch):
    """A branch whose ledger is balanced to the cent but needs > 28 significant digits:
    Dr 1010 1e26+0.03 / Cr 2010 1e26 / Cr 4010 0.03 and Dr 1020 0.03 / Cr 4010 0.03."""
    br = make_branch()
    _gl_row(db, "1010", br.branch_code, debit=BIG)
    _gl_row(db, "2010", br.branch_code, credit=BIG_LESS_3C)
    _gl_row(db, "4010", br.branch_code, credit="0.03")
    _gl_row(db, "1020", br.branch_code, debit="0.03")
    _gl_row(db, "4010", br.branch_code, credit="0.03")
    return br


class TestGLReportPrecisionAndBranch:
    def test_balance_sheet_balances_with_huge_amounts(self, superclient, big_branch):
        r = superclient.get(F + "/accounting/reports/balance-sheet",
                            params={"fiscal_year": TODAY.year, "branch_code": big_branch.branch_code})
        assert r.status_code == 200, r.text
        bs = r.json()
        assert D(str(bs["total_assets"])) == TOTAL
        assert D(str(bs["total_liabilities_and_equity"])) == TOTAL
        assert bs["is_balanced"] is True

    def test_trial_balance_branch_filter(self, superclient, big_branch):
        r = superclient.get(F + "/accounting/general-ledger/trial-balance",
                            params={"fiscal_year": TODAY.year, "branch_code": big_branch.branch_code})
        assert r.status_code == 200, r.text
        tb = r.json()
        assert {a["account_code"] for a in tb["accounts"]} == {"1010", "1020", "2010", "4010"}
        assert D(str(tb["total_debit"])) == D(str(tb["total_credit"])) == TOTAL

    def test_income_statement_branch_filter(self, superclient, big_branch):
        r = superclient.get(F + "/accounting/reports/income-statement",
                            params={"fiscal_year": TODAY.year, "branch_code": big_branch.branch_code})
        assert r.status_code == 200, r.text
        assert D(str(r.json()["net_income"])) == D("0.06")

    def test_branch_user_is_scoped(self, superclient, make_user, make_branch, big_branch):
        own = make_branch()
        _u, token = make_user(permissions=[Permissions.REPORTING_FINANCE_VIEW, Permissions.GENERAL_LEDGER_VIEW],
                              branches=[own])
        superclient.headers.update({"Authorization": f"Bearer {token}"})
        denied = superclient.get(F + "/accounting/reports/balance-sheet",
                                 params={"fiscal_year": TODAY.year, "branch_code": big_branch.branch_code})
        assert denied.status_code == 403, denied.text
        tb = superclient.get(F + "/accounting/general-ledger/trial-balance", params={"fiscal_year": TODAY.year})
        assert tb.status_code == 200, tb.text
        assert tb.json()["accounts"] == []  # only the user's (empty) branch, not big_branch / company-wide

    def test_ar_aging_branch_filter_and_scope(self, superclient, make_user, make_branch, shop):
        own = make_branch()
        _u, token = make_user(permissions=[Permissions.CUSTOMER_VIEW], branches=[own])
        assert superclient.get(C + "/reports/aging", params={"branch_code": shop[0].branch_code}).status_code == 200
        superclient.headers.update({"Authorization": f"Bearer {token}"})
        assert superclient.get(C + "/reports/aging", params={"branch_code": shop[0].branch_code}).status_code == 403
        r = superclient.get(C + "/reports/aging")
        assert r.status_code == 200 and r.json()["total"]["count"] == 0, r.text


class TestReconciliationCheck:
    YEAR = 2399

    def _period(self, db, n=1):
        p = AccountingPeriod(fiscal_year=self.YEAR, period_number=n, period_name=f"QA {n}/{self.YEAR}",
                             start_date=date(self.YEAR, n, 1), end_date=date(self.YEAR, n, 28), status="open")
        db.add(p)
        db.flush()
        return p

    def _check(self, superclient, period):
        r = superclient.get(F + "/accounting/reports/reconciliation-check",
                            params={"fiscal_year": self.YEAR, "fiscal_period": period})
        assert r.status_code == 200, r.text
        return r.json()

    def test_clean_existing_period_is_ready(self, db, superclient):
        self._period(db, 1)
        assert self._check(superclient, 1)["is_ready_to_close"] is True

    def test_pending_posting_failure_blocks_close(self, db, superclient):
        self._period(db, 2)
        db.add(GLPostingFailure(reference_type="QA", reference_id=1, source_module="sales",
                                entry_date=date(self.YEAR, 2, 10), error_code="exception",
                                error_message="QA", status="pending"))
        db.flush()
        res = self._check(superclient, 2)
        assert res["is_ready_to_close"] is False
        assert any("posting" in e for e in res["errors"]), res

    def test_missing_period_record_is_an_error(self, superclient):
        res = self._check(superclient, 7)
        assert res["is_ready_to_close"] is False
        assert any("No accounting period" in e for e in res["errors"]), res


# ═══════════════════════════════════════ F15 day-end hint ═══════════════════════════════════════
class TestDayEndHint:
    def test_gl_only_movement_says_cashbook_is_missing(self, db, make_branch):
        from app.modules.finance.reconciliation_service import ReconciliationService
        br = make_branch()
        _gl_row(db, "1010", br.branch_code, debit="50.00")
        _gl_row(db, "4010", br.branch_code, credit="50.00")
        res = ReconciliationService(db).day_end(TODAY, branch_code=br.branch_code)
        msg = " ".join(res.discrepancies)
        assert "missing from the cashbook" in msg and "did not post to the GL" not in msg, msg
