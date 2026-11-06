"""Deactivate legacy customer advances with a zero or negative amount

Revision ID: s128_nonpositive_advances
Revises: s127_cancelled_invoice_transfers
Create Date: 2026-11-05
"""
from alembic import op

revision = 's128_nonpositive_advances'
down_revision = 's127_cancelled_invoice_transfers'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The API now rejects amounts <= 0; these rows predate that check and must not be applied to invoices.
    op.execute(
        """
        UPDATE customer_advance_payments
           SET active = false
         WHERE payment_amount <= 0
           AND active IS TRUE
        """
    )


def downgrade() -> None:
    pass
