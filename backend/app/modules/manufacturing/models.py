"""Manufacturing: work centers, bills of materials with routing, production orders.

Masters:     work centers, BOMs (components + routing operations)
Execution:   production orders with their component and operation lines, material
             issues / returns / backflush, output receipts, job-card time logs

Stock integration: components are consumed from ``sales_stock`` rows of the order's
branch (status -> consumed, ``consumed_by_production_order_id`` set) and output is
received as new ``sales_stock`` rows (``production_order_id`` set, no GRN).

Costing is standard costing, matching how sales relieves inventory at
``Product.cost_price``: components leave inventory and output enters it at that cost,
labour and overhead are absorbed at the work-center rates, and closing an order posts
whatever is left in WIP to the production variance account.
"""
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Column,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.db.base import Base


# ─────────────────────────────── masters ───────────────────────────────
class MfgWorkCenter(Base, AuditMixin):
    __tablename__ = "mfg_work_centers"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(30), nullable=False)
    name = Column(String(150), nullable=False)
    description = Column(Text, nullable=True)
    branch_code = Column(String(200), nullable=True, index=True)
    # Operations the center can run at the same time (machines / stations)
    capacity = Column(Integer, nullable=False, default=1)
    # Planned minutes are divided by efficiency/100 (80% -> takes 25% longer)
    efficiency_pct = Column(Numeric(5, 2), nullable=False, default=100)
    working_hours_per_day = Column(Numeric(5, 2), nullable=False, default=8)
    labor_rate_per_hour = Column(Numeric(14, 2), nullable=False, default=0)
    overhead_rate_per_hour = Column(Numeric(14, 2), nullable=False, default=0)
    active = Column(Boolean, nullable=False, default=True)


class MfgBOM(Base, AuditMixin):
    __tablename__ = "mfg_boms"

    id = Column(Integer, primary_key=True, index=True)
    bom_no = Column(String(30), nullable=False, unique=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    version = Column(String(20), nullable=False, default="1")
    # The component quantities produce this many units of the product
    output_quantity = Column(Numeric(14, 4), nullable=False, default=1)
    # draft | active | archived (BOMStatus)
    status = Column(String(20), nullable=False, default="draft", index=True)
    # The BOM a new production order for the product picks up (one active default per product)
    is_default = Column(Boolean, nullable=False, default=False)
    description = Column(Text, nullable=True)

    product = relationship("Product", lazy="joined")
    items = relationship("MfgBOMItem", back_populates="bom", cascade="all, delete-orphan",
                         order_by="MfgBOMItem.sequence")
    operations = relationship("MfgBOMOperation", back_populates="bom", cascade="all, delete-orphan",
                              order_by="MfgBOMOperation.sequence")


class MfgBOMItem(Base, AuditMixin):
    __tablename__ = "mfg_bom_items"

    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("mfg_boms.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=10)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity = Column(Numeric(14, 4), nullable=False)
    scrap_pct = Column(Numeric(5, 2), nullable=False, default=0)
    # manual | backflush (MaterialIssueMethod)
    issue_method = Column(String(20), nullable=False, default="manual")
    remark = Column(String(255), nullable=True)

    bom = relationship("MfgBOM", back_populates="items")
    product = relationship("Product", lazy="joined")


class MfgBOMOperation(Base, AuditMixin):
    __tablename__ = "mfg_bom_operations"

    id = Column(Integer, primary_key=True, index=True)
    bom_id = Column(Integer, ForeignKey("mfg_boms.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=10)
    name = Column(String(150), nullable=False)
    work_center_id = Column(Integer, ForeignKey("mfg_work_centers.id"), nullable=False, index=True)
    setup_minutes = Column(Numeric(10, 2), nullable=False, default=0)
    # Per unit of the product
    run_minutes = Column(Numeric(12, 4), nullable=False, default=0)
    description = Column(Text, nullable=True)

    bom = relationship("MfgBOM", back_populates="operations")
    work_center = relationship("MfgWorkCenter", lazy="joined")


class MfgReorderRule(Base, AuditMixin):
    """Reordering rule (Odoo "min/max", BC "reorder point"): MRP plans a replenishment
    when the projected stock of the product in the branch falls below min_quantity, up to
    max_quantity (or min when no max), rounded up to multiple_quantity."""
    __tablename__ = "mfg_reorder_rules"
    __table_args__ = (UniqueConstraint("product_id", "branch_code", name="uq_mfg_reorder_rules_product_branch"),)

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    branch_code = Column(String(200), nullable=False, index=True)
    min_quantity = Column(Integer, nullable=False)
    max_quantity = Column(Integer, nullable=True)
    multiple_quantity = Column(Integer, nullable=False, default=1)
    preferred_supplier_id = Column(Integer, ForeignKey("supplier.id"), nullable=True)
    active = Column(Boolean, nullable=False, default=True)

    product = relationship("Product", lazy="joined")


# ─────────────────────────────── execution ───────────────────────────────
class MfgProductionOrder(Base, AuditMixin):
    __tablename__ = "mfg_production_orders"

    id = Column(Integer, primary_key=True, index=True)
    order_no = Column(String(40), nullable=False, unique=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    bom_id = Column(Integer, ForeignKey("mfg_boms.id"), nullable=False, index=True)
    branch_code = Column(String(200), nullable=False, index=True)
    # Where output is received (defaults to the branch's location)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    planned_quantity = Column(Integer, nullable=False)
    produced_quantity = Column(Integer, nullable=False, default=0)
    scrapped_quantity = Column(Integer, nullable=False, default=0)
    planned_start_date = Column(Date, nullable=False)
    planned_end_date = Column(Date, nullable=False)
    actual_start_at = Column(TIMESTAMP, nullable=True)
    actual_end_at = Column(TIMESTAMP, nullable=True)
    # low | normal | high | urgent
    priority = Column(String(10), nullable=False, default="normal")
    # draft | released | in_progress | completed | closed | cancelled (ProductionOrderStatus)
    status = Column(String(20), nullable=False, default="draft", index=True)
    # Free-text demand reference (sales order / quotation no.) for make-to-order work
    source_reference = Column(String(100), nullable=True)
    # Make-to-order: the quotation line this order was raised for; its output is
    # reserved for that line like quote-linked purchase receipts
    quote_item_id = Column(Integer, ForeignKey("sales_quote_items.id"), nullable=True, index=True)
    remark = Column(Text, nullable=True)
    cancel_reason = Column(Text, nullable=True)

    # Costing. Standard unit cost is fixed at release (Product.cost_price, or the planned
    # unit cost when the product has none) and values every output receipt.
    standard_unit_cost = Column(Numeric(14, 2), nullable=False, default=0)
    planned_material_cost = Column(Numeric(16, 2), nullable=False, default=0)
    planned_labor_cost = Column(Numeric(16, 2), nullable=False, default=0)
    planned_overhead_cost = Column(Numeric(16, 2), nullable=False, default=0)
    actual_material_cost = Column(Numeric(16, 2), nullable=False, default=0)
    actual_labor_cost = Column(Numeric(16, 2), nullable=False, default=0)
    actual_overhead_cost = Column(Numeric(16, 2), nullable=False, default=0)
    output_value = Column(Numeric(16, 2), nullable=False, default=0)
    # Posted to the variance account on close (actual - output value)
    variance_amount = Column(Numeric(16, 2), nullable=True)

    released_by = Column(Integer, nullable=True)
    released_at = Column(TIMESTAMP, nullable=True)
    closed_by = Column(Integer, nullable=True)
    closed_at = Column(TIMESTAMP, nullable=True)

    product = relationship("Product", lazy="joined")
    bom = relationship("MfgBOM", lazy="select")
    quote_item = relationship("SalesQuoteItem", lazy="select")
    materials = relationship("MfgProductionOrderMaterial", back_populates="order",
                             cascade="all, delete-orphan", order_by="MfgProductionOrderMaterial.sequence")
    operations = relationship("MfgProductionOrderOperation", back_populates="order",
                              cascade="all, delete-orphan", order_by="MfgProductionOrderOperation.sequence")


class MfgProductionOrderMaterial(Base, AuditMixin):
    __tablename__ = "mfg_production_order_materials"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("mfg_production_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=10)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
    quantity_per_unit = Column(Numeric(14, 6), nullable=False)
    scrap_pct = Column(Numeric(5, 2), nullable=False, default=0)
    required_quantity = Column(Integer, nullable=False)
    # Net of returns; backflushed units count here too
    issued_quantity = Column(Integer, nullable=False, default=0)
    issue_method = Column(String(20), nullable=False, default="manual")
    unit_cost = Column(Numeric(14, 2), nullable=False, default=0)

    order = relationship("MfgProductionOrder", back_populates="materials")
    product = relationship("Product", lazy="joined")


class MfgProductionOrderOperation(Base, AuditMixin):
    __tablename__ = "mfg_production_order_operations"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("mfg_production_orders.id", ondelete="CASCADE"), nullable=False, index=True)
    sequence = Column(Integer, nullable=False, default=10)
    name = Column(String(150), nullable=False)
    work_center_id = Column(Integer, ForeignKey("mfg_work_centers.id"), nullable=False, index=True)
    planned_minutes = Column(Numeric(12, 2), nullable=False, default=0)
    actual_minutes = Column(Numeric(12, 2), nullable=False, default=0)
    completed_quantity = Column(Integer, nullable=False, default=0)
    # pending | in_progress | completed
    status = Column(String(20), nullable=False, default="pending")
    labor_rate_per_hour = Column(Numeric(14, 2), nullable=False, default=0)
    overhead_rate_per_hour = Column(Numeric(14, 2), nullable=False, default=0)
    started_at = Column(TIMESTAMP, nullable=True)
    completed_at = Column(TIMESTAMP, nullable=True)

    order = relationship("MfgProductionOrder", back_populates="operations")
    work_center = relationship("MfgWorkCenter", lazy="joined")


class MfgMaterialTransaction(Base, AuditMixin):
    """One material issue, return or backflush against an order line (the stock
    document; posts Dr WIP / Cr Inventory, or the reverse for a return)."""
    __tablename__ = "mfg_material_transactions"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("mfg_production_orders.id"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("mfg_production_order_materials.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    # issue | return | backflush
    transaction_type = Column(String(20), nullable=False)
    quantity = Column(Integer, nullable=False)
    unit_cost = Column(Numeric(14, 2), nullable=False)
    total_cost = Column(Numeric(16, 2), nullable=False)
    branch_code = Column(String(200), nullable=False)
    transaction_date = Column(TIMESTAMP, nullable=False)
    remark = Column(String(255), nullable=True)

    product = relationship("Product", lazy="joined")
    order = relationship("MfgProductionOrder", lazy="select")


class MfgProductionOutput(Base, AuditMixin):
    """A finished-goods receipt from an order (posts Dr Inventory / Cr WIP at the
    order's standard unit cost)."""
    __tablename__ = "mfg_production_outputs"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("mfg_production_orders.id"), nullable=False, index=True)
    quantity = Column(Integer, nullable=False)
    scrap_quantity = Column(Integer, nullable=False, default=0)
    batch_no = Column(String(100), nullable=True)
    expiry_date = Column(Date, nullable=True)
    unit_cost = Column(Numeric(14, 2), nullable=False)
    total_value = Column(Numeric(16, 2), nullable=False)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    receipt_date = Column(TIMESTAMP, nullable=False)
    remark = Column(String(255), nullable=True)

    order = relationship("MfgProductionOrder", lazy="select")


class MfgTimeLog(Base, AuditMixin):
    """Job-card time booked on an operation (posts Dr WIP / Cr absorbed labour and
    overhead at the operation's rates)."""
    __tablename__ = "mfg_time_logs"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("mfg_production_orders.id"), nullable=False, index=True)
    operation_id = Column(Integer, ForeignKey("mfg_production_order_operations.id"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id"), nullable=True)
    start_time = Column(TIMESTAMP, nullable=True)
    end_time = Column(TIMESTAMP, nullable=True)
    minutes = Column(Numeric(12, 2), nullable=False)
    completed_quantity = Column(Integer, nullable=False, default=0)
    labor_cost = Column(Numeric(16, 2), nullable=False, default=0)
    overhead_cost = Column(Numeric(16, 2), nullable=False, default=0)
    # Booked automatically from the planned time when the operation was completed
    # without any time logged
    is_auto = Column(Boolean, nullable=False, default=False)
    remark = Column(String(255), nullable=True)

    operation = relationship("MfgProductionOrderOperation", lazy="joined")
    order = relationship("MfgProductionOrder", lazy="select")
