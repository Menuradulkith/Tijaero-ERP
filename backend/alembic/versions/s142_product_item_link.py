"""Central stock phase 2: products.material_id links a product (sales part) to its Item Catalog item

Data step: every stocked product (item_type 'inventory' or any sales_stock row)
gets an item (materials row) built from the product's data — or is linked to an
existing item of the same name when its category and brand match — and that
product's sales_stock / stock_transactions rows are pointed at the item.
The mapping mirrors app.modules.materials.from_product (used for new products).

Downgrade drops products.material_id only: the items created here stay in the
Item Catalog and sales_stock / stock_transactions keep their material_id.

Revision ID: s142_product_item_link
Revises: s141_stock_ledger
Create Date: 2026-11-20
"""
import re

import sqlalchemy as sa
from alembic import op

revision = 's142_product_item_link'
down_revision = 's141_stock_ledger'
branch_labels = None
depends_on = None


def _next_code(conn, table: str, column: str, prefix: str, width: int) -> str:
    last = conn.execute(sa.text(
        f"SELECT MAX(CAST(SUBSTR({column}, :start) AS INTEGER)) FROM {table} WHERE {column} ~ :pattern"
    ), {"start": len(prefix) + 1, "pattern": "^" + re.escape(prefix) + "[0-9]+$"}).scalar()
    return f"{prefix}{(last or 0) + 1:0{width}d}"


def _norm(name) -> str:
    return re.sub(r"\s+", " ", (name or "").strip()).lower()


def upgrade() -> None:
    op.add_column('products', sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=True))
    op.create_index('ix_products_material_id', 'products', ['material_id'])

    conn = op.get_bind()
    products = conn.execute(sa.text("""
        SELECT p.id, p.name, p.item_code, p.model, p.unit_of_measure, p.tracking_type,
               p.over_receipt_tolerance_pct, p.under_receipt_tolerance_pct, p.shelf_life_days, p.requires_qc,
               p.description, p.cost_price, p.tax_rate, p.active, p.items_brand_id, p.product_family,
               p.required_certificate, c.name AS category_name, c.memo AS category_memo,
               c.description AS category_description, h.code AS hs_code
        FROM products p
        JOIN category c ON c.id = p.category_id
        LEFT JOIN hs_codes h ON h.id = p.hs_code_id
        WHERE p.material_id IS NULL
          AND (p.item_type = 'inventory' OR EXISTS (SELECT 1 FROM sales_stock s WHERE s.product_id = p.id))
        ORDER BY p.id
    """)).mappings().all()

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
            """), {"name": p.category_name.strip(), "code": _next_code(conn, "material_categories", "category_code", "MCAT", 4),
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
        conn.execute(sa.text("UPDATE sales_stock SET material_id = :m WHERE product_id = :p"), {"m": material_id, "p": p.id})
        conn.execute(sa.text("UPDATE stock_transactions SET material_id = :m WHERE product_id = :p"),
                     {"m": material_id, "p": p.id})
    print(f"s142_product_item_link: {created} item(s) created, {linked} linked to an existing item, "
          f"{len(products)} product(s) linked")

    # Item-keyed allocation filters on these (phase 1 added the product-keyed ones).
    op.create_index('ix_sales_stock_material_branch_status', 'sales_stock', ['material_id', 'branch_code', 'status'])
    op.create_index('ix_sales_stock_material_location', 'sales_stock', ['material_id', 'location_id'])
    op.create_index('ix_stock_transactions_material_created', 'stock_transactions', ['material_id', 'created_at'])


def downgrade() -> None:
    op.drop_index('ix_stock_transactions_material_created', table_name='stock_transactions')
    op.drop_index('ix_sales_stock_material_location', table_name='sales_stock')
    op.drop_index('ix_sales_stock_material_branch_status', table_name='sales_stock')
    op.drop_index('ix_products_material_id', table_name='products')
    op.drop_column('products', 'material_id')
