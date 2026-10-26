"""Quotation items no longer have a 'needs_transfer' stock status

Revision ID: s109_quote_item_status
Revises: s108_company_document_details
Create Date: 2026-10-25

Quotations lead to a PO or an SO only; ITNs are raised from the ITN page. Lines that were
flagged 'needs_transfer' are short of stock in their own branch, i.e. 'needs_procurement'.
"""
from alembic import op

revision = 's109_quote_item_status'
down_revision = 's108_company_document_details'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE sales_quote_items SET stock_status = 'needs_procurement' WHERE stock_status = 'needs_transfer'")


def downgrade() -> None:
    pass  # the old value can't be told apart from a genuine 'needs_procurement'
