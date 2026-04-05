"""add company assets return fields

Revision ID: add_ca_return_fields
Revises: po_inv_no_nullable
Create Date: 2026-04-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'add_ca_return_fields'
down_revision = 'po_inv_no_nullable'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add return_reason column
    op.add_column(
        'company_assets',
        sa.Column('return_reason', sa.String(length=200), nullable=True)
    )
    # Add sale_return_id column
    op.add_column(
        'company_assets',
        sa.Column('sale_return_id', sa.Integer(), nullable=True)
    )
    # Add source column with default 'grn'
    op.add_column(
        'company_assets',
        sa.Column('source', sa.String(length=50), nullable=False, server_default='grn')
    )


def downgrade() -> None:
    op.drop_column('company_assets', 'source')
    op.drop_column('company_assets', 'sale_return_id')
    op.drop_column('company_assets', 'return_reason')
