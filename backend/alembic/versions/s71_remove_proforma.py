"""Remove the Proforma Invoice concept

Revision ID: s71_remove_proforma
Revises: s70_po_required_date_to_order
Create Date: 2026-09-28

Proforma is no longer a distinct quote type — every quote is now approved
through the same internal Sales Quotation approval workflow as an ordinary
quotation. This migration:
  1. Converts any existing quote_type='proforma' rows to 'quotation' (fully
     preserved, just loses the proforma distinction — not reversible, since
     we can no longer tell which rows were originally proforma).
  2. Renames customer_advance_payments.proforma_invoice_id -> quote_id,
     since an advance payment can now be linked to any quotation, not just
     a proforma one. This is a pure rename — no data is lost.
"""
from alembic import op
import sqlalchemy as sa

revision = 's71_remove_proforma'
down_revision = 's70_po_required_date_to_order'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "UPDATE sales_quotes SET quote_type = 'quotation', is_estimate = true "
        "WHERE quote_type = 'proforma'"
    )
    op.alter_column(
        'customer_advance_payments', 'proforma_invoice_id', new_column_name='quote_id'
    )


def downgrade() -> None:
    op.alter_column(
        'customer_advance_payments', 'quote_id', new_column_name='proforma_invoice_id'
    )
    # The quote_type='proforma' -> 'quotation' data conversion is not reversible.
