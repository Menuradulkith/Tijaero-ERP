"""Scenarios 11-15: Quotation Enhancements

Add parent_quote_id, revision_number, rejection_reason to sales_quotes.
Add sales_quote_id to purchasing_orders.

Revision ID: s11_15_quote_enhance
Revises: 20260212_gaps
Create Date: 2026-02-12

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "s11_15_quote_enhance"
down_revision = "20260212_gaps"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- sales_quotes: revision tracking --
    op.add_column(
        "sales_quotes",
        sa.Column("parent_quote_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("rejection_reason", sa.Text(), nullable=True),
    )
    op.create_foreign_key(
        "fk_sales_quotes_parent_quote_id",
        "sales_quotes",
        "sales_quotes",
        ["parent_quote_id"],
        ["id"],
    )

    # -- purchasing_orders: link to source quotation --
    op.add_column(
        "purchasing_orders",
        sa.Column("sales_quote_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_purchasing_orders_sales_quote_id",
        "purchasing_orders",
        "sales_quotes",
        ["sales_quote_id"],
        ["id"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_purchasing_orders_sales_quote_id",
        "purchasing_orders",
        type_="foreignkey",
    )
    op.drop_column("purchasing_orders", "sales_quote_id")

    op.drop_constraint(
        "fk_sales_quotes_parent_quote_id",
        "sales_quotes",
        type_="foreignkey",
    )
    op.drop_column("sales_quotes", "rejection_reason")
    op.drop_column("sales_quotes", "revision_number")
    op.drop_column("sales_quotes", "parent_quote_id")
