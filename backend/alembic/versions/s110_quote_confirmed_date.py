"""Quotation confirmation: sales_quotes.confirmed_date

Revision ID: s110_quote_confirmed_date
Revises: s109_quote_item_status
Create Date: 2026-10-25

After a quotation is marked sent it must be confirmed (customer accepted) or rejected before
a PO/SO can be raised. Quotations already sent and already being fulfilled are back-filled as
confirmed so they keep working; the rest wait for the customer's answer.
"""
from alembic import op
import sqlalchemy as sa

revision = 's110_quote_confirmed_date'
down_revision = 's109_quote_item_status'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('sales_quotes', sa.Column('confirmed_date', sa.TIMESTAMP(), nullable=True))
    op.execute("""
        UPDATE sales_quotes q
        SET confirmed_date = COALESCE(q.approved_date, q.submitted_date)
        WHERE q.submitted_date IS NOT NULL
          AND (
            q.status IN ('partially_processed', 'completed', 'so_created')
            OR EXISTS (
              SELECT 1 FROM sales_quote_items i
              WHERE i.quote_id = q.id
                AND (i.converted_qty > 0 OR i.item_status IN ('po_created', 'so_created', 'completed', 'itn_created', 'procurement'))
            )
          )
    """)


def downgrade() -> None:
    op.drop_column('sales_quotes', 'confirmed_date')
