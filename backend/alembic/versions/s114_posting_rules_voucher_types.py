"""Posting rules (configurable GL accounts per posting type) and voucher types

Revision ID: s114_posting_rules_voucher_types
Revises: s113_po_no_payment_method
Create Date: 2026-10-31

posting_rules / posting_rule_details let Finance re-point an automatic posting
type (CASH, BANK, INVENTORY, EXPENSE, ...) to another account, optionally per
branch or expense category. No rows are seeded: with no rule every posting type
keeps its built-in default account, so postings do not change.

voucher_types names the source of each journal entry; journal_entries gets a
voucher_type column, backfilled from the JE number prefix
(JE-SALE-202610-0001 -> SALE, JE-202610-0001 -> MJ, Closing entries -> YE).
"""
import sqlalchemy as sa
from alembic import op

revision = 's114_posting_rules_voucher_types'
down_revision = 's113_po_no_payment_method'
branch_labels = None
depends_on = None

VOUCHER_TYPES = [
    ("MJ", "Manual journal", "finance", True, "Journal entries typed by accountants, their reversals and corrections."),
    ("YE", "Year-end closing", "finance", False, "Closing entries that move the year's profit to retained earnings."),
    ("SALE", "Sales", "sales", False, "Sales invoices, returns, discounts, cost of sales and gift vouchers."),
    ("PUR", "Purchasing", "purchasing", False, "Goods received, landed costs, supplier payments, returns and credits."),
    ("ADV", "Supplier advances", "purchasing", False, "Advances paid to suppliers, their returns and application."),
    ("EXP", "Expenses", "finance", False, "Paid expenses and expense reclassifications."),
    ("PAY", "Payroll", "hr", False, "Monthly payroll batches."),
    ("STT", "Statutory payments", "hr", False, "EPF, ETF and APIT payments."),
    ("COM", "Commissions", "hr", False, "Sales commission payments."),
    ("RMB", "Reimbursements", "hr", False, "Employee reimbursement payments."),
    ("BNK", "Bank deposits", "finance", False, "Cash and cheques deposited to the bank."),
    ("CAD", "Customer advances", "customers", False, "Advances received from customers."),
    ("CAA", "Customer advance applied", "customers", False, "Customer advances used on invoices."),
    ("CAA-REV", "Customer advance reversed", "customers", False, "Reversal of an applied customer advance."),
    ("CCN", "Customer credit notes", "customers", False, "Credit notes issued to customers."),
    ("CST", "Customer credit settlement", "customers", False, "Customer credit balances settled."),
    ("PCF", "Petty cash funding", "finance", False, "Money moved from bank into a petty cash fund."),
    ("PCE", "Petty cash expense", "finance", False, "Expenses paid from petty cash."),
    ("PCR", "Petty cash replenishment", "finance", False, "Petty cash topped up from the bank."),
    ("PCC", "Petty cash closing", "finance", False, "Petty cash returned to the bank when a fund closes."),
    ("PCD", "Petty cash difference", "finance", False, "Shortages and overages found when counting petty cash."),
    ("MFG", "Manufacturing", "manufacturing", False, "Material issues, labour, output and production variance."),
    ("AUTO", "Other automatic", "finance", False, "Automatic postings without a more specific type."),
]


def _audit_columns():
    return [
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'posting_rules',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('posting_type', sa.String(50), nullable=False, unique=True),
        sa.Column('control_type', sa.String(30), nullable=False, server_default='none'),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        *_audit_columns(),
        sa.CheckConstraint("control_type IN ('none', 'branch', 'expense_category')", name='ck_posting_rules_control_type'),
    )
    op.create_index('ix_posting_rules_id', 'posting_rules', ['id'])
    op.create_index('ix_posting_rules_account_id', 'posting_rules', ['account_id'])

    op.create_table(
        'posting_rule_details',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('rule_id', sa.Integer(), sa.ForeignKey('posting_rules.id', ondelete='CASCADE'), nullable=False),
        sa.Column('control_value', sa.String(100), nullable=False),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        *_audit_columns(),
        sa.UniqueConstraint('rule_id', 'control_value', name='posting_rule_details_unique'),
    )
    op.create_index('ix_posting_rule_details_id', 'posting_rule_details', ['id'])
    op.create_index('ix_posting_rule_details_account_id', 'posting_rule_details', ['account_id'])

    voucher_types = op.create_table(
        'voucher_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('source_module', sa.String(50), nullable=True),
        sa.Column('is_manual', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        *_audit_columns(),
    )
    op.create_index('ix_voucher_types_id', 'voucher_types', ['id'])
    op.bulk_insert(voucher_types, [
        {"code": c, "name": n, "source_module": m, "is_manual": manual, "description": d, "is_active": True}
        for c, n, m, manual, d in VOUCHER_TYPES
    ])

    op.add_column('journal_entries', sa.Column('voucher_type', sa.String(20), nullable=True))
    op.execute("""
        UPDATE journal_entries
        SET voucher_type = CASE
            WHEN entry_type = 'Closing' THEN 'YE'
            WHEN regexp_replace(journal_entry_no, '-[0-9]{6}-[0-9]+$', '') = 'JE' THEN 'MJ'
            WHEN journal_entry_no LIKE 'JE-%%'
                THEN left(substr(regexp_replace(journal_entry_no, '-[0-9]{6}-[0-9]+$', ''), 4), 20)
            ELSE 'AUTO'
        END
    """)
    op.create_index('ix_journal_entries_voucher_type', 'journal_entries', ['voucher_type'])


def downgrade() -> None:
    op.drop_index('ix_journal_entries_voucher_type', table_name='journal_entries')
    op.drop_column('journal_entries', 'voucher_type')
    op.drop_table('voucher_types')
    op.drop_table('posting_rule_details')
    op.drop_table('posting_rules')
