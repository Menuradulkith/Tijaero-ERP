"""make purchasing_invoice_no nullable

Revision ID: make_purchasing_invoice_no_nullable
Revises: 8ab2dbb61732
Create Date: 2026-04-05

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'po_inv_no_nullable'
down_revision = '89784ea2a165'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'purchasing_orders',
        'purchasing_invoice_no',
        existing_type=sa.String(length=200),
        nullable=True
    )


def downgrade() -> None:
    # Set a placeholder for any existing nulls before re-adding NOT NULL
    op.execute("UPDATE purchasing_orders SET purchasing_invoice_no = '' WHERE purchasing_invoice_no IS NULL")
    op.alter_column(
        'purchasing_orders',
        'purchasing_invoice_no',
        existing_type=sa.String(length=200),
        nullable=False
    )
