"""Database-level uniqueness guards for the product catalog

Revision ID: s66_catalog_unique_guards
Revises: s65_supplier_payment_types
Create Date: 2026-09-26

The services already check for duplicates before inserting (check-then-act),
but two concurrent requests can both pass that check. These indexes make the
database the final arbiter:

- products: case-insensitive unique name and item_code
- category: case-insensitive unique name and category_code
- items_brand: case-insensitive unique brand_name and brand_code
- supplier_product: at most one preferred supplier per product (partial index)
"""
from alembic import op

revision = 's66_catalog_unique_guards'
down_revision = 's65_supplier_payment_types'
branch_labels = None
depends_on = None


_INDEXES = [
    ("uq_products_name_lower", "products", "lower(name)", None),
    ("uq_products_item_code_lower", "products", "lower(item_code)", None),
    ("uq_category_name_lower", "category", "lower(name)", None),
    ("uq_category_code_lower", "category", "lower(category_code)", None),
    ("uq_items_brand_name_lower", "items_brand", "lower(brand_name)", None),
    ("uq_items_brand_code_lower", "items_brand", "lower(brand_code)", None),
    ("uq_supplier_product_preferred", "supplier_product", "product_id", "is_preferred"),
]


def upgrade() -> None:
    for name, table, expr, where in _INDEXES:
        where_sql = f" WHERE {where}" if where else ""
        op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON {table} ({expr}){where_sql}")


def downgrade() -> None:
    for name, _table, _expr, _where in reversed(_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")
