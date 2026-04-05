"""merge add_active_to_branches and add_ca_return_fields heads

Revision ID: merge_branches_ca_fields
Revises: add_active_to_branches, add_ca_return_fields
Create Date: 2026-04-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'merge_branches_ca_fields'
down_revision = ('add_active_to_branches', 'add_ca_return_fields')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
