"""Cashbook is GL-driven: retire the insert-time cashbook triggers

Revision ID: s104_cashbook_gl_driven
Revises: s103_employee_advances_account
Create Date: 2026-10-24

The trg_cashbook_* triggers wrote the cashbook when a document row was
INSERTED - invoices pending approval or bank verification, expenses later
rejected, cancelled documents - while the GL posts money only when the
document completes. The two could never reconcile. The cashbook is now written
from GL cash/bank postings only (GLPostingService.post /
JournalEntryService.post_journal_entry -> record_cashbook_from_gl).

After upgrading, rebuild existing rows from the GL:
    python scripts/rebuild_cashbook_from_gl.py --apply
fn_insert_cashbook_entry stays: the GL-driven writer uses it.
"""
from alembic import op

revision = 's104_cashbook_gl_driven'
down_revision = 's103_employee_advances_account'
branch_labels = None
depends_on = None

TRIGGERS = (
    ("trg_cashbook_after_invoice", "invoices"),
    ("trg_cashbook_after_customer_credit_settle", "customer_credits_settle_transaction"),
    ("trg_cashbook_after_customer_advance", "customer_advance_payments"),
    ("trg_cashbook_after_voucher_sale", "customer_gift_voucher"),
    ("trg_cashbook_after_supplier_credit_settle", "supplier_credits_settle_transaction"),
    ("trg_cashbook_after_supplier_direct_payment", "supplier_payments"),
    ("trg_cashbook_after_supplier_advance", "supplier_advance_payment"),
    ("trg_cashbook_after_expense", "expenses"),
    ("trg_cashbook_after_bank_deposit", "bank_deposits"),
)


def upgrade() -> None:
    for trigger, table in TRIGGERS:
        op.execute(f"DROP TRIGGER IF EXISTS {trigger} ON {table};")


def downgrade() -> None:
    # Re-create the triggers (functions still exist) without backfilling.
    import importlib.util
    import os

    path = os.path.join(os.path.dirname(__file__), "s101_restore_cashbook_objects.py")
    spec = importlib.util.spec_from_file_location("_s104_s101", path)
    s101 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(s101)
    original = s101._load("a1b2c3d4e5f6_create_materialized_cashbook_entries.py")
    original.op = s101._ReplayOp(backfill=False)
    original.upgrade()
    for later in ("20260607_fix_cashbook_credit_settlement_time_and_format.py", "s96_fix_supplier_cashbook.py"):
        s101._load(later).upgrade()
