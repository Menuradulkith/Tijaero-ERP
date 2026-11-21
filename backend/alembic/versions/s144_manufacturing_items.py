"""Central stock phase 4: manufacturing works on Item Catalog items

* mfg_boms / mfg_bom_items / mfg_bom_byproducts / mfg_reorder_rules /
  mfg_production_orders / mfg_production_order_materials /
  mfg_production_order_byproducts get material_id (the item made, used or yielded);
  mfg_material_transactions gets item_material_id (its material_id column already
  points at the order's material line). All indexed, backfilled from
  products.material_id; their product_id becomes nullable so new records can
  carry an item only (old rows keep their product for history).
* A product referenced by manufacturing that has no item yet (e.g. a non-inventory
  component) gets one built from its data, with the same mapping as
  s142_product_item_link / app.modules.materials.from_product, and its stock rows
  and ledger lines are pointed at it, so every manufacturing row gets an item.
* Reordering rules are unique per (item, branch) when the backfill leaves no duplicates.

Downgrade drops the new columns and restores NOT NULL only where no row needs NULL;
items created here stay in the Item Catalog.

Revision ID: s144_manufacturing_items
Revises: s143_purchasing_items
Create Date: 2026-11-20
"""
import re

import sqlalchemy as sa
from alembic import op

revision = 's144_manufacturing_items'
down_revision = 's143_purchasing_items'
branch_labels = None
depends_on = None

# (table, item column, product column was NOT NULL)
TABLES = (
    ('mfg_boms', 'material_id', True),
    ('mfg_bom_items', 'material_id', True),
    ('mfg_bom_byproducts', 'material_id', True),
    ('mfg_reorder_rules', 'material_id', True),
    ('mfg_production_orders', 'material_id', True),
    ('mfg_production_order_materials', 'material_id', True),
    ('mfg_production_order_byproducts', 'material_id', True),
    ('mfg_material_transactions', 'item_material_id', True),
)


def _next_code(conn, table: str, column: str, prefix: str, width: int) -> str:
    last = conn.execute(sa.text(
        f"SELECT MAX(CAST(SUBSTR({column}, :start) AS INTEGER)) FROM {table} WHERE {column} ~ :pattern"
    ), {"start": len(prefix) + 1, "pattern": "^" + re.escape(prefix) + "[0-9]+$"}).scalar()
    return f"{prefix}{(last or 0) + 1:0{width}d}"


def _norm(name) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def _items_for_unlinked_products(conn) -> tuple:
    """Create (or link) an item for every product manufacturing references that has none."""
    refs = " UNION ".join(f"SELECT product_id FROM {t} WHERE product_id IS NOT NULL" for t, _, _ in TABLES)
    products = conn.execute(sa.text(f"""
        SELECT p.id, p.name, p.item_code, p.model, p.unit_of_measure, p.tracking_type,
               p.over_receipt_tolerance_pct, p.under_receipt_tolerance_pct, p.shelf_life_days, p.requires_qc,
               p.description, p.cost_price, p.tax_rate, p.active, p.items_brand_id, p.product_family,
               p.required_certificate, c.name AS category_name, c.memo AS category_memo,
               c.description AS category_description, h.code AS hs_code
        FROM products p
        JOIN category c ON c.id = p.category_id
        LEFT JOIN hs_codes h ON h.id = p.hs_code_id
        WHERE p.material_id IS NULL AND p.id IN ({refs})
        ORDER BY p.id
    """)).mappings().all()
    if not products:
        return 0, 0
    categories = {_norm(r.name): r.id for r in conn.execute(sa.text("SELECT id, name FROM material_categories"))}
    materials = {
        _norm(r.name): r for r in conn.execute(sa.text(
            "SELECT m.id, m.name, m.items_brand_id, mc.name AS category_name "
            "FROM materials m JOIN material_categories mc ON mc.id = m.category_id"))
    }
    created = linked = 0
    for p in products:
        cat_key = _norm(p.category_name)
        category_id = categories.get(cat_key)
        if category_id is None:
            category_id = conn.execute(sa.text("""
                INSERT INTO material_categories (name, category_code, memo, description, active, created_date,
                                                 created_at, updated_at)
                VALUES (:name, :code, :memo, :description, true, now(), now(), now()) RETURNING id
            """), {"name": p.category_name.strip(),
                   "code": _next_code(conn, "material_categories", "category_code", "MCAT", 4),
                   "memo": p.category_memo, "description": p.category_description}).scalar()
            categories[cat_key] = category_id
        name = re.sub(r"\s+", " ", p.name.strip())
        existing = materials.get(_norm(name))
        if existing is not None and _norm(existing.category_name) == cat_key and existing.items_brand_id == p.items_brand_id:
            material_id = existing.id
            linked += 1
        else:
            if existing is not None:
                suffix = f" (product {p.item_code})"
                name = name[:255 - len(suffix)] + suffix
            material_id = conn.execute(sa.text("""
                INSERT INTO materials (
                    name, item_code, model, item_type, unit_of_measure, tracking_type,
                    over_receipt_tolerance_pct, under_receipt_tolerance_pct, shelf_life_days, requires_qc,
                    description, website_active, active, cost_price, tax_rate, created_date, category_id,
                    items_brand_id, added_date, hs_code, required_certificate, inventory_valuation_method,
                    stock_issuing_method, product_family, check_for_availability, design_required,
                    created_at, updated_at)
                VALUES (
                    :name, :item_code, :model, 'stock_item', :uom, :tracking,
                    :over_tol, :under_tol, :shelf_life, :requires_qc,
                    :description, false, :active, :cost_price, :tax_rate, CURRENT_DATE, :category_id,
                    :brand_id, now(), :hs_code, :certificate, 'fifo',
                    :issuing, :family, false, false,
                    now(), now())
                RETURNING id
            """), {
                "name": name,
                "item_code": _next_code(conn, "materials", "item_code", "MAT", 6),
                "model": p.model,
                "uom": p.unit_of_measure or "pcs",
                "tracking": p.tracking_type or "serial",
                "over_tol": p.over_receipt_tolerance_pct or 0,
                "under_tol": p.under_receipt_tolerance_pct or 0,
                "shelf_life": p.shelf_life_days,
                "requires_qc": bool(p.requires_qc),
                "description": p.description,
                "active": bool(p.active),
                "cost_price": p.cost_price or 0,
                "tax_rate": p.tax_rate or 0,
                "category_id": category_id,
                "brand_id": p.items_brand_id,
                "hs_code": (p.hs_code or None) and p.hs_code[:20],
                "certificate": p.required_certificate,
                "issuing": "fefo" if p.tracking_type == "batch" else "fifo",
                "family": ((p.product_family or "").strip() or p.category_name.strip())[:120],
            }).scalar()
            materials[_norm(name)] = type("M", (), {"id": material_id, "name": name, "items_brand_id": p.items_brand_id,
                                                    "category_name": p.category_name})
            created += 1
        conn.execute(sa.text("UPDATE products SET material_id = :m WHERE id = :p"), {"m": material_id, "p": p.id})
        conn.execute(sa.text("UPDATE sales_stock SET material_id = :m WHERE product_id = :p AND material_id IS NULL"),
                     {"m": material_id, "p": p.id})
        conn.execute(sa.text("UPDATE stock_transactions SET material_id = :m WHERE product_id = :p AND material_id IS NULL"),
                     {"m": material_id, "p": p.id})
    return created, linked


def upgrade() -> None:
    conn = op.get_bind()
    for table, col, not_null in TABLES:
        op.add_column(table, sa.Column(col, sa.Integer(), sa.ForeignKey('materials.id'), nullable=True))
        op.create_index(f'ix_{table}_{col}', table, [col])
        if not_null:
            op.alter_column(table, 'product_id', existing_type=sa.Integer(), nullable=True)

    created, linked = _items_for_unlinked_products(conn)
    print(f"s144: {created} item(s) created and {linked} linked to an existing item for products "
          f"manufacturing referenced without one")

    for table, col, _ in TABLES:
        n = conn.execute(sa.text(f"""
            UPDATE {table} t SET {col} = p.material_id
            FROM products p
            WHERE p.id = t.product_id AND t.{col} IS NULL AND p.material_id IS NOT NULL
        """)).rowcount
        total = conn.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar()
        missing = conn.execute(sa.text(f"SELECT COUNT(*) FROM {table} WHERE {col} IS NULL")).scalar()
        print(f"s144: {table}: {col} backfilled on {n} of {total} row(s), {missing} without an item")

    dupes = conn.execute(sa.text("""
        SELECT COUNT(*) FROM (SELECT 1 FROM mfg_reorder_rules WHERE material_id IS NOT NULL
                              GROUP BY material_id, branch_code HAVING COUNT(*) > 1) d
    """)).scalar()
    if dupes:
        print(f"s144: mfg_reorder_rules: {dupes} (item, branch) pair(s) have several rules; "
              "unique index not created, merge them and add uq_mfg_reorder_rules_material_branch by hand")
    else:
        op.create_index('uq_mfg_reorder_rules_material_branch', 'mfg_reorder_rules', ['material_id', 'branch_code'],
                        unique=True)


def downgrade() -> None:
    conn = op.get_bind()
    if conn.execute(sa.text("SELECT 1 FROM pg_indexes WHERE indexname = 'uq_mfg_reorder_rules_material_branch'")).first():
        op.drop_index('uq_mfg_reorder_rules_material_branch', table_name='mfg_reorder_rules')
    for table, col, not_null in reversed(TABLES):
        op.drop_index(f'ix_{table}_{col}', table_name=table)
        op.drop_column(table, col)
        if not_null and not conn.execute(sa.text(f"SELECT 1 FROM {table} WHERE product_id IS NULL LIMIT 1")).first():
            op.alter_column(table, 'product_id', existing_type=sa.Integer(), nullable=False)
