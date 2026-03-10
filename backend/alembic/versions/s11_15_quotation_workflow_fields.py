"""Scenarios 11-15: Quotation Workflow Date Fields & Stock Status

Add workflow date tracking columns to sales_quotes:
  - submitted_date, po_created_date, approved_date,
    approved_by_customer, rejection_date, conversion_date
Add linked_po_id FK to sales_quotes.
Add stock_status to sales_quote_items.

Revision ID: s11_15_workflow_fields
Revises: add_image_url_to_products
Create Date: 2026-02-13

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "s11_15_workflow_fields"
down_revision = "add_image_url_to_products"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- sales_quotes: workflow date tracking --
    op.add_column(
        "sales_quotes",
        sa.Column("submitted_date", sa.TIMESTAMP(), nullable=True),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("po_created_date", sa.TIMESTAMP(), nullable=True),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("approved_date", sa.TIMESTAMP(), nullable=True),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("approved_by_customer", sa.String(200), nullable=True),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("rejection_date", sa.TIMESTAMP(), nullable=True),
    )
    op.add_column(
        "sales_quotes",
        sa.Column("conversion_date", sa.TIMESTAMP(), nullable=True),
    )

    # -- sales_quotes: linked PO --
    op.add_column(
        "sales_quotes",
        sa.Column("linked_po_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_sales_quotes_linked_po_id",
        "sales_quotes",
        "purchasing_orders",
        ["linked_po_id"],
        ["id"],
    )

    # -- sales_quote_items: stock status --
    op.add_column(
        "sales_quote_items",
        sa.Column("stock_status", sa.String(30), nullable=True),
    )


def downgrade() -> None:
    # -- sales_quote_items --
    op.drop_column("sales_quote_items", "stock_status")

    # -- sales_quotes: linked PO --
    op.drop_constraint(
        "fk_sales_quotes_linked_po_id",
        "sales_quotes",
        type_="foreignkey",
    )
    op.drop_column("sales_quotes", "linked_po_id")

    # -- sales_quotes: workflow dates --
    op.drop_column("sales_quotes", "conversion_date")
    op.drop_column("sales_quotes", "rejection_date")
    op.drop_column("sales_quotes", "approved_by_customer")
    op.drop_column("sales_quotes", "approved_date")
    op.drop_column("sales_quotes", "po_created_date")
    op.drop_column("sales_quotes", "submitted_date")
