"""Add is_tax_invoice to invoices table

Revision ID: 20260212_tax_invoice
Revises: s25_petty_cash_mgmt
Create Date: 2026-02-12

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260212_tax_invoice'
down_revision = 's25_petty_cash_mgmt'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('invoices', sa.Column('is_tax_invoice', sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade():
    op.drop_column('invoices', 'is_tax_invoice')
