"""Add a reason to purchase returns

Revision ID: s97_purchase_return_reason
Revises: s96_fix_supplier_cashbook
Create Date: 2026-10-21

The purchase return form now asks for a reason (Quality issue, Incorrect item, Quantity
mismatch, Damaged during delivery, Label errors, Other). Nullable so existing returns keep
working; the allowed values are enforced by the API schema.
"""
from alembic import op
import sqlalchemy as sa

revision = 's97_purchase_return_reason'
down_revision = 's96_fix_supplier_cashbook'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('purchasing_return', sa.Column('reason', sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column('purchasing_return', 'reason')
