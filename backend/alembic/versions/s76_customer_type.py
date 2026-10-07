"""Add customer_type (individual / business) to customers

Revision ID: s76_customer_type
Revises: s75_supplier_customer_display_no
Create Date: 2026-10-06

Customers can now be an individual or a business. Adds `customer_type`
(existing rows backfilled to 'individual'), tax / company registration
numbers, and relaxes the person-only columns (title, gender, civil_status,
no_of_kids, mobile_contact_number) so a business can be saved without them.
Per-type required fields are enforced in the Pydantic schema.
"""
from alembic import op
import sqlalchemy as sa

revision = 's76_customer_type'
down_revision = 's75_supplier_customer_display_no'
branch_labels = None
depends_on = None

_RELAXED = [
    ('title', 30),
    ('gender', 30),
    ('civil_status', 30),
    ('no_of_kids', 30),
    ('mobile_contact_number', 12),
]


def upgrade() -> None:
    op.add_column(
        'customers',
        sa.Column('customer_type', sa.String(20), nullable=False, server_default='individual'),
    )
    op.create_index('ix_customers_customer_type', 'customers', ['customer_type'])
    op.add_column('customers', sa.Column('tax_registration_number', sa.String(50), nullable=True))
    op.add_column('customers', sa.Column('company_registration_number', sa.String(50), nullable=True))
    for col, length in _RELAXED:
        op.alter_column('customers', col, existing_type=sa.String(length), nullable=True)


def downgrade() -> None:
    # Business rows have no person fields; fill placeholders so NOT NULL can be restored.
    for col, _ in _RELAXED:
        op.execute(f"UPDATE customers SET {col} = '' WHERE {col} IS NULL")
    for col, length in _RELAXED:
        op.alter_column('customers', col, existing_type=sa.String(length), nullable=False)
    op.drop_column('customers', 'company_registration_number')
    op.drop_column('customers', 'tax_registration_number')
    op.drop_index('ix_customers_customer_type', table_name='customers')
    op.drop_column('customers', 'customer_type')
