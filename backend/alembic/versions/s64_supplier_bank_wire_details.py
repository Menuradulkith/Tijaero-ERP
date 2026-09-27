"""Add bank-transfer wire details to supplier_payment_method

Revision ID: s64_supplier_bank_wire_details
Revises: s63_supplier_default_currency
Create Date: 2026-09-26

Branch, bank branch code, SWIFT code, and correspondent bank details for a
supplier's bank-transfer payment method. `bank_branch_code` (not
`branch_code`) to avoid colliding with the unrelated company-operating-
branch concept used everywhere else in the app.
"""
from alembic import op
import sqlalchemy as sa

revision = 's64_supplier_bank_wire_details'
down_revision = 's63_supplier_default_currency'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier_payment_method', sa.Column('branch', sa.String(255), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('bank_branch_code', sa.String(50), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('swift_code', sa.String(20), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('correspondent_bank_name', sa.String(255), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('correspondent_bank_swift_code', sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier_payment_method', 'correspondent_bank_swift_code')
    op.drop_column('supplier_payment_method', 'correspondent_bank_name')
    op.drop_column('supplier_payment_method', 'swift_code')
    op.drop_column('supplier_payment_method', 'bank_branch_code')
    op.drop_column('supplier_payment_method', 'branch')
