"""add phone_number, profile_picture_path, must_change_password to accounts_user

Revision ID: s57_user_security_fields
Revises: s56_user_primary_branch
Create Date: 2026-09-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 's57_user_security_fields'
down_revision = 's56_user_primary_branch'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('accounts_user', sa.Column('phone_number', sa.String(length=30), nullable=True))
    op.add_column('accounts_user', sa.Column('profile_picture_path', sa.String(length=500), nullable=True))
    op.add_column(
        'accounts_user',
        sa.Column('must_change_password', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column('accounts_user', 'must_change_password')
    op.drop_column('accounts_user', 'profile_picture_path')
    op.drop_column('accounts_user', 'phone_number')
