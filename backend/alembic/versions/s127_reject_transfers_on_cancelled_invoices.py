"""Reject bank transfers still pending on invoices that were cancelled

Revision ID: s127_cancelled_invoice_transfers
Revises: s126_coupon_code_ci_unique
Create Date: 2026-11-05
"""
from alembic import op

revision = 's127_cancelled_invoice_transfers'
down_revision = 's126_coupon_code_ci_unique'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Cancelling an order now rejects its pending transfer; this clears the ones cancelled before.
    op.execute(
        """
        UPDATE invoices
           SET bank_transfer_status = 'rejected',
               bank_transfer_verified_date = now(),
               bank_transfer_rejection_reason = 'Order cancelled'
         WHERE bank_transfer_status = 'pending_verification'
           AND (status IS FALSE OR payment_status = 'cancelled' OR approval_status = 'cancelled')
        """
    )


def downgrade() -> None:
    pass
