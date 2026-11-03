"""
General Ledger & Accounting Schemas

Pydantic v2 schemas for:
- Chart of Accounts (COA)
- Journal Entries & Lines
- General Ledger
- Accounting Periods
- Cash Flow Statements
"""

from pydantic import BaseModel, Field, field_validator, model_validator
from datetime import date, datetime
from typing import List, Literal, Optional
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema
from app.core.money import MoneyIn, SignedMoneyIn
from typing import Annotated
from pydantic import StringConstraints

# A reason someone must give (reverse, reject, correct, bounce...): trimmed, not blank.
Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


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


ACCOUNT_TYPES = ("Asset", "Liability", "Equity", "Revenue", "Expense")


def _clean_text(value: Optional[str], label: str, max_len: int) -> Optional[str]:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError(f"{label} can't be blank")
    if len(value) > max_len:
        raise ValueError(f"{label} can be at most {max_len} characters")
    return value


def _account_type(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    for t in ACCOUNT_TYPES:
        if value.strip().lower() == t.lower():
            return t
    raise ValueError("Account type must be Asset, Liability, Equity, Revenue or Expense")


def _normal_balance(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    for t in ("Debit", "Credit"):
        if value.strip().lower() == t.lower():
            return t
    raise ValueError("Normal balance must be Debit or Credit")


class ChartOfAccountCreate(ChartOfAccountBase):
    # Same fields as the response, but checked: the response model stays lenient.
    @field_validator("account_code")
    @classmethod
    def _code(cls, v):
        return _clean_text(v, "Account code", 50)

    @field_validator("account_name")
    @classmethod
    def _name(cls, v):
        return _clean_text(v, "Account name", 255)

    @field_validator("account_type")
    @classmethod
    def _type(cls, v):
        return _account_type(v)

    @field_validator("normal_balance")
    @classmethod
    def _balance(cls, v):
        return _normal_balance(v)

    @field_validator("account_category", "description")
    @classmethod
    def _optional_text(cls, v, info):
        return (v.strip() or None) if isinstance(v, str) else v


class ChartOfAccountUpdate(BaseModel):
    account_name: Optional[str] = None
    account_category: Optional[str] = None
    parent_account_id: Optional[int] = None
    is_active: Optional[bool] = None
    normal_balance: Optional[str] = None
    description: Optional[str] = None

    @field_validator("account_name")
    @classmethod
    def _name(cls, v):
        return _clean_text(v, "Account name", 255)

    @field_validator("normal_balance")
    @classmethod
    def _balance(cls, v):
        return _normal_balance(v)


class ChartOfAccountResponse(ChartOfAccountBase, TijaeroBaseSchema):
    id: int
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Resolved fields
    parent_account_name: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


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
    # Rounded to cents per line before the entry's totals are compared, so
    # 0.005 + 0.005 vs 0.01 can't be stored as a "balanced" draft.
    debit_amount: MoneyIn = Decimal("0")
    credit_amount: MoneyIn = Decimal("0")
    description: Optional[str] = None
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    reference_no: Optional[str] = None
    cost_center_id: Optional[int] = None


class JournalEntryLineResponse(JournalEntryLineCreate, TijaeroBaseSchema):
    id: int
    journal_entry_id: int
    created_at: Optional[datetime] = None
    # Resolved
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    cost_center_code: Optional[str] = None


class JournalEntryCreate(BaseModel):
    entry_date: date
    posting_date: Optional[date] = None
    entry_type: str = "Manual"  # Manual, Auto, Adjustment, Closing, Opening
    description: str
    branch_code: Optional[str] = None
    auto_reverse_date: Optional[date] = None  # accrual: posting also posts its reversal on this date
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


# Public-API input variants. JournalEntryLineCreate / JournalEntryCreate stay
# lenient because internal integrations (year-end close, corrections) build
# them from ledger balances, which can be negative (contra accounts) or larger
# than a single user-entered amount. User input is capped: 0 <= x <= MAX_MONEY,
# no NaN/Infinity.
class JournalEntryLineInput(JournalEntryLineCreate):
    debit_amount: MoneyIn = Decimal("0")
    credit_amount: MoneyIn = Decimal("0")

    @model_validator(mode="after")
    def _one_sided(self):
        if self.debit_amount and self.credit_amount:
            raise ValueError(
                f"Line {self.line_number}: a line is either a debit or a credit, not both"
            )
        if not self.debit_amount and not self.credit_amount:
            raise ValueError(f"Line {self.line_number}: debit or credit amount is required")
        return self


class JournalEntryCreateInput(JournalEntryCreate):
    lines: List[JournalEntryLineInput]


class JournalEntryUpdateInput(JournalEntryUpdate):
    lines: Optional[List[JournalEntryLineInput]] = None


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
    voucher_type: Optional[str] = None
    auto_reverse_date: Optional[date] = None
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
    voucher_type: Optional[str] = None
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
    reason: Reason
    reversal_date: Optional[date] = None


class SubmitJournalEntryRequest(BaseModel):
    """Submit a draft manual JE for approval."""
    remarks: Optional[str] = None


class ApproveJournalEntryRequest(BaseModel):
    """Approve a submitted manual JE."""
    remarks: Optional[str] = None


class RejectJournalEntryRequest(BaseModel):
    """Reject a submitted manual JE back to draft."""
    reason: Reason


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
    fiscal_year: int = Field(ge=2000, le=2100)
    period_number: int = Field(ge=1, le=13)
    period_name: str = Field(min_length=1, max_length=100)
    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _dates_in_order(self):
        if self.end_date < self.start_date:
            raise ValueError("End date can't be before the start date")
        return self


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
    fiscal_year: int = Field(ge=2000, le=2100)
    start_month: int = Field(default=1, ge=1, le=12)  # 1=January


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
    fiscal_year: int = Field(ge=2000, le=2100)
    fiscal_period: int = Field(ge=1, le=12)
    method: Literal["direct", "indirect"] = "indirect"
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
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    lines: List[CashFlowStatementLineResponse] = []
    # Resolved fields
    prepared_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


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
    amount: SignedMoneyIn
    notes: Optional[str] = None


class CashFlowManualLineUpdate(BaseModel):
    """Update a manual line on a cash flow statement."""
    line_description: Optional[str] = None
    amount: Optional[SignedMoneyIn] = None
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
    fiscal_year: int = Field(ge=2000, le=2100)
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
    reason: Reason
    correction_date: Optional[date] = None
    corrected_lines: List[JournalEntryLineInput]
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


# =============================================================================
# POSTING RULES & VOUCHER TYPES
# =============================================================================

class AccountRef(BaseModel):
    id: Optional[int] = None
    account_code: str
    account_name: str


class PostingRuleDetailResponse(BaseModel):
    control_value: str
    account: Optional[AccountRef] = None


class PostingTypeRule(BaseModel):
    code: str
    name: str
    group: str
    description: str
    account_types: List[str]
    control_types: List[str]
    default_account: AccountRef
    is_customized: bool
    control_type: str
    account: Optional[AccountRef] = None
    details: List[PostingRuleDetailResponse] = []
    notes: Optional[str] = None
    updated_at: Optional[datetime] = None


class ControlTypeInfo(BaseModel):
    code: str
    name: str
    description: str


class ControlValueOption(BaseModel):
    value: str
    label: str
    default_account: Optional[AccountRef] = None


class PostingRuleSetup(BaseModel):
    posting_types: List[PostingTypeRule]
    control_types: List[ControlTypeInfo]
    branches: List[ControlValueOption]
    expense_categories: List[ControlValueOption]


class PostingRuleDetailInput(BaseModel):
    control_value: str = Field(..., max_length=100)
    account_id: int


class PostingRuleUpdate(BaseModel):
    control_type: str = "none"
    account_id: Optional[int] = None
    details: List[PostingRuleDetailInput] = []
    notes: Optional[str] = Field(None, max_length=1000)


class VoucherTypeResponse(BaseModel):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    source_module: Optional[str] = None
    is_manual: bool
    is_active: bool
    entry_count: int = 0



# =============================================================================
# TAX (VAT)
# =============================================================================

class TaxCodeResponse(BaseModel):
    id: int
    code: str
    name: str
    rate: Decimal
    tax_type: str
    applies_to: str
    is_default_sales: bool
    is_default_purchases: bool
    is_active: bool
    description: Optional[str] = None

    class Config:
        from_attributes = True


class TaxCodeCreate(BaseModel):
    code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=20)]
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
    rate: Decimal = Field(Decimal("0"), ge=0, le=100)
    tax_type: str = "standard"
    applies_to: str = "both"
    is_default_sales: Optional[bool] = None
    is_default_purchases: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=1000)


class TaxCodeUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    rate: Optional[Decimal] = Field(None, ge=0, le=100)
    tax_type: Optional[str] = None
    applies_to: Optional[str] = None
    is_default_sales: Optional[bool] = None
    is_default_purchases: Optional[bool] = None
    is_active: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=1000)


class VatReturnLine(BaseModel):
    direction: str
    tax_code: str
    tax_name: str
    tax_rate: Optional[Decimal] = None
    count: int
    base_amount: Decimal
    tax_amount: Decimal


class VatReturnResponse(BaseModel):
    date_from: date
    date_to: date
    branch_code: Optional[str] = None
    lines: List[VatReturnLine]
    output_tax: Decimal
    input_tax: Decimal
    net_tax: Decimal  # > 0 payable, < 0 refundable
    gl_output_tax: Decimal
    gl_input_tax: Decimal
    unsettled_output_tax: Decimal
    unsettled_input_tax: Decimal
    warnings: List[str] = []


class TaxTransactionResponse(BaseModel):
    id: int
    transaction_date: date
    direction: str
    tax_code: str
    tax_rate: Optional[Decimal] = None
    base_amount: Decimal
    tax_amount: Decimal
    reference_type: Optional[str] = None
    reference_id: Optional[int] = None
    reference_no: Optional[str] = None
    branch_code: Optional[str] = None
    journal_entry_id: int
    journal_entry_no: Optional[str] = None
    settlement_id: Optional[int] = None


class TaxTransactionList(BaseModel):
    total: int
    items: List[TaxTransactionResponse]


class VatSettlementCreate(BaseModel):
    date_to: date
    settlement_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=1000)


class VatSettlementResponse(BaseModel):
    id: int
    settlement_no: str
    date_to: date
    settlement_date: date
    output_tax: Decimal
    input_tax: Decimal
    net_tax: Decimal
    journal_entry_id: Optional[int] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# =============================================================================
# BANK ACCOUNTS & RECONCILIATION
# =============================================================================

class BankAccountCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=100)
    account_number: Optional[str] = Field(None, max_length=50)
    branch_code: Optional[str] = None
    account_id: Optional[int] = None  # existing GL account; omit to create one under 1000
    currency: Optional[str] = Field("LKR", max_length=10)
    reconcile_from: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=1000)


class BankAccountUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    bank_name: Optional[str] = Field(None, max_length=100)
    account_number: Optional[str] = Field(None, max_length=50)
    branch_code: Optional[str] = None
    reconcile_from: Optional[date] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = Field(None, max_length=1000)


class BankAccountResponse(BaseModel):
    id: int
    name: str
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    branch_code: Optional[str] = None
    account_id: int
    account_code: str
    account_name: str
    currency: str
    reconcile_from: date
    is_active: bool
    notes: Optional[str] = None
    book_balance: Decimal
    last_reconciled_to: Optional[date] = None
    open_statements: int = 0


class BankStatementLineInput(BaseModel):
    line_date: date
    description: Optional[str] = Field(None, max_length=1000)
    reference: Optional[str] = Field(None, max_length=200)
    amount: SignedMoneyIn


class BankStatementCreate(BaseModel):
    bank_account_id: int
    statement_no: Optional[str] = Field(None, max_length=100)
    date_from: date
    date_to: date
    opening_balance: SignedMoneyIn = Decimal("0")
    closing_balance: SignedMoneyIn = Decimal("0")
    notes: Optional[str] = Field(None, max_length=1000)
    lines: List[BankStatementLineInput] = Field(default_factory=list, max_length=5000)
    auto_match: bool = True


class BankStatementListItem(BaseModel):
    id: int
    bank_account_id: int
    statement_no: Optional[str] = None
    date_from: date
    date_to: date
    opening_balance: Decimal
    closing_balance: Decimal
    status: str
    reconciled_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class BankGLItem(BaseModel):
    gl_id: int
    transaction_date: date
    amount: Decimal
    description: Optional[str] = None
    reference_type: Optional[str] = None
    reference_no: Optional[str] = None
    journal_entry_id: Optional[int] = None
    journal_entry_no: Optional[str] = None


class BankStatementLineResponse(BaseModel):
    id: int
    line_date: date
    description: Optional[str] = None
    reference: Optional[str] = None
    amount: Decimal
    status: str  # unmatched, auto, manual, created
    matched: List[BankGLItem] = []


class BankReconciliationSummary(BaseModel):
    book_balance: Decimal
    outstanding_count: int
    outstanding_total: Decimal
    unmatched_lines_count: int
    unmatched_lines_total: Decimal
    cleared_after_period: Decimal = Decimal("0")
    bank_only_total: Decimal = Decimal("0")
    adjusted_book_balance: Decimal
    statement_closing_balance: Decimal
    difference: Decimal


class BankStatementDetail(BaseModel):
    id: int
    bank_account_id: int
    bank_account_name: str
    statement_no: Optional[str] = None
    date_from: date
    date_to: date
    opening_balance: Decimal
    closing_balance: Decimal
    status: str
    notes: Optional[str] = None
    lines: List[BankStatementLineResponse]
    candidates: List[BankGLItem]
    summary: BankReconciliationSummary
    warnings: List[str] = []


class BankLineMatch(BaseModel):
    gl_ids: List[int] = Field(..., min_length=1, max_length=200)


class BankLineEntryCreate(BaseModel):
    account_id: int
    description: Optional[str] = Field(None, max_length=500)


# =============================================================================
# CUSTOMER WRITE-OFFS
# =============================================================================

class WriteOffCreate(BaseModel):
    invoice_id: int
    amount: MoneyIn
    reason: str = Field(..., max_length=30)
    write_off_date: Optional[date] = None
    notes: Optional[str] = Field(None, max_length=1000)


class WriteOffReverse(BaseModel):
    reason: Reason


class WriteOffResponse(BaseModel):
    id: int
    write_off_no: str
    invoice_id: int
    invoice_no: Optional[str] = None
    customer_id: int
    customer_name: Optional[str] = None
    branch_code: Optional[str] = None
    write_off_date: date
    amount: Decimal
    reason: str
    reason_label: str
    notes: Optional[str] = None
    status: str
    journal_entry_id: Optional[int] = None


class WriteOffLimitResponse(BaseModel):
    group_id: int
    group_name: str
    max_amount: Decimal


class WriteOffLimitUpdate(BaseModel):
    max_amount: MoneyIn


class WriteOffSetup(BaseModel):
    reasons: List[dict]
    my_limit: Optional[Decimal] = None  # None = no limit


# =============================================================================
# CHEQUE REGISTER
# =============================================================================

class ChequeStatusChange(BaseModel):
    status_date: Optional[date] = None


class ChequeBounce(BaseModel):
    reason: Reason
    status_date: Optional[date] = None


# =============================================================================
# COST CENTERS
# =============================================================================

class CostCenterCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    branch_code: Optional[str] = None
    is_branch_default: bool = False
    description: Optional[str] = Field(None, max_length=1000)


class CostCenterUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    branch_code: Optional[str] = None
    is_branch_default: Optional[bool] = None
    is_active: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=1000)


class CostCenterResponse(BaseModel):
    id: int
    code: str
    name: str
    branch_code: Optional[str] = None
    is_branch_default: bool
    is_active: bool
    description: Optional[str] = None

    class Config:
        from_attributes = True


class CostCenterProfitLine(BaseModel):
    cost_center_id: Optional[int] = None
    code: Optional[str] = None
    name: str
    income: Decimal
    costs: Decimal
    profit: Decimal


class CostCenterProfitReport(BaseModel):
    date_from: date
    date_to: date
    branch_code: Optional[str] = None
    lines: List[CostCenterProfitLine]
    income: Decimal
    costs: Decimal
    profit: Decimal




# =============================================================================
# FIXED ASSETS
# =============================================================================

class AssetClassCreate(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=100)
    asset_account_id: int
    depreciation_method: str = "straight_line"
    useful_life_months: int = Field(60, ge=1, le=1200)
    declining_rate: Optional[Decimal] = Field(None, ge=0, le=100)
    description: Optional[str] = Field(None, max_length=1000)


class AssetClassUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=100)
    asset_account_id: Optional[int] = None
    depreciation_method: Optional[str] = None
    useful_life_months: Optional[int] = Field(None, ge=1, le=1200)
    declining_rate: Optional[Decimal] = Field(None, ge=0, le=100)
    is_active: Optional[bool] = None
    description: Optional[str] = Field(None, max_length=1000)


class AssetClassResponse(BaseModel):
    id: int
    code: str
    name: str
    asset_account_id: int
    depreciation_method: str
    useful_life_months: int
    declining_rate: Optional[Decimal] = None
    is_active: bool
    description: Optional[str] = None

    class Config:
        from_attributes = True


class FixedAssetCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    asset_class_id: int
    branch_code: Optional[str] = None
    cost_center_id: Optional[int] = None
    serial_no: Optional[str] = Field(None, max_length=100)
    location: Optional[str] = Field(None, max_length=200)
    acquisition_date: date
    cost: MoneyIn
    salvage_value: MoneyIn = Decimal("0")
    useful_life_months: Optional[int] = Field(None, ge=1, le=1200)
    depreciation_method: Optional[str] = None
    declining_rate: Optional[Decimal] = Field(None, ge=0, le=100)
    depreciation_start: Optional[date] = None
    accumulated_depreciation: MoneyIn = Decimal("0")  # already taken, for an asset brought in
    funding: str = "existing"  # existing (already in the books), bank, cash, supplier, opening
    notes: Optional[str] = Field(None, max_length=2000)


class FixedAssetResponse(BaseModel):
    id: int
    asset_no: str
    name: str
    asset_class_id: int
    asset_class_name: Optional[str] = None
    branch_code: Optional[str] = None
    cost_center_id: Optional[int] = None
    serial_no: Optional[str] = None
    location: Optional[str] = None
    acquisition_date: date
    cost: Decimal
    salvage_value: Decimal
    useful_life_months: int
    depreciation_method: str
    declining_rate: Optional[Decimal] = None
    depreciation_start: date
    accumulated_depreciation: Decimal
    book_value: Decimal
    monthly_depreciation: Decimal
    status: str
    disposal_date: Optional[date] = None
    disposal_proceeds: Optional[Decimal] = None
    notes: Optional[str] = None


class FixedAssetDispose(BaseModel):
    kind: str  # sold, scrapped
    disposal_date: Optional[date] = None
    proceeds: MoneyIn = Decimal("0")
    received_into: str = "bank"  # bank, cash
    notes: Optional[str] = Field(None, max_length=1000)


class DepreciationRunCreate(BaseModel):
    period_year: int = Field(..., ge=2000, le=2100)
    period_month: int = Field(..., ge=1, le=12)


class DepreciationPreviewLine(BaseModel):
    asset_id: int
    asset_no: str
    name: str
    branch_code: Optional[str] = None
    amount: Decimal


class DepreciationRunResponse(BaseModel):
    id: int
    period_year: int
    period_month: int
    run_date: date
    total: Decimal
    status: str
    asset_count: int = 0


# =============================================================================
# RECURRING JOURNALS & OPENING BALANCES
# =============================================================================

class RecurringLineInput(BaseModel):
    account_id: int
    debit_amount: MoneyIn = Decimal("0")
    credit_amount: MoneyIn = Decimal("0")
    description: Optional[str] = Field(None, max_length=500)
    cost_center_id: Optional[int] = None


class RecurringJournalCreate(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
    description: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
    branch_code: Optional[str] = None
    frequency: str = "monthly"
    next_date: date
    end_date: Optional[date] = None
    auto_reverse: bool = False
    lines: List[RecurringLineInput] = Field(..., min_length=2, max_length=50)


class RecurringJournalUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=150)
    next_date: Optional[date] = None
    end_date: Optional[date] = None
    is_active: Optional[bool] = None


class RecurringJournalLineResponse(BaseModel):
    line_number: int
    account_id: int
    debit_amount: Decimal
    credit_amount: Decimal
    description: Optional[str] = None
    cost_center_id: Optional[int] = None

    class Config:
        from_attributes = True


class RecurringJournalResponse(BaseModel):
    id: int
    name: str
    description: str
    branch_code: Optional[str] = None
    frequency: str
    next_date: date
    end_date: Optional[date] = None
    auto_reverse: bool
    is_active: bool
    last_journal_entry_id: Optional[int] = None
    lines: List[RecurringJournalLineResponse] = []

    class Config:
        from_attributes = True


class OpeningBalanceLine(BaseModel):
    account_code: str = Field(..., min_length=1, max_length=50)
    debit: MoneyIn = Decimal("0")
    credit: MoneyIn = Decimal("0")
    description: Optional[str] = Field(None, max_length=500)


class OpeningBalanceCreate(BaseModel):
    entry_date: date
    branch_code: Optional[str] = None
    description: Optional[str] = Field(None, max_length=500)
    lines: List[OpeningBalanceLine] = Field(..., min_length=1, max_length=2000)
