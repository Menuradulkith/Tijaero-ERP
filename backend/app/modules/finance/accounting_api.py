"""
General Ledger & Accounting API

REST endpoints for:
- Chart of Accounts (CRUD + tree)
- Journal Entries (CRUD + post + reverse)
- General Ledger (list + trial balance + account ledger)
- Accounting Periods (generate + close/reopen/lock)
- Cash Flow Statements (generate + finalize + approve)
- Cash Flow Categories (CRUD)
- Dashboard stats
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date

from app.db.session import get_db
from . import accounting_schemas as schemas
from .accounting_service import (
    ChartOfAccountsService,
    JournalEntryService,
    GeneralLedgerService,
    AccountingPeriodService,
    CashFlowService,
    AccountingDashboardService,
)

router = APIRouter(prefix="/finance/accounting", tags=["accounting"])


# =============================================================================
# DASHBOARD
# =============================================================================

@router.get("/dashboard/stats", response_model=schemas.AccountingDashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db)):
    """Get accounting dashboard statistics."""
    return AccountingDashboardService(db).get_stats()


# =============================================================================
# CHART OF ACCOUNTS
# =============================================================================

@router.post("/chart-of-accounts", response_model=schemas.ChartOfAccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(data: schemas.ChartOfAccountCreate, db: Session = Depends(get_db)):
    """Create a new chart of accounts entry."""
    return ChartOfAccountsService(db).create_account(data)


@router.put("/chart-of-accounts/{account_id}", response_model=schemas.ChartOfAccountResponse)
def update_account(account_id: int, data: schemas.ChartOfAccountUpdate, db: Session = Depends(get_db)):
    """Update a chart of accounts entry."""
    return ChartOfAccountsService(db).update_account(account_id, data)


@router.get("/chart-of-accounts", response_model=List[schemas.ChartOfAccountResponse])
def list_accounts(
    account_type: Optional[str] = None,
    account_category: Optional[str] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    parent_account_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """List chart of accounts with optional filters."""
    return ChartOfAccountsService(db).list_accounts(schemas.COAListFilter(
        account_type=account_type,
        account_category=account_category,
        is_active=is_active,
        search=search,
        parent_account_id=parent_account_id,
    ))


@router.get("/chart-of-accounts/tree")
def get_account_tree(db: Session = Depends(get_db)):
    """Get hierarchical tree of chart of accounts."""
    return ChartOfAccountsService(db).get_account_tree()


@router.get("/chart-of-accounts/{account_id}", response_model=schemas.ChartOfAccountResponse)
def get_account(account_id: int, db: Session = Depends(get_db)):
    """Get a specific chart of accounts entry."""
    return ChartOfAccountsService(db).get_account(account_id)


@router.delete("/chart-of-accounts/{account_id}")
def delete_account(account_id: int, db: Session = Depends(get_db)):
    """Delete a chart of accounts entry."""
    ChartOfAccountsService(db).delete_account(account_id)
    return {"message": "Account deleted successfully"}


@router.post("/chart-of-accounts/seed")
def seed_chart_of_accounts(force: bool = Query(False), db: Session = Depends(get_db)):
    """
    Seed the standard Chart of Accounts hierarchy (Scenario 29).
    Creates the full COA structure with parent-child relationships and system accounts.
    Use ?force=true to add missing accounts even if some already exist.
    """
    from scripts.seed_chart_of_accounts import seed_chart_of_accounts as do_seed
    result = do_seed(db, force=force)
    return result


# =============================================================================
# JOURNAL ENTRIES
# =============================================================================

@router.post("/journal-entries", response_model=schemas.JournalEntryResponse, status_code=status.HTTP_201_CREATED)
def create_journal_entry(data: schemas.JournalEntryCreate, db: Session = Depends(get_db)):
    """Create a new journal entry (draft)."""
    je = JournalEntryService(db).create_journal_entry(data, created_by=0)
    return _serialize_je(je)


@router.put("/journal-entries/{je_id}", response_model=schemas.JournalEntryResponse)
def update_journal_entry(je_id: int, data: schemas.JournalEntryUpdate, db: Session = Depends(get_db)):
    """Update a draft journal entry."""
    je = JournalEntryService(db).update_journal_entry(je_id, data)
    return _serialize_je(je)


@router.get("/journal-entries")
def list_journal_entries(
    status_filter: Optional[str] = Query(None, alias="status"),
    entry_type: Optional[str] = None,
    branch_code: Optional[str] = None,
    fiscal_year: Optional[int] = None,
    fiscal_period: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List journal entries with optional filters."""
    items, total = JournalEntryService(db).list_journal_entries(schemas.JournalEntryListFilter(
        status=status_filter,
        entry_type=entry_type,
        branch_code=branch_code,
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        search=search,
        skip=skip,
        limit=limit,
    ))
    return {"items": [_serialize_je(je) for je in items], "total": total}


@router.get("/journal-entries/{je_id}", response_model=schemas.JournalEntryResponse)
def get_journal_entry(je_id: int, db: Session = Depends(get_db)):
    """Get a specific journal entry with lines."""
    je = JournalEntryService(db).get_journal_entry(je_id)
    return _serialize_je(je)


@router.post("/journal-entries/{je_id}/post", response_model=schemas.JournalEntryResponse)
def post_journal_entry(je_id: int, data: schemas.PostJournalEntryRequest = None, db: Session = Depends(get_db)):
    """Post a journal entry (creates GL entries)."""
    posting_date = data.posting_date if data else None
    je = JournalEntryService(db).post_journal_entry(je_id, posted_by=0, posting_date=posting_date)
    return _serialize_je(je)


@router.post("/journal-entries/{je_id}/reverse", response_model=schemas.JournalEntryResponse)
def reverse_journal_entry(je_id: int, data: schemas.ReverseJournalEntryRequest, db: Session = Depends(get_db)):
    """Reverse a posted journal entry."""
    je = JournalEntryService(db).reverse_journal_entry(
        je_id, reversed_by=0, reason=data.reason, reversal_date=data.reversal_date
    )
    return _serialize_je(je)


@router.delete("/journal-entries/{je_id}")
def delete_journal_entry(je_id: int, db: Session = Depends(get_db)):
    """Delete a draft journal entry."""
    JournalEntryService(db).delete_journal_entry(je_id)
    return {"message": "Journal entry deleted successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# Scenario 33: Manual JE Validation & Approval Workflow
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/journal-entries/{je_id}/validate", response_model=schemas.ValidateJournalEntryResponse)
def validate_journal_entry(je_id: int, db: Session = Depends(get_db)):
    """
    Validate a journal entry (Step 3).
    Checks: debit==credit, all accounts active, amounts positive, description provided.
    Returns detailed validation result with errors and warnings.
    """
    return JournalEntryService(db).validate_journal_entry(je_id)


@router.post("/journal-entries/{je_id}/submit", response_model=schemas.JournalEntryResponse)
def submit_journal_entry(
    je_id: int,
    data: schemas.SubmitJournalEntryRequest = None,
    db: Session = Depends(get_db),
):
    """
    Submit a draft manual JE for approval (Step 3→4).
    Runs validation first. Moves status: draft → submitted.
    """
    remarks = data.remarks if data else None
    je = JournalEntryService(db).submit_journal_entry(je_id, submitted_by=0, remarks=remarks)
    return _serialize_je(je)


@router.post("/journal-entries/{je_id}/approve", response_model=schemas.JournalEntryResponse)
def approve_journal_entry(
    je_id: int,
    data: schemas.ApproveJournalEntryRequest = None,
    db: Session = Depends(get_db),
):
    """
    Approve a submitted manual JE (Step 4).
    Finance manager verification. Moves status: submitted → approved.
    After approval, the JE can be posted.
    """
    remarks = data.remarks if data else None
    je = JournalEntryService(db).approve_journal_entry(je_id, approved_by=0, remarks=remarks)
    return _serialize_je(je)


@router.post("/journal-entries/{je_id}/reject", response_model=schemas.JournalEntryResponse)
def reject_journal_entry(
    je_id: int,
    data: schemas.RejectJournalEntryRequest,
    db: Session = Depends(get_db),
):
    """
    Reject a submitted manual JE back to draft.
    Allows the accountant to fix errors and resubmit.
    Moves status: submitted → draft.
    """
    je = JournalEntryService(db).reject_journal_entry(je_id, rejected_by=0, reason=data.reason)
    return _serialize_je(je)


def _serialize_je(je) -> dict:
    """Serialize JournalEntry with lines and resolved names."""
    lines = []
    for line in (je.lines or []):
        lines.append({
            "id": line.id,
            "journal_entry_id": line.journal_entry_id,
            "line_number": line.line_number,
            "account_id": line.account_id,
            "debit_amount": line.debit_amount,
            "credit_amount": line.credit_amount,
            "description": line.description,
            "reference_type": line.reference_type,
            "reference_id": line.reference_id,
            "reference_no": line.reference_no,
            "created_at": line.created_at,
            "account_code": line.account.account_code if line.account else None,
            "account_name": line.account.account_name if line.account else None,
        })
    return {
        "id": je.id,
        "journal_entry_no": je.journal_entry_no,
        "entry_date": je.entry_date,
        "posting_date": je.posting_date,
        "entry_type": je.entry_type,
        "description": je.description,
        "total_debit": je.total_debit,
        "total_credit": je.total_credit,
        "status": je.status,
        "is_reversed": je.is_reversed,
        "reversed_by_je_id": je.reversed_by_je_id,
        "fiscal_year": je.fiscal_year,
        "fiscal_period": je.fiscal_period,
        "branch_code": je.branch_code,
        "created_by": je.created_by,
        "submitted_by": je.submitted_by,
        "submitted_at": je.submitted_at,
        "approved_by": je.approved_by,
        "approved_at": je.approved_at,
        "rejection_reason": je.rejection_reason,
        "posted_by": je.posted_by,
        "posted_at": je.posted_at,
        "created_at": je.created_at,
        "updated_at": je.updated_at,
        "lines": lines,
    }


# =============================================================================
# GENERAL LEDGER
# =============================================================================

@router.get("/general-ledger")
def list_gl_entries(
    account_id: Optional[int] = None,
    account_code: Optional[str] = None,
    account_type: Optional[str] = None,
    transaction_type: Optional[str] = None,
    branch_code: Optional[str] = None,
    fiscal_year: Optional[int] = None,
    fiscal_period: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    reference_type: Optional[str] = None,
    reference_no: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    db: Session = Depends(get_db),
):
    """List general ledger entries with filters."""
    items, total = GeneralLedgerService(db).list_gl_entries(schemas.GLListFilter(
        account_id=account_id,
        account_code=account_code,
        account_type=account_type,
        transaction_type=transaction_type,
        branch_code=branch_code,
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        reference_type=reference_type,
        reference_no=reference_no,
        search=search,
        skip=skip,
        limit=limit,
    ))
    return {"items": items, "total": total}


@router.get("/general-ledger/trial-balance", response_model=schemas.TrialBalanceResponse)
def get_trial_balance(
    fiscal_year: int = Query(...),
    fiscal_period: Optional[int] = None,
    as_of_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Generate trial balance report."""
    return GeneralLedgerService(db).get_trial_balance(
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        as_of_date=date.fromisoformat(as_of_date) if as_of_date else None,
    )


@router.get("/general-ledger/account/{account_id}")
def get_account_ledger(
    account_id: int,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Get all GL entries for a specific account with running balance."""
    return GeneralLedgerService(db).get_account_ledger(
        account_id=account_id,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
    )


# =============================================================================
# FINANCIAL REPORTS (Scenario 34)
# =============================================================================

@router.get("/reports/income-statement", response_model=schemas.IncomeStatementResponse)
def get_income_statement(
    fiscal_year: int = Query(...),
    fiscal_period: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Generate Income Statement (Profit & Loss) report."""
    return GeneralLedgerService(db).get_income_statement(
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
    )


@router.get("/reports/balance-sheet", response_model=schemas.BalanceSheetResponse)
def get_balance_sheet(
    fiscal_year: int = Query(...),
    as_of_date: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Generate Balance Sheet (Statement of Financial Position) report."""
    return GeneralLedgerService(db).get_balance_sheet(
        fiscal_year=fiscal_year,
        as_of_date=date.fromisoformat(as_of_date) if as_of_date else None,
    )


@router.get("/reports/reconciliation-check", response_model=schemas.ReconciliationCheckResponse)
def reconciliation_check(
    fiscal_year: int = Query(...),
    fiscal_period: int = Query(...),
    db: Session = Depends(get_db),
):
    """Run pre-close reconciliation check for a fiscal period."""
    return AccountingPeriodService(db).run_reconciliation_check(
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
    )


@router.post("/reports/year-end-close", response_model=schemas.YearEndCloseResponse)
def year_end_close(
    data: schemas.YearEndCloseRequest,
    db: Session = Depends(get_db),
):
    """
    Create year-end closing entries for a fiscal year.
    Closes Revenue and Expense accounts to Current Year P/L,
    then transfers to Retained Earnings.
    """
    return AccountingPeriodService(db).create_year_end_closing_entries(
        data=data, closed_by=0,
    )


# =============================================================================
# AUDIT TRAIL & CORRECTION (Scenario 35)
# =============================================================================

@router.get("/audit-trail", response_model=schemas.AuditTrailResponse)
def get_audit_trail(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    account_id: Optional[int] = None,
    account_code: Optional[str] = None,
    entry_type: Optional[str] = None,
    transaction_type: Optional[str] = None,
    created_by: Optional[int] = None,
    include_reversed: bool = True,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=2000),
    db: Session = Depends(get_db),
):
    """
    Query the full audit trail of accounting activities.
    Returns JE and GL entries with user/timestamp information.
    """
    return GeneralLedgerService(db).get_audit_trail(schemas.AuditTrailFilter(
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        account_id=account_id,
        account_code=account_code,
        entry_type=entry_type,
        transaction_type=transaction_type,
        created_by=created_by,
        include_reversed=include_reversed,
        search=search,
        skip=skip,
        limit=limit,
    ))


@router.post("/journal-entries/{je_id}/correct", response_model=schemas.CorrectionResponse)
def correct_journal_entry(
    je_id: int,
    data: schemas.CorrectionRequest,
    db: Session = Depends(get_db),
):
    """
    Correct a posted journal entry.
    Atomic operation: reverses the original and creates a new corrected entry.
    """
    return GeneralLedgerService(db).correct_journal_entry(
        je_id=je_id, data=data, corrected_by=0,
    )


# =============================================================================
# ACCOUNTING PERIODS
# =============================================================================

@router.post("/periods/generate", response_model=List[schemas.AccountingPeriodResponse])
def generate_periods(data: schemas.GeneratePeriodsRequest, db: Session = Depends(get_db)):
    """Generate 12 monthly accounting periods for a fiscal year."""
    return AccountingPeriodService(db).generate_periods(data)


@router.get("/periods", response_model=List[schemas.AccountingPeriodResponse])
def list_periods(
    fiscal_year: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    """List accounting periods."""
    return AccountingPeriodService(db).list_periods(schemas.AccountingPeriodListFilter(
        fiscal_year=fiscal_year,
        status=status_filter,
    ))


@router.get("/periods/{period_id}", response_model=schemas.AccountingPeriodResponse)
def get_period(period_id: int, db: Session = Depends(get_db)):
    """Get a specific accounting period."""
    return AccountingPeriodService(db).get_period(period_id)


@router.post("/periods/{period_id}/close", response_model=schemas.AccountingPeriodResponse)
def close_period(period_id: int, db: Session = Depends(get_db)):
    """Close an accounting period."""
    return AccountingPeriodService(db).close_period(period_id, closed_by=0)


@router.post("/periods/{period_id}/reopen", response_model=schemas.AccountingPeriodResponse)
def reopen_period(period_id: int, db: Session = Depends(get_db)):
    """Reopen a closed accounting period."""
    return AccountingPeriodService(db).reopen_period(period_id)


@router.post("/periods/{period_id}/lock", response_model=schemas.AccountingPeriodResponse)
def lock_period(period_id: int, db: Session = Depends(get_db)):
    """Lock a closed accounting period (permanent)."""
    return AccountingPeriodService(db).lock_period(period_id)


# =============================================================================
# CASH FLOW CATEGORIES
# =============================================================================

@router.post("/cash-flow/categories/seed", response_model=schemas.CashFlowSeedResponse)
def seed_cash_flow_categories(db: Session = Depends(get_db)):
    """Seed the 13 standard cash flow categories (Operating, Investing, Financing)."""
    result = CashFlowService(db).seed_standard_categories()
    return {
        "created": result["created"],
        "skipped": result["skipped"],
        "categories": result["categories"],
        "message": result["message"],
    }


@router.post("/cash-flow/categories", response_model=schemas.CashFlowCategoryResponse, status_code=status.HTTP_201_CREATED)
def create_cash_flow_category(data: schemas.CashFlowCategoryCreate, db: Session = Depends(get_db)):
    """Create a new cash flow category."""
    return CashFlowService(db).create_category(data)


@router.put("/cash-flow/categories/{category_id}", response_model=schemas.CashFlowCategoryResponse)
def update_cash_flow_category(category_id: int, data: schemas.CashFlowCategoryUpdate, db: Session = Depends(get_db)):
    """Update a cash flow category."""
    return CashFlowService(db).update_category(category_id, data)


@router.get("/cash-flow/categories", response_model=List[schemas.CashFlowCategoryResponse])
def list_cash_flow_categories(section: Optional[str] = None, db: Session = Depends(get_db)):
    """List cash flow categories."""
    return CashFlowService(db).list_categories(section=section)


@router.delete("/cash-flow/categories/{category_id}")
def delete_cash_flow_category(category_id: int, db: Session = Depends(get_db)):
    """Delete a cash flow category."""
    CashFlowService(db).delete_category(category_id)
    return {"message": "Category deleted successfully"}


# =============================================================================
# CASH FLOW STATEMENTS
# =============================================================================

@router.post("/cash-flow/statements/generate", response_model=schemas.CashFlowStatementResponse)
def generate_cash_flow_statement(data: schemas.CashFlowStatementCreate, db: Session = Depends(get_db)):
    """Generate a cash flow statement for a fiscal period."""
    statement = CashFlowService(db).generate_statement(data, prepared_by=0)
    return _serialize_cfs(statement)


@router.get("/cash-flow/statements", response_model=List[schemas.CashFlowStatementResponse])
def list_cash_flow_statements(
    fiscal_year: Optional[int] = None,
    fiscal_period: Optional[int] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
):
    """List cash flow statements."""
    return CashFlowService(db).list_statements(schemas.CashFlowStatementListFilter(
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        status=status_filter,
    ))


@router.get("/cash-flow/statements/{statement_id}", response_model=schemas.CashFlowStatementResponse)
def get_cash_flow_statement(statement_id: int, db: Session = Depends(get_db)):
    """Get a specific cash flow statement with lines."""
    statement = CashFlowService(db).get_statement(statement_id)
    return _serialize_cfs(statement)


@router.post("/cash-flow/statements/{statement_id}/finalize", response_model=schemas.CashFlowStatementResponse)
def finalize_cash_flow_statement(statement_id: int, db: Session = Depends(get_db)):
    """Finalize a draft cash flow statement."""
    return CashFlowService(db).finalize_statement(statement_id)


@router.post("/cash-flow/statements/{statement_id}/approve", response_model=schemas.CashFlowStatementResponse)
def approve_cash_flow_statement(statement_id: int, db: Session = Depends(get_db)):
    """Approve a finalized cash flow statement."""
    return CashFlowService(db).approve_statement(statement_id, approved_by=0)


@router.delete("/cash-flow/statements/{statement_id}")
def delete_cash_flow_statement(statement_id: int, db: Session = Depends(get_db)):
    """Delete a draft cash flow statement."""
    CashFlowService(db).delete_statement(statement_id)
    return {"message": "Statement deleted successfully"}


@router.post("/cash-flow/statements/{statement_id}/regenerate", response_model=schemas.CashFlowStatementResponse)
def regenerate_cash_flow_statement(statement_id: int, db: Session = Depends(get_db)):
    """Regenerate a draft cash flow statement with fresh GL data."""
    statement = CashFlowService(db).regenerate_statement(statement_id, prepared_by=0)
    return _serialize_cfs(statement)


# =============================================================================
# CASH FLOW MANUAL LINES
# =============================================================================

@router.post(
    "/cash-flow/statements/{statement_id}/lines",
    response_model=schemas.CashFlowStatementLineResponse,
    status_code=status.HTTP_201_CREATED,
)
def add_cash_flow_manual_line(
    statement_id: int,
    data: schemas.CashFlowManualLineCreate,
    db: Session = Depends(get_db),
):
    """Add a manual (non-calculated) line to a draft cash flow statement."""
    svc = CashFlowService(db)
    line = svc.add_manual_line(statement_id, data)
    return {
        "id": line.id,
        "cash_flow_statement_id": line.cash_flow_statement_id,
        "category_id": line.category_id,
        "line_number": line.line_number,
        "line_description": line.line_description,
        "amount": line.amount,
        "is_calculated": line.is_calculated,
        "calculation_source": line.calculation_source,
        "reference_accounts": line.reference_accounts,
        "notes": line.notes,
        "created_at": line.created_at,
        "category_code": line.category.category_code if line.category else None,
        "category_name": line.category.category_name if line.category else None,
        "section": line.category.section if line.category else None,
    }


@router.put(
    "/cash-flow/statements/{statement_id}/lines/{line_id}",
    response_model=schemas.CashFlowStatementLineResponse,
)
def update_cash_flow_manual_line(
    statement_id: int,
    line_id: int,
    data: schemas.CashFlowManualLineUpdate,
    db: Session = Depends(get_db),
):
    """Update a manual line on a draft cash flow statement."""
    svc = CashFlowService(db)
    line = svc.update_manual_line(statement_id, line_id, data)
    return {
        "id": line.id,
        "cash_flow_statement_id": line.cash_flow_statement_id,
        "category_id": line.category_id,
        "line_number": line.line_number,
        "line_description": line.line_description,
        "amount": line.amount,
        "is_calculated": line.is_calculated,
        "calculation_source": line.calculation_source,
        "reference_accounts": line.reference_accounts,
        "notes": line.notes,
        "created_at": line.created_at,
        "category_code": line.category.category_code if line.category else None,
        "category_name": line.category.category_name if line.category else None,
        "section": line.category.section if line.category else None,
    }


@router.delete("/cash-flow/statements/{statement_id}/lines/{line_id}")
def delete_cash_flow_manual_line(
    statement_id: int, line_id: int, db: Session = Depends(get_db)
):
    """Delete a manual line from a draft cash flow statement."""
    CashFlowService(db).delete_manual_line(statement_id, line_id)
    return {"message": "Manual line deleted successfully"}


@router.post(
    "/cash-flow/statements/{statement_id}/recalculate",
    response_model=schemas.CashFlowStatementResponse,
)
def recalculate_cash_flow_totals(statement_id: int, db: Session = Depends(get_db)):
    """Recalculate section totals and net change on a statement."""
    statement = CashFlowService(db).recalculate_totals(statement_id)
    return _serialize_cfs(statement)


# =============================================================================
# CASH FLOW REPORT & RECONCILIATION
# =============================================================================

@router.get(
    "/cash-flow/statements/{statement_id}/report",
    response_model=schemas.CashFlowReportResponse,
)
def get_cash_flow_report(statement_id: int, db: Session = Depends(get_db)):
    """Get a formatted cash flow statement report with sections and cash composition."""
    return CashFlowService(db).generate_report(statement_id)


@router.get(
    "/cash-flow/statements/{statement_id}/reconcile",
    response_model=schemas.CashFlowReconciliationResponse,
)
def reconcile_cash_flow_with_gl(statement_id: int, db: Session = Depends(get_db)):
    """Verify the cash flow statement reconciles with GL cash balances."""
    return CashFlowService(db).reconcile_with_gl(statement_id)


def _serialize_cfs(statement) -> dict:
    """Serialize CashFlowStatement with lines."""
    lines = []
    for line in (statement.lines or []):
        lines.append({
            "id": line.id,
            "cash_flow_statement_id": line.cash_flow_statement_id,
            "category_id": line.category_id,
            "line_number": line.line_number,
            "line_description": line.line_description,
            "amount": line.amount,
            "is_calculated": line.is_calculated,
            "calculation_source": line.calculation_source,
            "reference_accounts": line.reference_accounts,
            "notes": line.notes,
            "created_at": line.created_at,
            "category_code": line.category.category_code if line.category else None,
            "category_name": line.category.category_name if line.category else None,
            "section": line.category.section if line.category else None,
        })
    return {
        "id": statement.id,
        "statement_no": statement.statement_no,
        "fiscal_year": statement.fiscal_year,
        "fiscal_period": statement.fiscal_period,
        "period_start_date": statement.period_start_date,
        "period_end_date": statement.period_end_date,
        "opening_cash_balance": statement.opening_cash_balance,
        "closing_cash_balance": statement.closing_cash_balance,
        "net_cash_from_operating": statement.net_cash_from_operating,
        "net_cash_from_investing": statement.net_cash_from_investing,
        "net_cash_from_financing": statement.net_cash_from_financing,
        "net_change_in_cash": statement.net_change_in_cash,
        "status": statement.status,
        "method": statement.method,
        "notes": statement.notes,
        "prepared_by": statement.prepared_by,
        "approved_by": statement.approved_by,
        "approved_at": statement.approved_at,
        "created_at": statement.created_at,
        "updated_at": statement.updated_at,
        "lines": lines,
    }
