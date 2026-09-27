"""Add default_currency to supplier

Revision ID: s63_supplier_default_currency
Revises: s62_supplier_tax_area
Create Date: 2026-09-25

The currency this supplier is normally billed/paid in — a 3-letter ISO
4217 code string, matching the existing Settings.default_currency
convention (no FK, options populated from the currencies table at the
API/frontend layer).
"""
from alembic import op
import sqlalchemy as sa

revision = 's63_supplier_default_currency'
down_revision = 's62_supplier_tax_area'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('default_currency', sa.String(3), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier', 'default_currency')
