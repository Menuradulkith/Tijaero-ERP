"""Supplier: drop name_in_cheque_card, civil_status, no_of_kids

Revision ID: s49_supplier_drop_fields
Revises: s48_supplier_logo_company_fields
Create Date: 2026-09-13

Removes three fields from the Contact Person section that are no longer
collected: name_in_cheque_card (already optional), civil_status and
no_of_kids (both were NOT NULL — dropped outright since no downstream
code reads them).
"""
from alembic import op
import sqlalchemy as sa

revision = 's49_supplier_drop_fields'
down_revision = 's48_supplier_logo_company_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('supplier', 'name_in_cheque_card')
    op.drop_column('supplier', 'civil_status')
    op.drop_column('supplier', 'no_of_kids')


def downgrade() -> None:
    op.add_column('supplier', sa.Column('no_of_kids', sa.String(30), nullable=False, server_default='0'))
    op.add_column('supplier', sa.Column('civil_status', sa.String(30), nullable=False, server_default='single'))
    op.add_column('supplier', sa.Column('name_in_cheque_card', sa.String(255), nullable=True))
