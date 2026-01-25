"""Add coupon enhancements and usage tracking

Revision ID: add_coupon_enhancements
Revises: 7b9e2be6f9a2
Create Date: 2026-01-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'add_coupon_enhancements'
down_revision: Union[str, None] = '7b9e2be6f9a2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add new columns to customer_cupon_codes table
    op.add_column('customer_cupon_codes', sa.Column('description', sa.String(255), nullable=True))
    op.add_column('customer_cupon_codes', sa.Column('discount_type', sa.String(20), nullable=False, server_default='PERCENT'))
    op.add_column('customer_cupon_codes', sa.Column('discount_value', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('customer_cupon_codes', sa.Column('min_invoice_amount', sa.Numeric(60, 2), nullable=False, server_default='0'))
    op.add_column('customer_cupon_codes', sa.Column('active', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('customer_cupon_codes', sa.Column('created_date', sa.TIMESTAMP(), nullable=True))
    op.add_column('customer_cupon_codes', sa.Column('validity_type', sa.String(20), nullable=False, server_default='ALL'))
    op.add_column('customer_cupon_codes', sa.Column('limit_validity_category_id', sa.Integer(), nullable=True))
    
    # Modify cupon_code column to be unique and longer
    op.alter_column('customer_cupon_codes', 'cupon_code',
                    existing_type=sa.String(10),
                    type_=sa.String(50),
                    nullable=False)
    
    # Create unique constraint on cupon_code
    op.create_unique_constraint('uq_customer_cupon_codes_cupon_code', 'customer_cupon_codes', ['cupon_code'])
    
    # Add foreign key for category
    op.create_foreign_key(
        'fk_customer_cupon_codes_category',
        'customer_cupon_codes', 'category',
        ['limit_validity_category_id'], ['id']
    )
    
    # Create coupon_usage table
    op.create_table(
        'coupon_usage',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('coupon_id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('invoice_id', sa.Integer(), nullable=False),
        sa.Column('discount_applied', sa.Numeric(60, 2), nullable=False),
        sa.Column('used_date', sa.TIMESTAMP(), nullable=False),
        sa.ForeignKeyConstraint(['coupon_id'], ['customer_cupon_codes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['customer_id'], ['customers.id']),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id']),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_coupon_usage_coupon_id'), 'coupon_usage', ['coupon_id'], unique=False)
    op.create_index(op.f('ix_coupon_usage_customer_id'), 'coupon_usage', ['customer_id'], unique=False)
    op.create_index(op.f('ix_coupon_usage_invoice_id'), 'coupon_usage', ['invoice_id'], unique=False)


def downgrade() -> None:
    # Drop coupon_usage table
    op.drop_index(op.f('ix_coupon_usage_invoice_id'), table_name='coupon_usage')
    op.drop_index(op.f('ix_coupon_usage_customer_id'), table_name='coupon_usage')
    op.drop_index(op.f('ix_coupon_usage_coupon_id'), table_name='coupon_usage')
    op.drop_table('coupon_usage')
    
    # Drop foreign key for category
    op.drop_constraint('fk_customer_cupon_codes_category', 'customer_cupon_codes', type_='foreignkey')
    
    # Drop unique constraint
    op.drop_constraint('uq_customer_cupon_codes_cupon_code', 'customer_cupon_codes', type_='unique')
    
    # Revert cupon_code column
    op.alter_column('customer_cupon_codes', 'cupon_code',
                    existing_type=sa.String(50),
                    type_=sa.String(10),
                    nullable=False)
    
    # Drop new columns
    op.drop_column('customer_cupon_codes', 'limit_validity_category_id')
    op.drop_column('customer_cupon_codes', 'validity_type')
    op.drop_column('customer_cupon_codes', 'created_date')
    op.drop_column('customer_cupon_codes', 'active')
    op.drop_column('customer_cupon_codes', 'min_invoice_amount')
    op.drop_column('customer_cupon_codes', 'discount_value')
    op.drop_column('customer_cupon_codes', 'discount_type')
    op.drop_column('customer_cupon_codes', 'description')
