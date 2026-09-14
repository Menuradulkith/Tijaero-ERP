"""Supplier: require company_name, add logo_path, drop unused company contact fields

Revision ID: s48_supplier_logo_company_fields
Revises: s47_supplier_payment_methods
Create Date: 2026-09-13

Reorganizes the supplier "Company Information" section per the new form
layout: company_name becomes mandatory (backfilled from full_name for any
existing supplier missing it), company_contact_number / company_postal_address
are dropped (unused elsewhere in the app), and logo_path is added to support
uploading a company logo image.
"""
from alembic import op
import sqlalchemy as sa

revision = 's48_supplier_logo_company_fields'
down_revision = 's47_supplier_payment_methods'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Backfill any missing company_name before enforcing NOT NULL.
    op.execute(
        "UPDATE supplier SET company_name = full_name "
        "WHERE company_name IS NULL OR company_name = ''"
    )
    op.alter_column('supplier', 'company_name', existing_type=sa.String(255), nullable=False)

    op.add_column('supplier', sa.Column('logo_path', sa.String(500), nullable=True))

    op.drop_column('supplier', 'company_contact_number')
    op.drop_column('supplier', 'company_postal_address')


def downgrade() -> None:
    op.add_column('supplier', sa.Column('company_postal_address', sa.Text(), nullable=True))
    op.add_column('supplier', sa.Column('company_contact_number', sa.String(12), nullable=True))
    op.drop_column('supplier', 'logo_path')
    op.alter_column('supplier', 'company_name', existing_type=sa.String(255), nullable=True)
