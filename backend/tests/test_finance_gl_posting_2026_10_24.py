"""GL posting gateway fixes (2026-10-24).

1. Retry of a "commit_failed" posting failure regenerates the JE from the source
   document (the stored payload is empty) instead of reporting skipped_empty.
2. Sale-return idempotency: the marker the locked re-check filters on is always
   findable in the JE, and reversed JEs no longer block a re-post.
3. JE numbering is numeric (…-10000 sorts above …-9999).
4. Header (parent) accounts are not postable.
5. Sale-return COGS reversal uses the same (price-tier) cost basis as the sale.
6. Lines are quantized to 2dp before the balance check.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.core import timezone as tz
from app.modules.finance.accounting_models import (
    ChartOfAccounts,
    GeneralLedger,
    GLPostingFailure,
    JournalEntry,
    JournalEntryLine,
)
from app.modules.finance.gl_posting_service import GLPostingService
from app.modules.sales.accounting_integration import SalesAccountingIntegration

D = Decimal
OPEN_DATE = date(2090, 6, 15)  # no accounting period -> always postable


def _uid() -> str:
    return uuid.uuid4().hex[:10].upper()


def _ref() -> int:
    return int(_uid(), 16) % 1_000_000 + 8_100_000


def _ensure(db, code, account_type="Asset", normal_balance="Debit"):
    acc = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).first()
    if acc is None:
        acc = ChartOfAccounts(account_code=code, account_name=f"QA {code}", account_type=account_type,
                              normal_balance=normal_balance, is_active=True)
        db.add(acc)
        db.flush()
    return acc


def _line(code, debit="0", credit="0"):
    return {"account_code": code, "debit": D(debit), "credit": D(credit), "description": "qa"}


def _post(db, ref_type, ref_id, lines, **kw):
    kw.setdefault("description", "QA post")
    return GLPostingService(db).post(reference_type=ref_type, reference_id=ref_id, lines=lines,
                                     entry_date=OPEN_DATE, branch_code="QA", user_id=1, **kw)


class _SharedSession:
    """Make the failure recorder's independent SessionLocal() write into the test session."""

    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    def commit(self):
        self._real.flush()

    def close(self):
        pass


@pytest.fixture
def outbox(db, monkeypatch):
    monkeypatch.setattr("app.db.session.SessionLocal", lambda: _SharedSession(db))
    return db


def _commit_failure(db, ref_type, ref_id, marker=None):
    fid = GLPostingService(db).record_post_commit_failure(
        reference_type=ref_type, reference_id=ref_id, error_message="QA commit failed",
        marker=marker, user_id=1,
    )
    assert fid is not None
    return db.query(GLPostingFailure).filter(GLPostingFailure.id == fid).one()


# ═══════════════════════════ 1. regenerate commit_failed ═══════════════════════════
class TestRetryRegeneratesFromSource:
    def test_gift_voucher_sale_commit_failure_is_regenerated(self, db, outbox):
        from app.modules.customers.models import CustomerGiftVoucher

        for code in ("1010", "2510"):
            _ensure(db, code)
        v = CustomerGiftVoucher(barcode_no=f"GV-QA-{_uid()}", amount=D("75.00"), balance=D("75.00"),
                                date=OPEN_DATE, valid_period_in_months=12, status="active",
                                payment_method="cash", branch_code="QA", customer_name="QA")
        db.add(v)
        db.flush()
        failure = _commit_failure(db, "GiftVoucherSale", v.id)
        assert failure.payload == "[]"  # nothing to replay

        result = GLPostingService(db).retry_failure(failure.id, user_id=1)

        assert result.status == "posted", (result.error_code, result.error_message)
        db.refresh(failure)
        assert failure.status == "resolved"
        assert failure.resolved_je_id is not None
        je = db.query(JournalEntry).get(failure.resolved_je_id)
        assert je.total_debit == je.total_credit == D("75.00")
        refs = {(l.reference_type, l.reference_id) for l in je.lines}
        assert refs == {("GiftVoucherSale", v.id)}

    def test_credit_note_commit_failure_is_regenerated(self, db, outbox, make_customer):
        from app.modules.customers.models import CustomerCreditNotes

        for code, t, nb in (("4030", "Revenue", "Debit"), ("2530", "Liability", "Credit")):
            _ensure(db, code, t, nb)
        note = CustomerCreditNotes(customer_id=make_customer().id, date=datetime.combine(OPEN_DATE, time()),
                                   amount=D("40.00"), remark="qa", invoice_no="INV-QA")
        db.add(note)
        db.flush()
        failure = _commit_failure(db, "CustomerCreditNote", note.id)
        result = GLPostingService(db).retry_failure(failure.id, user_id=1)
        assert result.status == "posted", (result.error_code, result.error_message)
        db.refresh(failure)
        assert failure.status == "resolved"
        je = db.query(JournalEntry).get(failure.resolved_je_id)
        assert je.total_debit == je.total_credit == D("40.00")

    def test_supplier_batch_failure_is_not_regenerable(self, db, outbox):
        failure = _commit_failure(db, "AdvanceApplicationBatch", _ref())
        result = GLPostingService(db).retry_failure(failure.id, user_id=1)
        assert result.failed and result.error_code == "not_regenerable"
        db.refresh(failure)
        assert failure.status == "pending"

    def test_empty_payload_is_never_reported_as_success(self, db, outbox):
        # A non-commit_failed row with an empty payload and no regenerator.
        ref_id = _ref()
        failure = _commit_failure(db, "QAUnknownType", ref_id)
        failure.error_code = "exception"
        db.flush()
        result = GLPostingService(db).retry_failure(failure.id, user_id=1)
        assert result.status != "skipped_empty"
        assert result.failed
        db.refresh(failure)
        assert failure.status == "pending"

    def test_registry_covers_hook_call_sites(self):
        from app.modules.finance.gl_regenerators import get_regenerator, NOT_REGENERABLE

        regenerable = [
            ("GiftVoucherSale", None), ("GiftVoucherExpiry", "GiftVoucherExpiry ID: 5"),
            ("BankDeposit", None), ("Expense", None), ("CustomerAdvance", None),
            ("Reimbursement", None), ("PayrollBatch", None), ("SupplierPayment", None),
            ("LandedCost", None), ("LandedCost", "Cancel"), ("PurchaseReturn", None),
            ("GRN", None), ("GRN", "Cancel"), ("AdvanceApplication", None),
            ("AdvanceApplication", "grn"), ("CreditSettle", None), ("SupplierAdvance", None),
            ("SupplierAdvanceReturn", None), ("Invoice", None), ("SaleReturn", None),
            ("CustomerCreditNote", None), ("StatutoryPayment", None),
        ]
        for key in regenerable:
            assert get_regenerator(*key) is not None, key
        for t in ("AdvanceApplicationBatch",):
            assert t in NOT_REGENERABLE and get_regenerator(t, None) is None
        # A cancel marker never falls back to the forward posting.
        assert get_regenerator("GRN", "Cancel") is not get_regenerator("GRN", None)


# ═══════════════════════════ 2. marker / reversed idempotency ═══════════════════════════
class TestAlreadyPosted:
    def test_sale_return_marker_found_by_locked_recheck(self, db):
        a, b = _ensure(db, "4030"), _ensure(db, "1010")
        ref_id = _ref()
        lines = [_line("4030", debit="10"), _line("1010", credit="10")]
        desc = f"Auto GL - Sale Return | Return: SR-QA | Invoice ID: {ref_id}"
        first = _post(db, "SaleReturn", ref_id, lines, marker="SaleReturn", description=desc)
        second = _post(db, "SaleReturn", ref_id, lines, marker="SaleReturn", description=desc)
        assert first.status == "posted"
        assert second.status == "skipped_duplicate"
        assert second.journal_entry.id == first.journal_entry.id

    def test_integration_sale_return_found_by_marker(self, db, make_customer):
        """The JE the integration posts must be visible to already_posted('SaleReturn' marker)."""
        je = self._sale_return_je(db, make_customer())
        assert GLPostingService(db).already_posted("SaleReturn", je.lines[0].reference_id, "SaleReturn") is not None

    def _sale_return_je(self, db, customer):
        for code in ("1010", "1020", "1110", "2210", "2530", "4030"):
            _ensure(db, code)
        inv = _mk_invoice(db, customer)
        ret = SimpleNamespace(id=_ref(), sale_return_no=f"SR-{_uid()}", invoice_id=inv.id,
                              total_refund=D("50.00"), tax_refund=D("0"), payment_method="cash",
                              added_date=OPEN_DATE, branch_code=inv.branch_code, items=[])
        je = SalesAccountingIntegration(db).post_sale_return_to_gl(ret, user_id=1)
        assert je is not None
        db.refresh(je)
        return je

    def test_reversed_je_does_not_block_repost(self, db):
        _ensure(db, "1010"), _ensure(db, "4030")
        ref_id = _ref()
        lines = [_line("1010", debit="20"), _line("4030", credit="20")]
        first = _post(db, "QARev", ref_id, lines, marker="Revenue", description="QA Revenue")
        assert first.status == "posted"
        first.journal_entry.is_reversed = True
        db.flush()
        again = _post(db, "QARev", ref_id, lines, marker="Revenue", description="QA Revenue")
        assert again.status == "posted"
        assert again.journal_entry.id != first.journal_entry.id

    def test_reversed_status_does_not_block_repost(self, db):
        _ensure(db, "1010"), _ensure(db, "4030")
        ref_id = _ref()
        lines = [_line("1010", debit="20"), _line("4030", credit="20")]
        first = _post(db, "QARev", ref_id, lines)
        first.journal_entry.status = "reversed"
        db.flush()
        assert _post(db, "QARev", ref_id, lines).status == "posted"


def _mk_invoice(db, customer, *, payment_method="cash"):
    from app.modules.sales.models import Invoice

    inv = Invoice(
        is_tax_invoice=False, invoice_no=f"INV-QA-{_uid()}", branch_code="QA", payment_method=payment_method,
        created_date=OPEN_DATE, customer_id=customer.id, approval=True, approval_status="completed",
        bank_transfer_amount=D("0"), card_amex_amount=D("0"), card_mastercard_amount=D("0"),
        card_visa_amount=D("0"), cash_amount=D("1000"), cheque_date=OPEN_DATE, cheque_amount=D("0"),
        payment_adjustments=D("0"), credit_amount=D("0"), cupon_amount=D("0"), special=False,
        created_date_time=datetime.combine(OPEN_DATE, time(12, 0)), status=True, tax_rate=D("0"),
        tax_amount=D("0"), discount_percent=D("0"), discount_amount=D("0"), subtotal=D("1000"),
        grand_total=D("1000"), paid_amount=D("1000"), balance_due=D("0"), payment_status="paid",
        service_charge_rate=D("0"), service_charge_amount=D("0"),
    )
    db.add(inv)
    db.flush()
    return inv


# ═══════════════════════════ 3. JE numbering ═══════════════════════════
class TestJENumbering:
    def test_sequence_past_9999_is_numeric(self, db):
        prefix = f"QA{_uid()[:6]}"
        full = f"{prefix}-{tz.today().strftime('%Y%m')}-"
        for n in ("9999", "10000"):
            db.add(JournalEntry(journal_entry_no=f"{full}{n}", entry_date=OPEN_DATE, posting_date=OPEN_DATE,
                                entry_type="Auto", description="qa", total_debit=0, total_credit=0,
                                status="posted", fiscal_year=2090, fiscal_period=6, created_by=1))
        db.flush()
        assert GLPostingService(db)._generate_je_number(prefix) == f"{full}10001"


# ═══════════════════════════ 4. header accounts ═══════════════════════════
class TestHeaderAccount:
    def test_posting_to_parent_account_fails(self, db, make_account, outbox):
        parent = make_account(account_type="Asset", normal_balance="Debit")
        child = make_account(account_type="Asset", normal_balance="Debit")
        child.parent_account_id = parent.id
        other = make_account(account_type="Revenue", normal_balance="Credit")
        db.flush()
        ref_id = _ref()
        res = _post(db, "QAHdr", ref_id, [_line(parent.account_code, debit="5"),
                                          _line(other.account_code, credit="5")])
        assert res.failed and res.error_code == "header_account", res
        assert res.failure_id is not None
        f = db.query(GLPostingFailure).get(res.failure_id)
        assert f.error_code == "header_account"
        # The leaf account is still postable.
        ok = _post(db, "QAHdr", _ref(), [_line(child.account_code, debit="5"),
                                         _line(other.account_code, credit="5")])
        assert ok.status == "posted"


# ═══════════════════════════ 5. sale return COGS basis ═══════════════════════════
class TestSaleReturnCogsBasis:
    def test_restock_uses_price_tier_cost(self, db, make_product, make_customer):
        from app.modules.products.price_tier_models import ProductPriceTier
        from app.modules.sales.models import InvoiceItems

        for code in ("1010", "4030", "1210", "5010"):
            _ensure(db, code)
        product = make_product(cost_price=100)
        tier = ProductPriceTier(product_id=product.id, cost_price=D("60.00"), minimum_selling_price=D("70"),
                                selling_price=D("90"), is_active=True)
        db.add(tier)
        db.flush()
        inv = _mk_invoice(db, make_customer())
        item = InvoiceItems(warrenty_month="12", selling_price=D("90"), created_date=datetime.now(),
                            invoice_id=inv.id, product_id=product.id, quantity=2,
                            minimum_selling_price=D("70"), price_tier_id=tier.id)
        db.add(item)
        db.flush()

        cogs_je = SalesAccountingIntegration(db).post_cogs_to_gl(inv, user_id=1)
        assert cogs_je is not None and cogs_je.total_debit == D("120.00")

        ret = SimpleNamespace(
            id=_ref(), sale_return_no=f"SR-{_uid()}", invoice_id=inv.id, total_refund=D("180.00"),
            tax_refund=D("0"), payment_method="cash", added_date=OPEN_DATE, branch_code="QA",
            items=[SimpleNamespace(restocked=True, product_id=product.id, quantity=2, invoice_item_id=item.id)],
        )
        je = SalesAccountingIntegration(db).post_sale_return_to_gl(ret, user_id=1)
        assert je is not None
        rows = (db.query(ChartOfAccounts.account_code, GeneralLedger.debit_amount, GeneralLedger.credit_amount)
                .join(GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id)
                .filter(GeneralLedger.journal_entry_id == je.id).all())
        by = {c: (D(str(d)), D(str(cr))) for c, d, cr in rows}
        assert by["1210"] == (D("120.00"), D("0"))  # tier cost 60 x 2, not product cost 100 x 2
        assert by["5010"] == (D("0"), D("120.00"))


# ═══════════════════════════ 6. quantize before balance check ═══════════════════════════
class TestQuantizeBeforeBalance:
    def test_stored_lines_balance(self, db):
        _ensure(db, "1010"), _ensure(db, "4030")
        res = _post(db, "QAQ", _ref(), [_line("1010", debit="33.335"), _line("1010", debit="33.335"),
                                        _line("4030", credit="66.67")])
        assert res.status == "posted", res
        je = res.journal_entry
        db.flush()
        lines = db.query(JournalEntryLine).filter(JournalEntryLine.journal_entry_id == je.id).all()
        for l in lines:
            db.refresh(l)
        dr = sum(D(str(l.debit_amount)) for l in lines)
        cr = sum(D(str(l.credit_amount)) for l in lines)
        assert dr == cr
        db.refresh(je)
        assert D(str(je.total_debit)) == dr and D(str(je.total_credit)) == cr


class TestSaleReturnArAppliedDerivation:
    """The SaleReturn regenerator re-derives ar_applied from stored data."""

    def _inv(self, method="credit", credit="500"):
        return SimpleNamespace(payment_method=method, credit_amount=D(credit))

    def test_credit_note_with_note_splits_receivable(self, db, make_customer):
        from app.modules.customers.models import CustomerCreditNotes
        from app.modules.finance.gl_regenerators import sale_return_ar_applied

        note = CustomerCreditNotes(customer_id=make_customer().id, date=datetime.now(), amount=D("40.00"),
                                   remark="qa", invoice_no="INV-QA")
        db.add(note)
        db.flush()
        sr = SimpleNamespace(id=_ref(), total_refund=D("100.00"), payment_method="credit_note",
                             credit_note_id=note.id, refund_reference=f"CN-{note.id}")
        assert sale_return_ar_applied(db, sr, self._inv()) == D("60.00")

    def test_credit_note_without_note_is_all_receivable(self, db):
        from app.modules.finance.gl_regenerators import sale_return_ar_applied

        sr = SimpleNamespace(id=_ref(), total_refund=D("100.00"), payment_method="credit_note",
                             credit_note_id=None, refund_reference="AR-SR-1")
        assert sale_return_ar_applied(db, sr, self._inv()) == D("100.00")

    def test_cash_refund_on_cash_sale_has_no_receivable(self, db):
        from app.modules.finance.gl_regenerators import sale_return_ar_applied

        sr = SimpleNamespace(id=_ref(), total_refund=D("100.00"), payment_method="cash",
                             credit_note_id=None, refund_reference="CASH-1")
        assert sale_return_ar_applied(db, sr, self._inv("cash", "0")) == D("0")
