"""Implement sales and procurement gaps (2-7, P1)

- Gap 2: Change card_payments.deposited default to False
- Gap 3: Add status, confirmed_by, confirmed_date to bank_deposits
- Gap 4: Add applied_amount, remaining_amount, is_fully_applied to customer_advance_payments
- Gap 5: (No schema change - cheque auto bank deposit is logic only)
- Gap 6: (No schema change - coupon auto-deactivation is logic only)
- Gap 7: Add coupon_categories and coupon_brands association tables

Revision ID: 20260212_gaps
Revises: 20260212_tax_invoice
Create Date: 2026-02-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260212_gaps'
down_revision: Union[str, None] = '20260212_tax_invoice'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Gap 2: Change card_payments.deposited server default to False ──
    op.alter_column(
        'card_payments',
        'deposited',
        server_default=sa.text('false'),
        existing_type=sa.Boolean(),
        existing_nullable=False
    )

    # ── Gap 3: Add confirmation workflow fields to bank_deposits ──
    op.add_column('bank_deposits', sa.Column(
        'status', sa.String(30), nullable=False, server_default='pending'
    ))
    op.add_column('bank_deposits', sa.Column(
        'confirmed_by', sa.Integer(), nullable=True
    ))
    op.add_column('bank_deposits', sa.Column(
        'confirmed_date', sa.TIMESTAMP(), nullable=True
    ))

    # ── Gap 4: Add balance tracking fields to customer_advance_payments ──
    op.add_column('customer_advance_payments', sa.Column(
        'applied_amount', sa.Numeric(60, 2), nullable=False, server_default='0'
    ))
    op.add_column('customer_advance_payments', sa.Column(
        'remaining_amount', sa.Numeric(60, 2), nullable=False, server_default='0'
    ))
    op.add_column('customer_advance_payments', sa.Column(
        'is_fully_applied', sa.Boolean(), nullable=False, server_default=sa.text('false')
    ))

    # Initialize remaining_amount = payment_amount for existing records
    op.execute(
        "UPDATE customer_advance_payments SET remaining_amount = payment_amount WHERE remaining_amount = 0"
    )

    # ── Gap 7: Create coupon_categories association table ──
    op.create_table(
        'coupon_categories',
        sa.Column('coupon_id', sa.Integer(),
                  sa.ForeignKey('customer_cupon_codes.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('category_id', sa.Integer(),
                  sa.ForeignKey('category.id', ondelete='CASCADE'),
                  primary_key=True)
    )

    # ── Gap 7: Create coupon_brands association table ──
    op.create_table(
        'coupon_brands',
        sa.Column('coupon_id', sa.Integer(),
                  sa.ForeignKey('customer_cupon_codes.id', ondelete='CASCADE'),
                  primary_key=True),
        sa.Column('brand_id', sa.Integer(),
                  sa.ForeignKey('items_brand.id', ondelete='CASCADE'),
                  primary_key=True)
    )


def downgrade() -> None:
    # ── Gap 7 ──
    op.drop_table('coupon_brands')
    op.drop_table('coupon_categories')

    # ── Gap 4 ──
    op.drop_column('customer_advance_payments', 'is_fully_applied')
    op.drop_column('customer_advance_payments', 'remaining_amount')
    op.drop_column('customer_advance_payments', 'applied_amount')

    # ── Gap 3 ──
    op.drop_column('bank_deposits', 'confirmed_date')
    op.drop_column('bank_deposits', 'confirmed_by')
    op.drop_column('bank_deposits', 'status')

    # ── Gap 2 ──
    op.alter_column(
        'card_payments',
        'deposited',
        server_default=sa.text('true'),
        existing_type=sa.Boolean(),
        existing_nullable=False
    )
