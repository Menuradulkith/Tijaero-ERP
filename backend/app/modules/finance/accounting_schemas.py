"""
General Ledger & Accounting Schemas

Pydantic v2 schemas for:
- Chart of Accounts (COA)
- Journal Entries & Lines
- General Ledger
- Accounting Periods
- Cash Flow Statements
"""

from pydantic import BaseModel, Field, field_validator
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema


# =============================================================================
# CHART OF ACCOUNTS
# =============================================================================

class ChartOfAccountBase(BaseModel):
    account_code: str
    account_name: str
    account_type: str  # Asset, Liability, Equity, Revenue, Expense
    account_category: Optional[str] = None
    parent_account_id: Optional[int] = None
    is_active: bool = True
    is_system_account: bool = False
    normal_balance: str  # Debit or Credit
    description: Optional[str] = None


class ChartOfAccountCreate(ChartOfAccountBase):
    pass


class ChartOfAccountUpdate(BaseModel):
    account_name: Optional[str] = None
    account_category: Optional[str] = None
    parent_account_id: Optional[int] = None
    is_active: Optional[bool] = None
    normal_balance: Optional[str] = None
    description: Optional[str] = None


class ChartOfAccountResponse(ChartOfAccountBase, TijaeroBaseSchema):
    id: int
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Resolved fields
    parent_account_name: Optional[str] = None


class ChartOfAccountTree(ChartOfAccountResponse):
    """COA with nested children for tree view."""
    children: List["ChartOfAccountTree"] = []


class COAListFilter(BaseModel):
    account_type: Optional[str] = None
    account_category: Optional[str] = None
    is_active: Optional[bool] = None
    search: Optional[str] = None
    parent_account_id: Optional[int] = None


# =============================================================================
# JOURNAL ENTRIES
# =============================================================================

class JournalEntryLineCreate(BaseModel):
    line_number: int
    account_id: int
    debit_amount: Decimal = Decimal("0")
    credit_amount: Decimal = Decimal("0")
    description: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    reference_no: Optional[str] = None


class JournalEntryLineResponse(JournalEntryLineCreate, TijaeroBaseSchema):
    id: int
    journal_entry_id: int
    created_at: Optional[datetime] = None
    # Resolved
    account_code: Optional[str] = None
    account_name: Optional[str] = None


class JournalEntryCreate(BaseModel):
    entry_date: date
    posting_date: Optional[date] = None
    entry_type: str = "Manual"  # Manual, Auto, Adjustment, Closing
    description: str
    branch_code: Optional[str] = None
    lines: List[JournalEntryLineCreate]

    @field_validator("lines")
    @classmethod
    def validate_lines(cls, v: List[JournalEntryLineCreate]) -> List[JournalEntryLineCreate]:
        if len(v) < 2:
            raise ValueError("Journal entry must have at least 2 lines")
        total_debit = sum(line.debit_amount for line in v)
        total_credit = sum(line.credit_amount for line in v)
        if total_debit != total_credit:
            raise ValueError(f"Total debits ({total_debit}) must equal total credits ({total_credit})")
        if total_debit == 0:
            raise ValueError("Journal entry total cannot be zero")
        return v


class JournalEntryUpdate(BaseModel):
    entry_date: Optional[date] = None
    description: Optional[str] = None
    branch_code: Optional[str] = None
    lines: Optional[List[JournalEntryLineCreate]] = None

    @field_validator("lines")
    @classmethod
    def validate_lines(cls, v: Optional[List[JournalEntryLineCreate]]) -> Optional[List[JournalEntryLineCreate]]:
        if v is None:
            return v
        if len(v) < 2:
            raise ValueError("Journal entry must have at least 2 lines")
        total_debit = sum(line.debit_amount for line in v)
        total_credit = sum(line.credit_amount for line in v)
        if total_debit != total_credit:
            raise ValueError(f"Total debits ({total_debit}) must equal total credits ({total_credit})")
        return v


class JournalEntryResponse(TijaeroBaseSchema):
    id: int
    journal_entry_no: str
    entry_date: date
    posting_date: date
    entry_type: str
    description: str
    total_debit: Decimal
    total_credit: Decimal
    status: str
    is_reversed: bool = False
    reversed_by_je_id: Optional[int] = None
    fiscal_year: int
    fiscal_period: int
    branch_code: Optional[str] = None
    created_by: int
    submitted_by: Optional[int] = None
    submitted_at: Optional[datetime] = None
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    posted_by: Optional[int] = None
    posted_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Resolved
    lines: List[JournalEntryLineResponse] = []
    created_by_name: Optional[str] = None
    submitted_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    posted_by_name: Optional[str] = None


class JournalEntryListFilter(BaseModel):
    status: Optional[str] = None
    entry_type: Optional[str] = None
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # user-scoped branch list
    fiscal_year: Optional[int] = None
    fiscal_period: Optional[int] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    search: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    skip: int = 0
    limit: int = 100


class PostJournalEntryRequest(BaseModel):
    posting_date: Optional[date] = None


class ReverseJournalEntryRequest(BaseModel):
    reason: str
    reversal_date: Optional[date] = None


class SubmitJournalEntryRequest(BaseModel):
    """Submit a draft manual JE for approval."""
    remarks: Optional[str] = None


class ApproveJournalEntryRequest(BaseModel):
    """Approve a submitted manual JE."""
    remarks: Optional[str] = None


class RejectJournalEntryRequest(BaseModel):
    """Reject a submitted manual JE back to draft."""
    reason: str


class ValidateJournalEntryResponse(BaseModel):
    """Result of validating a journal entry."""
    is_valid: bool
    errors: List[str] = []
    warnings: List[str] = []
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    line_count: int = 0


# =============================================================================
# GENERAL LEDGER
# =============================================================================

class GeneralLedgerResponse(TijaeroBaseSchema):
    id: int
    transaction_date: date
    posting_date: date
    account_id: int
    debit_amount: Decimal = Decimal("0")
    credit_amount: Decimal = Decimal("0")
    balance: Optional[Decimal] = None
    transaction_type: str
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    reference_no: Optional[str] = None
    journal_entry_id: Optional[int] = None
    description: Optional[str] = None
    branch_code: Optional[str] = None
    fiscal_year: int
    fiscal_period: int
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    # Resolved
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    account_type: Optional[str] = None


class GLListFilter(BaseModel):
    account_id: Optional[int] = None
    account_code: Optional[str] = None
    account_type: Optional[str] = None
    transaction_type: Optional[str] = None
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # user-scoped branch list
    fiscal_year: Optional[int] = None
    fiscal_period: Optional[int] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    reference_type: Optional[str] = None
    reference_no: Optional[str] = None
    search: Optional[str] = None
    skip: int = 0
    limit: int = 500


class GLAccountSummary(BaseModel):
    """Summary of GL entries for a single account."""
    account_id: int
    account_code: str
    account_name: str
    account_type: str
    normal_balance: str
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    net_balance: Decimal = Decimal("0")


class TrialBalanceResponse(BaseModel):
    """Trial balance report."""
    as_of_date: date
    fiscal_year: int
    fiscal_period: Optional[int] = None
    accounts: List[GLAccountSummary] = []
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")


# =============================================================================
# ACCOUNTING PERIODS
# =============================================================================

class AccountingPeriodCreate(BaseModel):
    fiscal_year: int
    period_number: int
    period_name: str
    start_date: date
    end_date: date


class AccountingPeriodResponse(TijaeroBaseSchema):
    id: int
    fiscal_year: int
    period_number: int
    period_name: str
    start_date: date
    end_date: date
    status: str
    closed_by: Optional[int] = None
    closed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


class AccountingPeriodListFilter(BaseModel):
    fiscal_year: Optional[int] = None
    status: Optional[str] = None


class GeneratePeriodsRequest(BaseModel):
    fiscal_year: int
    start_month: int = 1  # 1=January


class ClosePeriodRequest(BaseModel):
    reason: Optional[str] = None


# =============================================================================
# CASH FLOW
# =============================================================================

class CashFlowCategoryCreate(BaseModel):
    category_code: str
    category_name: str
    section: str  # Operating, Investing, Financing
    line_item: str
    display_order: int
    is_inflow: bool
    account_mapping: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True


class CashFlowCategoryUpdate(BaseModel):
    category_name: Optional[str] = None
    section: Optional[str] = None
    line_item: Optional[str] = None
    display_order: Optional[int] = None
    is_inflow: Optional[bool] = None
    account_mapping: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None


class CashFlowCategoryResponse(TijaeroBaseSchema):
    id: int
    category_code: str
    category_name: str
    section: str
    line_item: str
    display_order: int
    is_inflow: bool
    account_mapping: Optional[str] = None
    description: Optional[str] = None
    is_active: bool = True
    created_at: Optional[datetime] = None


class CashFlowStatementLineCreate(BaseModel):
    category_id: int
    line_number: int
    line_description: str
    amount: Decimal
    is_calculated: bool = False
    calculation_source: Optional[str] = None
    reference_accounts: Optional[str] = None
    notes: Optional[str] = None


class CashFlowStatementLineResponse(CashFlowStatementLineCreate, TijaeroBaseSchema):
    id: int
    cash_flow_statement_id: int
    created_at: Optional[datetime] = None
    # Resolved
    category_code: Optional[str] = None
    category_name: Optional[str] = None
    section: Optional[str] = None


class CashFlowStatementCreate(BaseModel):
    fiscal_year: int
    fiscal_period: int
    method: str = "indirect"
    notes: Optional[str] = None


class CashFlowStatementResponse(TijaeroBaseSchema):
    id: int
    statement_no: str
    fiscal_year: int
    fiscal_period: int
    period_start_date: date
    period_end_date: date
    opening_cash_balance: Decimal
    closing_cash_balance: Decimal
    net_cash_from_operating: Optional[Decimal] = None
    net_cash_from_investing: Optional[Decimal] = None
    net_cash_from_financing: Optional[Decimal] = None
    net_change_in_cash: Optional[Decimal] = None
    status: str
    method: str
    notes: Optional[str] = None
    prepared_by: Optional[int] = None
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    lines: List[CashFlowStatementLineResponse] = []


class CashFlowStatementListFilter(BaseModel):
    fiscal_year: Optional[int] = None
    fiscal_period: Optional[int] = None
    status: Optional[str] = None


class ApproveCashFlowRequest(BaseModel):
    notes: Optional[str] = None


class CashFlowManualLineCreate(BaseModel):
    """Create a manual (non-calculated) line on a cash flow statement."""
    category_id: int
    line_description: str
    amount: Decimal
    notes: Optional[str] = None


class CashFlowManualLineUpdate(BaseModel):
    """Update a manual line on a cash flow statement."""
    line_description: Optional[str] = None
    amount: Optional[Decimal] = None
    notes: Optional[str] = None


class CashFlowReconciliationItem(BaseModel):
    """One cash account and its GL balance vs statement balance."""
    account_id: int
    account_code: str
    account_name: str
    gl_balance: Decimal = Decimal("0")


class CashFlowReconciliationResponse(BaseModel):
    """Reconciliation of cash flow statement with GL cash balances."""
    statement_id: int
    statement_no: str
    fiscal_year: int
    fiscal_period: int
    opening_cash_balance: Decimal = Decimal("0")
    closing_cash_balance: Decimal = Decimal("0")
    net_change_in_cash: Decimal = Decimal("0")
    calculated_closing: Decimal = Decimal("0")  # opening + net_change
    gl_cash_balance: Decimal = Decimal("0")
    cash_accounts: List[CashFlowReconciliationItem] = []
    statement_vs_calculated_diff: Decimal = Decimal("0")
    statement_vs_gl_diff: Decimal = Decimal("0")
    is_reconciled: bool = False
    warnings: List[str] = []


class CashFlowReportSection(BaseModel):
    """A section (Operating, Investing, Financing) in the formatted report."""
    section_name: str
    lines: List[dict] = []
    subtotal: Decimal = Decimal("0")


class CashFlowReportResponse(BaseModel):
    """Formatted cash flow statement report output."""
    statement_no: str
    fiscal_year: int
    fiscal_period: int
    period_start_date: date
    period_end_date: date
    method: str
    status: str
    # Cash flow sections
    operating_activities: CashFlowReportSection
    investing_activities: CashFlowReportSection
    financing_activities: CashFlowReportSection
    # Totals
    net_increase_in_cash: Decimal = Decimal("0")
    opening_cash_balance: Decimal = Decimal("0")
    closing_cash_balance: Decimal = Decimal("0")
    # Cash composition
    cash_accounts_breakdown: List[CashFlowReconciliationItem] = []
    # Supplemental
    supplemental_notes: Optional[str] = None
    prepared_by: Optional[int] = None
    approved_by: Optional[int] = None
    approved_at: Optional[datetime] = None
    generated_at: Optional[datetime] = None


class CashFlowSeedResponse(BaseModel):
    """Response from seeding standard cash flow categories."""
    created: int = 0
    skipped: int = 0
    categories: List[CashFlowCategoryResponse] = []
    message: str = ""


# =============================================================================
# FINANCIAL REPORTS (Scenario 34)
# =============================================================================

class IncomeStatementLineItem(BaseModel):
    """Single line on an income statement (one account)."""
    account_id: int
    account_code: str
    account_name: str
    amount: Decimal = Decimal("0")


class IncomeStatementSection(BaseModel):
    """A section grouping (e.g. Revenue, Cost of Sales, Operating Expenses)."""
    section_name: str
    items: List[IncomeStatementLineItem] = []
    total: Decimal = Decimal("0")


class IncomeStatementResponse(BaseModel):
    """Profit & Loss / Income Statement report."""
    fiscal_year: int
    fiscal_period: Optional[int] = None
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    revenue: IncomeStatementSection
    cost_of_sales: IncomeStatementSection
    gross_profit: Decimal = Decimal("0")
    operating_expenses: IncomeStatementSection
    operating_income: Decimal = Decimal("0")
    other_income: IncomeStatementSection
    other_expenses: IncomeStatementSection
    net_income: Decimal = Decimal("0")
    generated_at: Optional[datetime] = None


class BalanceSheetSection(BaseModel):
    """A section grouping on the balance sheet."""
    section_name: str
    items: List[IncomeStatementLineItem] = []
    total: Decimal = Decimal("0")


class BalanceSheetResponse(BaseModel):
    """Balance Sheet / Statement of Financial Position."""
    as_of_date: date
    fiscal_year: int
    # Assets
    current_assets: BalanceSheetSection
    non_current_assets: BalanceSheetSection
    total_assets: Decimal = Decimal("0")
    # Liabilities
    current_liabilities: BalanceSheetSection
    non_current_liabilities: BalanceSheetSection
    total_liabilities: Decimal = Decimal("0")
    # Equity
    equity: BalanceSheetSection
    total_equity: Decimal = Decimal("0")
    # Verification
    total_liabilities_and_equity: Decimal = Decimal("0")
    is_balanced: bool = True
    generated_at: Optional[datetime] = None


class ReconciliationCheckResponse(BaseModel):
    """Pre-close reconciliation check results."""
    fiscal_year: int
    fiscal_period: int
    is_ready_to_close: bool = False
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")
    is_balanced: bool = True
    unposted_je_count: int = 0
    unposted_je_ids: List[int] = []
    warnings: List[str] = []
    errors: List[str] = []


class YearEndCloseRequest(BaseModel):
    """Request to create year-end closing entries."""
    fiscal_year: int
    closing_date: Optional[date] = None  # Defaults to Dec 31 of fiscal_year


class YearEndCloseResponse(BaseModel):
    """Result of year-end closing process."""
    fiscal_year: int
    closing_date: date
    revenue_close_je_id: Optional[int] = None
    expense_close_je_id: Optional[int] = None
    net_income: Decimal = Decimal("0")
    retained_earnings_je_id: Optional[int] = None
    message: str = ""
    warnings: List[str] = []


# =============================================================================
# AUDIT TRAIL & CORRECTION (Scenario 35)
# =============================================================================

class AuditTrailEntry(BaseModel):
    """Single audit trail record."""
    id: int
    entry_type: str  # "JE" or "GL"
    entry_no: Optional[str] = None
    entry_date: date
    posting_date: Optional[date] = None
    description: Optional[str] = None
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    debit_amount: Decimal = Decimal("0")
    credit_amount: Decimal = Decimal("0")
    status: Optional[str] = None
    transaction_type: Optional[str] = None
    reference_type: Optional[str] = None
    reference_no: Optional[str] = None
    is_reversed: bool = False
    reversed_by_je_id: Optional[int] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    posted_by: Optional[int] = None
    posted_at: Optional[datetime] = None


class AuditTrailFilter(BaseModel):
    """Filters for audit trail query."""
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    account_id: Optional[int] = None
    account_code: Optional[str] = None
    entry_type: Optional[str] = None  # "JE", "GL", or None for both
    transaction_type: Optional[str] = None
    created_by: Optional[int] = None
    include_reversed: bool = True
    search: Optional[str] = None
    skip: int = 0
    limit: int = 200


class AuditTrailResponse(BaseModel):
    """Paginated audit trail results."""
    items: List[AuditTrailEntry] = []
    total: int = 0
    date_from: Optional[date] = None
    date_to: Optional[date] = None


class CorrectionRequest(BaseModel):
    """
    Request to correct a posted JE: reverses the original and creates a new correct entry.
    """
    reason: str
    correction_date: Optional[date] = None
    corrected_lines: List[JournalEntryLineCreate]
    description: Optional[str] = None

    @field_validator("corrected_lines")
    @classmethod
    def validate_correction_lines(cls, v: List[JournalEntryLineCreate]) -> List[JournalEntryLineCreate]:
        if len(v) < 2:
            raise ValueError("Corrected journal entry must have at least 2 lines")
        total_debit = sum(line.debit_amount for line in v)
        total_credit = sum(line.credit_amount for line in v)
        if total_debit != total_credit:
            raise ValueError(f"Total debits ({total_debit}) must equal total credits ({total_credit})")
        if total_debit == 0:
            raise ValueError("Corrected journal entry total cannot be zero")
        return v


class CorrectionResponse(BaseModel):
    """Result of a correction operation."""
    original_je_id: int
    original_je_no: str
    reversal_je_id: int
    reversal_je_no: str
    correction_je_id: int
    correction_je_no: str
    message: str = ""


# =============================================================================
# DASHBOARD / SUMMARY
# =============================================================================

class AccountingDashboardStats(BaseModel):
    total_accounts: int = 0
    active_accounts: int = 0
    total_journal_entries: int = 0
    draft_journal_entries: int = 0
    posted_journal_entries: int = 0
    total_gl_entries: int = 0
    open_periods: int = 0
    closed_periods: int = 0
    current_fiscal_year: int = 0
    current_fiscal_period: int = 0
    total_debit: Decimal = Decimal("0")
    total_credit: Decimal = Decimal("0")


# =============================================================================
# GL POSTING FAILURES (Transactional Outbox)
# =============================================================================

class GLPostingFailureResponse(TijaeroBaseSchema):
    id: int
    reference_type: str
    reference_id: int
    reference_no: Optional[str] = None
    source_module: str
    transaction_type: Optional[str] = None
    posting_marker: Optional[str] = None
    entry_date: Optional[date] = None
    branch_code: Optional[str] = None
    description: Optional[str] = None
    error_code: str
    error_message: str
    status: str
    attempts: int = 1
    last_attempt_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    resolved_by: Optional[int] = None
    resolved_je_id: Optional[int] = None
    created_at: Optional[datetime] = None


class GLPostingFailureListResponse(BaseModel):
    items: List[GLPostingFailureResponse] = []
    total: int = 0
    pending_count: int = 0


class RetryPostingFailureResponse(BaseModel):
    failure_id: int
    status: str  # resolved | failed
    journal_entry_no: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None


# =============================================================================
# DAY-END RECONCILIATION ("Books Balanced")
# =============================================================================

class DayEndReconciliationResponse(BaseModel):
    """
    A single end-of-day assertion that the books balance for a date/branch.

    Combines three independent checks:
      1. Trial balance — total GL debits == total GL credits for the day.
      2. Cash reconciliation — GL movement on cash (1010) + bank (1020)
         reconciles with the cashbook's net movement. The identity used,
         which holds whether or not bank deposits are posted as internal
         1010↔1020 transfers, is::

             gl_cash_bank_net == cashbook_net + cashbook_bank_deposits

      3. Posting health — there are no pending GL posting failures and no
         unposted journal entries dated on the day.
    """
    reconciliation_date: date
    branch_code: Optional[str] = None

    # 1. Trial balance
    gl_total_debit: Decimal = Decimal("0")
    gl_total_credit: Decimal = Decimal("0")
    trial_balanced: bool = True

    # 2. Cash / bank reconciliation
    gl_cash_movement: Decimal = Decimal("0")
    gl_bank_movement: Decimal = Decimal("0")
    gl_cash_bank_net: Decimal = Decimal("0")
    cashbook_money_in: Decimal = Decimal("0")
    cashbook_money_out: Decimal = Decimal("0")
    cashbook_net: Decimal = Decimal("0")
    cashbook_bank_deposits: Decimal = Decimal("0")
    cash_reconciled: bool = True
    cash_difference: Decimal = Decimal("0")

    # 3. Posting health
    posting_failures_pending: int = 0
    unposted_je_count: int = 0
    submitted_je_count: int = 0

    # Overall
    is_balanced: bool = True
    discrepancies: List[str] = []
    warnings: List[str] = []
