"""merge multiple heads jan18

Revision ID: g1a2b3c4d5e6
Revises: f8766ef60c46, cb91b745ee27
Create Date: 2026-01-18 01:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'g1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = ('f8766ef60c46', 'cb91b745ee27')
branch_labels = None
depends_on = None


def upgrade() -> None:
    # This is a merge migration - no actual changes needed
    pass


def downgrade() -> None:
    # This is a merge migration - no actual changes needed
    pass
