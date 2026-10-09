"""Widen contact number columns for international (E.164) numbers

Revision ID: s79_widen_contact_numbers
Revises: s78_customer_structured_address
Create Date: 2026-10-08

Contact numbers are now entered with a country dial code (+94771234567, up
to 16 characters) and stored in E.164 form, which does not fit the old
varchar(12) columns. Existing values are left as they are; the ERP converts
them to E.164 the next time each record is saved.

Downgrade narrows the columns back to 12 and will fail if any stored number
is longer than that.
"""
from alembic import op
import sqlalchemy as sa

revision = 's79_widen_contact_numbers'
down_revision = 's78_customer_structured_address'
branch_labels = None
depends_on = None

_COLUMNS = [
    ('customers', 'home_contact_number', True),
    ('customers', 'mobile_contact_number', True),
    ('supplier', 'home_contact_number', True),
    ('supplier', 'mobile_contact_number', False),  # NOT NULL
    ('supplier_contact_person', 'phone', True),
    ('settings', 'company_telephone_number', True),
]


def upgrade() -> None:
    for table, column, nullable in _COLUMNS:
        op.alter_column(table, column, existing_type=sa.String(12), type_=sa.String(20), existing_nullable=nullable)


def downgrade() -> None:
    for table, column, nullable in _COLUMNS:
        op.alter_column(table, column, existing_type=sa.String(20), type_=sa.String(12), existing_nullable=nullable)
