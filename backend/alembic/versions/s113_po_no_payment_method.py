"""Purchase orders carry no payment method: open POs become payable-to-supplier (credit)

Revision ID: s113_po_no_payment_method
Revises: s112_mfg_planning
Create Date: 2026-10-26

How a supplier is paid (cash / bank / cheque ...) is now decided in Finance, so every PO is owed to the
supplier (GRN posts to Trade Creditors). Existing POs that are still untouched (no GRN, no payment, no
advance) are switched to 'credit' so their GRN follows the same rule. POs that already have receipts or
payments keep the method they were raised with, so history and outstanding balances don't move.
"""
from alembic import op

revision = 's113_po_no_payment_method'
down_revision = 's112_mfg_planning'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE purchasing_orders po
        SET payment_method = 'credit'
        WHERE lower(po.payment_method) <> 'credit'
          AND po.status IN ('draft', 'pending', 'pending_approval', 'approved')
          AND NOT EXISTS (SELECT 1 FROM good_received_note g WHERE g.purchasingorders_id = po.id)
          AND NOT EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.purchasing_order_id = po.id)
          AND NOT EXISTS (SELECT 1 FROM supplier_advance_payment sa WHERE sa.purchasing_order_id = po.id)
    """)


def downgrade() -> None:
    pass  # the previous method can't be recovered
