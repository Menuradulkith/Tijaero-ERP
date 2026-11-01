"""Cost centers and stock movement postings (finance blueprint phase D)

Revision ID: s119_cost_centers_stock_gl
Revises: s118_write_offs_cheques
Create Date: 2026-11-01

- cost_centers (one optional default per branch); chart_of_accounts.requires_cost_center;
  cost_center_id on journal_entry_lines and general_ledger.
- New leaf account 5186 Stock Write-offs & Shrinkage; voucher type STK for
  branch transfers, damaged stock and stock moved to company assets.
"""
import sqlalchemy as sa
from alembic import op

revision = 's119_cost_centers_stock_gl'
down_revision = 's118_write_offs_cheques'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'cost_centers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('is_branch_default', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    )
    op.create_index('ix_cost_centers_id', 'cost_centers', ['id'])
    op.create_index('uq_cost_centers_branch_default', 'cost_centers', ['branch_code'], unique=True,
                    postgresql_where=sa.text('is_branch_default'))

    op.add_column('chart_of_accounts', sa.Column('requires_cost_center', sa.Boolean(), nullable=False,
                                                 server_default=sa.false()))
    op.add_column('journal_entry_lines', sa.Column('cost_center_id', sa.Integer(),
                                                   sa.ForeignKey('cost_centers.id'), nullable=True))
    op.add_column('general_ledger', sa.Column('cost_center_id', sa.Integer(),
                                              sa.ForeignKey('cost_centers.id'), nullable=True))
    op.create_index('ix_general_ledger_cost_center_id', 'general_ledger', ['cost_center_id'])

    op.execute("""
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_category,
                                       parent_account_id, is_active, is_system_account, normal_balance,
                                       description, created_at, updated_at)
        SELECT '5186', 'Stock Write-offs & Shrinkage', 'Expense', 'COGS',
               (SELECT id FROM chart_of_accounts WHERE account_code = '5000'), true, true, 'Debit',
               'Stock marked damaged or otherwise lost', now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '5186')
    """)
    op.execute("""
        INSERT INTO voucher_types (code, name, description, source_module, is_manual, is_active, created_at, updated_at)
        VALUES ('STK', 'Stock movements', 'Branch transfers, damaged stock and stock moved to company assets.',
                'inventory', false, true, now(), now())
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM voucher_types WHERE code = 'STK'")
    op.drop_index('ix_general_ledger_cost_center_id', table_name='general_ledger')
    op.drop_column('general_ledger', 'cost_center_id')
    op.drop_column('journal_entry_lines', 'cost_center_id')
    op.drop_column('chart_of_accounts', 'requires_cost_center')
    op.drop_table('cost_centers')
