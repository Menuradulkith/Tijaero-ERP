"""Add quantity / batch fields to good_received_items

Revision ID: s91_grn_items_quantity_batch
Revises: s90_product_tracking_type
Create Date: 2026-10-11

Batch- and none-tracked products are received as one GRN line carrying a
quantity (no per-unit barcode), so good_received_items needs:

- quantity: units the row represents. Backfilled to 1 (every existing row is
  a single serial unit).
- batch_no / expiry_date: lot details for batch-tracked receipts.
- barcode becomes nullable (NULL for batch/none receipts).
"""
from alembic import op
import sqlalchemy as sa

revision = 's91_grn_items_quantity_batch'
down_revision = 's90_product_tracking_type'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'good_received_items',
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
    )
    op.add_column('good_received_items', sa.Column('batch_no', sa.String(100), nullable=True))
    op.add_column('good_received_items', sa.Column('expiry_date', sa.Date(), nullable=True))
    op.create_check_constraint('ck_good_received_items_quantity_positive', 'good_received_items', 'quantity >= 1')
    op.alter_column('good_received_items', 'barcode', existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    op.execute("DELETE FROM good_received_items WHERE barcode IS NULL")
    op.alter_column('good_received_items', 'barcode', existing_type=sa.Text(), nullable=False)
    op.drop_constraint('ck_good_received_items_quantity_positive', 'good_received_items', type_='check')
    op.drop_column('good_received_items', 'expiry_date')
    op.drop_column('good_received_items', 'batch_no')
    op.drop_column('good_received_items', 'quantity')
