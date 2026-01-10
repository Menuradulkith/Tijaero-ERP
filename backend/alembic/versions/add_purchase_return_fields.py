"""Add purchase return fields for soft-delete and approval workflow

Revision ID: add_purchase_return_fields
Revises: add_grn_item_type
Create Date: 2026-01-10 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_purchase_return_fields'
down_revision: Union[str, None] = 'add_grn_item_type'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new fields to sales_stock table for soft-delete tracking
    op.add_column('sales_stock', sa.Column('is_active', sa.Boolean(), nullable=True))
    op.add_column('sales_stock', sa.Column('returned_date', sa.TIMESTAMP(), nullable=True))
    op.add_column('sales_stock', sa.Column('purchase_return_id', sa.Integer(), nullable=True))
    
    # Set default value for existing rows
    op.execute("UPDATE sales_stock SET is_active = true WHERE is_active IS NULL")
    
    # Make is_active non-nullable after setting defaults
    op.alter_column('sales_stock', 'is_active', nullable=False, server_default=sa.text('true'))
    
    # Add foreign key constraint
    op.create_foreign_key(
        'fk_sales_stock_purchase_return',
        'sales_stock', 'purchasing_return',
        ['purchase_return_id'], ['id']
    )
    
    # Add new fields to purchasing_return table
    op.add_column('purchasing_return', sa.Column('status', sa.String(30), nullable=True))
    op.add_column('purchasing_return', sa.Column('approved_date', sa.TIMESTAMP(), nullable=True))
    
    # Set default value for existing rows
    op.execute("UPDATE purchasing_return SET status = 'approved' WHERE status IS NULL")
    
    # Make status non-nullable after setting defaults
    op.alter_column('purchasing_return', 'status', nullable=False, server_default=sa.text("'draft'"))
    
    # Add unique constraint to purchasing_return_no
    op.create_unique_constraint('uq_purchasing_return_no', 'purchasing_return', ['purchasing_return_no'])
    
    # Add sales_stock_id to purchasing_return_items
    op.add_column('purchasing_return_items', sa.Column('sales_stock_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'fk_purchasing_return_items_sales_stock',
        'purchasing_return_items', 'sales_stock',
        ['sales_stock_id'], ['id']
    )


def downgrade() -> None:
    # Remove foreign key and column from purchasing_return_items
    op.drop_constraint('fk_purchasing_return_items_sales_stock', 'purchasing_return_items', type_='foreignkey')
    op.drop_column('purchasing_return_items', 'sales_stock_id')
    
    # Remove unique constraint from purchasing_return
    op.drop_constraint('uq_purchasing_return_no', 'purchasing_return', type_='unique')
    
    # Remove columns from purchasing_return
    op.drop_column('purchasing_return', 'approved_date')
    op.drop_column('purchasing_return', 'status')
    
    # Remove foreign key and columns from sales_stock
    op.drop_constraint('fk_sales_stock_purchase_return', 'sales_stock', type_='foreignkey')
    op.drop_column('sales_stock', 'purchase_return_id')
    op.drop_column('sales_stock', 'returned_date')
    op.drop_column('sales_stock', 'is_active')
