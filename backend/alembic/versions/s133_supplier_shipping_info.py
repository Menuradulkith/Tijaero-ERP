"""Supplier shipping info: Incoterm, named place, shipment method

Revision ID: s133_supplier_shipping_info
Revises: s132_supplier_foreign_acct_grp
Create Date: 2026-11-18
"""
import sqlalchemy as sa
from alembic import op

revision = 's133_supplier_shipping_info'
down_revision = 's132_supplier_foreign_acct_grp'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('incoterm', sa.String(length=3), nullable=True))
    op.add_column('supplier', sa.Column('incoterm_place', sa.String(length=120), nullable=True))
    op.add_column('supplier', sa.Column('shipment_method', sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier', 'shipment_method')
    op.drop_column('supplier', 'incoterm_place')
    op.drop_column('supplier', 'incoterm')
