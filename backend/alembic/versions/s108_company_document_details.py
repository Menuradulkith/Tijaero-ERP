"""Company details printed on documents: logo, website, BRN, bank account

Revision ID: s108_company_document_details
Revises: s107_supplier_contact_active
Create Date: 2026-10-25
"""
import sqlalchemy as sa
from alembic import op

revision = 's108_company_document_details'
down_revision = 's107_supplier_contact_active'
branch_labels = None
depends_on = None

COLUMNS = (
    ("company_logo", sa.Text()),
    ("company_website", sa.String(255)),
    ("business_registration_number", sa.String(50)),
    ("bank_name", sa.String(100)),
    ("bank_branch", sa.String(100)),
    ("bank_account_name", sa.String(150)),
    ("bank_account_number", sa.String(50)),
    ("bank_swift_code", sa.String(20)),
)


def upgrade() -> None:
    for name, type_ in COLUMNS:
        op.add_column("settings", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _type in reversed(COLUMNS):
        op.drop_column("settings", name)
