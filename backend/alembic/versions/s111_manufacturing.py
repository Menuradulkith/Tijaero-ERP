"""Manufacturing: work centers, BOMs with routing, production orders and their
material issues, output receipts and job-card time logs.

Revision ID: s111_manufacturing
Revises: s110_quote_confirmed_date
Create Date: 2026-10-26

sales_stock gains production links: manufactured stock has no GRN line, so the GRN /
PO-item columns become nullable and production_order_id marks where it came from;
consumed_by_production_order_id marks components issued to an order.

GL: 1230 Work in Progress, 5030 Production Variance, 5040 Production Labour & Overhead
Absorbed. Permissions are granted to the Admin group only.
"""
from alembic import op
import sqlalchemy as sa

revision = "s111_manufacturing"
down_revision = "s110_quote_confirmed_date"
branch_labels = None
depends_on = None


def _audit():
    return [
        sa.Column("created_by", sa.Integer, nullable=True),
        sa.Column("updated_by", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
    ]


NEW_PERMISSIONS = [
    ("manufacturing_dashboard", "view", "View the manufacturing dashboard"),
    ("work_centers", "view", "View work centers"),
    ("work_centers", "create", "Create work centers"),
    ("work_centers", "update", "Update work centers"),
    ("work_centers", "delete", "Delete work centers"),
    ("boms", "view", "View bills of materials"),
    ("boms", "create", "Create bills of materials"),
    ("boms", "update", "Update and activate bills of materials"),
    ("boms", "delete", "Delete draft bills of materials"),
    ("production_orders", "view", "View production orders"),
    ("production_orders", "create", "Create production orders"),
    ("production_orders", "update", "Update draft production orders"),
    ("production_orders", "delete", "Delete draft production orders"),
    ("production_orders", "approve", "Release, complete, close and cancel production orders"),
    ("shop_floor", "view", "View job cards and material requirements on the shop floor"),
    ("shop_floor", "update", "Issue materials, record output and log time on production orders"),
    ("mrp", "view", "View material requirements planning"),
]

NEW_ACCOUNTS = [
    # code, name, type, category, normal balance, description, parent
    ("1230", "Work in Progress", "Asset", "Inventory", "Debit",
     "Materials, labour and overhead on open production orders", "1200"),
    ("5030", "Production Variance", "Expense", "COGS", "Debit",
     "Difference between actual production cost and the standard cost of output", "5000"),
    ("5040", "Production Labour & Overhead Absorbed", "Expense", "COGS", "Debit",
     "Labour and overhead charged to production orders at work-center rates (credit balance)", "5000"),
]


def upgrade() -> None:
    op.create_table(
        "mfg_work_centers",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(30), nullable=False),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("branch_code", sa.String(200), nullable=True),
        sa.Column("capacity", sa.Integer, nullable=False, server_default="1"),
        sa.Column("efficiency_pct", sa.Numeric(5, 2), nullable=False, server_default="100"),
        sa.Column("working_hours_per_day", sa.Numeric(5, 2), nullable=False, server_default="8"),
        sa.Column("labor_rate_per_hour", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("overhead_rate_per_hour", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        *_audit(),
    )
    op.create_index("ix_mfg_work_centers_id", "mfg_work_centers", ["id"])
    op.create_index("ix_mfg_work_centers_branch_code", "mfg_work_centers", ["branch_code"])
    op.execute("create unique index uq_mfg_work_centers_code_ci on mfg_work_centers (lower(btrim(code)))")

    op.create_table(
        "mfg_boms",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("bom_no", sa.String(30), nullable=False, unique=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("version", sa.String(20), nullable=False, server_default="1"),
        sa.Column("output_quantity", sa.Numeric(14, 4), nullable=False, server_default="1"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("description", sa.Text, nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_boms_id", "mfg_boms", ["id"])
    op.create_index("ix_mfg_boms_product_id", "mfg_boms", ["product_id"])
    op.create_index("ix_mfg_boms_status", "mfg_boms", ["status"])
    op.execute("create unique index uq_mfg_boms_product_version_ci on mfg_boms (product_id, lower(btrim(version)))")
    # One default active BOM per product
    op.execute("create unique index uq_mfg_boms_default on mfg_boms (product_id) where is_default and status = 'active'")

    op.create_table(
        "mfg_bom_items",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("bom_id", sa.Integer, sa.ForeignKey("mfg_boms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer, nullable=False, server_default="10"),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("scrap_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("issue_method", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("remark", sa.String(255), nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_bom_items_id", "mfg_bom_items", ["id"])
    op.create_index("ix_mfg_bom_items_bom_id", "mfg_bom_items", ["bom_id"])
    op.create_index("ix_mfg_bom_items_product_id", "mfg_bom_items", ["product_id"])

    op.create_table(
        "mfg_bom_operations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("bom_id", sa.Integer, sa.ForeignKey("mfg_boms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer, nullable=False, server_default="10"),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("work_center_id", sa.Integer, sa.ForeignKey("mfg_work_centers.id"), nullable=False),
        sa.Column("setup_minutes", sa.Numeric(10, 2), nullable=False, server_default="0"),
        sa.Column("run_minutes", sa.Numeric(12, 4), nullable=False, server_default="0"),
        sa.Column("description", sa.Text, nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_bom_operations_id", "mfg_bom_operations", ["id"])
    op.create_index("ix_mfg_bom_operations_bom_id", "mfg_bom_operations", ["bom_id"])
    op.create_index("ix_mfg_bom_operations_work_center_id", "mfg_bom_operations", ["work_center_id"])

    op.create_table(
        "mfg_production_orders",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_no", sa.String(40), nullable=False, unique=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("bom_id", sa.Integer, sa.ForeignKey("mfg_boms.id"), nullable=False),
        sa.Column("branch_code", sa.String(200), nullable=False),
        sa.Column("location_id", sa.Integer, sa.ForeignKey("good_received_locations.id"), nullable=True),
        sa.Column("planned_quantity", sa.Integer, nullable=False),
        sa.Column("produced_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("scrapped_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("planned_start_date", sa.Date, nullable=False),
        sa.Column("planned_end_date", sa.Date, nullable=False),
        sa.Column("actual_start_at", sa.TIMESTAMP, nullable=True),
        sa.Column("actual_end_at", sa.TIMESTAMP, nullable=True),
        sa.Column("priority", sa.String(10), nullable=False, server_default="normal"),
        sa.Column("status", sa.String(20), nullable=False, server_default="draft"),
        sa.Column("source_reference", sa.String(100), nullable=True),
        sa.Column("remark", sa.Text, nullable=True),
        sa.Column("cancel_reason", sa.Text, nullable=True),
        sa.Column("standard_unit_cost", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("planned_material_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("planned_labor_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("planned_overhead_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("actual_material_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("actual_labor_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("actual_overhead_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("output_value", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("variance_amount", sa.Numeric(16, 2), nullable=True),
        sa.Column("released_by", sa.Integer, nullable=True),
        sa.Column("released_at", sa.TIMESTAMP, nullable=True),
        sa.Column("closed_by", sa.Integer, nullable=True),
        sa.Column("closed_at", sa.TIMESTAMP, nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_production_orders_id", "mfg_production_orders", ["id"])
    op.create_index("ix_mfg_production_orders_product_id", "mfg_production_orders", ["product_id"])
    op.create_index("ix_mfg_production_orders_bom_id", "mfg_production_orders", ["bom_id"])
    op.create_index("ix_mfg_production_orders_branch_code", "mfg_production_orders", ["branch_code"])
    op.create_index("ix_mfg_production_orders_status", "mfg_production_orders", ["status"])

    op.create_table(
        "mfg_production_order_materials",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("mfg_production_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer, nullable=False, server_default="10"),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity_per_unit", sa.Numeric(14, 6), nullable=False),
        sa.Column("scrap_pct", sa.Numeric(5, 2), nullable=False, server_default="0"),
        sa.Column("required_quantity", sa.Integer, nullable=False),
        sa.Column("issued_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("issue_method", sa.String(20), nullable=False, server_default="manual"),
        sa.Column("unit_cost", sa.Numeric(14, 2), nullable=False, server_default="0"),
        *_audit(),
    )
    op.create_index("ix_mfg_production_order_materials_id", "mfg_production_order_materials", ["id"])
    op.create_index("ix_mfg_production_order_materials_order_id", "mfg_production_order_materials", ["order_id"])
    op.create_index("ix_mfg_production_order_materials_product_id", "mfg_production_order_materials", ["product_id"])

    op.create_table(
        "mfg_production_order_operations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("mfg_production_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sequence", sa.Integer, nullable=False, server_default="10"),
        sa.Column("name", sa.String(150), nullable=False),
        sa.Column("work_center_id", sa.Integer, sa.ForeignKey("mfg_work_centers.id"), nullable=False),
        sa.Column("planned_minutes", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("actual_minutes", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("completed_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("labor_rate_per_hour", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("overhead_rate_per_hour", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("started_at", sa.TIMESTAMP, nullable=True),
        sa.Column("completed_at", sa.TIMESTAMP, nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_production_order_operations_id", "mfg_production_order_operations", ["id"])
    op.create_index("ix_mfg_production_order_operations_order_id", "mfg_production_order_operations", ["order_id"])
    op.create_index("ix_mfg_production_order_operations_work_center_id", "mfg_production_order_operations", ["work_center_id"])

    op.create_table(
        "mfg_material_transactions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("mfg_production_orders.id"), nullable=False),
        sa.Column("material_id", sa.Integer, sa.ForeignKey("mfg_production_order_materials.id"), nullable=False),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("unit_cost", sa.Numeric(14, 2), nullable=False),
        sa.Column("total_cost", sa.Numeric(16, 2), nullable=False),
        sa.Column("branch_code", sa.String(200), nullable=False),
        sa.Column("transaction_date", sa.TIMESTAMP, nullable=False),
        sa.Column("remark", sa.String(255), nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_material_transactions_id", "mfg_material_transactions", ["id"])
    op.create_index("ix_mfg_material_transactions_order_id", "mfg_material_transactions", ["order_id"])
    op.create_index("ix_mfg_material_transactions_material_id", "mfg_material_transactions", ["material_id"])

    op.create_table(
        "mfg_production_outputs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("mfg_production_orders.id"), nullable=False),
        sa.Column("quantity", sa.Integer, nullable=False),
        sa.Column("scrap_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("batch_no", sa.String(100), nullable=True),
        sa.Column("expiry_date", sa.Date, nullable=True),
        sa.Column("unit_cost", sa.Numeric(14, 2), nullable=False),
        sa.Column("total_value", sa.Numeric(16, 2), nullable=False),
        sa.Column("location_id", sa.Integer, sa.ForeignKey("good_received_locations.id"), nullable=True),
        sa.Column("receipt_date", sa.TIMESTAMP, nullable=False),
        sa.Column("remark", sa.String(255), nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_production_outputs_id", "mfg_production_outputs", ["id"])
    op.create_index("ix_mfg_production_outputs_order_id", "mfg_production_outputs", ["order_id"])

    op.create_table(
        "mfg_time_logs",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("order_id", sa.Integer, sa.ForeignKey("mfg_production_orders.id"), nullable=False),
        sa.Column("operation_id", sa.Integer, sa.ForeignKey("mfg_production_order_operations.id"), nullable=False),
        sa.Column("employee_id", sa.Integer, sa.ForeignKey("employees.id"), nullable=True),
        sa.Column("start_time", sa.TIMESTAMP, nullable=True),
        sa.Column("end_time", sa.TIMESTAMP, nullable=True),
        sa.Column("minutes", sa.Numeric(12, 2), nullable=False),
        sa.Column("completed_quantity", sa.Integer, nullable=False, server_default="0"),
        sa.Column("labor_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("overhead_cost", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("is_auto", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("remark", sa.String(255), nullable=True),
        *_audit(),
    )
    op.create_index("ix_mfg_time_logs_id", "mfg_time_logs", ["id"])
    op.create_index("ix_mfg_time_logs_order_id", "mfg_time_logs", ["order_id"])
    op.create_index("ix_mfg_time_logs_operation_id", "mfg_time_logs", ["operation_id"])

    # ── stock links ──
    op.alter_column("sales_stock", "good_received_note_id", existing_type=sa.Integer, nullable=True)
    op.alter_column("sales_stock", "purchasing_order_items_id", existing_type=sa.Integer, nullable=True)
    op.add_column("sales_stock", sa.Column("production_order_id", sa.Integer,
                                           sa.ForeignKey("mfg_production_orders.id"), nullable=True))
    op.add_column("sales_stock", sa.Column("consumed_by_production_order_id", sa.Integer,
                                           sa.ForeignKey("mfg_production_orders.id"), nullable=True))
    op.create_index("ix_sales_stock_production_order_id", "sales_stock", ["production_order_id"])
    op.create_index("ix_sales_stock_consumed_by_production_order_id", "sales_stock", ["consumed_by_production_order_id"])
    # Every stock row comes from somewhere: a GRN line or a production order
    op.execute("""
        alter table sales_stock add constraint ck_sales_stock_source
        check ((good_received_note_id is not null and purchasing_order_items_id is not null)
               or production_order_id is not null)
    """)

    conn = op.get_bind()
    # ── accounts ──
    for code, name, typ, cat, normal, desc, parent in NEW_ACCOUNTS:
        conn.execute(sa.text("""
            INSERT INTO chart_of_accounts
                (account_code, account_name, account_type, account_category, parent_account_id,
                 is_active, is_system_account, normal_balance, description)
            SELECT cast(:code as varchar), cast(:name as varchar), cast(:typ as varchar), cast(:cat as varchar),
                   (SELECT id FROM chart_of_accounts WHERE account_code = cast(:parent as varchar)),
                   TRUE, TRUE, cast(:normal as varchar), cast(:desc as text)
            WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = cast(:code as varchar))
        """), dict(code=code, name=name, typ=typ, cat=cat, normal=normal, desc=desc, parent=parent))
    conn.execute(sa.text("""
        UPDATE cash_flow_categories SET account_mapping = '["1210", "1220", "1230"]'
        WHERE category_code = 'OP-011' AND account_mapping = '["1210", "1220"]'
    """))

    # ── permissions (Admin only) ──
    for resource, action, desc in NEW_PERMISSIONS:
        conn.execute(sa.text(
            "insert into auth_permission (name, resource, action, description, created_at, updated_at) "
            "select cast(:n as varchar), cast(:r as varchar), cast(:a as varchar), cast(:d as varchar), now(), now() "
            "where not exists (select 1 from auth_permission where resource=:r and action=:a)"
        ), {"n": f"{action}_{resource}", "r": resource, "a": action, "d": desc})
        conn.execute(sa.text("""
            insert into auth_group_permissions (group_id, permission_id)
            select g.id, np.id from auth_group g join auth_permission np on np.resource = :r and np.action = :a
            where g.name = 'Admin' and not exists (select 1 from auth_group_permissions x where x.group_id = g.id and x.permission_id = np.id)
        """), {"r": resource, "a": action})


_RESOURCES = "('manufacturing_dashboard','work_centers','boms','production_orders','shop_floor','mrp')"


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text(f"delete from auth_group_permissions where permission_id in (select id from auth_permission where resource in {_RESOURCES})"))
    conn.execute(sa.text(f"delete from auth_permission where resource in {_RESOURCES}"))
    conn.execute(sa.text("""
        UPDATE cash_flow_categories SET account_mapping = '["1210", "1220"]'
        WHERE category_code = 'OP-011' AND account_mapping = '["1210", "1220", "1230"]'
    """))
    conn.execute(sa.text("""
        DELETE FROM chart_of_accounts c WHERE c.account_code IN ('1230', '5030', '5040')
        AND NOT EXISTS (SELECT 1 FROM general_ledger g WHERE g.account_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.account_id = c.id)
    """))
    op.execute("alter table sales_stock drop constraint if exists ck_sales_stock_source")
    op.drop_index("ix_sales_stock_consumed_by_production_order_id", table_name="sales_stock")
    op.drop_index("ix_sales_stock_production_order_id", table_name="sales_stock")
    op.drop_column("sales_stock", "consumed_by_production_order_id")
    op.drop_column("sales_stock", "production_order_id")
    # Manufactured stock rows have no GRN line; they cannot survive the NOT NULL.
    op.execute("delete from sales_stock where good_received_note_id is null")
    op.alter_column("sales_stock", "purchasing_order_items_id", existing_type=sa.Integer, nullable=False)
    op.alter_column("sales_stock", "good_received_note_id", existing_type=sa.Integer, nullable=False)
    for t in ("mfg_time_logs", "mfg_production_outputs", "mfg_material_transactions",
              "mfg_production_order_operations", "mfg_production_order_materials", "mfg_production_orders",
              "mfg_bom_operations", "mfg_bom_items", "mfg_boms", "mfg_work_centers"):
        op.drop_table(t)
