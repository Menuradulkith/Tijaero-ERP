"""Add procurement_queue_items table

Revision ID: s72_procurement_queue
Revises: s71_remove_proforma
Create Date: 2026-09-28

Backs the central "TOP" page: one row per Sales Quotation item that has a
supplier chosen but no Purchase Order created for it yet. Rows are deleted
automatically once a PO is created for the item.
"""
from alembic import op
import sqlalchemy as sa

revision = 's72_procurement_queue'
down_revision = 's71_remove_proforma'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'procurement_queue_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('quote_item_id', sa.Integer(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('unit_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('added_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['quote_item_id'], ['sales_quote_items.id']),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id']),
        sa.UniqueConstraint('quote_item_id', name='uq_procurement_queue_quote_item'),
    )
    op.create_index('ix_procurement_queue_items_quote_item_id', 'procurement_queue_items', ['quote_item_id'])
    op.create_index('ix_procurement_queue_items_supplier_id', 'procurement_queue_items', ['supplier_id'])


def downgrade() -> None:
    op.drop_index('ix_procurement_queue_items_supplier_id', table_name='procurement_queue_items')
    op.drop_index('ix_procurement_queue_items_quote_item_id', table_name='procurement_queue_items')
    op.drop_table('procurement_queue_items')
