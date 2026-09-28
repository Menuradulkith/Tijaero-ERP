"""Add purchase_batch_id to purchasing_orders and required_date to purchasing_order_items

Revision ID: s68_po_batch_required_date
Revises: s67_supplier_unique_guards
Create Date: 2026-09-27

Supports the product-first, multi-supplier PO creation flow:
- purchase_batch_id: shared UUID string set on every PurchasingOrder created
  in the same multi-supplier checkout (PurchasingOrderService.create_order_batch),
  so the UI can show sibling POs that came from one purchase. NULL for POs
  created the normal single-supplier way.
- required_date: optional per-line "needed by" date, distinct from the
  order-level good_received_note_date.
"""
from alembic import op
import sqlalchemy as sa

revision = 's68_po_batch_required_date'
down_revision = 's67_supplier_unique_guards'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('purchasing_orders', sa.Column('purchase_batch_id', sa.String(length=36), nullable=True))
    op.create_index('ix_purchasing_orders_purchase_batch_id', 'purchasing_orders', ['purchase_batch_id'])
    op.add_column('purchasing_order_items', sa.Column('required_date', sa.Date(), nullable=True))


def downgrade() -> None:
    op.drop_column('purchasing_order_items', 'required_date')
    op.drop_index('ix_purchasing_orders_purchase_batch_id', table_name='purchasing_orders')
    op.drop_column('purchasing_orders', 'purchase_batch_id')
