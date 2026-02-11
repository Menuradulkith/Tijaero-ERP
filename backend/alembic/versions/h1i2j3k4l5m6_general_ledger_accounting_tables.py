"""Add general ledger and accounting tables

Revision ID: h1i2j3k4l5m6
Revises: f7g8h9i0j1k2
Create Date: 2026-02-11 18:00:00.000000

This migration creates the core accounting tables:
- chart_of_accounts: Chart of accounts hierarchy
- journal_entries: Journal entry headers
- journal_entry_lines: Journal entry line items
- general_ledger: Posted GL transactions
- accounting_periods: Fiscal period management
- cash_flow_categories: Cash flow category definitions
- cash_flow_statements: Cash flow statement headers
- cash_flow_statement_lines: Cash flow statement line items
"""
from alembic import op
import sqlalchemy as sa


revision = 'h1i2j3k4l5m6'
down_revision = 'f7g8h9i0j1k2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── chart_of_accounts ──────────────────────────────────────────────────
    op.create_table(
        'chart_of_accounts',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('account_code', sa.String(50), unique=True, nullable=False),
        sa.Column('account_name', sa.String(255), nullable=False),
        sa.Column('account_type', sa.String(50), nullable=False),
        sa.Column('account_category', sa.String(100), nullable=True),
        sa.Column('parent_account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default='true'),
        sa.Column('is_system_account', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('normal_balance', sa.String(10), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_index('ix_chart_of_accounts_code', 'chart_of_accounts', ['account_code'])

    # ── journal_entries ────────────────────────────────────────────────────
    op.create_table(
        'journal_entries',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('journal_entry_no', sa.String(200), unique=True, nullable=False),
        sa.Column('entry_date', sa.Date(), nullable=False),
        sa.Column('posting_date', sa.Date(), nullable=False),
        sa.Column('entry_type', sa.String(50), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('total_debit', sa.Numeric(60, 2), nullable=False),
        sa.Column('total_credit', sa.Numeric(60, 2), nullable=False),
        sa.Column('status', sa.String(30), nullable=False, server_default='draft'),
        sa.Column('is_reversed', sa.Boolean(), server_default='false'),
        sa.Column('reversed_by_je_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_period', sa.Integer(), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=False),
        sa.Column('posted_by', sa.Integer(), nullable=True),
        sa.Column('posted_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_index('ix_journal_entries_no', 'journal_entries', ['journal_entry_no'])
    op.create_index('ix_journal_entries_status', 'journal_entries', ['status'])
    op.create_index('ix_journal_entries_date', 'journal_entries', ['entry_date'])

    # ── journal_entry_lines ────────────────────────────────────────────────
    op.create_table(
        'journal_entry_lines',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id', ondelete='CASCADE'), nullable=False),
        sa.Column('line_number', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False),
        sa.Column('debit_amount', sa.Numeric(60, 2), server_default='0.00'),
        sa.Column('credit_amount', sa.Numeric(60, 2), server_default='0.00'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('reference_type', sa.String(50), nullable=True),
        sa.Column('reference_id', sa.Integer(), nullable=True),
        sa.Column('reference_no', sa.String(200), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_unique_constraint('journal_entry_lines_unique', 'journal_entry_lines', ['journal_entry_id', 'line_number'])
    op.create_index('ix_je_lines_entry', 'journal_entry_lines', ['journal_entry_id'])
    op.create_index('ix_je_lines_account', 'journal_entry_lines', ['account_id'])

    # ── general_ledger ─────────────────────────────────────────────────────
    op.create_table(
        'general_ledger',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('transaction_date', sa.Date(), nullable=False),
        sa.Column('posting_date', sa.Date(), nullable=False),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False),
        sa.Column('debit_amount', sa.Numeric(60, 2), server_default='0.00'),
        sa.Column('credit_amount', sa.Numeric(60, 2), server_default='0.00'),
        sa.Column('balance', sa.Numeric(60, 2), nullable=True),
        sa.Column('transaction_type', sa.String(50), nullable=False),
        sa.Column('reference_type', sa.String(50), nullable=True),
        sa.Column('reference_id', sa.Integer(), nullable=True),
        sa.Column('reference_no', sa.String(200), nullable=True),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_period', sa.Integer(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_index('idx_gl_account_date', 'general_ledger', ['account_id', 'transaction_date'])
    op.create_index('idx_gl_fiscal', 'general_ledger', ['fiscal_year', 'fiscal_period'])
    op.create_index('idx_gl_reference', 'general_ledger', ['reference_type', 'reference_id'])

    # ── accounting_periods ─────────────────────────────────────────────────
    op.create_table(
        'accounting_periods',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('period_number', sa.Integer(), nullable=False),
        sa.Column('period_name', sa.String(50), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('status', sa.String(30), nullable=False, server_default='open'),
        sa.Column('closed_by', sa.Integer(), nullable=True),
        sa.Column('closed_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_unique_constraint('accounting_periods_unique', 'accounting_periods', ['fiscal_year', 'period_number'])
    op.create_index('ix_accounting_periods_year', 'accounting_periods', ['fiscal_year'])

    # ── cash_flow_categories ───────────────────────────────────────────────
    op.create_table(
        'cash_flow_categories',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('category_code', sa.String(50), unique=True, nullable=False),
        sa.Column('category_name', sa.String(255), nullable=False),
        sa.Column('section', sa.String(50), nullable=False),
        sa.Column('line_item', sa.String(255), nullable=False),
        sa.Column('display_order', sa.Integer(), nullable=False),
        sa.Column('is_inflow', sa.Boolean(), nullable=False),
        sa.Column('account_mapping', sa.Text(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default='true'),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_index('idx_cf_category_section', 'cash_flow_categories', ['section', 'display_order'])

    # ── cash_flow_statements ───────────────────────────────────────────────
    op.create_table(
        'cash_flow_statements',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('statement_no', sa.String(200), unique=True, nullable=False),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_period', sa.Integer(), nullable=False),
        sa.Column('period_start_date', sa.Date(), nullable=False),
        sa.Column('period_end_date', sa.Date(), nullable=False),
        sa.Column('opening_cash_balance', sa.Numeric(60, 2), nullable=False),
        sa.Column('closing_cash_balance', sa.Numeric(60, 2), nullable=False),
        sa.Column('net_cash_from_operating', sa.Numeric(60, 2), nullable=True),
        sa.Column('net_cash_from_investing', sa.Numeric(60, 2), nullable=True),
        sa.Column('net_cash_from_financing', sa.Numeric(60, 2), nullable=True),
        sa.Column('net_change_in_cash', sa.Numeric(60, 2), nullable=True),
        sa.Column('status', sa.String(30), server_default='draft'),
        sa.Column('method', sa.String(20), server_default='indirect'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('prepared_by', sa.Integer(), nullable=True),
        sa.Column('approved_by', sa.Integer(), nullable=True),
        sa.Column('approved_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_unique_constraint('cash_flow_statements_period', 'cash_flow_statements', ['fiscal_year', 'fiscal_period'])

    # ── cash_flow_statement_lines ──────────────────────────────────────────
    op.create_table(
        'cash_flow_statement_lines',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('cash_flow_statement_id', sa.Integer(), sa.ForeignKey('cash_flow_statements.id', ondelete='CASCADE'), nullable=False),
        sa.Column('category_id', sa.Integer(), sa.ForeignKey('cash_flow_categories.id'), nullable=False),
        sa.Column('line_number', sa.Integer(), nullable=False),
        sa.Column('line_description', sa.String(255), nullable=False),
        sa.Column('amount', sa.Numeric(60, 2), nullable=False),
        sa.Column('is_calculated', sa.Boolean(), server_default='false'),
        sa.Column('calculation_source', sa.Text(), nullable=True),
        sa.Column('reference_accounts', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    )
    op.create_unique_constraint('cash_flow_lines_unique', 'cash_flow_statement_lines', ['cash_flow_statement_id', 'line_number'])
    op.create_index('idx_cf_line_statement', 'cash_flow_statement_lines', ['cash_flow_statement_id'])


def downgrade() -> None:
    op.drop_index('idx_cf_line_statement', 'cash_flow_statement_lines')
    op.drop_table('cash_flow_statement_lines')
    op.drop_table('cash_flow_statements')
    op.drop_index('idx_cf_category_section', 'cash_flow_categories')
    op.drop_table('cash_flow_categories')
    op.drop_index('ix_accounting_periods_year', 'accounting_periods')
    op.drop_table('accounting_periods')
    op.drop_index('idx_gl_reference', 'general_ledger')
    op.drop_index('idx_gl_fiscal', 'general_ledger')
    op.drop_index('idx_gl_account_date', 'general_ledger')
    op.drop_table('general_ledger')
    op.drop_index('ix_je_lines_account', 'journal_entry_lines')
    op.drop_index('ix_je_lines_entry', 'journal_entry_lines')
    op.drop_table('journal_entry_lines')
    op.drop_index('ix_journal_entries_date', 'journal_entries')
    op.drop_index('ix_journal_entries_status', 'journal_entries')
    op.drop_index('ix_journal_entries_no', 'journal_entries')
    op.drop_table('journal_entries')
    op.drop_index('ix_chart_of_accounts_code', 'chart_of_accounts')
    op.drop_table('chart_of_accounts')
