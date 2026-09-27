"""Add tax_area to supplier

Revision ID: s62_supplier_tax_area
Revises: s61_supplier_lead_time
Create Date: 2026-09-25

A supplier's tax treatment classification (domestic standard/zero-rated/
exempt, export, import) — a small fixed set, not a geographic jurisdiction.
Mirrors standard ERP "fiscal position" concepts (Odoo, SAP). See
app.common.enums.SupplierTaxArea.
"""
from alembic import op
import sqlalchemy as sa

revision = 's62_supplier_tax_area'
down_revision = 's61_supplier_lead_time'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('tax_area', sa.String(30), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier', 'tax_area')
