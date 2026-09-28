"""Move required_date from purchasing_order_items to purchasing_orders

Revision ID: s70_po_required_date_to_order
Revises: s69_po_item_quote_link
Create Date: 2026-09-28

Required Date is now set once per generated PO (Step 2 of the product-first
creation wizard, per supplier group) rather than per line item — a single
purchase can span many products for the same supplier, and asking for one
required date per supplier group (i.e. per resulting PO) matches how the
date is actually used downstream. purchasing_order_items.required_date was
only ever written by that same wizard and shipped in the same short-lived
migration (s68) this replaces the column from, so there is no real data to
migrate off of it.
"""
from alembic import op
import sqlalchemy as sa

revision = 's70_po_required_date_to_order'
down_revision = 's69_po_item_quote_link'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('purchasing_orders', sa.Column('required_date', sa.Date(), nullable=True))
    op.drop_column('purchasing_order_items', 'required_date')


def downgrade() -> None:
    op.add_column('purchasing_order_items', sa.Column('required_date', sa.Date(), nullable=True))
    op.drop_column('purchasing_orders', 'required_date')
