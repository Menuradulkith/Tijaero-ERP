"""Product tax rate + purchase-order line tax rate snapshot

Revision ID: s125_po_line_tax
Revises: s124_customer_contact_active
Create Date: 2026-11-05
"""
import sqlalchemy as sa
from alembic import op

revision = 's125_po_line_tax'
down_revision = 's124_customer_contact_active'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('products', sa.Column('tax_rate', sa.Numeric(5, 2), nullable=False, server_default='0'))
    op.add_column('purchasing_order_items', sa.Column('tax_rate', sa.Numeric(5, 2), nullable=False, server_default='0'))


def downgrade() -> None:
    op.drop_column('purchasing_order_items', 'tax_rate')
    op.drop_column('products', 'tax_rate')
