"""Central stock phase 5: costing from stock row cost, stock count documents

* materials.average_cost NUMERIC(18,4): company-wide moving average unit cost for
  weighted-average items (backfilled from the units held: quantity-weighted row cost,
  else the item's cost price).
* sales_stock.unit_cost backfilled on every held row that has none (or 0) with the old
  derived cost (PO line price, else product cost price, else item cost price), and the
  landed cost already allocated to a GRN line (posted vouchers) added per unit to that
  line's held rows, so every held row carries its full receipt cost.
* invoice_items.unit_cost NUMERIC(18,2): the cost basis captured when the sale's COGS
  posts, so a return reverses COGS at the same cost.
* stock_counts / stock_count_lines: the stock count document; sales_stock.stock_count_id is
  the source of stock found by a count, so ck_sales_stock_source now also accepts it.

Revision ID: s145_costing_counts
Revises: s144_manufacturing_items
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's145_costing_counts'
down_revision = 's144_manufacturing_items'
branch_labels = None
depends_on = None

HELD = ("'available', 'reserved', 'frozen', 'damaged', 'transfer_pending', 'return_pending', 'in_transit'")


def upgrade() -> None:
    conn = op.get_bind()
    op.add_column('materials', sa.Column('average_cost', sa.Numeric(18, 4), nullable=True))
    op.add_column('invoice_items', sa.Column('unit_cost', sa.Numeric(18, 2), nullable=True))

    # Held rows without a cost get the old derived cost
    filled = conn.execute(sa.text(f"""
        UPDATE sales_stock s SET unit_cost = COALESCE(
            NULLIF((SELECT poi.unit_price FROM purchasing_order_items poi WHERE poi.id = s.purchasing_order_items_id), 0),
            (SELECT p.cost_price FROM products p WHERE p.id = s.product_id),
            (SELECT m.cost_price FROM materials m WHERE m.id = s.material_id),
            0)
        WHERE (s.unit_cost IS NULL OR s.unit_cost = 0) AND s.status IN ({HELD})
    """)).rowcount

    # Landed cost already allocated to a GRN line: its per-unit share onto the line's held rows
    landed = conn.execute(sa.text(f"""
        WITH share AS (
            SELECT v.good_received_note_id AS grn_id, a.purchasing_order_items_id AS po_item_id,
                   SUM(a.amount) / NULLIF(SUM(a.quantity), 0) AS per_unit
            FROM landed_cost_allocations a
            JOIN landed_cost_vouchers v ON v.id = a.voucher_id
            WHERE v.status = 'posted'
            GROUP BY v.good_received_note_id, a.purchasing_order_items_id
        )
        UPDATE sales_stock s SET unit_cost = ROUND(s.unit_cost + share.per_unit, 2)
        FROM share
        WHERE s.good_received_note_id = share.grn_id AND s.purchasing_order_items_id = share.po_item_id
          AND share.per_unit IS NOT NULL AND s.status IN ({HELD})
    """)).rowcount

    averaged = conn.execute(sa.text(f"""
        UPDATE materials m SET average_cost = ROUND(COALESCE(
            (SELECT SUM(s.quantity * s.unit_cost) / NULLIF(SUM(s.quantity), 0)
             FROM sales_stock s WHERE s.material_id = m.id AND s.status IN ({HELD}) AND s.unit_cost IS NOT NULL),
            m.cost_price), 4)
        WHERE m.inventory_valuation_method = 'weighted_average'
    """)).rowcount

    op.create_table(
        'stock_counts',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('count_no', sa.String(40), nullable=False, unique=True),
        sa.Column('branch_code', sa.String(200), nullable=False),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('good_received_locations.id'), nullable=True),
        sa.Column('category_id', sa.Integer(), sa.ForeignKey('material_categories.id'), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='counting'),
        sa.Column('remark', sa.Text(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('posted_by', sa.Integer(), nullable=True),
        sa.Column('posted_at', sa.DateTime(), nullable=True),
        sa.Column('cancelled_by', sa.Integer(), nullable=True),
        sa.Column('cancel_reason', sa.Text(), nullable=True),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.CheckConstraint("status IN ('counting', 'posted', 'cancelled')", name='ck_stock_counts_status'),
    )
    op.create_index('ix_stock_counts_branch_code', 'stock_counts', ['branch_code'])
    op.create_index('ix_stock_counts_status', 'stock_counts', ['status'])
    op.create_table(
        'stock_count_lines',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('count_id', sa.Integer(), sa.ForeignKey('stock_counts.id', ondelete='CASCADE'), nullable=False),
        sa.Column('stock_id', sa.Integer(), sa.ForeignKey('sales_stock.id'), nullable=True),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=False),
        sa.Column('location_id', sa.Integer(), sa.ForeignKey('good_received_locations.id'), nullable=True),
        sa.Column('batch_no', sa.String(100), nullable=True),
        sa.Column('barcode', sa.Text(), nullable=True),
        sa.Column('expiry_date', sa.Date(), nullable=True),
        sa.Column('system_quantity', sa.Numeric(18, 3), nullable=False, server_default='0'),
        sa.Column('counted_quantity', sa.Numeric(18, 3), nullable=True),
        sa.Column('unit_cost', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('is_found', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('remark', sa.Text(), nullable=True),
        sa.Column('posted_current_quantity', sa.Numeric(18, 3), nullable=True),
        sa.Column('difference', sa.Numeric(18, 3), nullable=True),
        sa.CheckConstraint('counted_quantity IS NULL OR counted_quantity >= 0', name='ck_stock_count_lines_counted'),
    )
    op.create_index('ix_stock_count_lines_count_id', 'stock_count_lines', ['count_id'])
    op.create_index('ix_stock_count_lines_stock_id', 'stock_count_lines', ['stock_id'])
    op.create_index('ix_stock_count_lines_material_id', 'stock_count_lines', ['material_id'])

    # Stock found by a count has no GRN / production order: the count is its source
    op.add_column('sales_stock', sa.Column('stock_count_id', sa.Integer(), sa.ForeignKey('stock_counts.id'),
                                           nullable=True))
    op.create_index('ix_sales_stock_stock_count_id', 'sales_stock', ['stock_count_id'])
    op.execute("ALTER TABLE sales_stock DROP CONSTRAINT IF EXISTS ck_sales_stock_source")
    op.execute("""
        ALTER TABLE sales_stock ADD CONSTRAINT ck_sales_stock_source
        CHECK ((good_received_note_id IS NOT NULL AND purchasing_order_items_id IS NOT NULL)
               OR production_order_id IS NOT NULL OR stock_count_id IS NOT NULL)
    """)

    print(f"s145_costing_counts: {filled} held stock row(s) given a unit cost, {landed} row(s) given their landed "
          f"cost share, {averaged} weighted-average item(s) averaged")


def downgrade() -> None:
    op.execute("ALTER TABLE sales_stock DROP CONSTRAINT IF EXISTS ck_sales_stock_source")
    op.execute("""
        ALTER TABLE sales_stock ADD CONSTRAINT ck_sales_stock_source
        CHECK ((good_received_note_id IS NOT NULL AND purchasing_order_items_id IS NOT NULL)
               OR production_order_id IS NOT NULL) NOT VALID
    """)
    op.drop_index('ix_sales_stock_stock_count_id', table_name='sales_stock')
    op.drop_column('sales_stock', 'stock_count_id')
    op.drop_table('stock_count_lines')
    op.drop_table('stock_counts')
    op.drop_column('invoice_items', 'unit_cost')
    op.drop_column('materials', 'average_cost')
