"""Drop supplier_product.lead_time_days

Revision ID: s59_drop_supplier_lead_time
Revises: s58_supplier_products
Create Date: 2026-09-24

Lead time per supplier-product mapping is no longer tracked; the
supplier-level average_lead_time_days (computed from actual PO/GRN
delivery history) is unaffected and remains in place.
"""
from alembic import op
import sqlalchemy as sa

revision = 's59_drop_supplier_lead_time'
down_revision = 's58_supplier_products'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('supplier_product', 'lead_time_days')


def downgrade() -> None:
    op.add_column('supplier_product', sa.Column('lead_time_days', sa.Integer(), nullable=True))
