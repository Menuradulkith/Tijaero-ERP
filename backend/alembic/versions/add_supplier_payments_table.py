"""Add supplier_payments table

Revision ID: add_supplier_payments
Revises: e1f2a3b4c5d6
Create Date: 2026-01-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_supplier_payments'
down_revision: Union[str, Sequence[str], None] = 'e1f2a3b4c5d6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create supplier_payments table
    op.create_table(
        'supplier_payments',
        sa.Column('id', sa.Integer(), nullable=False, primary_key=True),
        sa.Column('payment_no', sa.String(200), nullable=False, unique=True),
        sa.Column('supplier_id', sa.Integer(), sa.ForeignKey('supplier.id'), nullable=False),
        sa.Column('purchasing_order_id', sa.Integer(), sa.ForeignKey('purchasing_orders.id'), nullable=True),
        sa.Column('payment_date', sa.Date(), nullable=False),
        sa.Column('payment_method', sa.String(30), nullable=False),
        sa.Column('payment_amount', sa.Numeric(60, 2), nullable=False),
        sa.Column('reference_number', sa.String(300), nullable=True),
        sa.Column('bank_name', sa.String(255), nullable=True),
        sa.Column('branch_code', sa.String(200), nullable=False),
        sa.Column('payment_for', sa.String(100), nullable=False),
        sa.Column('invoice_reference', sa.String(200), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('status', sa.String(30), nullable=False, server_default='pending'),
        sa.Column('verified_by', sa.Integer(), nullable=True),  # No FK - users table may not exist
        sa.Column('verified_date', sa.TIMESTAMP(), nullable=True),
        sa.Column('created_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),  # No FK - users table may not exist
    )
    
    # Create indexes
    op.create_index('ix_supplier_payments_supplier_id', 'supplier_payments', ['supplier_id'])
    op.create_index('ix_supplier_payments_branch_code', 'supplier_payments', ['branch_code'])
    op.create_index('ix_supplier_payments_payment_date', 'supplier_payments', ['payment_date'])
    op.create_index('ix_supplier_payments_status', 'supplier_payments', ['status'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_supplier_payments_status', 'supplier_payments')
    op.drop_index('ix_supplier_payments_payment_date', 'supplier_payments')
    op.drop_index('ix_supplier_payments_branch_code', 'supplier_payments')
    op.drop_index('ix_supplier_payments_supplier_id', 'supplier_payments')
    
    # Drop table
    op.drop_table('supplier_payments')
