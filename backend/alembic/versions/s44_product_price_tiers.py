"""Add product_price_tiers table and link to invoice/quote items

Revision ID: s44_product_price_tiers
Revises: 4ea2e428576c
Create Date: 2026-07-17

This migration:
1. Creates the product_price_tiers table.
2. Inserts a default 'Default' price tier for every existing product,
   copying cost_price / selling_price / website_price from products table.
3. Adds price_tier_id FK column to invoice_items and sales_quote_items,
   linking all existing rows to their product's default tier.
4. Keeps existing price columns on 'products' intact (no columns dropped).
   They are kept for backward compatibility and can be dropped in a future migration
   once we confirm everything is working.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.sql import text

revision = 's44_product_price_tiers'
down_revision = '4ea2e428576c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. Create product_price_tiers ────────────────────────────────────────
    op.create_table(
        'product_price_tiers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('cost_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('minimum_selling_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('selling_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('website_price', sa.Numeric(60, 2), nullable=True),
        sa.Column('remark', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        # AuditMixin columns
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_product_price_tiers_id', 'product_price_tiers', ['id'], unique=False)
    op.create_index('ix_product_price_tiers_product_id', 'product_price_tiers', ['product_id'], unique=False)

    # ── 2. Seed one default tier for every existing product ──────────────────
    # selling_price may be NULL on some products; default to cost_price in that case.
    op.execute(text("""
        INSERT INTO product_price_tiers
            (product_id, cost_price, minimum_selling_price, selling_price, website_price, remark, is_active, created_at, updated_at)
        SELECT
            id,
            cost_price,
            COALESCE(selling_price, cost_price),   -- min selling = selling (or cost if NULL)
            COALESCE(selling_price, cost_price),   -- selling price
            website_price,
            'Default',
            true,
            NOW(),
            NOW()
        FROM products
    """))

    # ── 3a. Add price_tier_id to invoice_items ───────────────────────────────
    op.add_column('invoice_items', sa.Column('price_tier_id', sa.Integer(), nullable=True))
    op.create_index('ix_invoice_items_price_tier_id', 'invoice_items', ['price_tier_id'], unique=False)
    op.create_foreign_key(
        'fk_invoice_items_price_tier_id',
        'invoice_items', 'product_price_tiers',
        ['price_tier_id'], ['id'],
    )

    # Link existing invoice rows to their product's default tier
    op.execute(text("""
        UPDATE invoice_items ii
        SET price_tier_id = ppt.id
        FROM product_price_tiers ppt
        WHERE ppt.product_id = ii.product_id
          AND ppt.remark = 'Default'
    """))

    # ── 3b. Add price_tier_id to sales_quote_items ───────────────────────────
    op.add_column('sales_quote_items', sa.Column('price_tier_id', sa.Integer(), nullable=True))
    op.create_index('ix_sales_quote_items_price_tier_id', 'sales_quote_items', ['price_tier_id'], unique=False)
    op.create_foreign_key(
        'fk_sales_quote_items_price_tier_id',
        'sales_quote_items', 'product_price_tiers',
        ['price_tier_id'], ['id'],
    )

    # Link existing quote rows to their product's default tier
    op.execute(text("""
        UPDATE sales_quote_items sqi
        SET price_tier_id = ppt.id
        FROM product_price_tiers ppt
        WHERE ppt.product_id = sqi.product_id
          AND ppt.remark = 'Default'
    """))


def downgrade() -> None:
    # Remove FKs and columns from junction tables
    op.drop_constraint('fk_sales_quote_items_price_tier_id', 'sales_quote_items', type_='foreignkey')
    op.drop_index('ix_sales_quote_items_price_tier_id', table_name='sales_quote_items')
    op.drop_column('sales_quote_items', 'price_tier_id')

    op.drop_constraint('fk_invoice_items_price_tier_id', 'invoice_items', type_='foreignkey')
    op.drop_index('ix_invoice_items_price_tier_id', table_name='invoice_items')
    op.drop_column('invoice_items', 'price_tier_id')

    # Drop price tiers table
    op.drop_index('ix_product_price_tiers_product_id', table_name='product_price_tiers')
    op.drop_index('ix_product_price_tiers_id', table_name='product_price_tiers')
    op.drop_table('product_price_tiers')
