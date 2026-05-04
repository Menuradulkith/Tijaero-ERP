"""add purchase invoice tables

Revision ID: add_purchase_invoices
Revises: 
Create Date: 2026-05-02

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_purchase_invoices'
down_revision = '2d3a3f0d6240'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Purchase Invoices (Supplier Bills)
    op.create_table(
        'purchase_invoices',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('invoice_no', sa.String(200), unique=True, nullable=False, index=True),
        sa.Column('supplier_invoice_no', sa.String(200), nullable=False),
        sa.Column('supplier_invoice_date', sa.Date(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), sa.ForeignKey('supplier.id'), nullable=False, index=True),
        sa.Column('branch_code', sa.String(200), nullable=False, index=True),
        sa.Column('received_date', sa.Date(), nullable=False),
        sa.Column('due_date', sa.Date(), nullable=False),
        sa.Column('subtotal', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('tax_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('discount_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('total_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('paid_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('balance_due', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('status', sa.String(30), nullable=False, server_default='draft', index=True),
        sa.Column('payment_status', sa.String(30), nullable=False, server_default='unpaid', index=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('verified_by', sa.Integer(), nullable=True),
        sa.Column('verified_date', sa.TIMESTAMP(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.UniqueConstraint('supplier_id', 'supplier_invoice_no', name='uq_supplier_invoice'),
    )
    op.create_index('idx_pi_supplier_status', 'purchase_invoices', ['supplier_id', 'status'])
    op.create_index('idx_pi_due_date', 'purchase_invoices', ['due_date'])

    # Purchase Invoice Items
    op.create_table(
        'purchase_invoice_items',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('purchase_invoice_id', sa.Integer(), sa.ForeignKey('purchase_invoices.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('grn_id', sa.Integer(), sa.ForeignKey('good_received_note.id'), nullable=False, index=True),
        sa.Column('purchasing_order_id', sa.Integer(), sa.ForeignKey('purchasing_orders.id'), nullable=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id'), nullable=True),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('unit_price', sa.Numeric(18, 2), nullable=False),
        sa.Column('line_total', sa.Numeric(18, 2), nullable=False),
        sa.Column('tax_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
    )

    # Purchase Invoice Payments (M:N allocation)
    op.create_table(
        'purchase_invoice_payments',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('purchase_invoice_id', sa.Integer(), sa.ForeignKey('purchase_invoices.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('supplier_payment_id', sa.Integer(), sa.ForeignKey('supplier_payments.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('allocated_amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('allocated_date', sa.Date(), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.UniqueConstraint('purchase_invoice_id', 'supplier_payment_id', name='uq_invoice_payment'),
    )
    op.create_index('idx_pip_payment', 'purchase_invoice_payments', ['supplier_payment_id'])


def downgrade() -> None:
    op.drop_table('purchase_invoice_payments')
    op.drop_table('purchase_invoice_items')
    op.drop_table('purchase_invoices')
