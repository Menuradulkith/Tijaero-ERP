"""Indexes for paged list sorting and ILIKE search on the big tables

Revision ID: s98_list_sort_and_search_indexes
Revises: s97_purchase_return_reason
Create Date: 2026-10-22

The paged product/customer lists sort by ``lower(<col>)`` and search with
``ILIKE '%term%'``. The existing case-insensitive unique indexes are on
``lower(btrim(col))``, which Postgres cannot use for those expressions, so every page
sorted the whole table and every search scanned it. Under load (20k products) a product
page cost ~60ms of database time instead of ~2ms.

* btree on ``lower(col)`` matches the ORDER BY expression exactly.
* GIN trigram indexes serve ``ILIKE '%term%'`` (needs the pg_trgm extension; skipped,
  with a notice, if the database role may not create it).

Built CONCURRENTLY so a live system is not blocked from writing while they build.
"""
from alembic import op

revision = 's98_list_sort_and_search_indexes'
down_revision = 's97_purchase_return_reason'
branch_labels = None
depends_on = None

BTREE = [
    ("ix_products_item_code_lower", "products", "lower(item_code)"),
    ("ix_products_name_lower", "products", "lower(name)"),
    ("ix_products_model_lower", "products", "lower(model)"),
    ("ix_customers_customer_name_lower", "customers", "lower(customer_name)"),
    ("ix_customers_customer_no_lower", "customers", "lower(customer_no)"),
]
TRIGRAM = [
    ("ix_products_name_trgm", "products", "name"),
    ("ix_products_item_code_trgm", "products", "item_code"),
    ("ix_products_model_trgm", "products", "model"),
    ("ix_customers_customer_name_trgm", "customers", "customer_name"),
    ("ix_invoices_invoice_no_trgm", "invoices", "invoice_no"),
]


def upgrade() -> None:
    with op.get_context().autocommit_block():
        for name, table, expr in BTREE:
            op.execute(f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} ({expr})")

        try:
            op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        except Exception as exc:  # insufficient privilege on managed databases
            print(f"pg_trgm not available, skipping trigram indexes: {exc}")
            return
        for name, table, col in TRIGRAM:
            op.execute(
                f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {name} ON {table} USING gin ({col} gin_trgm_ops)"
            )


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for name, _, _ in BTREE + TRIGRAM:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {name}")
