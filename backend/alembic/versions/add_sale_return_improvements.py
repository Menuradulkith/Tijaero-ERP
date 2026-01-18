"""Add sale return status, totals, and item improvements

Revision ID: add_sale_return_improvements
Revises: add_invoice_improvements
Create Date: 2026-01-18
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_sale_return_improvements'
down_revision = 'add_invoice_improvements'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add status and tracking fields to sale_return table
    op.add_column('sale_return', sa.Column('status', sa.String(30), nullable=False, server_default='pending'))
    op.add_column('sale_return', sa.Column('return_reason', sa.String(100), nullable=True))
    
    # Add totals fields
    op.add_column('sale_return', sa.Column('subtotal', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('sale_return', sa.Column('tax_refund', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('sale_return', sa.Column('total_refund', sa.Numeric(60, 2), nullable=False, server_default='0'))
    
    # Add refund tracking fields
    op.add_column('sale_return', sa.Column('refund_status', sa.String(30), nullable=False, server_default='pending'))
    op.add_column('sale_return', sa.Column('refund_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('sale_return', sa.Column('refund_date', sa.Date(), nullable=True))
    op.add_column('sale_return', sa.Column('refund_reference', sa.String(200), nullable=True))
    op.add_column('sale_return', sa.Column('credit_note_id', sa.Integer(), nullable=True))
    
    # Add user tracking
    op.add_column('sale_return', sa.Column('created_by', sa.Integer(), nullable=True))
    op.add_column('sale_return', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('sale_return', sa.Column('processed_by', sa.Integer(), nullable=True))
    
    # Add timestamps using TimestampMixin pattern
    op.add_column('sale_return', sa.Column('created_at', sa.TIMESTAMP(), nullable=True, server_default=sa.func.now()))
    op.add_column('sale_return', sa.Column('updated_at', sa.TIMESTAMP(), nullable=True, server_default=sa.func.now()))
    
    # Add foreign keys (skip user FKs if users table doesn't exist yet)
    op.create_foreign_key('fk_sale_return_credit_note', 'sale_return', 'customer_credit_notes', ['credit_note_id'], ['id'])
    
    # Note: User foreign keys are defined in the model but not enforced at DB level in this migration
    # to avoid dependency issues. The application layer handles the relationship.
    
    # Add fields to sale_return_items table
    op.add_column('sale_return_items', sa.Column('sales_stock_id', sa.Integer(), nullable=True))
    op.add_column('sale_return_items', sa.Column('product_id', sa.Integer(), nullable=True))
    op.add_column('sale_return_items', sa.Column('quantity', sa.Integer(), nullable=False, server_default='1'))
    op.add_column('sale_return_items', sa.Column('condition', sa.String(50), nullable=False, server_default='good'))
    op.add_column('sale_return_items', sa.Column('restockable', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('sale_return_items', sa.Column('restocked', sa.Boolean(), nullable=False, server_default='false'))
    
    # Add timestamps to sale_return_items
    op.add_column('sale_return_items', sa.Column('created_at', sa.TIMESTAMP(), nullable=True, server_default=sa.func.now()))
    op.add_column('sale_return_items', sa.Column('updated_at', sa.TIMESTAMP(), nullable=True, server_default=sa.func.now()))
    
    # Add foreign keys for sale_return_items
    op.create_foreign_key('fk_sale_return_items_sales_stock', 'sale_return_items', 'sales_stock', ['sales_stock_id'], ['id'])
    op.create_foreign_key('fk_sale_return_items_product', 'sale_return_items', 'products', ['product_id'], ['id'])


def downgrade() -> None:
    # Drop foreign keys from sale_return_items
    op.drop_constraint('fk_sale_return_items_product', 'sale_return_items', type_='foreignkey')
    op.drop_constraint('fk_sale_return_items_sales_stock', 'sale_return_items', type_='foreignkey')
    
    # Drop columns from sale_return_items
    op.drop_column('sale_return_items', 'updated_at')
    op.drop_column('sale_return_items', 'created_at')
    op.drop_column('sale_return_items', 'restocked')
    op.drop_column('sale_return_items', 'restockable')
    op.drop_column('sale_return_items', 'condition')
    op.drop_column('sale_return_items', 'quantity')
    op.drop_column('sale_return_items', 'product_id')
    op.drop_column('sale_return_items', 'sales_stock_id')
    
    # Drop foreign keys from sale_return
    op.drop_constraint('fk_sale_return_credit_note', 'sale_return', type_='foreignkey')
    
    # Drop columns from sale_return
    op.drop_column('sale_return', 'updated_at')
    op.drop_column('sale_return', 'created_at')
    op.drop_column('sale_return', 'processed_by')
    op.drop_column('sale_return', 'approved_by')
    op.drop_column('sale_return', 'created_by')
    op.drop_column('sale_return', 'credit_note_id')
    op.drop_column('sale_return', 'refund_reference')
    op.drop_column('sale_return', 'refund_date')
    op.drop_column('sale_return', 'refund_amount')
    op.drop_column('sale_return', 'refund_status')
    op.drop_column('sale_return', 'total_refund')
    op.drop_column('sale_return', 'tax_refund')
    op.drop_column('sale_return', 'subtotal')
    op.drop_column('sale_return', 'return_reason')
    op.drop_column('sale_return', 'status')
