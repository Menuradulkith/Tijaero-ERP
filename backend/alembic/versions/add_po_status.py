"""add_status_to_purchasing_orders

Revision ID: add_po_status
Revises: 2142e10de002
Create Date: 2026-01-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'add_po_status'
down_revision: Union[str, None] = '2142e10de002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # For SQLite, we need to use batch mode for ALTER operations
    # Add status column with default value
    with op.batch_alter_table('purchasing_orders') as batch_op:
        batch_op.add_column(sa.Column('status', sa.String(30), nullable=False, server_default='pending'))


def downgrade() -> None:
    with op.batch_alter_table('purchasing_orders') as batch_op:
        batch_op.drop_column('status')
