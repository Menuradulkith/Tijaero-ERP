"""Add tax normalization settings to company settings

Revision ID: 20260429_tax_norm
Revises: s35_merge_all_heads
Create Date: 2026-04-29 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = '20260429_tax_norm'
down_revision = 's35_merge_all_heads'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('settings', sa.Column('default_tax_rate', sa.Float(), nullable=False, server_default='0'))
    op.add_column('settings', sa.Column('tax_inclusive_pricing', sa.Boolean(), nullable=False, server_default='true'))
    op.add_column('settings', sa.Column('hide_service_charge', sa.Boolean(), nullable=False, server_default='true'))


def downgrade() -> None:
    op.drop_column('settings', 'hide_service_charge')
    op.drop_column('settings', 'tax_inclusive_pricing')
    op.drop_column('settings', 'default_tax_rate')
