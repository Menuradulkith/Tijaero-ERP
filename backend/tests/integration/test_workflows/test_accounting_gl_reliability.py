"""
QA suite — Accounting ↔ Sales/Purchasing finance-flow reliability.

This suite is the "final check" that the accounting layer stays consistent with
the sales and purchasing finance flows, and that the day-end books always
balance (or the system tells you precisely why they do not).

It exercises the *new* reliability machinery end-to-end against the
auto-rolled-back ``db`` session (real PostgreSQL, nothing persisted):

GLPostingService (the single gateway every sale / purchase / expense / payroll
posting now flows through)
    * a balanced set of lines  -> one posted Auto JE + matching GL rows, totals set
    * GL debits == credits for the entry (double-entry preserved)
    * a missing COA account    -> failed result (never a silent skip)
    * an imbalance beyond tol  -> failed result
    * a closed accounting period -> blocked
    * sub-cent rounding        -> balanced via an explicit 5900 line
    * exact-reference idempotency -> the same document never posts twice
    * marker idempotency       -> Revenue / COGS / Discount are told apart

Sales finance flow (SalesAccountingIntegration)
    * cash sale  (Dr 1010 / Cr 4010 / Cr 2210) posts one balanced JE-SALE entry
    * credit sale (Dr 1110 / Cr 4020 / Cr 2210) posts to receivables, not cash
    * COGS        (Dr 5010 / Cr 1210) posts balanced
    * the Revenue / COGS guards do not collide

Purchasing finance flow (PurchaseExpensePayrollGL)
    * GRN purchase (Dr 1210 / Cr 1020) posts one balanced JE-PUR entry
    * credit purchase (Dr 1210 / Cr 2010) posts to creditors
    * expense (Dr 5xxx / Cr 1020) posts balanced
    * the "GRN ID: x" guard recognises an already-posted GRN

Day-End reconciliation (ReconciliationService)
    * a clean day -> trial_balanced, cash_reconciled, is_balanced
    * GL cash movement vs cashbook mismatch -> flagged, not balanced
    * a pending posting failure -> counted, not balanced
    * an unposted JE dated today -> warned, not balanced

Posting-failure outbox (GLPostingService + GLPostingFailureService)
    * a failed posting is recorded durably (survives caller rollback)
    * retry re-posts once the account exists and marks the failure resolved
    * list / ignore behave
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.modules.finance.accounting_models import (
    AccountingPeriod,
    ChartOfAccounts,
    GeneralLedger,
    GLPostingFailure,
    JournalEntry,
    JournalEntryLine,
)
from app.modules.finance.gl_posting_service import (
    ROUNDING_ACCOUNT_CODE,
    GLPostingService,
)
from app.modules.finance.models import CashbookEntryRecord
from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
from app.modules.finance.reconciliation_service import (
    GLPostingFailureService,
    ReconciliationService,
)
from app.modules.sales.accounting_integration import SalesAccountingIntegration


# --------------------------------------------------------------------------- #
# Constants & helpers
# --------------------------------------------------------------------------- #
# A date with no accounting period -> posting is always allowed, and there is no
# pre-existing GL / cashbook data, so day-end math is fully deterministic.
OPEN_DATE = date(2090, 6, 15)
# A date we deliberately put a *closed* period around.
CLOSED_DATE = date(2099, 1, 15)


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _branch() -> str:
    return f"QA{_uid()}"


def _ensure_account(
    db,
    code: str,
    *,
    account_type: str = "Asset",
    normal_balance: str = "Debit",
    name: str | None = None,
) -> ChartOfAccounts:
    """Return the existing COA row for ``code`` or create it (idempotent).

    Lets the suite run against both a freshly-seeded and an already-seeded DB
    without violating the unique ``account_code`` constraint.
    """
    acc = (
        db.query(ChartOfAccounts)
        .filter(ChartOfAccounts.account_code == code)
        .first()
    )
    if acc is not None:
        if not acc.is_active:
            acc.is_active = True
            db.flush()
        return acc
    acc = ChartOfAccounts(
        account_code=code,
        account_name=name or f"QA Account {code}",
        account_type=account_type,
        normal_balance=normal_balance,
        is_active=True,
        is_system_account=False,
    )
    db.add(acc)
    db.flush()
    return acc


def _line(code: str, debit: str = "0", credit: str = "0", desc: str = "") -> dict:
    return {
        "account_code": code,
        "debit": Decimal(debit),
        "credit": Decimal(credit),
        "description": desc,
    }


def _make_cashbook(
    db,
    *,
    branch_code: str,
    money_in: str = "0",
    money_out: str = "0",
    entry_type: str = "invoice_receipt",
    on_date: date = OPEN_DATE,
) -> CashbookEntryRecord:
    row = CashbookEntryRecord(
        entry_type=entry_type,
        transaction_date=datetime.combine(on_date, time(12, 0)),
        source_table="invoices",
        source_id=1,
        reference_no=f"QA-{_uid()}",
        money_in=Decimal(money_in),
        money_out=Decimal(money_out),
        running_balance=Decimal("0"),
        branch_code=branch_code,
    )
    db.add(row)
    db.flush()
    return row


class _SharedSession:
    """Proxy that makes ``GLPostingService._record_failure``'s independent
    ``SessionLocal()`` write into the *test* session instead of the real DB.

    ``commit`` becomes ``flush`` (so the row is visible to later queries in the
    same test but still rolls back on teardown) and ``close`` is a no-op (so the
    shared test session is never closed mid-test).
    """

    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    def commit(self):
        self._real.flush()

    def close(self):
        pass


@pytest.fixture
def outbox_to_test_session(db, monkeypatch):
    """Route the failure-recording independent session into the test session."""
    monkeypatch.setattr(
        "app.db.session.SessionLocal", lambda: _SharedSession(db)
    )
    return db


# --------------------------------------------------------------------------- #
# GLPostingService — core double-entry gateway
# --------------------------------------------------------------------------- #
class TestGLPostingServiceBalancing:
    def test_balanced_post_creates_posted_je_and_gl(self, db):
        cash = _ensure_account(db, f"QA{_uid()}", account_type="Asset", normal_balance="Debit")
        rev = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        svc = GLPostingService(db)
        ref_id = int(_uid(), 16) % 1_000_000

        result = svc.post(
            reference_type="QA",
            reference_id=ref_id,
            lines=[
                _line(cash.account_code, debit="100.00", desc="cash in"),
                _line(rev.account_code, credit="100.00", desc="revenue"),
            ],
            entry_date=OPEN_DATE,
            description="QA balanced post",
            branch_code=_branch(),
            user_id=1,
        )

        assert result.posted is True
        assert result.status == "posted"
        je = result.journal_entry
        assert je is not None
        assert je.status == "posted"
        assert je.entry_type == "Auto"
        assert je.total_debit == Decimal("100.00")
        assert je.total_credit == Decimal("100.00")

        gl_rows = (
            db.query(GeneralLedger)
            .filter(GeneralLedger.journal_entry_id == je.id)
            .all()
        )
        assert len(gl_rows) == 2
        assert sum(r.debit_amount for r in gl_rows) == sum(r.credit_amount for r in gl_rows)
        # Lines carry the integer reference for exact idempotency.
        line_refs = (
            db.query(JournalEntryLine)
            .filter(JournalEntryLine.journal_entry_id == je.id)
            .all()
        )
        assert all(l.reference_type == "QA" and l.reference_id == ref_id for l in line_refs)

    def test_idempotent_repost_returns_same_je(self, db):
        a = _ensure_account(db, f"QA{_uid()}", normal_balance="Debit")
        b = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        svc = GLPostingService(db)
        ref_id = int(_uid(), 16) % 1_000_000
        lines = [_line(a.account_code, debit="50"), _line(b.account_code, credit="50")]

        first = svc.post(
            reference_type="QA",
            reference_id=ref_id,
            lines=lines,
            entry_date=OPEN_DATE,
            description="QA idempotent",
            branch_code=_branch(),
            user_id=1,
        )
        second = svc.post(
            reference_type="QA",
            reference_id=ref_id,
            lines=lines,
            entry_date=OPEN_DATE,
            description="QA idempotent",
            branch_code=_branch(),
            user_id=1,
        )

        assert first.posted is True
        assert second.status == "skipped_duplicate"
        assert second.journal_entry is not None
        assert second.journal_entry.id == first.journal_entry.id
        # Only ONE JE exists for this reference.
        je_count = (
            db.query(JournalEntry.id)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .filter(
                JournalEntryLine.reference_type == "QA",
                JournalEntryLine.reference_id == ref_id,
            )
            .distinct()
            .count()
        )
        assert je_count == 1

    def test_zero_amount_lines_skipped_empty(self, db):
        a = _ensure_account(db, f"QA{_uid()}")
        b = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        svc = GLPostingService(db)
        result = svc.post(
            reference_type="QA",
            reference_id=int(_uid(), 16) % 1_000_000,
            lines=[_line(a.account_code, "0", "0"), _line(b.account_code, "0", "0")],
            entry_date=OPEN_DATE,
            description="QA empty",
            branch_code=_branch(),
            user_id=1,
        )
        assert result.status == "skipped_empty"
        assert result.journal_entry is None


class TestGLPostingServiceFailures:
    """Failure paths use ``record_failure=False`` to keep the test isolated
    (the durable-outbox write is covered separately)."""

    def test_missing_account_is_failure_not_silent(self, db):
        real = _ensure_account(db, f"QA{_uid()}")
        missing_code = f"ZZ{_uid()}"  # guaranteed absent
        svc = GLPostingService(db)
        result = svc.post(
            reference_type="QA",
            reference_id=int(_uid(), 16) % 1_000_000,
            lines=[
                _line(real.account_code, debit="100"),
                _line(missing_code, credit="100"),
            ],
            entry_date=OPEN_DATE,
            description="QA missing account",
            branch_code=_branch(),
            user_id=1,
            record_failure=False,
        )
        assert result.failed is True
        assert result.error_code == "missing_account"
        assert missing_code in result.error_message

    def test_imbalance_beyond_tolerance_is_failure(self, db):
        a = _ensure_account(db, f"QA{_uid()}")
        b = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        svc = GLPostingService(db)
        result = svc.post(
            reference_type="QA",
            reference_id=int(_uid(), 16) % 1_000_000,
            lines=[_line(a.account_code, debit="100"), _line(b.account_code, credit="99")],
            entry_date=OPEN_DATE,
            description="QA imbalance",
            branch_code=_branch(),
            user_id=1,
            record_failure=False,
        )
        assert result.failed is True
        assert result.error_code == "imbalance"

    def test_closed_period_blocks_posting(self, db):
        a = _ensure_account(db, f"QA{_uid()}")
        b = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        # A closed period around CLOSED_DATE (fiscal_year 2099 is free of seed data).
        db.add(
            AccountingPeriod(
                fiscal_year=2099,
                period_number=1,
                period_name="QA Closed Jan 2099",
                start_date=date(2099, 1, 1),
                end_date=date(2099, 1, 31),
                status="closed",
            )
        )
        db.flush()
        svc = GLPostingService(db)
        result = svc.post(
            reference_type="QA",
            reference_id=int(_uid(), 16) % 1_000_000,
            lines=[_line(a.account_code, debit="100"), _line(b.account_code, credit="100")],
            entry_date=CLOSED_DATE,
            description="QA closed period",
            branch_code=_branch(),
            user_id=1,
            record_failure=False,
        )
        assert result.failed is True
        assert result.error_code == "period_closed"


class TestGLPostingRounding:
    def test_subcent_imbalance_posts_to_rounding_account(self, db):
        a = _ensure_account(db, f"QA{_uid()}")
        b = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        rounding = _ensure_account(
            db, ROUNDING_ACCOUNT_CODE, account_type="Expense", normal_balance="Debit"
        )
        svc = GLPostingService(db)
        # debits exceed credits by 0.03 (<= 0.05 tolerance) -> rounding gets a credit.
        result = svc.post(
            reference_type="QA",
            reference_id=int(_uid(), 16) % 1_000_000,
            lines=[
                _line(a.account_code, debit="100.00"),
                _line(b.account_code, credit="99.97"),
            ],
            entry_date=OPEN_DATE,
            description="QA rounding",
            branch_code=_branch(),
            user_id=1,
            record_failure=False,
        )
        assert result.posted is True
        je = result.journal_entry
        assert je.total_debit == je.total_credit

        rounding_gl = (
            db.query(GeneralLedger)
            .filter(
                GeneralLedger.journal_entry_id == je.id,
                GeneralLedger.account_id == rounding.id,
            )
            .one()
        )
        assert rounding_gl.credit_amount == Decimal("0.03")


class TestMarkerIdempotency:
    """Revenue / COGS / Discount share one invoice id and are distinguished only
    by the description marker — the mechanism the sales flow relies on."""

    def test_markers_are_independent(self, db):
        cash = _ensure_account(db, f"QA{_uid()}")
        rev = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        cogs = _ensure_account(db, f"QA{_uid()}", account_type="Expense", normal_balance="Debit")
        inv = _ensure_account(db, f"QA{_uid()}")
        svc = GLPostingService(db)
        invoice_id = int(_uid(), 16) % 1_000_000

        # Post the "Revenue" leg.
        svc.post(
            reference_type="Invoice",
            reference_id=invoice_id,
            lines=[_line(cash.account_code, debit="100"), _line(rev.account_code, credit="100")],
            entry_date=OPEN_DATE,
            description=f"Auto GL - Sale Revenue | Invoice ID: {invoice_id}",
            branch_code=_branch(),
            user_id=1,
            marker="Revenue",
            idempotent=False,
        )

        assert svc.already_posted("Invoice", invoice_id, "Revenue") is not None
        # COGS not posted yet -> guard must still allow it.
        assert svc.already_posted("Invoice", invoice_id, "COGS") is None

        # Post the "COGS" leg for the same invoice id.
        svc.post(
            reference_type="Invoice",
            reference_id=invoice_id,
            lines=[_line(cogs.account_code, debit="60"), _line(inv.account_code, credit="60")],
            entry_date=OPEN_DATE,
            description=f"Auto GL - COGS | Invoice ID: {invoice_id}",
            branch_code=_branch(),
            user_id=1,
            marker="COGS",
            idempotent=False,
        )

        assert svc.already_posted("Invoice", invoice_id, "COGS") is not None
        # Revenue guard still independently true.
        assert svc.already_posted("Invoice", invoice_id, "Revenue") is not None


# --------------------------------------------------------------------------- #
# Sales finance flow (through the gateway)
# --------------------------------------------------------------------------- #
class TestSalesFinanceFlow:
    def _accounts(self, db):
        return {
            "cash": _ensure_account(db, "1010", account_type="Asset", normal_balance="Debit"),
            "bank": _ensure_account(db, "1020", account_type="Asset", normal_balance="Debit"),
            "debtors": _ensure_account(db, "1110", account_type="Asset", normal_balance="Debit"),
            "inventory": _ensure_account(db, "1210", account_type="Asset", normal_balance="Debit"),
            "vat": _ensure_account(db, "2210", account_type="Liability", normal_balance="Credit"),
            "cash_sales": _ensure_account(db, "4010", account_type="Revenue", normal_balance="Credit"),
            "credit_sales": _ensure_account(db, "4020", account_type="Revenue", normal_balance="Credit"),
            "cogs": _ensure_account(db, "5010", account_type="Expense", normal_balance="Debit"),
        }

    def test_cash_sale_posts_balanced_jesale(self, db):
        acc = self._accounts(db)
        integ = SalesAccountingIntegration(db)
        invoice_id = int(_uid(), 16) % 1_000_000

        je = integ._create_je_and_post(
            entry_date=OPEN_DATE,
            description=f"Auto GL - Sale Revenue | Invoice ID: {invoice_id}",
            lines=[
                _line("1010", debit="115", desc="cash in"),
                _line("4010", credit="100", desc="revenue"),
                _line("2210", credit="15", desc="VAT"),
            ],
            branch_code=_branch(),
            user_id=1,
            reference_type="Invoice",
            reference_id=invoice_id,
            reference_no=f"INV-{invoice_id}",
            marker="Revenue",
        )

        assert je is not None
        assert je.journal_entry_no.startswith("JE-SALE-")
        assert je.total_debit == je.total_credit == Decimal("115")
        # The Revenue guard now recognises this invoice; COGS still open.
        assert integ._check_already_posted(invoice_id, "Revenue") is True
        assert integ._check_already_posted(invoice_id, "COGS") is False

    def test_credit_sale_hits_receivables_not_cash(self, db):
        acc = self._accounts(db)
        integ = SalesAccountingIntegration(db)
        invoice_id = int(_uid(), 16) % 1_000_000

        je = integ._create_je_and_post(
            entry_date=OPEN_DATE,
            description=f"Auto GL - Sale Revenue | Invoice ID: {invoice_id}",
            lines=[
                _line("1110", debit="100", desc="trade debtors"),
                _line("4020", credit="100", desc="credit revenue"),
            ],
            branch_code=_branch(),
            user_id=1,
            reference_type="Invoice",
            reference_id=invoice_id,
            marker="Revenue",
        )
        assert je is not None
        debtor_gl = (
            db.query(GeneralLedger)
            .filter(
                GeneralLedger.journal_entry_id == je.id,
                GeneralLedger.account_id == acc["debtors"].id,
            )
            .one()
        )
        assert debtor_gl.debit_amount == Decimal("100")

    def test_cogs_posts_balanced(self, db):
        acc = self._accounts(db)
        integ = SalesAccountingIntegration(db)
        invoice_id = int(_uid(), 16) % 1_000_000

        je = integ._create_je_and_post(
            entry_date=OPEN_DATE,
            description=f"Auto GL - COGS | Invoice ID: {invoice_id}",
            lines=[
                _line("5010", debit="60", desc="COGS"),
                _line("1210", credit="60", desc="inventory out"),
            ],
            branch_code=_branch(),
            user_id=1,
            reference_type="Invoice",
            reference_id=invoice_id,
            marker="COGS",
        )
        assert je is not None
        assert je.total_debit == je.total_credit == Decimal("60")
        assert integ._check_already_posted(invoice_id, "COGS") is True


# --------------------------------------------------------------------------- #
# Purchasing finance flow (through the gateway)
# --------------------------------------------------------------------------- #
class TestPurchasingFinanceFlow:
    def _accounts(self, db):
        return {
            "cash": _ensure_account(db, "1010", account_type="Asset", normal_balance="Debit"),
            "bank": _ensure_account(db, "1020", account_type="Asset", normal_balance="Debit"),
            "inventory": _ensure_account(db, "1210", account_type="Asset", normal_balance="Debit"),
            "creditors": _ensure_account(db, "2010", account_type="Liability", normal_balance="Credit"),
            "utilities": _ensure_account(db, "5130", account_type="Expense", normal_balance="Debit"),
        }

    def test_grn_purchase_posts_balanced_jepur(self, db):
        self._accounts(db)
        integ = PurchaseExpensePayrollGL(db)
        grn_id = int(_uid(), 16) % 1_000_000

        je = integ._create_je_and_post(
            entry_date=OPEN_DATE,
            description=f"Auto GL - GRN Received | GRN ID: {grn_id}",
            lines=[
                _line("1210", debit="500", desc="inventory in"),
                _line("1020", credit="500", desc="bank out"),
            ],
            branch_code=_branch(),
            user_id=1,
            je_prefix="JE-PUR",
            transaction_type="Purchase",
            reference_type="GRN",
            reference_id=grn_id,
            reference_no=f"GRN-{grn_id}",
        )
        assert je is not None
        assert je.journal_entry_no.startswith("JE-PUR-")
        assert je.total_debit == je.total_credit == Decimal("500")
        assert integ._check_already_posted(grn_id, f"GRN ID: {grn_id}") is True

    def test_credit_purchase_hits_creditors(self, db):
        acc = self._accounts(db)
        integ = PurchaseExpensePayrollGL(db)
        grn_id = int(_uid(), 16) % 1_000_000

        je = integ._create_je_and_post(
            entry_date=OPEN_DATE,
            description=f"Auto GL - GRN Received | GRN ID: {grn_id}",
            lines=[
                _line("1210", debit="500", desc="inventory in"),
                _line("2010", credit="500", desc="trade creditors"),
            ],
            branch_code=_branch(),
            user_id=1,
            reference_type="GRN",
            reference_id=grn_id,
        )
        assert je is not None
        creditor_gl = (
            db.query(GeneralLedger)
            .filter(
                GeneralLedger.journal_entry_id == je.id,
                GeneralLedger.account_id == acc["creditors"].id,
            )
            .one()
        )
        assert creditor_gl.credit_amount == Decimal("500")

    def test_expense_posts_balanced(self, db):
        self._accounts(db)
        integ = PurchaseExpensePayrollGL(db)
        expense_id = int(_uid(), 16) % 1_000_000

        je = integ._create_je_and_post(
            entry_date=OPEN_DATE,
            description=f"Auto GL - Expense | Expense ID: {expense_id}",
            lines=[
                _line("5130", debit="80", desc="utilities expense"),
                _line("1020", credit="80", desc="bank out"),
            ],
            branch_code=_branch(),
            user_id=1,
            transaction_type="Expense",
            reference_type="Expense",
            reference_id=expense_id,
        )
        assert je is not None
        assert je.total_debit == je.total_credit == Decimal("80")


# --------------------------------------------------------------------------- #
# Day-End reconciliation — "do the books balance?"
# --------------------------------------------------------------------------- #
class TestDayEndReconciliation:
    def _post_cash_sale(self, db, branch, amount="100"):
        _ensure_account(db, "1010", account_type="Asset", normal_balance="Debit")
        rev = _ensure_account(db, f"QA{_uid()}", account_type="Revenue", normal_balance="Credit")
        GLPostingService(db).post(
            reference_type="QA",
            reference_id=int(_uid(), 16) % 1_000_000,
            lines=[_line("1010", debit=amount), _line(rev.account_code, credit=amount)],
            entry_date=OPEN_DATE,
            description="QA recon sale",
            branch_code=branch,
            user_id=1,
        )

    def test_clean_day_is_balanced(self, db):
        branch = _branch()
        self._post_cash_sale(db, branch, "100")
        _make_cashbook(db, branch_code=branch, money_in="100")

        recon = ReconciliationService(db).day_end(OPEN_DATE, branch_code=branch)

        assert recon.trial_balanced is True
        assert recon.gl_total_debit == Decimal("100")
        assert recon.gl_total_credit == Decimal("100")
        assert recon.gl_cash_movement == Decimal("100")
        assert recon.cashbook_net == Decimal("100")
        assert recon.cash_reconciled is True
        assert recon.cash_difference == Decimal("0")
        assert recon.posting_failures_pending == 0
        assert recon.unposted_je_count == 0
        assert recon.is_balanced is True
        assert recon.discrepancies == []

    def test_cash_mismatch_flagged(self, db):
        branch = _branch()
        self._post_cash_sale(db, branch, "100")
        # Cashbook says 150 came in but the GL only moved 100 -> mismatch.
        _make_cashbook(db, branch_code=branch, money_in="150")

        recon = ReconciliationService(db).day_end(OPEN_DATE, branch_code=branch)

        assert recon.trial_balanced is True  # the JE itself is balanced
        assert recon.cash_reconciled is False
        assert recon.cash_difference == Decimal("-50")
        assert recon.is_balanced is False
        assert any("reconcile" in d.lower() for d in recon.discrepancies)

    def test_pending_failure_breaks_balance(self, db):
        branch = _branch()
        self._post_cash_sale(db, branch, "100")
        _make_cashbook(db, branch_code=branch, money_in="100")
        # A durable posting failure dated today for this branch.
        db.add(
            GLPostingFailure(
                reference_type="Invoice",
                reference_id=1,
                source_module="sales",
                transaction_type="Sale",
                entry_date=OPEN_DATE,
                branch_code=branch,
                description="QA failure",
                error_code="missing_account",
                error_message="COA account(s) not found: ['9999']",
                status="pending",
                attempts=1,
            )
        )
        db.flush()

        recon = ReconciliationService(db).day_end(OPEN_DATE, branch_code=branch)

        assert recon.posting_failures_pending == 1
        assert recon.is_balanced is False
        assert any("failed" in d.lower() for d in recon.discrepancies)

    def test_unposted_je_warns_and_unbalances(self, db):
        branch = _branch()
        self._post_cash_sale(db, branch, "100")
        _make_cashbook(db, branch_code=branch, money_in="100")
        # A draft (unposted) JE dated today for this branch.
        db.add(
            JournalEntry(
                journal_entry_no=f"JE-QA-{_uid()}",
                entry_date=OPEN_DATE,
                posting_date=OPEN_DATE,
                entry_type="Manual",
                description="QA draft",
                total_debit=Decimal("0"),
                total_credit=Decimal("0"),
                status="draft",
                fiscal_year=2090,
                fiscal_period=6,
                branch_code=branch,
                created_by=1,
            )
        )
        db.flush()

        recon = ReconciliationService(db).day_end(OPEN_DATE, branch_code=branch)

        assert recon.unposted_je_count == 1
        assert recon.is_balanced is False
        assert any("not yet posted" in w.lower() for w in recon.warnings)


# --------------------------------------------------------------------------- #
# Posting-failure outbox + retry
# --------------------------------------------------------------------------- #
class TestPostingFailureOutbox:
    def test_failure_recorded_then_retry_resolves(self, db, outbox_to_test_session):
        real = _ensure_account(db, f"QA{_uid()}")
        missing_code = f"ZZ{_uid()}"
        branch = _branch()
        svc = GLPostingService(db)
        ref_id = int(_uid(), 16) % 1_000_000

        # 1. Posting fails because an account is missing — recorded durably.
        result = svc.post(
            reference_type="Invoice",
            reference_id=ref_id,
            reference_no=f"INV-{ref_id}",
            lines=[
                _line(real.account_code, debit="100"),
                _line(missing_code, credit="100"),
            ],
            entry_date=OPEN_DATE,
            description="QA outbox failure",
            branch_code=branch,
            user_id=1,
            source_module="sales",
            marker="Revenue",
            idempotent=False,
            record_failure=True,
        )
        assert result.failed is True
        assert result.error_code == "missing_account"
        assert result.failure_id is not None

        failure = (
            db.query(GLPostingFailure)
            .filter(GLPostingFailure.id == result.failure_id)
            .one()
        )
        assert failure.status == "pending"
        assert failure.source_module == "sales"
        assert failure.reference_id == ref_id
        assert missing_code in (failure.payload or "")

        # 2. Fix the configuration: create the missing account.
        _ensure_account(db, missing_code, account_type="Revenue", normal_balance="Credit")

        # 3. Retry -> posts and resolves.
        retry = svc.retry_failure(result.failure_id, user_id=1)
        assert retry.posted is True
        db.refresh(failure)
        assert failure.status == "resolved"
        assert failure.resolved_je_id is not None

        gl_rows = (
            db.query(GeneralLedger)
            .filter(GeneralLedger.journal_entry_id == failure.resolved_je_id)
            .count()
        )
        assert gl_rows == 2

    def test_failure_service_list_and_ignore(self, db, outbox_to_test_session):
        real = _ensure_account(db, f"QA{_uid()}")
        missing_code = f"ZZ{_uid()}"
        svc = GLPostingService(db)
        ref_id = int(_uid(), 16) % 1_000_000

        result = svc.post(
            reference_type="GRN",
            reference_id=ref_id,
            lines=[
                _line(real.account_code, debit="200"),
                _line(missing_code, credit="200"),
            ],
            entry_date=OPEN_DATE,
            description="QA outbox ignore",
            branch_code=_branch(),
            user_id=1,
            source_module="purchasing",
            record_failure=True,
        )
        assert result.failure_id is not None

        fsvc = GLPostingFailureService(db)
        listing = fsvc.list_failures(status="pending", source_module="purchasing")
        assert listing.pending_count >= 1
        assert any(item.id == result.failure_id for item in listing.items)

        ignored = fsvc.ignore(result.failure_id, user_id=7)
        assert ignored.status == "ignored"
        refreshed = (
            db.query(GLPostingFailure)
            .filter(GLPostingFailure.id == result.failure_id)
            .one()
        )
        assert refreshed.status == "ignored"
        assert refreshed.resolved_by == 7


# --------------------------------------------------------------------------- #
# Customer receipt account routing — cheque/card must land in Cash/Bank
# --------------------------------------------------------------------------- #
class TestCustomerReceiptAccountRouting:
    """Customer advance + credit-settlement receipts are mirrored into the
    materialized cashbook as a single ``money_in`` regardless of tender, while
    day-end reconciliation only sums GL Cash (1010) + Bank (1020). So a cheque
    or card receipt MUST debit 1010/1020 — never a sub-ledger account such as
    1030 (Petty Cash) or 1040 (Cheques in Hand) — or the receipt would appear in
    the cashbook but not in ``gl_cash_bank_net`` and the day would fail to
    reconcile. These tests pin the routing so the misclassification can't return.
    """

    @staticmethod
    def _debit_codes(db, je) -> set[str]:
        rows = (
            db.query(ChartOfAccounts.account_code)
            .join(GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id)
            .filter(
                GeneralLedger.journal_entry_id == je.id,
                GeneralLedger.debit_amount > 0,
            )
            .all()
        )
        return {r[0] for r in rows}

    @staticmethod
    def _seed(db, *codes):
        for code in codes:
            _ensure_account(db, code)

    @pytest.mark.parametrize("method", ["cheque", "check", "card", "bank_transfer"])
    def test_advance_receipt_non_cash_debits_bank(self, db, method):
        self._seed(db, "1010", "1020", "2520")
        gl = PurchaseExpensePayrollGL(db)
        advance = SimpleNamespace(
            id=int(_uid(), 16) % 1_000_000 + 7_000_000,
            payment_amount=Decimal("500.00"),
            payment_method=method,
            advance_payments_no=f"ADV-{_uid()}",
            customer_id=1,
            created_date=OPEN_DATE,
            branch_code=_branch(),
        )
        je = gl.post_customer_advance_receipt_to_gl(advance, user_id=1)
        assert je is not None
        debit_codes = self._debit_codes(db, je)
        assert "1020" in debit_codes, f"{method} advance should debit Bank, got {debit_codes}"
        assert "1030" not in debit_codes  # never Petty Cash
        assert "1040" not in debit_codes  # never Cheques-in-Hand
        assert je.total_debit == je.total_credit == Decimal("500.00")

    def test_advance_receipt_cash_debits_cash(self, db):
        self._seed(db, "1010", "1020", "2520")
        gl = PurchaseExpensePayrollGL(db)
        advance = SimpleNamespace(
            id=int(_uid(), 16) % 1_000_000 + 7_100_000,
            payment_amount=Decimal("300.00"),
            payment_method="cash",
            advance_payments_no=f"ADV-{_uid()}",
            customer_id=1,
            created_date=OPEN_DATE,
            branch_code=_branch(),
        )
        je = gl.post_customer_advance_receipt_to_gl(advance, user_id=1)
        assert je is not None
        assert "1010" in self._debit_codes(db, je)

    @pytest.mark.parametrize("method", ["cheque", "card", "visa", "mastercard", "bank_transfer"])
    def test_credit_settlement_non_cash_debits_bank(self, db, method):
        self._seed(db, "1010", "1020", "1110", "4110")
        gl = PurchaseExpensePayrollGL(db)
        settlement = SimpleNamespace(
            id=int(_uid(), 16) % 1_000_000 + 7_200_000,
            customer_id=1,
            customer_credits_settle_no=f"CCS-{_uid()}",
            created_date=OPEN_DATE,
            branch_code=_branch(),
        )
        txns = [
            SimpleNamespace(
                payment_method=method,
                payment_amount=Decimal("750.00"),
                service_charge_amount=Decimal("0"),
            )
        ]
        je = gl.post_customer_credit_settlement_to_gl(settlement, txns, user_id=1)
        assert je is not None
        debit_codes = self._debit_codes(db, je)
        assert "1020" in debit_codes, f"{method} settlement should debit Bank, got {debit_codes}"
        assert "1030" not in debit_codes  # never Petty Cash
        assert "1040" not in debit_codes  # never Cheques-in-Hand
        assert je.total_debit == je.total_credit

    def test_credit_settlement_cash_debits_cash(self, db):
        self._seed(db, "1010", "1020", "1110", "4110")
        gl = PurchaseExpensePayrollGL(db)
        settlement = SimpleNamespace(
            id=int(_uid(), 16) % 1_000_000 + 7_300_000,
            customer_id=1,
            customer_credits_settle_no=f"CCS-{_uid()}",
            created_date=OPEN_DATE,
            branch_code=_branch(),
        )
        txns = [
            SimpleNamespace(
                payment_method="cash",
                payment_amount=Decimal("400.00"),
                service_charge_amount=Decimal("0"),
            )
        ]
        je = gl.post_customer_credit_settlement_to_gl(settlement, txns, user_id=1)
        assert je is not None
        assert "1010" in self._debit_codes(db, je)
