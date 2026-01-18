"""merge heads

Revision ID: merge_heads_jan17
Revises: cb91b745ee27, f8766ef60c46
Create Date: 2026-01-17 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'merge_heads_jan17'
down_revision = ('cb91b745ee27', 'f8766ef60c46')
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
