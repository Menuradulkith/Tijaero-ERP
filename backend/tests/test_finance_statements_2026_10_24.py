"""Finance QA 2026-10-24: financial statements and journal-entry lifecycle.

Every test posts into fiscal years 2090/2091 on its own branch, so the reports
are isolated from whatever else is in the shared dev database.
"""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.finance import accounting_schemas as schemas
from app.modules.finance.accounting_models import (
    AccountingPeriod,
    CashFlowCategory,
    ChartOfAccounts,
    JournalEntry,
)
from app.modules.finance.accounting_service import (
    AccountingPeriodService,
    CashFlowService,
    ChartOfAccountsService,
    GeneralLedgerService,
    JournalEntryService,
)

D = Decimal


@pytest.fixture
def branch(make_branch):
    return make_branch()


@pytest.fixture
def user(superuser):
    return superuser[0]


@pytest.fixture
def acc(make_account, db):
    """Accounts for one test, keyed by role."""
    def cat(a, category):
        a.account_category = category
        db.flush()
        return a

    return {
        "cash": cat(make_account(account_type="Asset", normal_balance="Debit"), "Cash"),
        "plain_asset": make_account(account_type="Asset", normal_balance="Debit"),  # no category
        "revenue": make_account(account_type="Revenue", normal_balance="Credit"),
        "expense": make_account(account_type="Expense", normal_balance="Debit"),
        "capital": cat(make_account(account_type="Equity", normal_balance="Credit"), "Equity"),
        "loan": cat(make_account(account_type="Liability", normal_balance="Credit"), "Long-term"),
        "receivable": cat(make_account(account_type="Asset", normal_balance="Debit"), "Receivable"),
    }


def _lines(*pairs):
    """(account, debit, credit) -> line inputs."""
    return [
        schemas.JournalEntryLineCreate(
            line_number=i, account_id=a.id, debit_amount=D(str(dr)), credit_amount=D(str(cr))
        )
        for i, (a, dr, cr) in enumerate(pairs, 1)
    ]


def _post(db, user, on, *pairs, branch=None, entry_type="Adjustment"):
    """Create, approve and post an entry dated ``on``."""
    svc = JournalEntryService(db)
    je = svc.create_journal_entry(
        schemas.JournalEntryCreate(
            entry_date=on, entry_type=entry_type, description="QA statements test",
            branch_code=branch.branch_code if branch else None, lines=_lines(*pairs),
        ),
        created_by=user.id,
    )
    je.status = "approved"
    db.flush()
    return svc.post_journal_entry(je.id, posted_by=user.id)


def _tb_row(tb, account):
    return next((a for a in tb.accounts if a.account_id == account.id), None)


# --------------------------------------------------------------------------- #
# F-1 trial balance
# --------------------------------------------------------------------------- #
def test_trial_balance_carries_prior_year_balance_sheet_accounts(db, user, acc, branch):
    _post(db, user, date(2090, 6, 1), (acc["cash"], 100, 0), (acc["revenue"], 0, 100), branch=branch)
    _post(db, user, date(2091, 3, 1), (acc["expense"], 30, 0), (acc["cash"], 0, 30), branch=branch)

    tb = GeneralLedgerService(db).get_trial_balance(2091, branch_code=branch.branch_code)

    cash = _tb_row(tb, acc["cash"])
    assert cash.net_balance == D("70")  # 100 brought forward - 30 this year
    assert _tb_row(tb, acc["revenue"]) is None  # prior-year P&L is not this year's revenue
    retained = next(a for a in tb.accounts if a.account_code == "3100")
    assert retained.total_credit - retained.total_debit == D("100")  # unclosed 2090 profit
    assert tb.total_debit == tb.total_credit


# --------------------------------------------------------------------------- #
# F-2 / F-4 / F-5 income statement, closing, reversal
# --------------------------------------------------------------------------- #
def test_income_statement_survives_year_end_close_and_reclose(db, user, acc, branch):
    _post(db, user, date(2091, 2, 1), (acc["cash"], 100, 0), (acc["revenue"], 0, 100), branch=branch)
    _post(db, user, date(2091, 2, 2), (acc["expense"], 40, 0), (acc["cash"], 0, 40), branch=branch)
    gl = GeneralLedgerService(db)
    assert gl.get_income_statement(2091, branch_code=branch.branch_code).net_income == D("60")

    periods = AccountingPeriodService(db)
    close = periods.create_year_end_closing_entries(schemas.YearEndCloseRequest(fiscal_year=2091), closed_by=user.id)
    assert close.closing_date == date(2091, 12, 31)
    assert gl.get_income_statement(2091, branch_code=branch.branch_code).net_income == D("60")

    # Reverse every closing entry; the year can then be closed again.
    je_svc = JournalEntryService(db)
    for je_id in (close.revenue_close_je_id, close.expense_close_je_id, close.retained_earnings_je_id):
        if je_id:
            je_svc.reverse_journal_entry(je_id, reversed_by=user.id, reason="QA re-close",
                                         reversal_date=date(2091, 12, 31))
            assert db.get(JournalEntry, je_id).status == "reversed"
    assert gl.get_income_statement(2091, branch_code=branch.branch_code).net_income == D("60")
    again = periods.create_year_end_closing_entries(schemas.YearEndCloseRequest(fiscal_year=2091), closed_by=user.id)
    assert again.revenue_close_je_id


def test_income_statement_includes_deactivated_expense_account(db, user, acc, branch):
    _post(db, user, date(2091, 4, 1), (acc["expense"], 25, 0), (acc["cash"], 0, 25), branch=branch)
    acc["expense"].is_active = False
    db.flush()
    is_ = GeneralLedgerService(db).get_income_statement(2091, branch_code=branch.branch_code)
    assert is_.net_income == D("-25")


def test_year_end_close_uses_fiscal_calendar_and_is_atomic(db, user, acc, branch):
    AccountingPeriodService(db).generate_periods(schemas.GeneratePeriodsRequest(fiscal_year=2090, start_month=4))
    _post(db, user, date(2091, 1, 15), (acc["cash"], 10, 0), (acc["revenue"], 0, 10), branch=branch)
    last = db.query(AccountingPeriod).filter_by(fiscal_year=2090, period_number=12).one()
    assert last.end_date == date(2091, 3, 31)

    # Close the last period: the closing entries can't post, and none may stay behind.
    last.status = "closed"
    db.commit()
    with pytest.raises(HTTPException):
        AccountingPeriodService(db).create_year_end_closing_entries(
            schemas.YearEndCloseRequest(fiscal_year=2090), closed_by=user.id
        )
    assert db.query(JournalEntry).filter_by(fiscal_year=2090, entry_type="Closing").count() == 0

    last.status = "open"
    db.commit()
    res = AccountingPeriodService(db).create_year_end_closing_entries(
        schemas.YearEndCloseRequest(fiscal_year=2090), closed_by=user.id
    )
    assert res.closing_date == date(2091, 3, 31)
    assert db.get(JournalEntry, res.revenue_close_je_id).fiscal_period == 12


# --------------------------------------------------------------------------- #
# F-3 balance sheet
# --------------------------------------------------------------------------- #
def test_balance_sheet_keeps_uncategorised_accounts(db, user, acc, branch):
    _post(db, user, date(2091, 5, 1), (acc["plain_asset"], 50, 0), (acc["capital"], 0, 50), branch=branch)
    bs = GeneralLedgerService(db).get_balance_sheet(2091, as_of_date=date(2091, 12, 31), branch_code=branch.branch_code)
    assert acc["plain_asset"].id in {i.account_id for i in bs.current_assets.items}
    assert bs.total_assets == D("50")
    assert bs.is_balanced


# --------------------------------------------------------------------------- #
# F-15 manual JE controls / maker-checker / correction
# --------------------------------------------------------------------------- #
def test_manual_entry_rejects_control_header_and_inactive_accounts(db, user, acc, make_account):
    svc = JournalEntryService(db)

    def create(a):
        return svc.create_journal_entry(
            schemas.JournalEntryCreate(entry_date=date(2091, 1, 1), description="QA", entry_type="Manual",
                                       lines=_lines((a, 5, 0), (acc["cash"], 0, 5))),
            created_by=user.id,
        )

    with pytest.raises(HTTPException, match="control account"):
        create(acc["receivable"])
    child = make_account(account_type="Asset", normal_balance="Debit")
    child.parent_account_id = acc["plain_asset"].id
    db.flush()
    with pytest.raises(HTTPException, match="header account"):
        create(acc["plain_asset"])
    child.is_active = False
    db.flush()
    with pytest.raises(HTTPException, match="inactive"):
        create(child)


def test_line_cannot_be_both_debit_and_credit():
    with pytest.raises(ValidationError):
        schemas.JournalEntryLineInput(line_number=1, account_id=1, debit_amount=D("5"), credit_amount=D("5"))
    with pytest.raises(ValidationError):
        schemas.JournalEntryLineInput(line_number=1, account_id=1)


def test_creator_cannot_approve_own_entry(db, user, acc, make_user):
    svc = JournalEntryService(db)
    je = svc.create_journal_entry(
        schemas.JournalEntryCreate(entry_date=date(2091, 1, 2), description="QA", entry_type="Manual",
                                   lines=_lines((acc["expense"], 5, 0), (acc["cash"], 0, 5))),
        created_by=user.id,
    )
    svc.submit_journal_entry(je.id, submitted_by=user.id)
    with pytest.raises(HTTPException) as exc:
        svc.approve_journal_entry(je.id, approved_by=user.id)
    assert exc.value.status_code == 403
    other, _ = make_user()
    assert svc.approve_journal_entry(je.id, approved_by=other.id).status == "approved"


def test_failed_correction_leaves_original_untouched(db, user, acc, branch, make_account):
    original = _post(db, user, date(2091, 6, 1), (acc["expense"], 9, 0), (acc["cash"], 0, 9), branch=branch)
    dead = make_account(account_type="Expense", normal_balance="Debit", is_active=False)
    with pytest.raises(HTTPException, match="inactive"):
        GeneralLedgerService(db).correct_journal_entry(
            original.id,
            schemas.CorrectionRequest(
                reason="QA", correction_date=date(2091, 6, 2),
                corrected_lines=[
                    schemas.JournalEntryLineInput(line_number=1, account_id=dead.id, debit_amount=D("9")),
                    schemas.JournalEntryLineInput(line_number=2, account_id=acc["cash"].id, credit_amount=D("9")),
                ],
            ),
            corrected_by=user.id,
        )
    db.expire_all()
    fresh = db.get(JournalEntry, original.id)
    assert fresh.status == "posted" and not fresh.is_reversed


# --------------------------------------------------------------------------- #
# F-13 periods / F-14 numbering / F-16 ledger
# --------------------------------------------------------------------------- #
def test_posting_into_closed_period_is_blocked(db, user, acc, branch):
    AccountingPeriodService(db).generate_periods(schemas.GeneratePeriodsRequest(fiscal_year=2091))
    march = db.query(AccountingPeriod).filter_by(fiscal_year=2091, period_number=3).one()
    march.status = "closed"
    db.flush()
    with pytest.raises(HTTPException, match="closed"):
        _post(db, user, date(2091, 3, 15), (acc["expense"], 1, 0), (acc["cash"], 0, 1), branch=branch)


def test_je_number_after_9999(db, user, acc):
    svc = JournalEntryService(db)
    prefix = svc._generate_je_number().rsplit("-", 1)[0] + "-"
    for n in ("9999", "10000"):
        db.add(JournalEntry(journal_entry_no=prefix + n, entry_date=date(2091, 1, 1), posting_date=date(2091, 1, 1),
                            entry_type="Manual", description="QA seq", total_debit=0, total_credit=0,
                            status="draft", fiscal_year=2091, fiscal_period=1, created_by=user.id))
    db.flush()
    assert svc._generate_je_number() == prefix + "10001"


def test_account_ledger_starts_from_opening_balance(db, user, acc, branch):
    _post(db, user, date(2091, 1, 10), (acc["cash"], 100, 0), (acc["capital"], 0, 100), branch=branch)
    _post(db, user, date(2091, 2, 10), (acc["expense"], 30, 0), (acc["cash"], 0, 30), branch=branch)
    rows = GeneralLedgerService(db).get_account_ledger(acc["cash"].id, date_from=date(2091, 2, 1))
    assert rows[0]["transaction_type"] == "Opening Balance" and rows[0]["running_balance"] == D("100")
    assert rows[-1]["running_balance"] == D("70")


def test_cannot_deactivate_balance_sheet_account_with_balance(db, user, acc, branch):
    _post(db, user, date(2091, 1, 11), (acc["plain_asset"], 5, 0), (acc["capital"], 0, 5), branch=branch)
    with pytest.raises(HTTPException, match="balance"):
        ChartOfAccountsService(db).update_account(acc["plain_asset"].id, schemas.ChartOfAccountUpdate(is_active=False))


# --------------------------------------------------------------------------- #
# F-10 cash flow
# --------------------------------------------------------------------------- #
def test_cash_flow_financing_is_gross_and_expands_headers(db, user, acc, branch, make_account):
    header = make_account(account_type="Liability", normal_balance="Credit")
    acc["loan"].parent_account_id = header.id
    db.flush()
    _post(db, user, date(2091, 7, 1), (acc["cash"], 100, 0), (acc["capital"], 0, 100), branch=branch)
    _post(db, user, date(2091, 7, 2), (acc["cash"], 500, 0), (acc["loan"], 0, 500), branch=branch)
    _post(db, user, date(2091, 7, 3), (acc["loan"], 200, 0), (acc["cash"], 0, 200), branch=branch)

    def cat(code, inflow, account):
        return CashFlowCategory(category_code=code, category_name=code, section="Financing", line_item=code,
                                is_inflow=inflow, account_mapping=f'["{account.account_code}"]')

    cf = CashFlowService(db)
    start, end = date(2091, 7, 1), date(2091, 7, 31)
    assert cf._calc_financing(cat("FN-001", True, acc["capital"]), start, end) == D("100")
    assert cf._calc_financing(cat("FN-002", False, acc["capital"]), start, end) == D("0")
    assert cf._calc_financing(cat("FN-003", True, header), start, end) == D("500")
    assert cf._calc_financing(cat("FN-004", False, header), start, end) == D("-200")


def test_cash_flow_net_income_excludes_closing(db, user, acc, branch):
    _post(db, user, date(2091, 8, 1), (acc["cash"], 80, 0), (acc["revenue"], 0, 80), branch=branch)
    AccountingPeriodService(db).create_year_end_closing_entries(schemas.YearEndCloseRequest(fiscal_year=2091), closed_by=user.id)
    assert CashFlowService(db)._calc_net_income(date(2091, 1, 1), date(2091, 12, 31)) == D("80")


# --------------------------------------------------------------------------- #
# F-9 route order
# --------------------------------------------------------------------------- #
def test_journal_entry_csv_export_is_reachable(superclient):
    r = superclient.get("/api/v1/finance/accounting/journal-entries/export-csv?fiscal_year=2091")
    assert r.status_code == 200, r.text
    assert r.text.startswith("JE No") or "JE No" in r.text.splitlines()[0]


# --------------------------------------------------------------------------- #
# Payroll: advances are an asset, repayments clear it, late pay reduces cost
# --------------------------------------------------------------------------- #
def test_payroll_posts_advances_to_employee_asset(db, user, make_employee):
    import uuid
    from app.modules.employees.models import EmployeePayroll
    from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
    from app.modules.hr.models import PayrollBatch

    emp = make_employee()
    batch = PayrollBatch(batch_no=f"QA-PB-{uuid.uuid4().hex[:8]}", payroll_month=1, payroll_year=2091,
                         status="approved", salary_payment_date=date(2091, 1, 31))
    db.add(batch)
    db.flush()
    # gross 10,000 = basic 9,000 + advance paid now 1,000
    # deductions: late 200, advance repayment 300, loan repayment 100, stamp 25
    db.add(EmployeePayroll(
        employee_id=emp.employee_id, payroll_month=1, payroll_year=2091, payroll_batch_no=batch.batch_no,
        basic_salary=D("9000"), add_salary_advance=D("1000"), gross_salary=D("10000"),
        less_late_deductions=D("200"), less_salary_advance_repayment=D("300"), less_loan_repayment=D("100"),
        less_stamp_duty=D("25"), total_deductions=D("625"), net_salary=D("9375"), payment_method="bank_transfer",
    ))
    db.flush()

    je = PurchaseExpensePayrollGL(db).post_payroll_batch_to_gl(batch, user_id=user.id)
    assert je is not None
    by_code = {}
    for line in je.lines:
        code = db.get(ChartOfAccounts, line.account_id).account_code
        dr, cr = by_code.get(code, (D(0), D(0)))
        by_code[code] = (dr + D(str(line.debit_amount)), cr + D(str(line.credit_amount)))
    assert by_code["5110"] == (D("8800"), D("0"))       # 10,000 - 1,000 advance - 200 late
    assert by_code["1130"] == (D("1000"), D("400"))     # advance paid / repaid (300 + 100 loan)
    assert by_code["2140"] == (D("0"), D("25"))         # stamp duty only
    assert sum(d for d, _ in by_code.values()) == sum(c for _, c in by_code.values())


# --------------------------------------------------------------------------- #
# GL-driven cashbook
# --------------------------------------------------------------------------- #
def _cashbook_rows(db, source_table, source_id):
    from app.modules.finance.models import CashbookEntryRecord
    return db.query(CashbookEntryRecord).filter_by(source_table=source_table, source_id=source_id).all()


def test_cashbook_rows_come_from_gl_postings(db, user, branch):
    from app.modules.finance.gl_posting_service import GLPostingService

    gl = GLPostingService(db)
    ref = 9_900_001
    on = date(2091, 9, 1)
    res = gl.post(reference_type="Invoice", reference_id=ref, entry_date=on, description="QA cash sale",
                  branch_code=branch.branch_code, user_id=user.id, lines=[
                      {"account_code": "1010", "debit": D("60"), "credit": D("0"), "description": "Cash received"},
                      {"account_code": "1020", "debit": D("40"), "credit": D("0"), "description": "Card payment"},
                      {"account_code": "4010", "debit": D("0"), "credit": D("100"), "description": "Sale"},
                  ])
    assert res.status == "posted", res.error_message
    [row] = _cashbook_rows(db, "invoices", ref)
    assert (row.entry_type, row.money_in, row.money_out, row.payment_method) == ("invoice_receipt", D("100"), D("0"), "Cash")

    # A posting that moves no cash writes nothing.
    gl.post(reference_type="Invoice", reference_id=ref + 1, entry_date=on, description="QA credit sale",
            branch_code=branch.branch_code, user_id=user.id, lines=[
                {"account_code": "1110", "debit": D("50"), "credit": D("0")},
                {"account_code": "4010", "debit": D("0"), "credit": D("50")},
            ])
    assert _cashbook_rows(db, "invoices", ref + 1) == []

    # A bank deposit nets to zero in cash+bank but is the money leaving the till.
    gl.post(reference_type="BankDeposit", reference_id=ref, entry_date=on, description="QA deposit",
            branch_code=branch.branch_code, user_id=user.id, lines=[
                {"account_code": "1020", "debit": D("30"), "credit": D("0")},
                {"account_code": "1010", "debit": D("0"), "credit": D("30")},
            ])
    [dep] = _cashbook_rows(db, "bank_deposits", ref)
    assert (dep.entry_type, dep.money_in, dep.money_out) == ("bank_deposit", D("0"), D("30"))


def test_unpaid_expense_is_not_in_the_cashbook(db, branch, user):
    """The old insert trigger put every new expense in the cashbook."""
    from app.modules.finance.models import Expenses

    exp = Expenses(expenses_no=f"EXP-QA-{branch.branch_code}", expense_amount=D("75"), branch_code=branch.branch_code,
                   expenses_method="cash", expense_date=date(2091, 9, 3), created_date=date(2091, 9, 3), status="pending", vendor_name="QA Vendor")
    db.add(exp)
    db.flush()
    assert _cashbook_rows(db, "expenses", exp.id) == []


def test_manual_cash_journal_and_reversal_hit_the_cashbook(db, user, acc, branch):
    je = _post(db, user, date(2091, 9, 2), (acc["expense"], 20, 0), (db.query(ChartOfAccounts).filter_by(account_code="1010").one(), 0, 20), branch=branch)
    [row] = _cashbook_rows(db, "journal_entries", je.id)
    assert (row.entry_type, row.money_out) == ("journal_entry", D("20"))
    rev = JournalEntryService(db).reverse_journal_entry(je.id, reversed_by=user.id, reason="QA", reversal_date=date(2091, 9, 2))
    [back] = _cashbook_rows(db, "journal_entries", rev.id)
    assert back.money_in == D("20")
