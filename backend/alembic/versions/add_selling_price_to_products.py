"""add selling_price to products

Revision ID: add_selling_price
Revises: bcaec621ce04
Create Date: 2026-01-12

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'add_selling_price'
down_revision = 'bcaec621ce04'  # Points to merge_heads migration
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add selling_price column to products table
    op.add_column('products', sa.Column('selling_price', sa.Numeric(60, 2), nullable=True))


def downgrade() -> None:
    # Remove selling_price column from products table
    op.drop_column('products', 'selling_price')
