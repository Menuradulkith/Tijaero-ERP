"""add image_url to products

Revision ID: add_image_url_to_products
Revises: 
Create Date: 2025-01-01 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_image_url_to_products'
down_revision = 's11_15_quote_enhance'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('products', sa.Column('image_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('products', 'image_url')
