"""Add payment fields to gift voucher for cashbook tracking

Revision ID: add_voucher_payment_fields
Revises: def053c91ef9
Create Date: 2026-01-29
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_voucher_payment_fields'
down_revision = 'def053c91ef9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add payment tracking fields to customer_gift_voucher table
    # These fields enable cashbook entry creation when voucher is sold
    op.add_column('customer_gift_voucher', 
        sa.Column('payment_method', sa.String(50), nullable=True, server_default='cash')
    )
    op.add_column('customer_gift_voucher', 
        sa.Column('branch_code', sa.String(50), nullable=True)
    )
    op.add_column('customer_gift_voucher', 
        sa.Column('customer_name', sa.String(200), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('customer_gift_voucher', 'customer_name')
    op.drop_column('customer_gift_voucher', 'branch_code')
    op.drop_column('customer_gift_voucher', 'payment_method')
