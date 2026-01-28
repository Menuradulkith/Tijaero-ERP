"""merge heads jan28

Revision ID: merge_heads_jan28
Revises: 7fd21e43667a, add_grn_item_type
Create Date: 2026-01-28 14:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'merge_heads_jan28'
down_revision: Union[str, Sequence[str], None] = ('7fd21e43667a', 'add_grn_item_type')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
