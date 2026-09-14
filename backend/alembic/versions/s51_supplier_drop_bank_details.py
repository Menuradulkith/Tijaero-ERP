"""Supplier: drop bank_details

Revision ID: s51_supplier_drop_bank_details
Revises: s50_supplier_contact_persons
Create Date: 2026-09-13

Removes the free-text bank_details field from the Payment section — payment
account details are now captured per-record in supplier_payment_method
instead (bank_name/account_number/account_holder_name), making this
redundant. No downstream code reads it.
"""
from alembic import op
import sqlalchemy as sa

revision = 's51_supplier_drop_bank_details'
down_revision = 's50_supplier_contact_persons'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('supplier', 'bank_details')


def downgrade() -> None:
    op.add_column('supplier', sa.Column('bank_details', sa.Text(), nullable=True))
