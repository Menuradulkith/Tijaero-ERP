"""Add transfer workflow columns

Adds:
- status column to item_transfer_note table
- location_id column to sales_stock table

Revision ID: add_transfer_workflow
Revises: 
Create Date: 2026-01-13
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_transfer_workflow'
down_revision = 'update_location_fk_cascade'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add status column to item_transfer_note
    op.add_column('item_transfer_note', 
        sa.Column('status', sa.String(50), nullable=False, server_default='pending')
    )
    
    # Add location_id column to sales_stock
    op.add_column('sales_stock',
        sa.Column('location_id', sa.Integer(), nullable=True)
    )
    
    # Add foreign key for location_id
    op.create_foreign_key(
        'fk_sales_stock_location',
        'sales_stock',
        'good_received_locations',
        ['location_id'],
        ['id']
    )


def downgrade() -> None:
    # Remove foreign key
    op.drop_constraint('fk_sales_stock_location', 'sales_stock', type_='foreignkey')
    
    # Remove columns
    op.drop_column('sales_stock', 'location_id')
    op.drop_column('item_transfer_note', 'status')
