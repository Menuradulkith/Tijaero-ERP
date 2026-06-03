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
    fiscal_year = Column(Integer, nullable=False)
    fiscal_period = Column(Integer, nullable=False)
    branch_code = Column(String(200), nullable=True)
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
