"""Merge multiple heads

Revision ID: e1f2a3b4c5d6
Revises: a6ef1329e39d, add_transfer_workflow
Create Date: 2026-01-14

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e1f2a3b4c5d6'
down_revision: Union[str, Sequence[str], None] = ('a6ef1329e39d', 'add_transfer_workflow')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Merge migration - no changes needed
    pass


def downgrade() -> None:
    # Merge migration - no changes needed
    pass
