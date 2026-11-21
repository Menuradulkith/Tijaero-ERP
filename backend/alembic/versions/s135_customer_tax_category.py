"""Customer: tax area, accounting group, VAT registration no, category

Revision ID: s135_customer_tax_category
Revises: s134_customer_correspondent_bank
Create Date: 2026-11-18
"""
import sqlalchemy as sa
from alembic import op

revision = 's135_customer_tax_category'
down_revision = 's134_customer_correspondent_bank'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('customers', sa.Column('vat_registration_number', sa.String(length=50), nullable=True))
    op.add_column('customers', sa.Column('tax_area', sa.String(length=30), nullable=True))
    op.add_column('customers', sa.Column('accounting_group', sa.String(length=30), nullable=True))
    # Existing customers are real customers; new ones must pick a category.
    op.add_column('customers', sa.Column('customer_category', sa.String(length=20), nullable=False,
                                         server_default='customer'))
    op.create_check_constraint(
        'ck_customers_customer_category', 'customers',
        "customer_category IN ('customer', 'prospect', 'end_customer')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_customers_customer_category', 'customers', type_='check')
    op.drop_column('customers', 'customer_category')
    op.drop_column('customers', 'accounting_group')
    op.drop_column('customers', 'tax_area')
    op.drop_column('customers', 'vat_registration_number')
