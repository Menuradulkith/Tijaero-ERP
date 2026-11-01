"""Fixed assets, recurring journals, auto-reversing journals, opening balances (phase E)

Revision ID: s120_fixed_assets_period_end
Revises: s119_cost_centers_stock_gl
Create Date: 2026-11-01

- asset_classes (seeded: equipment and furniture on 1310 / 1320), fixed_assets,
  depreciation_runs / depreciation_lines.
- recurring_journals / recurring_journal_lines; journal_entries.auto_reverse_date.
- New leaf accounts 4130 Gain on Asset Disposal, 5187 Loss on Asset Disposal,
  3900 Opening Balance Equity; voucher types FA and OB.
"""
import sqlalchemy as sa
from alembic import op

revision = 's120_fixed_assets_period_end'
down_revision = 's119_cost_centers_stock_gl'
branch_labels = None
depends_on = None


def _std():
    return [
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    op.execute("""
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_category,
                                       parent_account_id, is_active, is_system_account, normal_balance,
                                       description, created_at, updated_at)
        SELECT v.code, v.name, v.type, v.cat, (SELECT id FROM chart_of_accounts WHERE account_code = v.parent),
               true, true, v.nb, v.descr, now(), now()
        FROM (VALUES
            ('4130', 'Gain on Asset Disposal', 'Revenue', 'Other', '4100', 'Credit', 'Assets sold above book value'),
            ('5187', 'Loss on Asset Disposal', 'Expense', 'Operating', '5100', 'Debit', 'Assets sold or scrapped below book value'),
            ('3900', 'Opening Balance Equity', 'Equity', 'Equity', NULL, 'Credit', 'Other side of opening balances when the books start')
        ) AS v(code, name, type, cat, parent, nb, descr)
        WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = v.code)
    """)

    op.create_table(
        'asset_classes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('asset_account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False),
        sa.Column('depreciation_method', sa.String(20), nullable=False, server_default='straight_line'),
        sa.Column('useful_life_months', sa.Integer(), nullable=False, server_default='60'),
        sa.Column('declining_rate', sa.Numeric(7, 3), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('description', sa.Text(), nullable=True),
        *_std(),
        sa.CheckConstraint("depreciation_method IN ('straight_line', 'declining')", name='ck_asset_classes_method'),
    )
    op.create_index('ix_asset_classes_id', 'asset_classes', ['id'])
    op.execute("""
        INSERT INTO asset_classes (code, name, asset_account_id, depreciation_method, useful_life_months, description)
        SELECT v.code, v.name, a.id, 'straight_line', v.months, v.descr
        FROM (VALUES ('EQUIP', 'Equipment', '1310', 60, 'Machines, computers and tools'),
                     ('FURN', 'Furniture & fittings', '1320', 96, 'Furniture, shelving and fittings')) AS v(code, name, acc, months, descr)
        JOIN chart_of_accounts a ON a.account_code = v.acc
    """)

    op.create_table(
        'fixed_assets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('asset_no', sa.String(50), nullable=False, unique=True),
        sa.Column('name', sa.String(200), nullable=False),
        sa.Column('asset_class_id', sa.Integer(), sa.ForeignKey('asset_classes.id'), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('cost_center_id', sa.Integer(), sa.ForeignKey('cost_centers.id'), nullable=True),
        sa.Column('serial_no', sa.String(100), nullable=True),
        sa.Column('location', sa.String(200), nullable=True),
        sa.Column('acquisition_date', sa.Date(), nullable=False),
        sa.Column('cost', sa.Numeric(18, 2), nullable=False),
        sa.Column('salvage_value', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('useful_life_months', sa.Integer(), nullable=False),
        sa.Column('depreciation_method', sa.String(20), nullable=False, server_default='straight_line'),
        sa.Column('declining_rate', sa.Numeric(7, 3), nullable=True),
        sa.Column('depreciation_start', sa.Date(), nullable=False),
        sa.Column('accumulated_depreciation', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='active'),
        sa.Column('acquisition_journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.Column('disposal_date', sa.Date(), nullable=True),
        sa.Column('disposal_proceeds', sa.Numeric(18, 2), nullable=True),
        sa.Column('disposal_journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        *_std(),
        sa.CheckConstraint("status IN ('active', 'fully_depreciated', 'sold', 'scrapped')", name='ck_fixed_assets_status'),
        sa.CheckConstraint("cost > 0 AND salvage_value >= 0 AND salvage_value < cost", name='ck_fixed_assets_values'),
        sa.CheckConstraint("accumulated_depreciation >= 0", name='ck_fixed_assets_accumulated'),
    )
    op.create_index('ix_fixed_assets_id', 'fixed_assets', ['id'])
    op.create_index('ix_fixed_assets_asset_class_id', 'fixed_assets', ['asset_class_id'])

    op.create_table(
        'depreciation_runs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('period_year', sa.Integer(), nullable=False),
        sa.Column('period_month', sa.Integer(), nullable=False),
        sa.Column('run_date', sa.Date(), nullable=False),
        sa.Column('total', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('status', sa.String(20), nullable=False, server_default='posted'),
        *_std(),
    )
    op.create_index('ix_depreciation_runs_id', 'depreciation_runs', ['id'])
    op.create_index('uq_depreciation_runs_posted_month', 'depreciation_runs', ['period_year', 'period_month'],
                    unique=True, postgresql_where=sa.text("status = 'posted'"))

    op.create_table(
        'depreciation_lines',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('run_id', sa.Integer(), sa.ForeignKey('depreciation_runs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('asset_id', sa.Integer(), sa.ForeignKey('fixed_assets.id'), nullable=False),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        *_std(),
    )
    op.create_index('ix_depreciation_lines_id', 'depreciation_lines', ['id'])
    op.create_index('ix_depreciation_lines_run_id', 'depreciation_lines', ['run_id'])
    op.create_index('ix_depreciation_lines_asset_id', 'depreciation_lines', ['asset_id'])

    op.create_table(
        'recurring_journals',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('frequency', sa.String(20), nullable=False, server_default='monthly'),
        sa.Column('next_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=True),
        sa.Column('auto_reverse', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('last_journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        *_std(),
        sa.CheckConstraint("frequency IN ('monthly', 'quarterly', 'yearly')", name='ck_recurring_journals_frequency'),
    )
    op.create_index('ix_recurring_journals_id', 'recurring_journals', ['id'])
    op.create_table(
        'recurring_journal_lines',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('template_id', sa.Integer(), sa.ForeignKey('recurring_journals.id', ondelete='CASCADE'), nullable=False),
        sa.Column('line_number', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False),
        sa.Column('debit_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('credit_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('cost_center_id', sa.Integer(), sa.ForeignKey('cost_centers.id'), nullable=True),
        *_std(),
    )
    op.create_index('ix_recurring_journal_lines_id', 'recurring_journal_lines', ['id'])
    op.create_index('ix_recurring_journal_lines_template_id', 'recurring_journal_lines', ['template_id'])

    op.add_column('journal_entries', sa.Column('auto_reverse_date', sa.Date(), nullable=True))

    op.execute("""
        INSERT INTO voucher_types (code, name, description, source_module, is_manual, is_active, created_at, updated_at)
        VALUES ('FA', 'Fixed assets', 'Asset purchases, depreciation and disposals.', 'finance', false, true, now(), now()),
               ('OB', 'Opening balances', 'Balances brought in when the books start.', 'finance', true, true, now(), now())
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM voucher_types WHERE code IN ('FA', 'OB')")
    op.drop_column('journal_entries', 'auto_reverse_date')
    op.drop_table('recurring_journal_lines')
    op.drop_table('recurring_journals')
    op.drop_table('depreciation_lines')
    op.drop_table('depreciation_runs')
    op.drop_table('fixed_assets')
    op.drop_table('asset_classes')
