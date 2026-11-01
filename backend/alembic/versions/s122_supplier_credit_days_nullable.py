"""Supplier credit_days nullable: NULL means payment terms not chosen yet

Revision ID: s122_supplier_credit_days_nullable
Revises: s121_simplify_finance
Create Date: 2026-11-01
"""
import sqlalchemy as sa
from alembic import op

revision = 's122_supplier_credit_days_nullable'
down_revision = 's121_simplify_finance'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('supplier', 'credit_days', existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE supplier SET credit_days = 30 WHERE credit_days IS NULL")
    op.alter_column('supplier', 'credit_days', existing_type=sa.Integer(), nullable=False)
