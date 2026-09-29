"""Add reserved_for_quote_item_id to sales_stock

Revision ID: s73_sales_stock_reservation
Revises: s72_procurement_queue
Create Date: 2026-09-28

Supports the Sales Quotation -> PO -> GRN stock reservation workflow: when a
GRN is received against a PO line that traces back to a Sales Quotation item,
the received units are committed to that quotation instead of the general
available pool. NULL for stock received against ordinary, quote-less POs.
"""
from alembic import op
import sqlalchemy as sa

revision = 's73_sales_stock_reservation'
down_revision = 's72_procurement_queue'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'sales_stock',
        sa.Column('reserved_for_quote_item_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_sales_stock_reserved_for_quote_item',
        'sales_stock', 'sales_quote_items',
        ['reserved_for_quote_item_id'], ['id'],
    )
    op.create_index(
        'ix_sales_stock_reserved_for_quote_item_id',
        'sales_stock', ['reserved_for_quote_item_id'],
    )


def downgrade() -> None:
    op.drop_index('ix_sales_stock_reserved_for_quote_item_id', table_name='sales_stock')
    op.drop_constraint('fk_sales_stock_reserved_for_quote_item', 'sales_stock', type_='foreignkey')
    op.drop_column('sales_stock', 'reserved_for_quote_item_id')
