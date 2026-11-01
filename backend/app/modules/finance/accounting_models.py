"""
General Ledger & Accounting Models

Tables:
- chart_of_accounts: Chart of Accounts (COA) hierarchy
- journal_entries: Journal entry headers
- journal_entry_lines: Journal entry line items (debits/credits)
- general_ledger: Posted GL transactions
- accounting_periods: Fiscal period management
- cash_flow_categories: Cash flow statement category definitions
- cash_flow_statements: Cash flow statement headers
- cash_flow_statement_lines: Cash flow statement line items
- posting_rules / posting_rule_details: which account each automatic posting type hits
- voucher_types: names for the journal-entry sources (SALE, PUR, MJ, ...)
"""

from app.db.base import Base
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Column,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import relationship
from app.common.base_models import AuditMixin


# =============================================================================
# CHART OF ACCOUNTS
# =============================================================================

class ChartOfAccounts(Base, AuditMixin):
    """
    Chart of Accounts - The accounting taxonomy.
    Every financial transaction must reference an account from this table.
    
    Account types follow the accounting equation:
    Assets = Liabilities + Equity + (Revenue - Expense)
    """
    __tablename__ = "chart_of_accounts"

    id = Column(Integer, primary_key=True, index=True)
    account_code = Column(String(50), unique=True, nullable=False, index=True)
    account_name = Column(String(255), nullable=False)
    account_type = Column(String(50), nullable=False)  # Asset, Liability, Equity, Revenue, Expense
    account_category = Column(String(100), nullable=True)  # Cash, Bank, AR, Inventory, Fixed Asset, etc.
    parent_account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    is_system_account = Column(Boolean, nullable=False, default=False)
    normal_balance = Column(String(10), nullable=False)  # Debit or Credit

    description = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # Self-referential relationship for hierarchy
    parent = relationship("ChartOfAccounts", remote_side=[id], backref="children")
    # GL entries for this account
    gl_entries = relationship("GeneralLedger", back_populates="account")
    # Journal entry lines for this account
    journal_lines = relationship("JournalEntryLine", back_populates="account")


# =============================================================================
# JOURNAL ENTRIES
# =============================================================================

class JournalEntry(Base, AuditMixin):
    """
    Journal Entry header - groups related debit/credit lines.
    Every accounting transaction starts as a journal entry.
    
    Statuses:
      Manual JE:  draft → submitted → approved → posted → reversed
      Auto JE:    posted (created directly by system integrations)
    Entry types: Manual, Auto, Adjustment, Closing
    """
    __tablename__ = "journal_entries"

    id = Column(Integer, primary_key=True, index=True)
    journal_entry_no = Column(String(200), unique=True, nullable=False, index=True)
    entry_date = Column(Date, nullable=False)
    posting_date = Column(Date, nullable=False)
    entry_type = Column(String(50), nullable=False)  # Manual, Auto, Adjustment, Closing
    description = Column(Text, nullable=False)
    total_debit = Column(Numeric(60, 2), nullable=False)
    total_credit = Column(Numeric(60, 2), nullable=False)
    status = Column(String(30), nullable=False, default="draft")  # draft, submitted, approved, posted, reversed
    is_reversed = Column(Boolean, default=False)
    reversed_by_je_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    # Accruals: when posted, a reversal dated this day is posted with it.
    auto_reverse_date = Column(Date, nullable=True)
    fiscal_year = Column(Integer, nullable=False)
    fiscal_period = Column(Integer, nullable=False)
    branch_code = Column(String(200), nullable=True)
    voucher_type = Column(String(20), nullable=True, index=True)  # voucher_types.code, e.g. SALE, PUR, MJ
    created_by = Column(Integer, nullable=False)
    submitted_by = Column(Integer, nullable=True)
    submitted_at = Column(TIMESTAMP, nullable=True)
    approved_by = Column(Integer, nullable=True)
    approved_at = Column(TIMESTAMP, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    posted_by = Column(Integer, nullable=True)
    posted_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # Relationships
    lines = relationship("JournalEntryLine", back_populates="journal_entry", cascade="all, delete-orphan")
    gl_entries = relationship("GeneralLedger", back_populates="journal_entry")
    reversed_by = relationship("JournalEntry", remote_side=[id], foreign_keys=[reversed_by_je_id])


class JournalEntryLine(Base, AuditMixin):
    """
    Journal Entry line items - individual debit/credit entries.
    Each line references a COA account.
    """
    __tablename__ = "journal_entry_lines"

    id = Column(Integer, primary_key=True, index=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False)
    line_number = Column(Integer, nullable=False)
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    debit_amount = Column(Numeric(60, 2), default=0.00)
    credit_amount = Column(Numeric(60, 2), default=0.00)
    description = Column(Text, nullable=True)
    reference_type = Column(String(50), nullable=True)
    reference_id = Column(Integer, nullable=True)
    reference_no = Column(String(200), nullable=True)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    # Relationships
    journal_entry = relationship("JournalEntry", back_populates="lines")
    account = relationship("ChartOfAccounts", back_populates="journal_lines")

    __table_args__ = (
        UniqueConstraint("journal_entry_id", "line_number", name="journal_entry_lines_unique"),
    )


# =============================================================================
# GENERAL LEDGER
# =============================================================================

class GeneralLedger(Base, AuditMixin):
    """
    General Ledger - The master record of all posted financial transactions.
    Each row represents a single debit or credit posting to a COA account.
    """
    __tablename__ = "general_ledger"

    id = Column(Integer, primary_key=True, index=True)
    transaction_date = Column(Date, nullable=False)
    posting_date = Column(Date, nullable=False)
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    debit_amount = Column(Numeric(60, 2), default=0.00)
    credit_amount = Column(Numeric(60, 2), default=0.00)
    balance = Column(Numeric(60, 2), nullable=True)
    transaction_type = Column(String(50), nullable=False)  # Sale, Purchase, Payment, Receipt, Payroll, Expense
    reference_type = Column(String(50), nullable=True)  # Invoice, PO, Payment, JE
    reference_id = Column(Integer, nullable=True)
    reference_no = Column(String(200), nullable=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    description = Column(Text, nullable=True)
    branch_code = Column(String(200), nullable=True)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True, index=True)
    fiscal_year = Column(Integer, nullable=False)
    fiscal_period = Column(Integer, nullable=False)
    created_by = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    # Relationships
    account = relationship("ChartOfAccounts", back_populates="gl_entries")
    journal_entry = relationship("JournalEntry", back_populates="gl_entries")

    __table_args__ = (
        Index("idx_gl_account_date", "account_id", "transaction_date"),
        Index("idx_gl_fiscal", "fiscal_year", "fiscal_period"),
        Index("idx_gl_reference", "reference_type", "reference_id"),
    )


# =============================================================================
# ACCOUNTING PERIODS
# =============================================================================

class AccountingPeriod(Base, AuditMixin):
    """
    Fiscal period management - controls when transactions can be posted.
    
    Statuses: open → closed → locked
    """
    __tablename__ = "accounting_periods"

    id = Column(Integer, primary_key=True, index=True)
    fiscal_year = Column(Integer, nullable=False)
    period_number = Column(Integer, nullable=False)  # 1-12 for monthly
    period_name = Column(String(50), nullable=False)  # 'January 2026', 'Q1 2026', etc.
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    status = Column(String(30), nullable=False, default="open")  # open, closed, locked
    closed_by = Column(Integer, nullable=True)
    closed_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("fiscal_year", "period_number", name="accounting_periods_unique"),
    )


# =============================================================================
# CASH FLOW
# =============================================================================

class CashFlowCategory(Base, AuditMixin):
    """
    Cash Flow Statement category definitions (IAS 7 / ASC 230).
    Defines the structure and account mappings for cash flow reporting.
    """
    __tablename__ = "cash_flow_categories"

    id = Column(Integer, primary_key=True, index=True)
    category_code = Column(String(50), unique=True, nullable=False, index=True)
    category_name = Column(String(255), nullable=False)
    section = Column(String(50), nullable=False)  # Operating, Investing, Financing
    line_item = Column(String(255), nullable=False)
    display_order = Column(Integer, nullable=False)
    is_inflow = Column(Boolean, nullable=False)
    account_mapping = Column(Text, nullable=True)  # JSON array of account codes
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    # Relationship
    statement_lines = relationship("CashFlowStatementLine", back_populates="category")

    __table_args__ = (
        Index("idx_cf_category_section", "section", "display_order"),
    )


class CashFlowStatement(Base, AuditMixin):
    """
    Cash Flow Statement header for a specific fiscal period.
    """
    __tablename__ = "cash_flow_statements"

    id = Column(Integer, primary_key=True, index=True)
    statement_no = Column(String(200), unique=True, nullable=False, index=True)
    fiscal_year = Column(Integer, nullable=False)
    fiscal_period = Column(Integer, nullable=False)
    period_start_date = Column(Date, nullable=False)
    period_end_date = Column(Date, nullable=False)
    opening_cash_balance = Column(Numeric(60, 2), nullable=False)
    closing_cash_balance = Column(Numeric(60, 2), nullable=False)
    net_cash_from_operating = Column(Numeric(60, 2), nullable=True)
    net_cash_from_investing = Column(Numeric(60, 2), nullable=True)
    net_cash_from_financing = Column(Numeric(60, 2), nullable=True)
    net_change_in_cash = Column(Numeric(60, 2), nullable=True)
    status = Column(String(30), default="draft")  # draft, final, approved
    method = Column(String(20), default="indirect")  # direct or indirect
    notes = Column(Text, nullable=True)
    prepared_by = Column(Integer, nullable=True)
    approved_by = Column(Integer, nullable=True)
    approved_at = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # Relationship
    lines = relationship("CashFlowStatementLine", back_populates="statement", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("fiscal_year", "fiscal_period", name="cash_flow_statements_period"),
    )


class CashFlowStatementLine(Base, AuditMixin):
    """
    Cash Flow Statement line items with amounts and calculation sources.
    """
    __tablename__ = "cash_flow_statement_lines"

    id = Column(Integer, primary_key=True, index=True)
    cash_flow_statement_id = Column(Integer, ForeignKey("cash_flow_statements.id", ondelete="CASCADE"), nullable=False)
    category_id = Column(Integer, ForeignKey("cash_flow_categories.id"), nullable=False)
    line_number = Column(Integer, nullable=False)
    line_description = Column(String(255), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    is_calculated = Column(Boolean, default=False)
    calculation_source = Column(Text, nullable=True)
    reference_accounts = Column(Text, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    # Relationships
    statement = relationship("CashFlowStatement", back_populates="lines")
    category = relationship("CashFlowCategory", back_populates="statement_lines")

    __table_args__ = (
        UniqueConstraint("cash_flow_statement_id", "line_number", name="cash_flow_lines_unique"),
        Index("idx_cf_line_statement", "cash_flow_statement_id"),
    )


# =============================================================================
# GL POSTING FAILURES (Transactional Outbox / Dead-letter)
# =============================================================================

class GLPostingFailure(Base, AuditMixin):
    """
    Durable record of automatic GL postings that could NOT be completed.

    Auto-integrations (sales, purchasing, expenses, payroll, commissions) post
    journal entries in the same transaction as the source document. Previously,
    if posting failed — a required COA account was missing, the period was
    closed, or debits != credits — the error was logged and silently swallowed,
    letting the source document commit with NO matching GL entries. Over a day
    this silently desynchronises the subledgers from the General Ledger.

    Instead, every failure is now written here (via an independent session so it
    survives a rollback of the source transaction). A retry endpoint/worker can
    re-attempt the posting once the underlying issue is fixed, guaranteeing
    eventual 100% posting with zero silent loss.

    status: pending → resolved | ignored
    """
    __tablename__ = "gl_posting_failures"

    id = Column(Integer, primary_key=True, index=True)
    # What should have been posted
    reference_type = Column(String(50), nullable=False)   # Invoice, SaleReturn, GRN, Expense, Payroll, ...
    reference_id = Column(Integer, nullable=False)
    reference_no = Column(String(200), nullable=True)
    source_module = Column(String(50), nullable=False)    # sales, purchasing, finance, payroll
    transaction_type = Column(String(50), nullable=True)  # Sale, Purchase, Expense, Payroll, ...
    posting_marker = Column(String(50), nullable=True)    # Revenue, COGS, Discount, etc. (sub-type)
    entry_date = Column(Date, nullable=True)
    branch_code = Column(String(200), nullable=True)
    description = Column(Text, nullable=True)
    # JSON snapshot of the balanced lines that should have been posted
    payload = Column(Text, nullable=True)
    # Why it failed
    error_code = Column(String(50), nullable=False)       # missing_account, imbalance, period_closed, exception
    error_message = Column(Text, nullable=False)
    # Lifecycle
    status = Column(String(20), nullable=False, default="pending")  # pending, resolved, ignored
    attempts = Column(Integer, nullable=False, default=1)
    last_attempt_at = Column(TIMESTAMP, server_default=func.now())
    resolved_at = Column(TIMESTAMP, nullable=True)
    resolved_by = Column(Integer, nullable=True)
    resolved_je_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)

    __table_args__ = (
        Index("idx_gl_failure_ref", "reference_type", "reference_id"),
        Index("idx_gl_failure_status", "status"),
    )


# =============================================================================
# POSTING RULES & VOUCHER TYPES
# =============================================================================

class PostingRule(Base, AuditMixin):
    """
    Account override for one automatic posting type (see posting_rules.POSTING_TYPES).

    No row = the posting type uses its built-in default account. ``account_id``
    NULL = keep the default but still split by ``control_type`` via the details.
    """
    __tablename__ = "posting_rules"

    id = Column(Integer, primary_key=True, index=True)
    posting_type = Column(String(50), unique=True, nullable=False)
    control_type = Column(String(30), nullable=False, default="none")  # none, branch, expense_category
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    account = relationship("ChartOfAccounts")
    details = relationship("PostingRuleDetail", back_populates="rule", cascade="all, delete-orphan")


class PostingRuleDetail(Base, AuditMixin):
    """Account for one value of the rule's control type (e.g. branch BR-02 -> 1021)."""
    __tablename__ = "posting_rule_details"

    id = Column(Integer, primary_key=True, index=True)
    rule_id = Column(Integer, ForeignKey("posting_rules.id", ondelete="CASCADE"), nullable=False)
    control_value = Column(String(100), nullable=False)
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    rule = relationship("PostingRule", back_populates="details")
    account = relationship("ChartOfAccounts")

    __table_args__ = (
        UniqueConstraint("rule_id", "control_value", name="posting_rule_details_unique"),
    )


class VoucherType(Base, AuditMixin):
    """
    Where a journal entry came from. ``code`` is the JE number prefix without
    "JE-" (JE-SALE-202610-0001 -> SALE); manual entries are MJ.
    """
    __tablename__ = "voucher_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    source_module = Column(String(50), nullable=True)
    is_manual = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


# =============================================================================
# TAX (VAT)
# =============================================================================

class TaxCode(Base, AuditMixin):
    """
    A VAT treatment: rate + type. Sales and supplier invoices carry one, every
    taxed posting writes a tax_transactions row with it, and the VAT return
    groups by it.

    tax_type: standard (charged at ``rate``), zero_rated (0%, still reported),
    exempt (no VAT, still reported).
    """
    __tablename__ = "tax_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    rate = Column(Numeric(7, 3), nullable=False, default=0)
    tax_type = Column(String(20), nullable=False, default="standard")
    applies_to = Column(String(20), nullable=False, default="both")  # sales, purchases, both
    is_default_sales = Column(Boolean, nullable=False, default=False)
    is_default_purchases = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    description = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class TaxTransaction(Base, AuditMixin):
    """
    Tax ledger: one row per VAT line of an automatic posting (IFS TaxLedgerItem).

    ``direction`` output = VAT charged on sales, input = VAT paid on purchases.
    Amounts are signed in the direction's own sense: a sale return is a
    negative output row, a cancelled supplier invoice a negative input row.
    ``settlement_id`` is set once the row is included in a VAT settlement.
    """
    __tablename__ = "tax_transactions"

    id = Column(Integer, primary_key=True, index=True)
    transaction_date = Column(Date, nullable=False)
    fiscal_year = Column(Integer, nullable=False)
    fiscal_period = Column(Integer, nullable=False)
    direction = Column(String(10), nullable=False)  # output, input
    tax_code = Column(String(20), nullable=False)
    tax_rate = Column(Numeric(7, 3), nullable=True)
    base_amount = Column(Numeric(60, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(60, 2), nullable=False, default=0)
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    reference_type = Column(String(50), nullable=True)
    reference_id = Column(Integer, nullable=True)
    reference_no = Column(String(200), nullable=True)
    branch_code = Column(String(200), nullable=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=False)
    settlement_id = Column(Integer, ForeignKey("tax_settlements.id"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    account = relationship("ChartOfAccounts")

    __table_args__ = (
        Index("idx_tax_txn_date", "transaction_date"),
        Index("idx_tax_txn_je", "journal_entry_id"),
        Index("idx_tax_txn_settlement", "settlement_id"),
    )


class TaxSettlement(Base, AuditMixin):
    """
    A VAT settlement: every unsettled tax row up to ``date_to`` cleared into the
    VAT_SETTLEMENT account (output VAT - input VAT = due to the tax authority).
    """
    __tablename__ = "tax_settlements"

    id = Column(Integer, primary_key=True, index=True)
    settlement_no = Column(String(50), unique=True, nullable=False)
    date_to = Column(Date, nullable=False)
    settlement_date = Column(Date, nullable=False)
    output_tax = Column(Numeric(60, 2), nullable=False, default=0)
    input_tax = Column(Numeric(60, 2), nullable=False, default=0)
    net_tax = Column(Numeric(60, 2), nullable=False, default=0)  # > 0 payable, < 0 refundable
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


# =============================================================================
# BANK ACCOUNTS & RECONCILIATION
# =============================================================================

class BankAccount(Base, AuditMixin):
    """
    A real bank account, tied to the leaf GL account its money is posted to.
    ``reconcile_from``: GL rows before this date count as already reconciled
    (the point where the first statement picks up).
    """
    __tablename__ = "bank_accounts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False)
    bank_name = Column(String(100), nullable=True)
    account_number = Column(String(50), nullable=True)
    branch_code = Column(String(200), nullable=True)
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False, unique=True)
    currency = Column(String(10), nullable=False, default="LKR")
    reconcile_from = Column(Date, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    account = relationship("ChartOfAccounts")


class BankStatement(Base, AuditMixin):
    """One bank statement (imported or typed). Status: open -> reconciled."""
    __tablename__ = "bank_statements"

    id = Column(Integer, primary_key=True, index=True)
    bank_account_id = Column(Integer, ForeignKey("bank_accounts.id"), nullable=False, index=True)
    statement_no = Column(String(100), nullable=True)
    date_from = Column(Date, nullable=False)
    date_to = Column(Date, nullable=False)
    opening_balance = Column(Numeric(60, 2), nullable=False, default=0)
    closing_balance = Column(Numeric(60, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="open")
    reconciled_at = Column(TIMESTAMP, nullable=True)
    reconciled_by = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    bank_account = relationship("BankAccount")
    lines = relationship("BankStatementLine", back_populates="statement", cascade="all, delete-orphan",
                         order_by="BankStatementLine.line_date")


class BankStatementLine(Base, AuditMixin):
    """A statement line. ``amount`` > 0 money into the bank, < 0 money out."""
    __tablename__ = "bank_statement_lines"

    id = Column(Integer, primary_key=True, index=True)
    statement_id = Column(Integer, ForeignKey("bank_statements.id", ondelete="CASCADE"), nullable=False, index=True)
    line_date = Column(Date, nullable=False)
    description = Column(Text, nullable=True)
    reference = Column(String(200), nullable=True)
    amount = Column(Numeric(60, 2), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    statement = relationship("BankStatement", back_populates="lines")
    matches = relationship("BankReconciliationMatch", back_populates="statement_line", cascade="all, delete-orphan")


class BankReconciliationMatch(Base, AuditMixin):
    """Links a statement line to the GL bank row(s) it clears. A GL row is
    cleared at most once (unique gl_id); the matched rows sum to the line."""
    __tablename__ = "bank_reconciliation_matches"

    id = Column(Integer, primary_key=True, index=True)
    statement_line_id = Column(Integer, ForeignKey("bank_statement_lines.id", ondelete="CASCADE"), nullable=False, index=True)
    gl_id = Column(Integer, ForeignKey("general_ledger.id"), nullable=False, unique=True)
    match_type = Column(String(20), nullable=False, default="manual")  # auto, manual, created
    created_at = Column(TIMESTAMP, server_default=func.now())

    statement_line = relationship("BankStatementLine", back_populates="matches")


# =============================================================================
# CUSTOMER WRITE-OFFS
# =============================================================================

class WriteOffLimit(Base, AuditMixin):
    """Largest single write-off a user group may make (IFS WriteOffCodeLimit).
    Superusers have no limit; a user's limit is the highest of their groups'."""
    __tablename__ = "write_off_limits"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("auth_group.id", ondelete="CASCADE"), nullable=False, unique=True)
    max_amount = Column(Numeric(18, 2), nullable=False, default=0)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


class CustomerWriteOff(Base, AuditMixin):
    """Part of a credit invoice's balance that will not be collected.
    Posts Dr CUSTOMER_WRITE_OFF / Cr Trade Debtors; status posted -> reversed."""
    __tablename__ = "customer_write_offs"

    id = Column(Integer, primary_key=True, index=True)
    write_off_no = Column(String(50), unique=True, nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False, index=True)
    branch_code = Column(String(200), nullable=True)
    write_off_date = Column(Date, nullable=False)
    amount = Column(Numeric(18, 2), nullable=False)
    reason = Column(String(30), nullable=False)
    notes = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="posted")
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    reversed_at = Column(TIMESTAMP, nullable=True)
    reversed_by = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


# =============================================================================
# COST CENTERS
# =============================================================================

class CostCenter(Base, AuditMixin):
    """
    A department / unit whose income and costs are tracked separately (IFS code
    part B). Income and expense lines carry one; balance-sheet lines don't.
    A branch may have a default cost center that automatic postings use.
    """
    __tablename__ = "cost_centers"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    branch_code = Column(String(200), nullable=True)
    is_branch_default = Column(Boolean, nullable=False, default=False)
    is_active = Column(Boolean, nullable=False, default=True)
    description = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())


# =============================================================================
# FIXED ASSETS
# =============================================================================

class AssetClass(Base, AuditMixin):
    """A kind of asset (vehicles, computers...): its cost account and default depreciation."""
    __tablename__ = "asset_classes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    asset_account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    depreciation_method = Column(String(20), nullable=False, default="straight_line")  # straight_line, declining
    useful_life_months = Column(Integer, nullable=False, default=60)
    declining_rate = Column(Numeric(7, 3), nullable=True)  # % per year, declining method
    is_active = Column(Boolean, nullable=False, default=True)
    description = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    asset_account = relationship("ChartOfAccounts")


class FixedAsset(Base, AuditMixin):
    """
    One asset in the register. Status: active -> fully_depreciated, or sold / scrapped.
    ``accumulated_depreciation`` is the running total of posted depreciation.
    """
    __tablename__ = "fixed_assets"

    id = Column(Integer, primary_key=True, index=True)
    asset_no = Column(String(50), unique=True, nullable=False)
    name = Column(String(200), nullable=False)
    asset_class_id = Column(Integer, ForeignKey("asset_classes.id"), nullable=False, index=True)
    branch_code = Column(String(200), nullable=True)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    serial_no = Column(String(100), nullable=True)
    location = Column(String(200), nullable=True)
    acquisition_date = Column(Date, nullable=False)
    cost = Column(Numeric(18, 2), nullable=False)
    salvage_value = Column(Numeric(18, 2), nullable=False, default=0)
    useful_life_months = Column(Integer, nullable=False)
    depreciation_method = Column(String(20), nullable=False, default="straight_line")
    declining_rate = Column(Numeric(7, 3), nullable=True)
    depreciation_start = Column(Date, nullable=False)
    accumulated_depreciation = Column(Numeric(18, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="active")
    acquisition_journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    disposal_date = Column(Date, nullable=True)
    disposal_proceeds = Column(Numeric(18, 2), nullable=True)
    disposal_journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    asset_class = relationship("AssetClass")


class DepreciationRun(Base, AuditMixin):
    """One month's depreciation for all assets. Status posted -> reversed."""
    __tablename__ = "depreciation_runs"

    id = Column(Integer, primary_key=True, index=True)
    period_year = Column(Integer, nullable=False)
    period_month = Column(Integer, nullable=False)
    run_date = Column(Date, nullable=False)
    total = Column(Numeric(18, 2), nullable=False, default=0)
    status = Column(String(20), nullable=False, default="posted")
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    lines = relationship("DepreciationLine", back_populates="run", cascade="all, delete-orphan")


class DepreciationLine(Base, AuditMixin):
    __tablename__ = "depreciation_lines"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("depreciation_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    asset_id = Column(Integer, ForeignKey("fixed_assets.id"), nullable=False, index=True)
    amount = Column(Numeric(18, 2), nullable=False)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    run = relationship("DepreciationRun", back_populates="lines")
    asset = relationship("FixedAsset")


# =============================================================================
# RECURRING JOURNALS
# =============================================================================

class RecurringJournal(Base, AuditMixin):
    """
    A journal entry that repeats (rent, insurance spread, standing accruals).
    "Create due entries" makes a draft manual journal for every due date up to
    today; it then goes through the normal approval.
    """
    __tablename__ = "recurring_journals"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=False)
    branch_code = Column(String(200), nullable=True)
    frequency = Column(String(20), nullable=False, default="monthly")  # monthly, quarterly, yearly
    next_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=True)
    auto_reverse = Column(Boolean, nullable=False, default=False)  # accrual: reverse on the 1st of the next month
    is_active = Column(Boolean, nullable=False, default=True)
    last_journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    lines = relationship("RecurringJournalLine", back_populates="template", cascade="all, delete-orphan",
                         order_by="RecurringJournalLine.line_number")


class RecurringJournalLine(Base, AuditMixin):
    __tablename__ = "recurring_journal_lines"

    id = Column(Integer, primary_key=True, index=True)
    template_id = Column(Integer, ForeignKey("recurring_journals.id", ondelete="CASCADE"), nullable=False, index=True)
    line_number = Column(Integer, nullable=False)
    account_id = Column(Integer, ForeignKey("chart_of_accounts.id"), nullable=False)
    debit_amount = Column(Numeric(18, 2), nullable=False, default=0)
    credit_amount = Column(Numeric(18, 2), nullable=False, default=0)
    description = Column(Text, nullable=True)
    cost_center_id = Column(Integer, ForeignKey("cost_centers.id"), nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    template = relationship("RecurringJournal", back_populates="lines")
