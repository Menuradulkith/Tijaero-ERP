"""Add active flag to supplier contact persons

Revision ID: s107_supplier_contact_active
Revises: s106_report_center
Create Date: 2026-10-25

Supplier contact persons are no longer deleted; they are deactivated instead, and
pickers/popups on other pages list only the active ones.
"""
from alembic import op
import sqlalchemy as sa

revision = 's107_supplier_contact_active'
down_revision = 's106_report_center'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'supplier_contact_person',
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
    )


def downgrade() -> None:
    op.drop_column('supplier_contact_person', 'active')
