"""Central stock phase 1: material_id + unit_cost on sales_stock, stock_transactions ledger

Revision ID: s141_stock_ledger
Revises: s140_product_master_general
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's141_stock_ledger'
down_revision = 's140_product_master_general'
branch_labels = None
depends_on = None

# Statuses where the units physically sit at a branch / location. in_transit is
# between branches (not on hand anywhere) but still gets an opening line.
ON_HAND = ('available', 'reserved', 'frozen', 'damaged', 'transfer_pending', 'return_pending')


def upgrade() -> None:
    op.add_column('sales_stock', sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=True))
    op.add_column('sales_stock', sa.Column('unit_cost', sa.Numeric(18, 2), nullable=True))
    op.create_index('ix_sales_stock_material_id', 'sales_stock', ['material_id'])
    op.create_index('ix_sales_stock_product_branch_status', 'sales_stock', ['product_id', 'branch_code', 'status'])
    op.create_index('ix_sales_stock_product_location', 'sales_stock', ['product_id', 'location_id'])
    op.create_index('ix_sales_stock_good_received_note_id', 'sales_stock', ['good_received_note_id'])

    # Backfill unit cost: PO line price, else production standard cost, else product cost price.
    op.execute("""
        UPDATE sales_stock s SET unit_cost = COALESCE(
            NULLIF((SELECT poi.unit_price FROM purchasing_order_items poi WHERE poi.id = s.purchasing_order_items_id), 0),
            NULLIF((SELECT po.standard_unit_cost FROM mfg_production_orders po
                    WHERE po.id = s.production_order_id AND po.product_id = s.product_id), 0),
            (SELECT p.cost_price FROM products p WHERE p.id = s.product_id)
        )
    """)

    op.create_table(
        'stock_transactions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('stock_id', sa.Integer(), sa.ForeignKey('sales_stock.id'), nullable=False),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id'), nullable=True),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=True),
        sa.Column('movement_type', sa.String(30), nullable=False),
        sa.Column('quantity', sa.Numeric(18, 3), nullable=False),
        sa.Column('on_hand_change', sa.Numeric(18, 3), nullable=False, server_default='0'),
        sa.Column('from_status', sa.String(50), nullable=True),
        sa.Column('to_status', sa.String(50), nullable=True),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('from_location_id', sa.Integer(), sa.ForeignKey('good_received_locations.id'), nullable=True),
        sa.Column('to_location_id', sa.Integer(), sa.ForeignKey('good_received_locations.id'), nullable=True),
        sa.Column('batch_no', sa.String(100), nullable=True),
        sa.Column('barcode', sa.Text(), nullable=True),
        sa.Column('unit_cost', sa.Numeric(18, 2), nullable=True),
        sa.Column('reference_type', sa.String(40), nullable=True),
        sa.Column('reference_id', sa.Integer(), nullable=True),
        sa.Column('reference_no', sa.String(60), nullable=True),
        sa.Column('user_id', sa.Integer(), nullable=True),
    )
    op.create_index('ix_stock_transactions_stock_id', 'stock_transactions', ['stock_id'])
    op.create_index('ix_stock_transactions_product_created', 'stock_transactions', ['product_id', 'created_at'])
    op.create_index('ix_stock_transactions_branch_created', 'stock_transactions', ['branch_code', 'created_at'])
    op.create_index('ix_stock_transactions_reference', 'stock_transactions', ['reference_type', 'reference_id'])
    op.create_index('ix_stock_transactions_movement_type', 'stock_transactions', ['movement_type'])

    # Opening balance so the ledger reconciles from today: one line per active row
    # on hand or in transit.
    on_hand_list = ", ".join(f"'{s}'" for s in ON_HAND)
    op.execute(f"""
        INSERT INTO stock_transactions (
            created_at, stock_id, product_id, material_id, movement_type, quantity, on_hand_change,
            from_status, to_status, branch_code, from_location_id, to_location_id, batch_no, barcode,
            unit_cost, reference_type, reference_id, reference_no, user_id)
        SELECT now()::timestamp, s.id, s.product_id, s.material_id, 'opening_balance', s.quantity,
               CASE WHEN s.status IN ({on_hand_list}) THEN s.quantity ELSE 0 END,
               NULL, s.status, s.branch_code, NULL, s.location_id, s.batch_no, s.barcode,
               s.unit_cost, 'opening_balance', NULL, NULL, NULL
        FROM sales_stock s
        WHERE s.is_active = true AND s.status IN ({on_hand_list}, 'in_transit')
        ORDER BY s.id
    """)


def downgrade() -> None:
    op.drop_table('stock_transactions')
    op.drop_index('ix_sales_stock_good_received_note_id', table_name='sales_stock')
    op.drop_index('ix_sales_stock_product_location', table_name='sales_stock')
    op.drop_index('ix_sales_stock_product_branch_status', table_name='sales_stock')
    op.drop_index('ix_sales_stock_material_id', table_name='sales_stock')
    op.drop_column('sales_stock', 'unit_cost')
    op.drop_column('sales_stock', 'material_id')
