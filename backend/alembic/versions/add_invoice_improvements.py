"""Add invoice tax discount and payment tracking fields

Revision ID: add_invoice_improvements
Revises: c4056dbbf1f4
Create Date: 2026-01-18
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_invoice_improvements'
down_revision = 'c4056dbbf1f4'  # Revises add_approval_status_to_invoices
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add tax fields to invoices table
    op.add_column('invoices', sa.Column('tax_rate', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.add_column('invoices', sa.Column('tax_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    
    # Add discount fields to invoices table
    op.add_column('invoices', sa.Column('discount_percent', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.add_column('invoices', sa.Column('discount_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    
    # Add totals fields to invoices table
    op.add_column('invoices', sa.Column('subtotal', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('invoices', sa.Column('grand_total', sa.Numeric(60, 2), nullable=False, server_default='0'))
    
    # Add service charge fields to invoices table
    op.add_column('invoices', sa.Column('service_charge_rate', sa.Numeric(5, 3), nullable=False, server_default='0'))
    op.add_column('invoices', sa.Column('service_charge_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    
    # Add payment tracking fields to invoices table
    op.add_column('invoices', sa.Column('paid_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('invoices', sa.Column('balance_due', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('invoices', sa.Column('payment_status', sa.String(30), nullable=False, server_default='unpaid'))
    
    # Add tax and discount fields to invoice_items table
    op.add_column('invoice_items', sa.Column('tax_rate', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.add_column('invoice_items', sa.Column('tax_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('invoice_items', sa.Column('discount_percent', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.add_column('invoice_items', sa.Column('discount_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('invoice_items', sa.Column('line_total', sa.Numeric(60, 2), nullable=False, server_default='0'))
    
    # Add barcode and sales_stock_id to invoice_items for stock tracking
    op.add_column('invoice_items', sa.Column('barcode', sa.String(100), nullable=True))
    op.add_column('invoice_items', sa.Column('sales_stock_id', sa.Integer(), nullable=True))
    op.create_foreign_key('fk_invoice_items_sales_stock', 'invoice_items', 'sales_stock', ['sales_stock_id'], ['id'])


def downgrade() -> None:
    # Remove foreign key and stock tracking columns from invoice_items
    op.drop_constraint('fk_invoice_items_sales_stock', 'invoice_items', type_='foreignkey')
    op.drop_column('invoice_items', 'sales_stock_id')
    op.drop_column('invoice_items', 'barcode')
    
    # Remove columns from invoice_items
    op.drop_column('invoice_items', 'line_total')
    op.drop_column('invoice_items', 'discount_amount')
    op.drop_column('invoice_items', 'discount_percent')
    op.drop_column('invoice_items', 'tax_amount')
    op.drop_column('invoice_items', 'tax_rate')
    
    # Remove columns from invoices
    op.drop_column('invoices', 'payment_status')
    op.drop_column('invoices', 'balance_due')
    op.drop_column('invoices', 'paid_amount')
    op.drop_column('invoices', 'service_charge_amount')
    op.drop_column('invoices', 'service_charge_rate')
    op.drop_column('invoices', 'grand_total')
    op.drop_column('invoices', 'subtotal')
    op.drop_column('invoices', 'discount_amount')
    op.drop_column('invoices', 'discount_percent')
    op.drop_column('invoices', 'tax_amount')
    op.drop_column('invoices', 'tax_rate')
