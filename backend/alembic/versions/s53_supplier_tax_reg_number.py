"""Add supplier tax/VAT registration number

Revision ID: s53_supplier_tax_reg_number
Revises: s52_supplier_structured_address
Create Date: 2026-09-13

Adds tax_registration_number to supplier, alongside the existing
company_registration_number, for tax/VAT reporting purposes.
"""
from alembic import op
import sqlalchemy as sa

revision = 's53_supplier_tax_reg_number'
down_revision = 's52_supplier_structured_address'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('tax_registration_number', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier', 'tax_registration_number')
