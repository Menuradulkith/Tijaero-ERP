"""Add auth_revoked_token denylist for JWT revocation on logout

Revision ID: s80_auth_revoked_token
Revises: s79_widen_contact_numbers
Create Date: 2026-10-08

Logout now records the jti of the access and refresh tokens so they are
rejected for the rest of their lifetime. Access tokens issued before this
change carry no jti and remain valid until they expire.
"""
from alembic import op
import sqlalchemy as sa

revision = 's80_auth_revoked_token'
down_revision = 's79_widen_contact_numbers'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'auth_revoked_token',
        sa.Column('jti', sa.String(64), primary_key=True),
        sa.Column('expires_at', sa.TIMESTAMP(), nullable=False),
        sa.Column('revoked_at', sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_auth_revoked_token_expires_at', 'auth_revoked_token', ['expires_at'])


def downgrade() -> None:
    op.drop_index('ix_auth_revoked_token_expires_at', table_name='auth_revoked_token')
    op.drop_table('auth_revoked_token')
