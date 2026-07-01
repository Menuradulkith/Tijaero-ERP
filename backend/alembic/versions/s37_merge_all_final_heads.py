"""merge all remaining heads into s36_add_sales_quote_id_itn

Revision ID: s37_merge_all_final_heads
Revises: s36_add_sales_quote_id_itn, 20260610_gl_reliability, add_debtors_tables, 002_add_stock_transfer
Create Date: 2026-06-15

This migration merges all remaining heads into a single linear migration chain.
"""
from alembic import op
import sqlalchemy as sa


revision = "s37_merge_all_final_heads"
down_revision = (
    "s36_add_sales_quote_id_itn",
    "20260610_gl_reliability", 
    "add_debtors_tables",
    "002_add_stock_transfer"
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
