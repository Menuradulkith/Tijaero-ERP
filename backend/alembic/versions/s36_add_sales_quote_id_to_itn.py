"""Add sales_quote_id column to item_transfer_note table

Revision ID: s36_add_sales_quote_id_itn
Revises: s35_merge_all_heads
Create Date: 2026-06-15

This migration adds the missing sales_quote_id column to the item_transfer_note table,
which links transfer notes to their source sales quotations.
"""
from alembic import op
import sqlalchemy as sa


revision = "s36_add_sales_quote_id_itn"
down_revision = "s35_merge_all_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add the missing sales_quote_id column if it doesn't exist
    op.add_column(
        'item_transfer_note',
        sa.Column('sales_quote_id', sa.Integer(), nullable=True)
    )
    
    # Add the foreign key constraint
    op.create_foreign_key(
        'fk_item_transfer_note_sales_quote_id',
        'item_transfer_note',
        'sales_quotes',
        ['sales_quote_id'],
        ['id']
    )


def downgrade() -> None:
    # Drop the foreign key constraint
    op.drop_constraint(
        'fk_item_transfer_note_sales_quote_id',
        'item_transfer_note',
        type_='foreignkey'
    )
    
    # Drop the column
    op.drop_column('item_transfer_note', 'sales_quote_id')
