"""Add cancellation and short-close fields to purchasing_orders

Revision ID: s74_po_cancel_short_close
Revises: s73_sales_stock_reservation
Create Date: 2026-09-30

Supports two new PO actions:
- Cancel: only allowed before any GRN has been received; sets
  status='cancelled' with a required reason (cancellation_reason,
  cancelled_date, cancelled_by).
- Short-close: only allowed once a PO is 'partially_completed', for when the
  supplier confirms no more units are coming; sets status='short_closed'
  with a required reason (short_close_reason, short_closed_date,
  short_closed_by) instead of leaving the order outstanding forever.
"""
from alembic import op
import sqlalchemy as sa

revision = 's74_po_cancel_short_close'
down_revision = 's73_sales_stock_reservation'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('purchasing_orders', sa.Column('cancellation_reason', sa.Text(), nullable=True))
    op.add_column('purchasing_orders', sa.Column('cancelled_date', sa.TIMESTAMP(), nullable=True))
    op.add_column('purchasing_orders', sa.Column('cancelled_by', sa.Integer(), nullable=True))
    op.add_column('purchasing_orders', sa.Column('short_close_reason', sa.Text(), nullable=True))
    op.add_column('purchasing_orders', sa.Column('short_closed_date', sa.TIMESTAMP(), nullable=True))
    op.add_column('purchasing_orders', sa.Column('short_closed_by', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('purchasing_orders', 'short_closed_by')
    op.drop_column('purchasing_orders', 'short_closed_date')
    op.drop_column('purchasing_orders', 'short_close_reason')
    op.drop_column('purchasing_orders', 'cancelled_by')
    op.drop_column('purchasing_orders', 'cancelled_date')
    op.drop_column('purchasing_orders', 'cancellation_reason')
