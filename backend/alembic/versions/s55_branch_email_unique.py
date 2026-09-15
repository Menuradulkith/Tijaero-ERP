"""add unique constraint on branches.email

Revision ID: s55_branch_email_unique
Revises: s54_user_optional_fields
Create Date: 2026-09-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 's55_branch_email_unique'
down_revision = 's54_user_optional_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_unique_constraint('branches_email_key', 'branches', ['email'])


def downgrade() -> None:
    op.drop_constraint('branches_email_key', 'branches', type_='unique')
