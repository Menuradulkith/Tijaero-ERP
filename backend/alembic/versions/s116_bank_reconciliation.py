"""Bank accounts and bank reconciliation (finance blueprint phase C)

Revision ID: s116_bank_reconciliation
Revises: s115_tax_codes_and_vat_ledger
Create Date: 2026-10-31

- bank_accounts (one per real account, tied to its leaf GL account), seeded
  with "Main bank account" on 1020, reconciling from its first posting.
- bank_statements / bank_statement_lines / bank_reconciliation_matches.
- New leaf accounts 5184 Bank Charges, 4120 Interest Received; voucher type BREC.
"""
import sqlalchemy as sa
from alembic import op

revision = 's116_bank_reconciliation'
down_revision = 's115_tax_codes_and_vat_ledger'
branch_labels = None
depends_on = None


def _audit():
    return [
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    ]


def _stamps():
    return [
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
    ]


def upgrade() -> None:
    op.execute("""
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_category,
                                       parent_account_id, is_active, is_system_account, normal_balance,
                                       description, created_at, updated_at)
        SELECT v.code, v.name, v.type, v.cat, (SELECT id FROM chart_of_accounts WHERE account_code = v.parent),
               true, true, v.nb, v.descr, now(), now()
        FROM (VALUES
            ('5184', 'Bank Charges', 'Expense', 'Operating', '5100', 'Debit', 'Fees charged by the bank'),
            ('4120', 'Interest Received', 'Revenue', 'Other', '4100', 'Credit', 'Interest paid by the bank')
        ) AS v(code, name, type, cat, parent, nb, descr)
        WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = v.code)
    """)

    op.create_table(
        'bank_accounts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('bank_name', sa.String(100), nullable=True),
        sa.Column('account_number', sa.String(50), nullable=True),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False, unique=True),
        sa.Column('currency', sa.String(10), nullable=False, server_default='LKR'),
        sa.Column('reconcile_from', sa.Date(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('notes', sa.Text(), nullable=True),
        *_stamps(), *_audit(),
    )
    op.create_index('ix_bank_accounts_id', 'bank_accounts', ['id'])

    op.create_table(
        'bank_statements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('bank_account_id', sa.Integer(), sa.ForeignKey('bank_accounts.id'), nullable=False),
        sa.Column('statement_no', sa.String(100), nullable=True),
        sa.Column('date_from', sa.Date(), nullable=False),
        sa.Column('date_to', sa.Date(), nullable=False),
        sa.Column('opening_balance', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('closing_balance', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='open'),
        sa.Column('reconciled_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('reconciled_by', sa.Integer(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        *_stamps(), *_audit(),
        sa.CheckConstraint("status IN ('open', 'reconciled')", name='ck_bank_statements_status'),
        sa.CheckConstraint("date_from <= date_to", name='ck_bank_statements_dates'),
    )
    op.create_index('ix_bank_statements_id', 'bank_statements', ['id'])
    op.create_index('ix_bank_statements_bank_account_id', 'bank_statements', ['bank_account_id'])

    op.create_table(
        'bank_statement_lines',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('statement_id', sa.Integer(), sa.ForeignKey('bank_statements.id', ondelete='CASCADE'), nullable=False),
        sa.Column('line_date', sa.Date(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('reference', sa.String(200), nullable=True),
        sa.Column('amount', sa.Numeric(60, 2), nullable=False),
        *_stamps(), *_audit(),
        sa.CheckConstraint("amount <> 0", name='ck_bank_statement_lines_amount'),
    )
    op.create_index('ix_bank_statement_lines_id', 'bank_statement_lines', ['id'])
    op.create_index('ix_bank_statement_lines_statement_id', 'bank_statement_lines', ['statement_id'])

    op.create_table(
        'bank_reconciliation_matches',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('statement_line_id', sa.Integer(), sa.ForeignKey('bank_statement_lines.id', ondelete='CASCADE'), nullable=False),
        sa.Column('gl_id', sa.Integer(), sa.ForeignKey('general_ledger.id'), nullable=False, unique=True),
        sa.Column('match_type', sa.String(20), nullable=False, server_default='manual'),
        *_stamps(), *_audit(),
    )
    op.create_index('ix_bank_reconciliation_matches_id', 'bank_reconciliation_matches', ['id'])
    op.create_index('ix_bank_reconciliation_matches_statement_line_id', 'bank_reconciliation_matches', ['statement_line_id'])

    op.execute("""
        INSERT INTO bank_accounts (name, bank_name, account_id, currency, reconcile_from, is_active, created_at, updated_at)
        SELECT 'Main bank account', NULL, a.id, 'LKR',
               COALESCE((SELECT min(g.transaction_date) FROM general_ledger g WHERE g.account_id = a.id), CURRENT_DATE),
               true, now(), now()
        FROM chart_of_accounts a WHERE a.account_code = '1020'
    """)
    op.execute("""
        INSERT INTO voucher_types (code, name, description, source_module, is_manual, is_active, created_at, updated_at)
        VALUES ('BREC', 'Bank statement items', 'Bank charges, interest and other items entered from a bank statement.',
                'finance', false, true, now(), now())
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM voucher_types WHERE code = 'BREC'")
    op.drop_table('bank_reconciliation_matches')
    op.drop_table('bank_statement_lines')
    op.drop_table('bank_statements')
    op.drop_table('bank_accounts')
