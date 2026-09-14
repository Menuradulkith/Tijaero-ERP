"""Add currencies table

Revision ID: s45_currencies
Revises: s44_product_price_tiers
Create Date: 2026-09-12

This migration:
1. Creates the currencies table (manageable list of currencies).
2. Seeds a handful of common currencies, matching the existing implicit
   default (settings.default_currency defaults to 'LKR').
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

revision = 's45_currencies'
down_revision = 's44_product_price_tiers'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'currencies',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('code', sa.String(3), nullable=False),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('symbol', sa.String(10), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        # AuditMixin columns
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_currencies_id', 'currencies', ['id'], unique=False)
    op.create_index('ix_currencies_code', 'currencies', ['code'], unique=True)

    op.execute(text("""
        INSERT INTO currencies (code, name, symbol, is_active, created_at, updated_at)
        VALUES
            ('LKR', 'Sri Lankan Rupee', 'Rs.', true, NOW(), NOW()),
            ('USD', 'US Dollar', '$', true, NOW(), NOW()),
            ('EUR', 'Euro', '€', true, NOW(), NOW()),
            ('GBP', 'British Pound', '£', true, NOW(), NOW()),
            ('INR', 'Indian Rupee', '₹', true, NOW(), NOW())
    """))


def downgrade() -> None:
    op.drop_index('ix_currencies_code', table_name='currencies')
    op.drop_index('ix_currencies_id', table_name='currencies')
    op.drop_table('currencies')
