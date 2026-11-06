"""Manufacturing for Sri Lankan factories: yield & scrap reasons, shelf life and batch
traceability, quality hold, outside work (subcontracting), by-products.

Revision ID: s130_mfg_sri_lanka
Revises: s129_unique_receive_note
Create Date: 2026-11-06
"""
import sqlalchemy as sa
from alembic import op

revision = 's130_mfg_sri_lanka'
down_revision = 's129_unique_receive_note'
branch_labels = None
depends_on = None


def _audit():
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    # products: shelf life (expiry of a finished batch) and quality hold on output
    op.add_column("products", sa.Column("shelf_life_days", sa.Integer(), nullable=True))
    op.add_column("products", sa.Column("requires_qc", sa.Boolean(), nullable=False, server_default=sa.false()))

    # outside work: a work center can be another company (subcontractor)
    op.add_column("mfg_work_centers", sa.Column("is_outside", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("mfg_work_centers", sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("supplier.id"), nullable=True))
    op.add_column("mfg_bom_operations", sa.Column("outside_unit_cost", sa.Numeric(14, 2), nullable=False, server_default="0"))
    for col in (sa.Column("is_outside", sa.Boolean(), nullable=False, server_default=sa.false()),
                sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("supplier.id"), nullable=True),
                sa.Column("outside_unit_cost", sa.Numeric(14, 2), nullable=False, server_default="0"),
                sa.Column("outside_quantity", sa.Integer(), nullable=False, server_default="0")):
        op.add_column("mfg_production_order_operations", col)

    # yield: how much more than planned an order may produce (food / herbal yields vary)
    op.add_column("mfg_boms", sa.Column("overproduction_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))
    op.add_column("mfg_production_orders", sa.Column("overproduction_pct", sa.Numeric(5, 2), nullable=False, server_default="0"))
    op.add_column("mfg_production_orders", sa.Column("actual_outside_cost", sa.Numeric(16, 2), nullable=False, server_default="0"))

    # output: scrap reason, quality hold, by-product value
    for col in (sa.Column("scrap_reason", sa.String(30), nullable=True),
                sa.Column("qc_status", sa.String(20), nullable=False, server_default="none"),
                sa.Column("qc_passed_quantity", sa.Integer(), nullable=False, server_default="0"),
                sa.Column("qc_failed_quantity", sa.Integer(), nullable=False, server_default="0"),
                sa.Column("byproduct_value", sa.Numeric(16, 2), nullable=False, server_default="0"),
                sa.Column("by_products", sa.JSON(), nullable=True)):
        op.add_column("mfg_production_outputs", col)

    # traceability: the component lots each issue took, and which receipt a stock row came from
    op.add_column("mfg_material_transactions", sa.Column("lots", sa.JSON(), nullable=True))
    op.add_column("sales_stock", sa.Column("production_output_id", sa.Integer(),
                                           sa.ForeignKey("mfg_production_outputs.id"), nullable=True))
    op.create_index("ix_sales_stock_production_output_id", "sales_stock", ["production_output_id"])
    # serial rows of earlier receipts: link them by receipt time (how they were matched until now)
    op.execute("""
        UPDATE sales_stock s SET production_output_id = o.id
          FROM mfg_production_outputs o
         WHERE s.production_order_id = o.order_id AND s.added_date = o.receipt_date AND s.production_output_id IS NULL
    """)

    # by-products on a BOM and on an order
    op.create_table(
        "mfg_bom_byproducts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bom_id", sa.Integer(), sa.ForeignKey("mfg_boms.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        *_audit(),
    )
    op.create_table(
        "mfg_production_order_byproducts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("mfg_production_orders.id", ondelete="CASCADE"),
                  nullable=False, index=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id"), nullable=False),
        sa.Column("quantity_per_unit", sa.Numeric(14, 6), nullable=False),
        sa.Column("received_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("unit_cost", sa.Numeric(14, 2), nullable=False, server_default="0"),
        *_audit(),
    )

    # outside work receipts (GL: Dr WIP / Cr absorbed) and quality decisions (GL on fail)
    op.create_table(
        "mfg_outside_receipts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("mfg_production_orders.id"), nullable=False, index=True),
        sa.Column("operation_id", sa.Integer(), sa.ForeignKey("mfg_production_order_operations.id"), nullable=False),
        sa.Column("supplier_id", sa.Integer(), sa.ForeignKey("supplier.id"), nullable=True),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("bill_reference", sa.String(200), nullable=True),
        sa.Column("expense_id", sa.Integer(), sa.ForeignKey("expenses.id"), nullable=True),
        sa.Column("receipt_date", sa.DateTime(), nullable=False),
        sa.Column("remark", sa.String(255), nullable=True),
        *_audit(),
    )
    op.create_table(
        "mfg_qc_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("output_id", sa.Integer(), sa.ForeignKey("mfg_production_outputs.id"), nullable=False, index=True),
        sa.Column("order_id", sa.Integer(), sa.ForeignKey("mfg_production_orders.id"), nullable=False, index=True),
        sa.Column("passed_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed_value", sa.Numeric(16, 2), nullable=False, server_default="0"),
        sa.Column("remark", sa.String(500), nullable=True),
        sa.Column("decided_at", sa.DateTime(), nullable=False),
        *_audit(),
    )


def downgrade() -> None:
    op.drop_table("mfg_qc_results")
    op.drop_table("mfg_outside_receipts")
    op.drop_table("mfg_production_order_byproducts")
    op.drop_table("mfg_bom_byproducts")
    op.drop_index("ix_sales_stock_production_output_id", table_name="sales_stock")
    op.drop_column("sales_stock", "production_output_id")
    op.drop_column("mfg_material_transactions", "lots")
    for c in ("by_products", "byproduct_value", "qc_failed_quantity", "qc_passed_quantity", "qc_status", "scrap_reason"):
        op.drop_column("mfg_production_outputs", c)
    for c in ("actual_outside_cost", "overproduction_pct"):
        op.drop_column("mfg_production_orders", c)
    op.drop_column("mfg_boms", "overproduction_pct")
    for c in ("outside_quantity", "outside_unit_cost", "supplier_id", "is_outside"):
        op.drop_column("mfg_production_order_operations", c)
    op.drop_column("mfg_bom_operations", "outside_unit_cost")
    for c in ("supplier_id", "is_outside"):
        op.drop_column("mfg_work_centers", c)
    op.drop_column("products", "requires_qc")
    op.drop_column("products", "shelf_life_days")
