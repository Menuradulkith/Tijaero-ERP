"""merge_heads_fix_jan18_real

Revision ID: fix_heads_jan18_real
Revises: add_sale_return_improvements, a397723e0bec
Create Date: 2026-01-18 15:05:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fix_heads_jan18_real'
down_revision: Union[str, Sequence[str], None] = ('add_sale_return_improvements', 'a397723e0bec')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
