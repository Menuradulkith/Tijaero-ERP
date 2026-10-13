"""Add product tracking_type and lot fields on sales_stock

Revision ID: s90_product_tracking_type
Revises: s89_hr_core
Create Date: 2026-10-11

Foundation for serial / batch / none stock tracking (Odoo/ERPNext/SAP style):

- products.tracking_type: 'serial' (one barcode per unit, the existing
  behaviour), 'batch' (lot with batch no + optional expiry) or 'none'
  (quantity only). Existing products default to 'serial'.
- sales_stock.quantity: units a row represents. Backfilled to 1, which is
  exactly what every existing (serial) row is.
- sales_stock.batch_no / expiry_date: lot details for batch-tracked stock.
- sales_stock.barcode becomes nullable so batch/none lots need no barcode.
  The unique constraint stays: Postgres allows many NULLs, so serial
  uniqueness is unchanged.
"""
from alembic import op
import sqlalchemy as sa

revision = 's90_product_tracking_type'
down_revision = 's89_hr_core'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'products',
        sa.Column('tracking_type', sa.String(10), nullable=False, server_default='serial'),
    )
    op.create_check_constraint(
        'ck_products_tracking_type',
        'products',
        "tracking_type IN ('serial', 'batch', 'none')",
    )

    op.add_column(
        'sales_stock',
        sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'),
    )
    op.add_column('sales_stock', sa.Column('batch_no', sa.String(100), nullable=True))
    op.add_column('sales_stock', sa.Column('expiry_date', sa.Date(), nullable=True))
    op.create_index('ix_sales_stock_batch_no', 'sales_stock', ['batch_no'])
    op.create_check_constraint('ck_sales_stock_quantity_positive', 'sales_stock', 'quantity >= 0')
    op.alter_column('sales_stock', 'barcode', existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    # Lots without a barcode can't be represented in the old schema.
    op.execute("DELETE FROM sales_stock WHERE barcode IS NULL")
    op.alter_column('sales_stock', 'barcode', existing_type=sa.Text(), nullable=False)
    op.drop_constraint('ck_sales_stock_quantity_positive', 'sales_stock', type_='check')
    op.drop_index('ix_sales_stock_batch_no', table_name='sales_stock')
    op.drop_column('sales_stock', 'expiry_date')
    op.drop_column('sales_stock', 'batch_no')
    op.drop_column('sales_stock', 'quantity')
    op.drop_constraint('ck_products_tracking_type', 'products', type_='check')
    op.drop_column('products', 'tracking_type')
