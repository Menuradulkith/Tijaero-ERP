"""Central stock phase 3: purchasing buys Item Catalog items

* purchasing_order_items / purchasing_return_items / purchase_invoice_items /
  item_transfer_note_items / item_transfer_note_item_product get material_id
  (backfilled from products.material_id); their product_id becomes nullable
  where it was required, so new documents can carry an item only.
* sales_stock.product_id becomes nullable (item-only stock) with a CHECK that
  product_id or material_id is set.
* material_suppliers is seeded from supplier_product for linked products that
  have no link of that supplier on their item yet (one preferred per item), so
  products that could be bought before can still be bought as items.

Downgrade restores NOT NULL only when no row needs NULL; the new columns are dropped.

Revision ID: s143_purchasing_items
Revises: s142_product_item_link
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's143_purchasing_items'
down_revision = 's142_product_item_link'
branch_labels = None
depends_on = None

# (table, product column is NOT NULL today)
TABLES = (
    ('purchasing_order_items', True),
    ('purchasing_return_items', True),
    ('purchase_invoice_items', False),
    ('item_transfer_note_items', True),
    ('item_transfer_note_item_product', True),
)


def upgrade() -> None:
    conn = op.get_bind()
    for table, not_null in TABLES:
        op.add_column(table, sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=True))
        op.create_index(f'ix_{table}_material_id', table, ['material_id'])
        if not_null:
            op.alter_column(table, 'product_id', existing_type=sa.Integer(), nullable=True)
        n = conn.execute(sa.text(f"""
            UPDATE {table} t SET material_id = p.material_id
            FROM products p
            WHERE p.id = t.product_id AND t.material_id IS NULL AND p.material_id IS NOT NULL
        """)).rowcount
        print(f"s143: {table}: material_id backfilled on {n} row(s)")

    op.alter_column('sales_stock', 'product_id', existing_type=sa.Integer(), nullable=True)
    op.create_check_constraint('ck_sales_stock_product_or_material', 'sales_stock',
                               'product_id IS NOT NULL OR material_id IS NOT NULL')

    # Supplier price list moves to the item: copy product supplier links onto the item.
    n = conn.execute(sa.text("""
        INSERT INTO material_suppliers (supplier_id, material_id, supplier_sku, cost_price, minimum_order_qty,
                                        is_preferred, active, created_at, updated_at)
        SELECT DISTINCT ON (sp.supplier_id, p.material_id)
               sp.supplier_id, p.material_id, sp.supplier_sku, sp.cost_price, sp.minimum_order_qty,
               false, sp.active, now(), now()
        FROM supplier_product sp
        JOIN products p ON p.id = sp.product_id
        WHERE p.material_id IS NOT NULL AND sp.cost_price > 0
          AND NOT EXISTS (SELECT 1 FROM material_suppliers ms
                          WHERE ms.supplier_id = sp.supplier_id AND ms.material_id = p.material_id)
        ORDER BY sp.supplier_id, p.material_id, sp.is_preferred DESC, sp.active DESC, sp.id
    """)).rowcount
    # Preferred: an item without a preferred supplier takes the product's preferred one.
    m = conn.execute(sa.text("""
        UPDATE material_suppliers ms SET is_preferred = true
        FROM (
            SELECT DISTINCT ON (p.material_id) p.material_id, sp.supplier_id
            FROM supplier_product sp JOIN products p ON p.id = sp.product_id
            WHERE sp.is_preferred AND p.material_id IS NOT NULL
            ORDER BY p.material_id, sp.id
        ) pref
        WHERE ms.material_id = pref.material_id AND ms.supplier_id = pref.supplier_id
          AND NOT EXISTS (SELECT 1 FROM material_suppliers x WHERE x.material_id = ms.material_id AND x.is_preferred)
    """)).rowcount
    print(f"s143: material_suppliers: {n} link(s) copied from supplier_product, {m} marked preferred")


def downgrade() -> None:
    conn = op.get_bind()
    op.drop_constraint('ck_sales_stock_product_or_material', 'sales_stock', type_='check')
    if not conn.execute(sa.text("SELECT 1 FROM sales_stock WHERE product_id IS NULL LIMIT 1")).first():
        op.alter_column('sales_stock', 'product_id', existing_type=sa.Integer(), nullable=False)
    for table, not_null in reversed(TABLES):
        op.drop_index(f'ix_{table}_material_id', table_name=table)
        op.drop_column(table, 'material_id')
        if not_null and not conn.execute(sa.text(f"SELECT 1 FROM {table} WHERE product_id IS NULL LIMIT 1")).first():
            op.alter_column(table, 'product_id', existing_type=sa.Integer(), nullable=False)
