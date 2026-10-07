"""Structured payment / delivery address on customers

Revision ID: s78_customer_structured_address
Revises: s77_customer_contact_persons
Create Date: 2026-10-06

Adds supplier-style structured address columns (line 1/2, city, state,
postal code) for a customer's payment (billing_*) and delivery (shipping_*)
addresses. Existing single-line `payment_address` / `delivery_address` text
is carried into the new `*_address_line1` columns so nothing is lost; the
legacy columns stay and are kept in sync on save.
"""
from alembic import op
import sqlalchemy as sa

revision = 's78_customer_structured_address'
down_revision = 's77_customer_contact_persons'
branch_labels = None
depends_on = None

_COLUMNS = [
    ('address_line1', 255),
    ('address_line2', 255),
    ('city', 120),
    ('state', 120),
    ('postal_code', 20),
]


def upgrade() -> None:
    for prefix in ('billing', 'shipping'):
        for suffix, length in _COLUMNS:
            op.add_column('customers', sa.Column(f'{prefix}_{suffix}', sa.String(length), nullable=True))
    # line1 is varchar(255); trim the old free text to fit.
    op.execute("UPDATE customers SET billing_address_line1 = LEFT(payment_address, 255) WHERE payment_address IS NOT NULL AND payment_address <> ''")
    op.execute(
        "UPDATE customers SET shipping_address_line1 = LEFT(delivery_address, 255) "
        "WHERE delivery_address IS NOT NULL AND delivery_address <> '' "
        "AND delivery_address IS DISTINCT FROM payment_address"
    )


def downgrade() -> None:
    for prefix in ('shipping', 'billing'):
        for suffix, _ in reversed(_COLUMNS):
            op.drop_column('customers', f'{prefix}_{suffix}')
