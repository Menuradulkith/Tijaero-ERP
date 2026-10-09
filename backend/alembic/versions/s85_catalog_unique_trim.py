"""Catalog uniqueness ignores surrounding whitespace

Revision ID: s85_catalog_unique_trim
Revises: s84_users_branches_unique_ci
Create Date: 2026-10-09

The s66 catalog indexes compare ``lower(col)``, so "Laptop" and "Laptop " (or
" Laptop") counted as different names and eight concurrent requests that differed
only in case/whitespace produced five rows. The API now trims input; these
indexes make the database enforce the same rule (``lower(btrim(col))``) and
replace the old, weaker ones.

The upgrade stops with the list of clashing values if existing data collides.
"""
from alembic import op
from sqlalchemy import text

revision = 's85_catalog_unique_trim'
down_revision = 's84_users_branches_unique_ci'
branch_labels = None
depends_on = None

# (new index, old index, table, column)
_INDEXES = [
    ('uq_products_name_ci', 'uq_products_name_lower', 'products', 'name'),
    ('uq_products_item_code_ci', 'uq_products_item_code_lower', 'products', 'item_code'),
    ('uq_category_name_ci', 'uq_category_name_lower', 'category', 'name'),
    ('uq_category_code_ci', 'uq_category_code_lower', 'category', 'category_code'),
    ('uq_items_brand_name_ci', 'uq_items_brand_name_lower', 'items_brand', 'brand_name'),
    ('uq_items_brand_code_ci', 'uq_items_brand_code_lower', 'items_brand', 'brand_code'),
]


def upgrade() -> None:
    conn = op.get_bind()
    clashes = []
    for new, _old, table, col in _INDEXES:
        rows = conn.execute(
            text(f"SELECT lower(btrim({col})) AS k, count(*) FROM {table} GROUP BY 1 HAVING count(*) > 1")
        ).fetchall()
        clashes += [f"{table}.{col}: {k!r} appears {n} times (needed for {new})" for k, n in rows]
    if clashes:
        raise RuntimeError("Cannot tighten catalog unique indexes; resolve these duplicates first:\n  " + "\n  ".join(clashes))
    for new, old, table, col in _INDEXES:
        op.execute(f"CREATE UNIQUE INDEX {new} ON {table} (lower(btrim({col})))")
        op.execute(f"DROP INDEX IF EXISTS {old}")


def downgrade() -> None:
    for new, old, table, col in reversed(_INDEXES):
        op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {old} ON {table} (lower({col}))")
        op.execute(f"DROP INDEX IF EXISTS {new}")
