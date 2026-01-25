"""Add coupon_products junction table for multiple product restrictions

Revision ID: add_coupon_products_m2m
Revises: add_coupon_enhancements
Create Date: 2026-01-25
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'add_coupon_products_m2m'
down_revision: Union[str, None] = 'add_coupon_enhancements'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create coupon_products junction table for many-to-many relationship
    op.create_table(
        'coupon_products',
        sa.Column('coupon_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['coupon_id'], ['customer_cupon_codes.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('coupon_id', 'product_id')
    )
    
    # Migrate existing single product restrictions to the new many-to-many table
    op.execute("""
        INSERT INTO coupon_products (coupon_id, product_id)
        SELECT id, limit_validity_product_id
        FROM customer_cupon_codes
        WHERE limit_validity_product_id IS NOT NULL
    """)


def downgrade() -> None:
    # Drop the junction table
    op.drop_table('coupon_products')
