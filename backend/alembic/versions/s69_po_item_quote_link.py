"""Add quote_item_id to purchasing_order_items

Revision ID: s69_po_item_quote_link
Revises: s68_po_batch_required_date
Create Date: 2026-09-27

Supports the Sales Quotation -> multi-supplier Purchase Orders workflow:
quote_item_id links a PO line back to the exact SalesQuoteItem it fulfills,
so the source quote item can be marked po_created (and not re-sourced into
another PO) once its purchase order is created.
"""
from alembic import op
import sqlalchemy as sa

revision = 's69_po_item_quote_link'
down_revision = 's68_po_batch_required_date'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('purchasing_order_items', sa.Column('quote_item_id', sa.Integer(), nullable=True))
    op.create_index('ix_purchasing_order_items_quote_item_id', 'purchasing_order_items', ['quote_item_id'])
    op.create_foreign_key(
        'fk_purchasing_order_items_quote_item_id',
        'purchasing_order_items', 'sales_quote_items',
        ['quote_item_id'], ['id'],
    )


def downgrade() -> None:
    op.drop_constraint('fk_purchasing_order_items_quote_item_id', 'purchasing_order_items', type_='foreignkey')
    op.drop_index('ix_purchasing_order_items_quote_item_id', table_name='purchasing_order_items')
    op.drop_column('purchasing_order_items', 'quote_item_id')
