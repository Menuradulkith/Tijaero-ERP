"""Simplify finance for Sri Lankan SMEs: drop payment-term list, per-account cost-center rule, tax-code split

Revision ID: s121_simplify_finance
Revises: s120_fixed_assets_period_end
Create Date: 2026-11-01

- payment_terms + customers/supplier.payment_term_id: credit days (already on
  every customer / supplier form) decide due dates; invoices.due_date stays.
- chart_of_accounts.requires_cost_center: branch default cost centers suffice.
- posting rules can no longer split by tax code (one VAT regime).
"""
import sqlalchemy as sa
from alembic import op

revision = 's121_simplify_finance'
down_revision = 's120_fixed_assets_period_end'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('customers', 'payment_term_id')
    op.drop_column('supplier', 'payment_term_id')
    op.drop_table('payment_terms')
    op.drop_column('chart_of_accounts', 'requires_cost_center')
    op.execute("DELETE FROM posting_rules WHERE control_type = 'tax_code'")
    op.drop_constraint('ck_posting_rules_control_type', 'posting_rules', type_='check')
    op.create_check_constraint(
        'ck_posting_rules_control_type', 'posting_rules',
        "control_type IN ('none', 'branch', 'expense_category')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_posting_rules_control_type', 'posting_rules', type_='check')
    op.create_check_constraint(
        'ck_posting_rules_control_type', 'posting_rules',
        "control_type IN ('none', 'branch', 'expense_category', 'tax_code')",
    )
    op.add_column('chart_of_accounts', sa.Column('requires_cost_center', sa.Boolean(), nullable=False,
                                                 server_default=sa.false()))
    op.create_table(
        'payment_terms',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('end_of_month', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    )
    op.add_column('customers', sa.Column('payment_term_id', sa.Integer(), sa.ForeignKey('payment_terms.id'), nullable=True))
    op.add_column('supplier', sa.Column('payment_term_id', sa.Integer(), sa.ForeignKey('payment_terms.id'), nullable=True))
