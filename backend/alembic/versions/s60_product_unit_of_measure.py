"""Add unit_of_measure to products

Revision ID: s60_product_unit_of_measure
Revises: s59_drop_supplier_lead_time
Create Date: 2026-09-24

Records the unit a product is stocked/sold in (piece, box, kg, ...),
selected from a fixed list of standard ERP units on the frontend. Existing
rows default to "pcs" so the column can be added NOT NULL without a
separate backfill step.
"""
from alembic import op
import sqlalchemy as sa

revision = 's60_product_unit_of_measure'
down_revision = 's59_drop_supplier_lead_time'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'products',
        sa.Column('unit_of_measure', sa.String(20), nullable=False, server_default='pcs'),
    )


def downgrade() -> None:
    op.drop_column('products', 'unit_of_measure')
