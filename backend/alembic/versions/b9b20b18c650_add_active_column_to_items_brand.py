"""add active column to items_brand

Revision ID: b9b20b18c650
Revises: 20260610_gl_reliability
Create Date: 2026-06-14 00:37:56.632486

"""
from alembic import op
import sqlalchemy as sa


revision = 'b9b20b18c650'
down_revision = '20260610_gl_reliability'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column(
        'items_brand',
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true'))
    )

def downgrade() -> None:
    op.drop_column('items_brand', 'active')
