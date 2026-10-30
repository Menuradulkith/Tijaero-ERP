"""Manufacturing planning: reordering rules, make-to-order link from quotation lines.

Revision ID: s112_mfg_planning
Revises: s111_manufacturing
Create Date: 2026-10-26

mfg_reorder_rules keeps a min / max stock level per product and branch for MRP.
mfg_production_orders.quote_item_id links a make-to-order production order to the
quotation line it was raised for (its output is reserved for that line).
"""
from alembic import op
import sqlalchemy as sa

revision = "s112_mfg_planning"
down_revision = "s111_manufacturing"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "mfg_reorder_rules",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("product_id", sa.Integer, sa.ForeignKey("products.id"), nullable=False),
        sa.Column("branch_code", sa.String(200), nullable=False),
        sa.Column("min_quantity", sa.Integer, nullable=False),
        sa.Column("max_quantity", sa.Integer, nullable=True),
        sa.Column("multiple_quantity", sa.Integer, nullable=False, server_default="1"),
        sa.Column("preferred_supplier_id", sa.Integer, sa.ForeignKey("supplier.id"), nullable=True),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_by", sa.Integer, nullable=True),
        sa.Column("updated_by", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("product_id", "branch_code", name="uq_mfg_reorder_rules_product_branch"),
    )
    op.create_index("ix_mfg_reorder_rules_id", "mfg_reorder_rules", ["id"])
    op.create_index("ix_mfg_reorder_rules_branch_code", "mfg_reorder_rules", ["branch_code"])

    op.add_column("mfg_production_orders", sa.Column("quote_item_id", sa.Integer,
                                                     sa.ForeignKey("sales_quote_items.id"), nullable=True))
    op.create_index("ix_mfg_production_orders_quote_item_id", "mfg_production_orders", ["quote_item_id"])

    conn = op.get_bind()
    conn.execute(sa.text(
        "insert into auth_permission (name, resource, action, description, created_at, updated_at) "
        "select 'update_mrp', 'mrp', 'update', 'Manage reordering rules and create orders from MRP', now(), now() "
        "where not exists (select 1 from auth_permission where resource='mrp' and action='update')"
    ))
    conn.execute(sa.text("""
        insert into auth_group_permissions (group_id, permission_id)
        select g.id, np.id from auth_group g join auth_permission np on np.resource = 'mrp' and np.action = 'update'
        where g.name = 'Admin' and not exists (select 1 from auth_group_permissions x where x.group_id = g.id and x.permission_id = np.id)
    """))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("delete from auth_group_permissions where permission_id in (select id from auth_permission where resource='mrp' and action='update')"))
    conn.execute(sa.text("delete from auth_permission where resource='mrp' and action='update'"))
    conn.execute(sa.text("update sales_quote_items set item_status = 'pending' where item_status = 'mo_created'"))
    op.drop_index("ix_mfg_production_orders_quote_item_id", table_name="mfg_production_orders")
    op.drop_column("mfg_production_orders", "quote_item_id")
    op.drop_table("mfg_reorder_rules")
