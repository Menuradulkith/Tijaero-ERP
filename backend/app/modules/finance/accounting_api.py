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
from decimal import Decimal

from app.core import timezone as tz
from app.db.session import get_db
from app.auth.dependencies import (
    get_current_active_user,
    get_user_branch_filter,
    validate_branch_access,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.utils.csv_export import build_csv_response
from . import accounting_schemas as schemas
from .accounting_service import (
    ChartOfAccountsService,
    JournalEntryService,
    GeneralLedgerService,
    AccountingPeriodService,
    CashFlowService,
    AccountingDashboardService,
)
from .reconciliation_service import ReconciliationService, GLPostingFailureService
from .posting_rules_service import PostingRuleService, VoucherTypeService
from .tax_service import TaxCodeService, VatReturnService
from .bank_reconciliation import BankReconciliationService

from .write_off_service import WRITE_OFF_REASONS, WriteOffService
from .cheque_service import ChequeService
from .cost_centers import CostCenterService
from .fixed_assets import FixedAssetService
from .period_end import OpeningBalanceService, RecurringJournalService
from . import schemas as finance_schemas

# All accounting endpoints require authentication
router = APIRouter(
    prefix="/finance/accounting",
    tags=["accounting"],
    dependencies=[Depends(get_current_active_user)],
)


# =============================================================================
# DASHBOARD
# =============================================================================

@router.get("/dashboard/stats", response_model=schemas.AccountingDashboardStats, dependencies=[Depends(require_permission(*Permissions.FINANCE_DASHBOARD_VIEW))])
def get_dashboard_stats(db: Session = Depends(get_db)):
    """Get accounting dashboard statistics."""
    return AccountingDashboardService(db).get_stats()


# =============================================================================
# CHART OF ACCOUNTS
# =============================================================================

@router.post("/chart-of-accounts", response_model=schemas.ChartOfAccountResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_CREATE))])
def create_account(data: schemas.ChartOfAccountCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Create a new chart of accounts entry."""
    return ChartOfAccountsService(db).create_account(data, created_by=current_user.id)


@router.put("/chart-of-accounts/{account_id}", response_model=schemas.ChartOfAccountResponse, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def update_account(account_id: int, data: schemas.ChartOfAccountUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Update a chart of accounts entry."""
    return ChartOfAccountsService(db).update_account(account_id, data, updated_by=current_user.id)


@router.get("/chart-of-accounts", response_model=List[schemas.ChartOfAccountResponse], dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_VIEW))])
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


@router.get("/chart-of-accounts/tree", dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_VIEW))])
def get_account_tree(db: Session = Depends(get_db)):
    """Get hierarchical tree of chart of accounts."""
    return ChartOfAccountsService(db).get_account_tree()


@router.get("/chart-of-accounts/{account_id}", response_model=schemas.ChartOfAccountResponse, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_VIEW))])
def get_account(account_id: int, db: Session = Depends(get_db)):
    """Get a specific chart of accounts entry."""
    return ChartOfAccountsService(db).get_account(account_id)


@router.delete("/chart-of-accounts/{account_id}", dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_DELETE))])
def delete_account(account_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Delete a chart of accounts entry."""
    ChartOfAccountsService(db).delete_account(account_id, deleted_by=current_user.id)
    return {"message": "Account deleted successfully"}


@router.post("/chart-of-accounts/seed", dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_CREATE))])
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

def _check_branch(db: Session, current_user: User, branch_code: Optional[str]) -> None:
    """403 unless the user may work in ``branch_code`` (no branch = company-wide);
    the branch must exist and be active."""
    if not branch_code:
        return
    if not validate_branch_access(current_user, branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")
    from app.common.branch_validation import validate_branch_is_active
    validate_branch_is_active(db, branch_code)


def _je_in_branch_scope(
    je_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
) -> None:
    """A branch-limited user may open or act on a journal of their own branches,
    or a company-wide one (no branch) — the same rule as the journal list."""
    from .accounting_models import JournalEntry

    branch = db.query(JournalEntry.branch_code).filter(JournalEntry.id == je_id).scalar()
    if branch and not validate_branch_access(current_user, branch):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Journal entry not found")


@router.post("/journal-entries", response_model=schemas.JournalEntryResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))])
def create_journal_entry(
    data: schemas.JournalEntryCreateInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new journal entry (draft)."""
    # Entries created through the public API are always Manual and therefore
    # subject to the submit → approve workflow; only internal integrations may
    # create Auto/Adjustment/Closing entries that post directly to the GL.
    data.entry_type = "Manual"
    _check_branch(db, current_user, data.branch_code)
    je = JournalEntryService(db).create_journal_entry(data, created_by=current_user.id)
    return _serialize_je(je)


@router.put("/journal-entries/{je_id}", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_UPDATE))])
def update_journal_entry(
    je_id: int,
    data: schemas.JournalEntryUpdateInput,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a draft journal entry."""
    _check_branch(db, current_user, data.branch_code)
    je = JournalEntryService(db).update_journal_entry(je_id, data, updated_by=current_user.id)
    return _serialize_je(je)


@router.get("/journal-entries", dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def list_journal_entries(
    status_filter: Optional[str] = Query(None, alias="status"),
    entry_type: Optional[str] = None,
    voucher_type: Optional[str] = None,
    branch_code: Optional[str] = None,
    fiscal_year: Optional[int] = None,
    fiscal_period: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """List journal entries with optional filters."""
    if branch_code and user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")
    items, total = JournalEntryService(db).list_journal_entries(schemas.JournalEntryListFilter(
        status=status_filter,
        entry_type=entry_type,
        voucher_type=voucher_type,
        branch_code=branch_code,
        branch_codes=user_branches if not branch_code else None,
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        date_from=date_from,
        date_to=date_to,
        search=search,
        skip=skip,
        limit=limit,
    ))
    return {"items": [_serialize_je(je) for je in items], "total": total}


# Declared before /journal-entries/{je_id}: FastAPI matches in order, so the
# static path must come first or it is parsed as an id (422).
@router.get("/journal-entries/export-csv", summary="Export Journal Entries to CSV", dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def export_journal_entries_csv(
    status_filter: Optional[str] = Query(None, alias="status"),
    fiscal_year: Optional[int] = None,
    branch_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export journal entries to CSV."""
    if branch_code and user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")
    items, _total = JournalEntryService(db).list_journal_entries(schemas.JournalEntryListFilter(
        status=status_filter,
        fiscal_year=fiscal_year,
        branch_code=branch_code,
        branch_codes=user_branches if not branch_code else None,
        skip=0, limit=100000,
    ))
    return build_csv_response(
        filename="journal_entries",
        headers=["JE No", "Date", "Description", "Status", "Fiscal Year", "Period", "Total Debit", "Total Credit", "Created By"],
        rows=[
            [e.journal_entry_no, e.entry_date, e.description, e.status, e.fiscal_year, e.fiscal_period, e.total_debit, e.total_credit, e.created_by]
            for e in items
        ],
    )


@router.get("/journal-entries/{je_id}", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def get_journal_entry(je_id: int, db: Session = Depends(get_db)):
    """Get a specific journal entry with lines."""
    je = JournalEntryService(db).get_journal_entry(je_id)
    return _serialize_je(je)


@router.post("/journal-entries/{je_id}/post", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_UPDATE))])
def post_journal_entry(
    je_id: int,
    data: schemas.PostJournalEntryRequest = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Post a journal entry (creates GL entries)."""
    posting_date = data.posting_date if data else None
    je = JournalEntryService(db).post_journal_entry(
        je_id, posted_by=current_user.id, posting_date=posting_date, require_period=True,
    )
    return _serialize_je(JournalEntryService(db).get_journal_entry(je.id))


@router.post("/journal-entries/{je_id}/reverse", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_UPDATE))])
def reverse_journal_entry(
    je_id: int,
    data: schemas.ReverseJournalEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Reverse a posted manual journal entry (source-document entries are
    undone through their document)."""
    from .posting_dates import check_posting_date
    check_posting_date(db, data.reversal_date, "Reversal date")
    je = JournalEntryService(db).reverse_journal_entry(
        je_id, reversed_by=current_user.id, reason=data.reason, reversal_date=data.reversal_date,
        require_period=True, manual=True,
    )
    return _serialize_je(je)


@router.delete("/journal-entries/{je_id}", dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_DELETE))])
def delete_journal_entry(
    je_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a draft journal entry."""
    JournalEntryService(db).delete_journal_entry(je_id, deleted_by=current_user.id)
    return {"message": "Journal entry deleted successfully"}


# ─────────────────────────────────────────────────────────────────────────────
# Scenario 33: Manual JE Validation & Approval Workflow
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/journal-entries/{je_id}/validate", response_model=schemas.ValidateJournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def validate_journal_entry(je_id: int, db: Session = Depends(get_db)):
    """
    Validate a journal entry (Step 3).
    Checks: debit==credit, all accounts active, amounts positive, description provided.
    Returns detailed validation result with errors and warnings.
    """
    return JournalEntryService(db).validate_journal_entry(je_id)


@router.post("/journal-entries/{je_id}/submit", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.JOURNAL_ENTRY_UPDATE))])
def submit_journal_entry(
    je_id: int,
    data: schemas.SubmitJournalEntryRequest = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Submit a draft manual JE for approval (Step 3→4).
    Runs validation first. Moves status: draft → submitted.
    """
    remarks = data.remarks if data else None
    svc = JournalEntryService(db)
    je = svc.submit_journal_entry(je_id, submitted_by=current_user.id, remarks=remarks)
    return _serialize_je(svc.get_journal_entry(je.id))


@router.post("/journal-entries/{je_id}/approve", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.PAYMENT_APPROVAL_APPROVE))])
def approve_journal_entry(
    je_id: int,
    data: schemas.ApproveJournalEntryRequest = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Approve a submitted manual JE (Step 4).
    Finance manager verification. Moves status: submitted → approved.
    After approval, the JE can be posted.
    """
    remarks = data.remarks if data else None
    svc = JournalEntryService(db)
    je = svc.approve_journal_entry(je_id, approved_by=current_user.id, remarks=remarks)
    return _serialize_je(svc.get_journal_entry(je.id))


@router.post("/journal-entries/{je_id}/reject", response_model=schemas.JournalEntryResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.PAYMENT_APPROVAL_APPROVE))])
def reject_journal_entry(
    je_id: int,
    data: schemas.RejectJournalEntryRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Reject a submitted manual JE back to draft.
    Allows the accountant to fix errors and resubmit.
    Moves status: submitted → draft.
    """
    svc = JournalEntryService(db)
    je = svc.reject_journal_entry(je_id, rejected_by=current_user.id, reason=data.reason)
    return _serialize_je(svc.get_journal_entry(je.id))


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
            "cost_center_id": line.cost_center_id,
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
        "voucher_type": je.voucher_type,
        "auto_reverse_date": je.auto_reverse_date,
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
        "created_by_name": getattr(je, "created_by_name", None),
        "submitted_by_name": getattr(je, "submitted_by_name", None),
        "approved_by_name": getattr(je, "approved_by_name", None),
        "posted_by_name": getattr(je, "posted_by_name", None),
        "created_at": je.created_at,
        "updated_at": je.updated_at,
        "lines": lines,
    }


# =============================================================================
# GENERAL LEDGER
# =============================================================================

@router.get("/general-ledger", dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def list_gl_entries(
    account_id: Optional[int] = None,
    account_code: Optional[str] = None,
    account_type: Optional[str] = None,
    transaction_type: Optional[str] = None,
    branch_code: Optional[str] = None,
    fiscal_year: Optional[int] = None,
    fiscal_period: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    reference_type: Optional[str] = None,
    reference_no: Optional[str] = None,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """List general ledger entries with filters."""
    if branch_code and user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")
    items, total = GeneralLedgerService(db).list_gl_entries(schemas.GLListFilter(
        account_id=account_id,
        account_code=account_code,
        account_type=account_type,
        transaction_type=transaction_type,
        branch_code=branch_code,
        branch_codes=user_branches if not branch_code else None,
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        date_from=date_from,
        date_to=date_to,
        reference_type=reference_type,
        reference_no=reference_no,
        search=search,
        skip=skip,
        limit=limit,
    ))
    return {"items": items, "total": total}


def _report_branch_scope(branch_code: Optional[str], user_branches: Optional[List[str]]):
    """(branch_code, branch_codes) for a GL report: a branch-limited user may only
    ask for one of their branches and, without one, sees only their branches."""
    if branch_code and user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")
    return branch_code, (user_branches if not branch_code else None)


@router.get("/general-ledger/trial-balance", response_model=schemas.TrialBalanceResponse, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def get_trial_balance(
    fiscal_year: int = Query(...),
    fiscal_period: Optional[int] = None,
    as_of_date: Optional[date] = None,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Generate trial balance report (optionally for one branch)."""
    branch_code, branch_codes = _report_branch_scope(branch_code, user_branches)
    return GeneralLedgerService(db).get_trial_balance(
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        as_of_date=as_of_date,
        branch_code=branch_code,
        branch_codes=branch_codes,
    )


@router.get("/general-ledger/account/{account_id}", dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def get_account_ledger(
    account_id: int,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get all GL entries for a specific account with running balance
    (a branch-limited user sees only their branches' rows)."""
    return GeneralLedgerService(db).get_account_ledger(
        account_id=account_id,
        date_from=date_from,
        date_to=date_to,
        branch_codes=user_branches,
    )


# =============================================================================
# FINANCIAL REPORTS (Scenario 34)
# =============================================================================

@router.get("/reports/income-statement", response_model=schemas.IncomeStatementResponse, dependencies=[Depends(require_permission(*Permissions.REPORTING_FINANCE_VIEW))])
def get_income_statement(
    fiscal_year: int = Query(...),
    fiscal_period: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Generate Income Statement (Profit & Loss) report (optionally for one branch)."""
    branch_code, branch_codes = _report_branch_scope(branch_code, user_branches)
    return GeneralLedgerService(db).get_income_statement(
        fiscal_year=fiscal_year,
        fiscal_period=fiscal_period,
        date_from=date_from,
        date_to=date_to,
        branch_code=branch_code,
        branch_codes=branch_codes,
    )


@router.get("/reports/balance-sheet", response_model=schemas.BalanceSheetResponse, dependencies=[Depends(require_permission(*Permissions.REPORTING_FINANCE_VIEW))])
def get_balance_sheet(
    fiscal_year: int = Query(...),
    as_of_date: Optional[date] = None,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Generate Balance Sheet (Statement of Financial Position) report (optionally for one branch)."""
    branch_code, branch_codes = _report_branch_scope(branch_code, user_branches)
    return GeneralLedgerService(db).get_balance_sheet(
        fiscal_year=fiscal_year,
        as_of_date=as_of_date,
        branch_code=branch_code,
        branch_codes=branch_codes,
    )


@router.get("/reports/reconciliation-check", response_model=schemas.ReconciliationCheckResponse, dependencies=[Depends(require_permission(*Permissions.REPORTING_FINANCE_VIEW))])
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


@router.get("/reports/day-end-reconciliation", response_model=schemas.DayEndReconciliationResponse, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def day_end_reconciliation(
    reconciliation_date: Optional[date] = Query(None, alias="date"),
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """
    End-of-day "do the books balance?" check for a date/branch.

    Combines the trial balance, a cashbook ↔ GL cash/bank reconciliation, and a
    posting-health check (no pending GL posting failures, no unposted JEs).
    """
    recon_date = reconciliation_date or tz.today()
    return ReconciliationService(db).day_end(recon_date, branch_code=branch_code)


# =============================================================================
# GL POSTING FAILURES (Transactional Outbox)
# =============================================================================

@router.get("/posting-failures", response_model=schemas.GLPostingFailureListResponse, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def list_posting_failures(
    status_filter: Optional[str] = Query("pending", alias="status"),
    source_module: Optional[str] = None,
    branch_code: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    """List automatic GL postings that failed and are awaiting retry."""
    return GLPostingFailureService(db).list_failures(
        status=status_filter,
        source_module=source_module,
        branch_code=branch_code,
        skip=skip,
        limit=limit,
    )


@router.post("/posting-failures/{failure_id}/retry", response_model=schemas.RetryPostingFailureResponse, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_UPDATE))])
def retry_posting_failure(
    failure_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Re-attempt a failed GL posting using its stored payload."""
    return GLPostingFailureService(db).retry(failure_id, user_id=current_user.id)


@router.post("/posting-failures/{failure_id}/ignore", response_model=schemas.GLPostingFailureResponse, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_UPDATE))])
def ignore_posting_failure(
    failure_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Mark a failed GL posting as ignored (it will no longer be retried)."""
    return GLPostingFailureService(db).ignore(failure_id, user_id=current_user.id)


@router.post("/reports/year-end-close", response_model=schemas.YearEndCloseResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def year_end_close(
    data: schemas.YearEndCloseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Create year-end closing entries for a fiscal year.
    Closes Revenue and Expense accounts to Current Year P/L,
    then transfers to Retained Earnings.
    """
    return AccountingPeriodService(db).create_year_end_closing_entries(
        data=data, closed_by=current_user.id,
    )


# =============================================================================
# AUDIT TRAIL & CORRECTION (Scenario 35)
# =============================================================================

@router.get("/audit-trail", response_model=schemas.AuditTrailResponse, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def get_audit_trail(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    account_id: Optional[int] = None,
    account_code: Optional[str] = None,
    entry_type: Optional[str] = None,
    transaction_type: Optional[str] = None,
    created_by: Optional[int] = None,
    include_reversed: bool = True,
    search: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """
    Query the full audit trail of accounting activities (branch-limited users:
    their branches plus company-wide entries).
    Returns JE and GL entries with user/timestamp information.
    """
    return GeneralLedgerService(db).get_audit_trail(schemas.AuditTrailFilter(
        date_from=date_from,
        date_to=date_to,
        account_id=account_id,
        account_code=account_code,
        entry_type=entry_type,
        transaction_type=transaction_type,
        created_by=created_by,
        include_reversed=include_reversed,
        search=search,
        branch_codes=user_branches,
        skip=skip,
        limit=limit,
    ))


@router.post("/journal-entries/{je_id}/correct", response_model=schemas.CorrectionResponse, dependencies=[Depends(_je_in_branch_scope), Depends(require_permission(*Permissions.PAYMENT_APPROVAL_APPROVE))])
def correct_journal_entry(
    je_id: int,
    data: schemas.CorrectionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Correct a posted journal entry.
    Atomic operation: reverses the original and creates a new corrected entry.
    """
    from .posting_dates import check_posting_date
    check_posting_date(db, data.correction_date, "Correction date")
    return GeneralLedgerService(db).correct_journal_entry(
        je_id=je_id, data=data, corrected_by=current_user.id, require_period=True,
    )


# =============================================================================
# ACCOUNTING PERIODS
# =============================================================================

@router.post("/periods/generate", response_model=List[schemas.AccountingPeriodResponse], dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_CREATE))])
def generate_periods(data: schemas.GeneratePeriodsRequest, db: Session = Depends(get_db)):
    """Generate 12 monthly accounting periods for a fiscal year."""
    return AccountingPeriodService(db).generate_periods(data)


@router.get("/periods", response_model=List[schemas.AccountingPeriodResponse], dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_VIEW))])
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


@router.get("/periods/{period_id}", response_model=schemas.AccountingPeriodResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_VIEW))])
def get_period(period_id: int, db: Session = Depends(get_db)):
    """Get a specific accounting period."""
    return AccountingPeriodService(db).get_period(period_id)


@router.post("/periods/{period_id}/close", response_model=schemas.AccountingPeriodResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def close_period(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Close an accounting period."""
    return AccountingPeriodService(db).close_period(period_id, closed_by=current_user.id)


@router.post("/periods/{period_id}/reopen", response_model=schemas.AccountingPeriodResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def reopen_period(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Reopen a closed accounting period."""
    return AccountingPeriodService(db).reopen_period(period_id, reopened_by=current_user.id)


@router.post("/periods/{period_id}/lock", response_model=schemas.AccountingPeriodResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def lock_period(
    period_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Lock a closed accounting period (permanent)."""
    return AccountingPeriodService(db).lock_period(period_id, locked_by=current_user.id)


# =============================================================================
# CASH FLOW CATEGORIES
# =============================================================================

@router.post("/cash-flow/categories/seed", response_model=schemas.CashFlowSeedResponse, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_CREATE))])
def seed_cash_flow_categories(db: Session = Depends(get_db)):
    """Seed the 13 standard cash flow categories (Operating, Investing, Financing)."""
    result = CashFlowService(db).seed_standard_categories()
    return {
        "created": result["created"],
        "skipped": result["skipped"],
        "categories": result["categories"],
        "message": result["message"],
    }


@router.post("/cash-flow/categories", response_model=schemas.CashFlowCategoryResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_CREATE))])
def create_cash_flow_category(data: schemas.CashFlowCategoryCreate, db: Session = Depends(get_db)):
    """Create a new cash flow category."""
    return CashFlowService(db).create_category(data)


@router.put("/cash-flow/categories/{category_id}", response_model=schemas.CashFlowCategoryResponse, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def update_cash_flow_category(category_id: int, data: schemas.CashFlowCategoryUpdate, db: Session = Depends(get_db)):
    """Update a cash flow category."""
    return CashFlowService(db).update_category(category_id, data)


@router.get("/cash-flow/categories", response_model=List[schemas.CashFlowCategoryResponse], dependencies=[Depends(require_permission(*Permissions.CASH_FLOW_VIEW))])
def list_cash_flow_categories(section: Optional[str] = None, db: Session = Depends(get_db)):
    """List cash flow categories."""
    return CashFlowService(db).list_categories(section=section)


@router.delete("/cash-flow/categories/{category_id}", dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_DELETE))])
def delete_cash_flow_category(category_id: int, db: Session = Depends(get_db)):
    """Delete a cash flow category."""
    CashFlowService(db).delete_category(category_id)
    return {"message": "Category deleted successfully"}


# =============================================================================
# POSTING RULES & VOUCHER TYPES
# =============================================================================

@router.get("/posting-rules", response_model=schemas.PostingRuleSetup, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_VIEW))])
def list_posting_rules(db: Session = Depends(get_db)):
    """Every automatic posting type with its default and configured account."""
    return PostingRuleService(db).list_rules()


@router.put("/posting-rules/{posting_type}", response_model=schemas.PostingRuleSetup, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def save_posting_rule(posting_type: str, data: schemas.PostingRuleUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Point a posting type at another account, optionally per branch / expense category.
    Applies to postings made from now on; posted entries are not changed."""
    return PostingRuleService(db).save_rule(posting_type, data, user_id=current_user.id)


@router.delete("/posting-rules/{posting_type}", response_model=schemas.PostingRuleSetup, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def reset_posting_rule(posting_type: str, db: Session = Depends(get_db)):
    """Return a posting type to its built-in default account."""
    return PostingRuleService(db).reset_rule(posting_type)


@router.get("/voucher-types", response_model=List[schemas.VoucherTypeResponse], dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def list_voucher_types(db: Session = Depends(get_db)):
    """Journal-entry sources (MJ, SALE, PUR, ...) with how many entries each has."""
    return VoucherTypeService(db).list_types()


# =============================================================================
# TAX CODES & VAT RETURN
# =============================================================================

@router.get("/tax-codes", response_model=List[schemas.TaxCodeResponse], dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_VIEW))])
def list_tax_codes(active_only: bool = False, db: Session = Depends(get_db)):
    """VAT treatments (rate + type) used on sales and supplier invoices."""
    return TaxCodeService(db).list_codes(include_inactive=not active_only)


@router.post("/tax-codes", response_model=schemas.TaxCodeResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def create_tax_code(data: schemas.TaxCodeCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return TaxCodeService(db).create(data, user_id=current_user.id)


@router.put("/tax-codes/{code_id}", response_model=schemas.TaxCodeResponse, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def update_tax_code(code_id: int, data: schemas.TaxCodeUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return TaxCodeService(db).update(code_id, data, user_id=current_user.id)


@router.get("/reports/vat-return", response_model=schemas.VatReturnResponse, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def vat_return(
    date_from: date,
    date_to: date,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """VAT on sales minus VAT on purchases for a period, by tax code, with a GL cross-check."""
    if user_branches is not None and (not branch_code or branch_code not in user_branches):
        raise HTTPException(status_code=403, detail="Choose one of your branches for the VAT return")
    return VatReturnService(db).vat_return(date_from, date_to, branch_code)


@router.get("/reports/vat-return/transactions", response_model=schemas.TaxTransactionList, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def vat_transactions(
    date_from: date,
    date_to: date,
    direction: Optional[str] = None,
    tax_code: Optional[str] = None,
    tax_rate: Optional[Decimal] = None,
    branch_code: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=5000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """The documents behind a VAT return line."""
    if user_branches is not None and (not branch_code or branch_code not in user_branches):
        raise HTTPException(status_code=403, detail="Choose one of your branches")
    return VatReturnService(db).transactions(
        date_from, date_to, direction=direction, tax_code=tax_code, tax_rate=tax_rate, branch_code=branch_code,
        skip=skip, limit=limit
    )


@router.get("/vat-settlements", response_model=List[schemas.VatSettlementResponse], dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def list_vat_settlements(db: Session = Depends(get_db)):
    return VatReturnService(db).list_settlements()


@router.post("/vat-settlements", response_model=schemas.VatSettlementResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def settle_vat(data: schemas.VatSettlementCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Clear all unsettled VAT up to a date into "VAT due to tax authority"."""
    return VatReturnService(db).settle(data, user_id=current_user.id)


# =============================================================================
# CUSTOMER WRITE-OFFS
# =============================================================================

@router.get("/write-offs/setup", response_model=schemas.WriteOffSetup, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def write_off_setup(db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Reasons to choose from and the current user's write-off limit."""
    return {
        "reasons": [{"value": k, "label": v} for k, v in WRITE_OFF_REASONS.items()],
        "my_limit": WriteOffService(db).user_limit(current_user),
    }


@router.get("/write-offs", response_model=List[schemas.WriteOffResponse], dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def list_write_offs(
    customer_id: Optional[int] = None,
    invoice_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    return WriteOffService(db).list_write_offs(customer_id=customer_id, invoice_id=invoice_id, branch_codes=user_branches)


@router.post("/write-offs", response_model=schemas.WriteOffResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))])
def create_write_off(
    data: schemas.WriteOffCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Write off part or all of a credit invoice's open balance (within the user's limit)."""
    svc = WriteOffService(db)
    return svc.response(svc.write_off(data, current_user, allowed_branches=user_branches))


@router.post("/write-offs/{write_off_id}/reverse", response_model=schemas.WriteOffResponse, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))])
def reverse_write_off(
    write_off_id: int,
    data: schemas.WriteOffReverse,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    svc = WriteOffService(db)
    return svc.response(svc.reverse(write_off_id, current_user, data.reason, allowed_branches=user_branches))


@router.get("/write-off-limits", response_model=List[schemas.WriteOffLimitResponse], dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_VIEW))])
def list_write_off_limits(db: Session = Depends(get_db)):
    return WriteOffService(db).list_limits()


@router.put("/write-off-limits/{group_id}", response_model=List[schemas.WriteOffLimitResponse], dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def set_write_off_limit(group_id: int, data: schemas.WriteOffLimitUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return WriteOffService(db).set_limit(group_id, data.max_amount, user_id=current_user.id)


# =============================================================================
# CHEQUE REGISTER
# =============================================================================

@router.post("/cheques/{cheque_id}/clear", response_model=finance_schemas.ChequePayment, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))])
def clear_cheque(
    cheque_id: int,
    data: schemas.ChequeStatusChange,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """The bank has paid a deposited cheque."""
    return ChequeService(db).mark_cleared(cheque_id, data.status_date, allowed_branches=user_branches)


@router.post("/cheques/{cheque_id}/bounce", response_model=finance_schemas.ChequePayment, dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))])
def bounce_cheque(
    cheque_id: int,
    data: schemas.ChequeBounce,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """The cheque was returned unpaid: the customer owes the amount again."""
    return ChequeService(db).bounce(cheque_id, data.reason, data.status_date, user_id=current_user.id,
                                    allowed_branches=user_branches)


# =============================================================================
# COST CENTERS
# =============================================================================

@router.get("/cost-centers", response_model=List[schemas.CostCenterResponse])
def list_cost_centers(active_only: bool = False, db: Session = Depends(get_db)):
    """Cost centers (any signed-in user: journal lines and expenses pick from them)."""
    return CostCenterService(db).list_centers(active_only=active_only)


@router.post("/cost-centers", response_model=schemas.CostCenterResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def create_cost_center(data: schemas.CostCenterCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return CostCenterService(db).create(data, user_id=current_user.id)


@router.put("/cost-centers/{cc_id}", response_model=schemas.CostCenterResponse, dependencies=[Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))])
def update_cost_center(cc_id: int, data: schemas.CostCenterUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return CostCenterService(db).update(cc_id, data, user_id=current_user.id)


@router.get("/reports/profit-by-cost-center", response_model=schemas.CostCenterProfitReport, dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def profit_by_cost_center(
    date_from: date,
    date_to: date,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Income, costs and profit per cost center for a period."""
    if user_branches is not None and (not branch_code or branch_code not in user_branches):
        raise HTTPException(status_code=403, detail="Choose one of your branches")
    return CostCenterService(db).profit_by_cost_center(date_from, date_to, branch_code)


# =============================================================================
# FIXED ASSETS
# =============================================================================

_GL_VIEW = [Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))]
_SETUP = [Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))]
_JE_CREATE = [Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))]
_PERIOD_UPDATE = [Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))]


@router.get("/asset-classes", response_model=List[schemas.AssetClassResponse], dependencies=_GL_VIEW)
def list_asset_classes(db: Session = Depends(get_db)):
    return FixedAssetService(db).list_classes()


@router.post("/asset-classes", response_model=schemas.AssetClassResponse, status_code=status.HTTP_201_CREATED, dependencies=_SETUP)
def create_asset_class(data: schemas.AssetClassCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return FixedAssetService(db).create_class(data, user_id=current_user.id)


@router.put("/asset-classes/{class_id}", response_model=schemas.AssetClassResponse, dependencies=_SETUP)
def update_asset_class(class_id: int, data: schemas.AssetClassUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return FixedAssetService(db).update_class(class_id, data, user_id=current_user.id)


@router.get("/fixed-assets", response_model=List[schemas.FixedAssetResponse], dependencies=_GL_VIEW)
def list_fixed_assets(
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    svc = FixedAssetService(db)
    return [svc.response(a) for a in svc.list_assets(status_filter, user_branches)]


@router.post("/fixed-assets", response_model=schemas.FixedAssetResponse, status_code=status.HTTP_201_CREATED, dependencies=_JE_CREATE)
def register_fixed_asset(
    data: schemas.FixedAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Add an asset to the register; optionally book its purchase."""
    if user_branches is not None and data.branch_code not in user_branches:
        raise HTTPException(status_code=403, detail="Choose one of your branches")
    svc = FixedAssetService(db)
    return svc.response(svc.register(data, user_id=current_user.id))


@router.post("/fixed-assets/{asset_id}/dispose", response_model=schemas.FixedAssetResponse, dependencies=_JE_CREATE)
def dispose_fixed_asset(
    asset_id: int,
    data: schemas.FixedAssetDispose,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Sell or scrap an asset; the gain or loss is posted."""
    svc = FixedAssetService(db)
    return svc.response(svc.dispose(asset_id, data, user_id=current_user.id, allowed_branches=user_branches))


@router.get("/depreciation-runs", response_model=List[schemas.DepreciationRunResponse], dependencies=_GL_VIEW)
def list_depreciation_runs(db: Session = Depends(get_db)):
    return [
        schemas.DepreciationRunResponse(id=r.id, period_year=r.period_year, period_month=r.period_month,
                                        run_date=r.run_date, total=r.total, status=r.status, asset_count=len(r.lines))
        for r in FixedAssetService(db).list_runs()
    ]


@router.get("/depreciation-runs/preview", response_model=List[schemas.DepreciationPreviewLine], dependencies=_GL_VIEW)
def preview_depreciation(year: int, month: int, db: Session = Depends(get_db)):
    """What a run for this month would post, per asset."""
    return FixedAssetService(db).preview(year, month)


@router.post("/depreciation-runs", response_model=schemas.DepreciationRunResponse, status_code=status.HTTP_201_CREATED, dependencies=_PERIOD_UPDATE)
def run_depreciation(data: schemas.DepreciationRunCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    r = FixedAssetService(db).run(data.period_year, data.period_month, user_id=current_user.id)
    return schemas.DepreciationRunResponse(id=r.id, period_year=r.period_year, period_month=r.period_month,
                                           run_date=r.run_date, total=r.total, status=r.status, asset_count=len(r.lines))


@router.post("/depreciation-runs/{run_id}/reverse", response_model=schemas.DepreciationRunResponse, dependencies=_PERIOD_UPDATE)
def reverse_depreciation_run(run_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    r = FixedAssetService(db).reverse_run(run_id, user_id=current_user.id)
    return schemas.DepreciationRunResponse(id=r.id, period_year=r.period_year, period_month=r.period_month,
                                           run_date=r.run_date, total=r.total, status=r.status, asset_count=len(r.lines))


# =============================================================================
# RECURRING JOURNALS & OPENING BALANCES
# =============================================================================

@router.get("/recurring-journals", response_model=List[schemas.RecurringJournalResponse], dependencies=[Depends(require_permission(*Permissions.JOURNAL_ENTRY_VIEW))])
def list_recurring_journals(db: Session = Depends(get_db)):
    return RecurringJournalService(db).list_templates()


@router.post("/recurring-journals", response_model=schemas.RecurringJournalResponse, status_code=status.HTTP_201_CREATED, dependencies=_JE_CREATE)
def create_recurring_journal(data: schemas.RecurringJournalCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    _check_branch(db, current_user, data.branch_code)
    return RecurringJournalService(db).create(data, user_id=current_user.id)


@router.post("/recurring-journals/create-due", response_model=List[str], dependencies=_JE_CREATE)
def create_due_recurring_journals(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Draft journals for every recurring journal due up to today (they still need approval).
    A branch-limited user only runs their branches' (and company-wide) templates."""
    return RecurringJournalService(db).create_due(user_id=current_user.id, branch_codes=user_branches)


@router.put("/recurring-journals/{template_id}", response_model=schemas.RecurringJournalResponse, dependencies=_JE_CREATE)
def update_recurring_journal(template_id: int, data: schemas.RecurringJournalUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    from .accounting_models import RecurringJournal
    current = db.query(RecurringJournal.branch_code).filter(RecurringJournal.id == template_id).scalar()
    if current and not validate_branch_access(current_user, current):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring journal not found")
    return RecurringJournalService(db).update(template_id, data, user_id=current_user.id)


@router.post("/opening-balances", status_code=status.HTTP_201_CREATED, dependencies=_JE_CREATE)
def create_opening_balances(data: schemas.OpeningBalanceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """One "Opening" journal (draft, to approve and post) from a list of account balances."""
    _check_branch(db, current_user, data.branch_code)
    je = OpeningBalanceService(db).create(data, user_id=current_user.id)
    return _serialize_je(JournalEntryService(db).get_journal_entry(je.id))


# =============================================================================
# BANK ACCOUNTS & RECONCILIATION
# =============================================================================

_BANK_VIEW = [Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))]
_BANK_SETUP = [Depends(require_permission(*Permissions.CHART_OF_ACCOUNTS_UPDATE))]
_BANK_WORK = [Depends(require_permission(*Permissions.JOURNAL_ENTRY_CREATE))]


@router.get("/bank-accounts", response_model=List[schemas.BankAccountResponse], dependencies=_BANK_VIEW)
def list_bank_accounts(db: Session = Depends(get_db)):
    return BankReconciliationService(db).list_accounts()


@router.post("/bank-accounts", response_model=schemas.BankAccountResponse, status_code=status.HTTP_201_CREATED, dependencies=_BANK_SETUP)
def create_bank_account(data: schemas.BankAccountCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Add a bank account. Without account_id a new GL account is created under 1000 Cash & Bank."""
    return BankReconciliationService(db).create_account(data, user_id=current_user.id)


@router.put("/bank-accounts/{account_id}", response_model=schemas.BankAccountResponse, dependencies=_BANK_SETUP)
def update_bank_account(account_id: int, data: schemas.BankAccountUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return BankReconciliationService(db).update_account(account_id, data, user_id=current_user.id)


@router.get("/bank-accounts/{account_id}/statements", response_model=List[schemas.BankStatementListItem], dependencies=_BANK_VIEW)
def list_bank_statements(account_id: int, db: Session = Depends(get_db)):
    return BankReconciliationService(db).list_statements(account_id)


@router.post("/bank-statements", response_model=schemas.BankStatementDetail, status_code=status.HTTP_201_CREATED, dependencies=_BANK_WORK)
def create_bank_statement(data: schemas.BankStatementCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Add a statement with its lines; unambiguous lines are matched automatically."""
    return BankReconciliationService(db).create_statement(data, user_id=current_user.id)


@router.get("/bank-statements/{statement_id}", response_model=schemas.BankStatementDetail, dependencies=_BANK_VIEW)
def get_bank_statement(statement_id: int, db: Session = Depends(get_db)):
    return BankReconciliationService(db).statement_detail(statement_id)


@router.delete("/bank-statements/{statement_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=_BANK_WORK)
def delete_bank_statement(statement_id: int, db: Session = Depends(get_db)):
    BankReconciliationService(db).delete_statement(statement_id)


@router.post("/bank-statements/{statement_id}/auto-match", response_model=schemas.BankStatementDetail, dependencies=_BANK_WORK)
def auto_match_bank_statement(statement_id: int, db: Session = Depends(get_db)):
    return BankReconciliationService(db).auto_match(statement_id)


@router.post("/bank-statement-lines/{line_id}/match", response_model=schemas.BankStatementDetail, dependencies=_BANK_WORK)
def match_bank_line(line_id: int, data: schemas.BankLineMatch, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return BankReconciliationService(db).match(line_id, data.gl_ids, user_id=current_user.id)


@router.post("/bank-statement-lines/{line_id}/unmatch", response_model=schemas.BankStatementDetail, dependencies=_BANK_WORK)
def unmatch_bank_line(line_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return BankReconciliationService(db).unmatch(line_id, user_id=current_user.id)


@router.post("/bank-statement-lines/{line_id}/create-entry", response_model=schemas.BankStatementDetail, dependencies=_BANK_WORK)
def create_entry_from_bank_line(line_id: int, data: schemas.BankLineEntryCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Book a charge / interest / direct debit that is only on the statement, and match the line to it."""
    return BankReconciliationService(db).create_entry(line_id, data, user_id=current_user.id)


@router.post("/bank-statements/{statement_id}/finish", response_model=schemas.BankStatementDetail, dependencies=_BANK_WORK)
def finish_bank_statement(statement_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    return BankReconciliationService(db).finish(statement_id, user_id=current_user.id)


@router.post("/bank-statements/{statement_id}/reopen", response_model=schemas.BankStatementDetail, dependencies=_BANK_SETUP)
def reopen_bank_statement(statement_id: int, db: Session = Depends(get_db)):
    return BankReconciliationService(db).reopen(statement_id)


# =============================================================================
# CASH FLOW STATEMENTS
# =============================================================================

@router.post("/cash-flow/statements/generate", response_model=schemas.CashFlowStatementResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def generate_cash_flow_statement(
    data: schemas.CashFlowStatementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Generate a cash flow statement for a fiscal period."""
    statement = CashFlowService(db).generate_statement(data, prepared_by=current_user.id)
    return _serialize_cfs(statement)


@router.get("/cash-flow/statements", response_model=List[schemas.CashFlowStatementResponse], dependencies=[Depends(require_permission(*Permissions.CASH_FLOW_VIEW))])
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


@router.get("/cash-flow/statements/{statement_id}", response_model=schemas.CashFlowStatementResponse, dependencies=[Depends(require_permission(*Permissions.CASH_FLOW_VIEW))])
def get_cash_flow_statement(statement_id: int, db: Session = Depends(get_db)):
    """Get a specific cash flow statement with lines."""
    statement = CashFlowService(db).get_statement(statement_id)
    return _serialize_cfs(statement)


@router.post("/cash-flow/statements/{statement_id}/finalize", response_model=schemas.CashFlowStatementResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def finalize_cash_flow_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Finalize a draft cash flow statement."""
    return CashFlowService(db).finalize_statement(statement_id, finalized_by=current_user.id)


@router.post("/cash-flow/statements/{statement_id}/approve", response_model=schemas.CashFlowStatementResponse, dependencies=[Depends(require_permission(*Permissions.PAYMENT_APPROVAL_APPROVE))])
def approve_cash_flow_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Approve a finalized cash flow statement."""
    return CashFlowService(db).approve_statement(statement_id, approved_by=current_user.id)


@router.delete("/cash-flow/statements/{statement_id}", dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def delete_cash_flow_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Delete a draft cash flow statement."""
    CashFlowService(db).delete_statement(statement_id, deleted_by=current_user.id)
    return {"message": "Statement deleted successfully"}


@router.post("/cash-flow/statements/{statement_id}/regenerate", response_model=schemas.CashFlowStatementResponse, dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def regenerate_cash_flow_statement(
    statement_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Regenerate a draft cash flow statement with fresh GL data."""
    statement = CashFlowService(db).regenerate_statement(statement_id, prepared_by=current_user.id)
    return _serialize_cfs(statement)


# =============================================================================
# CASH FLOW MANUAL LINES
# =============================================================================

@router.post(
    "/cash-flow/statements/{statement_id}/lines",
    response_model=schemas.CashFlowStatementLineResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))],
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
    dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))],
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


@router.delete("/cash-flow/statements/{statement_id}/lines/{line_id}", dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))])
def delete_cash_flow_manual_line(
    statement_id: int, line_id: int, db: Session = Depends(get_db)
):
    """Delete a manual line from a draft cash flow statement."""
    CashFlowService(db).delete_manual_line(statement_id, line_id)
    return {"message": "Manual line deleted successfully"}


@router.post(
    "/cash-flow/statements/{statement_id}/recalculate",
    response_model=schemas.CashFlowStatementResponse,
    dependencies=[Depends(require_permission(*Permissions.ACCOUNTING_PERIOD_UPDATE))],
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
    dependencies=[Depends(require_permission(*Permissions.CASH_FLOW_VIEW))],
)
def get_cash_flow_report(statement_id: int, db: Session = Depends(get_db)):
    """Get a formatted cash flow statement report with sections and cash composition."""
    return CashFlowService(db).generate_report(statement_id)


@router.get(
    "/cash-flow/statements/{statement_id}/reconcile",
    response_model=schemas.CashFlowReconciliationResponse,
    dependencies=[Depends(require_permission(*Permissions.CASH_FLOW_VIEW))],
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


# =============================================================================
# CSV EXPORT ENDPOINTS
# =============================================================================

@router.get("/general-ledger/export-csv", summary="Export General Ledger to CSV", dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def export_general_ledger_csv(
    fiscal_year: Optional[int] = None,
    account_id: Optional[int] = None,
    branch_code: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export general ledger entries to CSV."""
    if branch_code and user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {branch_code}")
    items, _total = GeneralLedgerService(db).list_gl_entries(schemas.GLListFilter(
        fiscal_year=fiscal_year,
        account_id=account_id,
        branch_code=branch_code,
        branch_codes=user_branches if not branch_code else None,
        skip=0, limit=100000,
    ))
    return build_csv_response(
        filename="general_ledger",
        headers=["ID", "Transaction Date", "Posting Date", "Account Code", "Account Name", "Description", "Debit", "Credit", "Reference No", "Fiscal Year", "Period"],
        rows=[
            [e["id"], e["transaction_date"], e["posting_date"], e["account_code"], e["account_name"], e["description"], e["debit_amount"], e["credit_amount"], e["reference_no"], e["fiscal_year"], e["fiscal_period"]]
            for e in items
        ],
    )


@router.get("/trial-balance/export-csv", summary="Export Trial Balance to CSV", dependencies=[Depends(require_permission(*Permissions.GENERAL_LEDGER_VIEW))])
def export_trial_balance_csv(
    fiscal_year: Optional[int] = None,
    fiscal_period: Optional[int] = None,
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export trial balance to CSV."""
    branch_code, branch_codes = _report_branch_scope(branch_code, user_branches)
    tb = GeneralLedgerService(db).get_trial_balance(
        fiscal_year=fiscal_year or date.today().year,
        fiscal_period=fiscal_period,
        branch_code=branch_code,
        branch_codes=branch_codes,
    )
    return build_csv_response(
        filename="trial_balance",
        headers=["Account Code", "Account Name", "Account Type", "Total Debit", "Total Credit", "Net Balance"],
        rows=[
            [a.account_code, a.account_name, a.account_type, a.total_debit, a.total_credit, a.net_balance]
            for a in tb.accounts
        ],
    )
