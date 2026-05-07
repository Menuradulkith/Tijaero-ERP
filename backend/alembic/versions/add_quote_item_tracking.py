"""Add per-item conversion tracking to sales_quote_items and PARTIALLY_CONVERTED status

Revision ID: add_quote_item_tracking
Revises: add_proforma_to_customer_advance
Create Date: 2026-05-07
"""
from alembic import op
import sqlalchemy as sa

revision = 'add_quote_item_tracking'
down_revision = 'add_proforma_to_customer_advance'
branch_labels = None
depends_on = None


def upgrade():
    # Add item_status column to sales_quote_items
    op.add_column(
        'sales_quote_items',
        sa.Column('item_status', sa.String(30), nullable=False, server_default='pending')
    )
    # Add converted_qty column to sales_quote_items
    op.add_column(
        'sales_quote_items',
        sa.Column('converted_qty', sa.Integer(), nullable=False, server_default='0')
    )
    # No DB-level enum change needed — status is stored as String(30) already


def downgrade():
    op.drop_column('sales_quote_items', 'converted_qty')
    op.drop_column('sales_quote_items', 'item_status')
