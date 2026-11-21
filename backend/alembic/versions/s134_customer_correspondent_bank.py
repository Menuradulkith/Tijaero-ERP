"""Customer correspondent bank info: name, location, SWIFT, IBAN

Revision ID: s134_customer_correspondent_bank
Revises: s133_supplier_shipping_info
Create Date: 2026-11-18
"""
import sqlalchemy as sa
from alembic import op

revision = 's134_customer_correspondent_bank'
down_revision = 's133_supplier_shipping_info'
branch_labels = None
depends_on = None

COLUMNS = (
    ('correspondent_bank_name', 255),
    ('correspondent_bank_location', 255),
    ('correspondent_bank_swift_code', 20),
    ('correspondent_bank_iban', 34),
)


def upgrade() -> None:
    for name, length in COLUMNS:
        op.add_column('customers', sa.Column(name, sa.String(length=length), nullable=True))


def downgrade() -> None:
    for name, _ in reversed(COLUMNS):
        op.drop_column('customers', name)
