"""create sales_stock table for GRN items

Revision ID: add_grn_item_type
Revises: add_po_status
Create Date: 2025-01-15

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_grn_item_type'
down_revision: Union[str, None] = 'add_po_status'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create sales_stock table for items received from GRN that are available for sale
    # Items are grouped under their product_id - same product from different POs goes to same product group
    op.create_table('sales_stock',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('barcode', sa.Text(), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=False),
        sa.Column('good_received_note_id', sa.Integer(), nullable=False),
        sa.Column('purchasing_order_items_id', sa.Integer(), nullable=False),
        sa.Column('warranty_month', sa.String(30), nullable=True),  # From PO or entered in GRN
        sa.Column('status', sa.String(50), nullable=False, server_default='available'),
        sa.Column('added_date', sa.TIMESTAMP(), nullable=False),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ),
        sa.ForeignKeyConstraint(['good_received_note_id'], ['good_received_note.id'], ),
        sa.ForeignKeyConstraint(['purchasing_order_items_id'], ['purchasing_order_items.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('barcode', name='uq_sales_stock_barcode')  # Same barcode should never store twice
    )
    op.create_index(op.f('ix_sales_stock_id'), 'sales_stock', ['id'], unique=False)
    op.create_index(op.f('ix_sales_stock_barcode'), 'sales_stock', ['barcode'], unique=True)  # Unique index
    op.create_index(op.f('ix_sales_stock_status'), 'sales_stock', ['status'], unique=False)
    op.create_index(op.f('ix_sales_stock_product_id'), 'sales_stock', ['product_id'], unique=False)  # Index for product grouping
    
    # Upgrade company_assets table - add new columns for GRN tracking
    # These are the REAL columns, existing ones just get new additions
    op.add_column('company_assets', sa.Column('warranty_month', sa.String(30), nullable=True))
    op.add_column('company_assets', sa.Column('good_received_note_id', sa.Integer(), nullable=True))
    op.add_column('company_assets', sa.Column('purchasing_order_items_id', sa.Integer(), nullable=True))
    op.add_column('company_assets', sa.Column('status', sa.String(50), nullable=False, server_default='available'))
    op.add_column('company_assets', sa.Column('added_date', sa.TIMESTAMP(), nullable=True))
    
    # Add foreign keys for company_assets
    op.create_foreign_key('fk_company_assets_grn', 'company_assets', 'good_received_note', ['good_received_note_id'], ['id'])
    op.create_foreign_key('fk_company_assets_po_item', 'company_assets', 'purchasing_order_items', ['purchasing_order_items_id'], ['id'])
    
    # Make barcode and inventory_no unique in company_assets
    op.create_index('ix_company_assets_barcode', 'company_assets', ['barcode'], unique=True)
    op.create_index('ix_company_assets_inventory_no', 'company_assets', ['inventory_no'], unique=True)


def downgrade() -> None:
    # Remove company_assets updates
    op.drop_index('ix_company_assets_inventory_no', table_name='company_assets')
    op.drop_index('ix_company_assets_barcode', table_name='company_assets')
    op.drop_constraint('fk_company_assets_po_item', 'company_assets', type_='foreignkey')
    op.drop_constraint('fk_company_assets_grn', 'company_assets', type_='foreignkey')
    op.drop_column('company_assets', 'added_date')
    op.drop_column('company_assets', 'status')
    op.drop_column('company_assets', 'purchasing_order_items_id')
    op.drop_column('company_assets', 'good_received_note_id')
    op.drop_column('company_assets', 'warranty_month')
    
    # Remove sales_stock table
    op.drop_index(op.f('ix_sales_stock_product_id'), table_name='sales_stock')
    op.drop_index(op.f('ix_sales_stock_status'), table_name='sales_stock')
    op.drop_index(op.f('ix_sales_stock_barcode'), table_name='sales_stock')
    op.drop_index(op.f('ix_sales_stock_id'), table_name='sales_stock')
    op.drop_constraint('uq_sales_stock_barcode', 'sales_stock', type_='unique')
    op.drop_table('sales_stock')
