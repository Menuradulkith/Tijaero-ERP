"""Customer contact persons get an active flag (they are deactivated, never deleted)

Revision ID: s124_customer_contact_active
Revises: s123_hr_sri_lanka_payroll
Create Date: 2026-11-05
"""
import sqlalchemy as sa
from alembic import op

revision = 's124_customer_contact_active'
down_revision = 's123_hr_sri_lanka_payroll'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'customer_contact_person',
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
    )


def downgrade() -> None:
    op.drop_column('customer_contact_person', 'active')
