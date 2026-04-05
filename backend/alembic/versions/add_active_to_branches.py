"""add active column to branches

Revision ID: add_active_to_branches
Revises: po_inv_no_nullable
Create Date: 2026-04-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_active_to_branches'
down_revision = 'po_inv_no_nullable'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'branches',
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true'))
    )


def downgrade() -> None:
    op.drop_column('branches', 'active')
