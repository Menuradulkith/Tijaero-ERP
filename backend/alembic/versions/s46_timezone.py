"""Add default_timezone to settings

Revision ID: s46_timezone
Revises: s45_currencies
Create Date: 2026-09-12

This migration adds a single default_timezone column to the settings
singleton (matching the existing default_currency pattern) — no new table,
since IANA timezones are a fixed, non-user-inventable set validated at the
schema layer against zoneinfo.available_timezones().
"""
from alembic import op
import sqlalchemy as sa

revision = 's46_timezone'
down_revision = 's45_currencies'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'settings',
        sa.Column('default_timezone', sa.String(50), nullable=True, server_default='Asia/Colombo'),
    )


def downgrade() -> None:
    op.drop_column('settings', 'default_timezone')
