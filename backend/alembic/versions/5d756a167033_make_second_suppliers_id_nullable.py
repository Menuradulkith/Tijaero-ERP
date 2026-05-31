"""make_second_suppliers_id_nullable

Revision ID: 5d756a167033
Revises: add_quote_item_tracking
Create Date: 2026-05-31 12:06:30.024623

"""
from alembic import op
import sqlalchemy as sa

revision = '5d756a167033'
down_revision = 'add_quote_item_tracking'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'purchasing_orders',
        'second_suppliers_id',
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        'purchasing_orders',
        'second_suppliers_id',
        existing_type=sa.Integer(),
        nullable=False,
    )
