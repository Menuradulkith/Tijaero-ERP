"""add tax_mode and tax_rate to sales_quotes

Revision ID: add_tax_to_sales_quotes
Revises: add_pi_payment_type
Create Date: 2026-05-05

"""
from alembic import op
import sqlalchemy as sa

revision = 'add_tax_to_sales_quotes'
down_revision = 'add_pi_payment_type'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('sales_quotes',
        sa.Column('tax_mode', sa.String(20), nullable=False, server_default='none')
    )
    op.add_column('sales_quotes',
        sa.Column('tax_rate', sa.Numeric(5, 2), nullable=False, server_default='0')
    )


def downgrade():
    op.drop_column('sales_quotes', 'tax_rate')
    op.drop_column('sales_quotes', 'tax_mode')
