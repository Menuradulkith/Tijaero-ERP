"""add primary_branch_id to accounts_user

Revision ID: s56_user_primary_branch
Revises: s55_branch_email_unique
Create Date: 2026-09-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 's56_user_primary_branch'
down_revision = 's55_branch_email_unique'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('accounts_user', sa.Column('primary_branch_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'accounts_user_primary_branch_id_fkey',
        'accounts_user', 'branches',
        ['primary_branch_id'], ['id'],
    )
    # Backfill: default each user's primary branch to their first assigned branch.
    op.execute(
        """
        UPDATE accounts_user u
        SET primary_branch_id = (
            SELECT ub.branches_id
            FROM accounts_user_branches ub
            WHERE ub.user_id = u.id
            ORDER BY ub.id
            LIMIT 1
        )
        """
    )


def downgrade() -> None:
    op.drop_constraint('accounts_user_primary_branch_id_fkey', 'accounts_user', type_='foreignkey')
    op.drop_column('accounts_user', 'primary_branch_id')
