"""Add proforma_invoice_id to customer_advance_payments

Revision ID: add_proforma_to_customer_advance
Revises: add_tax_to_sales_quotes
Create Date: 2026-05-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_proforma_to_customer_advance'
down_revision = 'add_tax_to_sales_quotes'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'customer_advance_payments',
        sa.Column('proforma_invoice_id', sa.Integer(), sa.ForeignKey('sales_quotes.id'), nullable=True)
    )
    op.create_unique_constraint(
        'uq_customer_advance_proforma',
        'customer_advance_payments',
        ['proforma_invoice_id']
    )


def downgrade():
    op.drop_constraint('uq_customer_advance_proforma', 'customer_advance_payments', type_='unique')
    op.drop_column('customer_advance_payments', 'proforma_invoice_id')
