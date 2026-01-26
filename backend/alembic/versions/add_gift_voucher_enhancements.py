"""add_gift_voucher_enhancements

Revision ID: add_gift_voucher_enhancements
Revises: fix_heads_jan18_real
Create Date: 2026-01-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_gift_voucher_enhancements'
down_revision: Union[str, Sequence[str], None] = 'fix_heads_jan18_real'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Get bind and check if it's SQLite or PostgreSQL
    conn = op.get_bind()
    dialect_name = conn.dialect.name
    
    # Create voucher_usage table using try-except to avoid errors if exists
    try:
        op.create_table('voucher_usage',
            sa.Column('id', sa.Integer(), primary_key=True, index=True),
            sa.Column('voucher_id', sa.Integer(), sa.ForeignKey('customer_gift_voucher.id'), nullable=False),
            sa.Column('invoice_id', sa.Integer(), sa.ForeignKey('invoices.id'), nullable=False),
            sa.Column('amount_used', sa.Numeric(60, 2), nullable=False),
            sa.Column('used_date', sa.TIMESTAMP, nullable=False, server_default=sa.func.now()),
        )
    except Exception as e:
        # Table might already exist
        pass
    
    # Add columns to customer_gift_voucher if they don't exist
    try:
        op.add_column('customer_gift_voucher', 
            sa.Column('balance', sa.Numeric(60, 2), nullable=False, server_default='0')
        )
    except Exception:
        pass  # Column already exists
    
    try:
        op.add_column('customer_gift_voucher', 
            sa.Column('status', sa.String(20), nullable=False, server_default='active')
        )
    except Exception:
        pass  # Column already exists
    
    try:
        op.add_column('customer_gift_voucher', 
            sa.Column('created_at', sa.TIMESTAMP, server_default=sa.func.now())
        )
    except Exception:
        pass  # Column already exists
    
    # Add gift_voucher_id and gift_voucher_amount to invoices if not exists
    try:
        op.add_column('invoices', 
            sa.Column('gift_voucher_id', sa.Integer(), sa.ForeignKey('customer_gift_voucher.id'), nullable=True)
        )
    except Exception:
        pass  # Column already exists
    
    try:
        op.add_column('invoices', 
            sa.Column('gift_voucher_amount', sa.Numeric(60, 2), nullable=False, server_default='0')
        )
    except Exception:
        pass  # Column already exists
    
    # Initialize balance from amount for existing vouchers
    try:
        op.execute("""
            UPDATE customer_gift_voucher 
            SET balance = amount 
            WHERE balance = 0 AND amount > 0
        """)
    except Exception:
        pass


def downgrade() -> None:
    # Remove added columns (be careful - this is destructive)
    op.drop_column('invoices', 'gift_voucher_amount')
    op.drop_column('invoices', 'gift_voucher_id')
    op.drop_table('voucher_usage')
    op.drop_column('customer_gift_voucher', 'created_at')
    op.drop_column('customer_gift_voucher', 'status')
    op.drop_column('customer_gift_voucher', 'balance')
