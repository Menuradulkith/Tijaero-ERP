"""Indexes matching the general ledger list and audit-trail sort orders

Revision ID: s99_general_ledger_order_indexes
Revises: s98_list_sort_and_search_indexes
Create Date: 2026-10-22

The ledger list orders by ``posting_date DESC, id DESC`` and the accounting audit trail by
``transaction_date DESC, created_at DESC, id DESC``. Neither had an index, so each page
sorted the entire ledger (about 0.6s over 1M rows, growing with every posting). With the
indexes the newest rows come straight off the index.

Built CONCURRENTLY so a live system is not blocked from posting while they build.
"""
from alembic import op

revision = 's99_general_ledger_order_indexes'
down_revision = 's98_list_sort_and_search_indexes'
branch_labels = None
depends_on = None

INDEXES = [
    ("ix_gl_posting_date_id", "general_ledger", "posting_date DESC, id DESC"),
    ("ix_gl_txn_date_created_id", "general_ledger", "transaction_date DESC, created_at DESC NULLS LAST, id DESC"),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, cols in INDEXES:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({cols})")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _, _ in INDEXES:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
