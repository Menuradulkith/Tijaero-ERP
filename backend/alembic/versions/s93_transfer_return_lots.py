"""Quantity support on transfer-note and purchase-return items

Revision ID: s93_transfer_return_lots
Revises: s92_approval_remark_text
Create Date: 2026-10-11

Batch/none-tracked stock moves in quantities, not per-barcode units:

- item_transfer_note_items.quantity (default 1) and .sales_stock_id: when a
  transfer note is approved, a lot line is allocated to (and split off as) a
  concrete sales_stock row, which this column points at.
- purchasing_return_items.quantity (default 1); barcode becomes nullable.
  return_price / purchasing_price stay PER UNIT; amounts are price * quantity.
"""
from alembic import op
import sqlalchemy as sa

revision = 's93_transfer_return_lots'
down_revision = 's92_approval_remark_text'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'item_transfer_note_items',
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
    )
    op.add_column(
        'item_transfer_note_items',
        sa.Column('sales_stock_id', sa.Integer(), sa.ForeignKey('sales_stock.id'), nullable=True),
    )
    op.create_check_constraint('ck_itn_items_quantity_positive', 'item_transfer_note_items', 'quantity >= 1')

    op.add_column(
        'purchasing_return_items',
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
    )
    op.create_check_constraint('ck_purchasing_return_items_quantity_positive', 'purchasing_return_items', 'quantity >= 1')
    op.alter_column('purchasing_return_items', 'barcode', existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM purchasing_return_items WHERE barcode IS NULL")
    op.alter_column('purchasing_return_items', 'barcode', existing_type=sa.Text(), nullable=False)
    op.drop_constraint('ck_purchasing_return_items_quantity_positive', 'purchasing_return_items', type_='check')
    op.drop_column('purchasing_return_items', 'quantity')
    op.drop_constraint('ck_itn_items_quantity_positive', 'item_transfer_note_items', type_='check')
    op.drop_column('item_transfer_note_items', 'sales_stock_id')
    op.drop_column('item_transfer_note_items', 'quantity')
