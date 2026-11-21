from sqlalchemy import Column, Integer, String, Text, ForeignKey, TIMESTAMP, Boolean, Date, DateTime, Numeric, Index, CheckConstraint
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import AuditMixin, _sl_now


class CompanyAssets(Base, AuditMixin):
    __tablename__ = "company_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    inventory_no = Column(Text, nullable=False, unique=True)
    item = Column(Text, nullable=False)
    description = Column(Text)
    branch_code = Column(String(200), nullable=False)
    asigned_to = Column(Integer)
    barcode = Column(Text, unique=True)
    warranty_month = Column(String(30), nullable=True)  
    good_received_note_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=True)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=True)
    status = Column(String(50), nullable=False, default="available")  
    return_reason = Column(String(200), nullable=True)  # Reason for return (from sale return)
    sale_return_id = Column(Integer, nullable=True)  # Link to sale return record
    source = Column(String(50), nullable=False, default="grn")  # 'grn' or 'sale_return'
    added_date = Column(TIMESTAMP, nullable=True)
    
    product = relationship("Product", back_populates="company_assets")
    employee_assignments = relationship("EmployeesAssets", back_populates="asset")
    good_received_note = relationship("GoodReceivedNote", back_populates="company_asset_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="company_asset_items")


class SalesStock(Base, AuditMixin):
    __tablename__ = "sales_stock"
    
    id = Column(Integer, primary_key=True, index=True)
    # The product this stock was received / made under. NULL for item-only stock
    # (an Item Catalog item no product sells); material_id is then the key.
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True, index=True)
    # Unique per serial unit. NULL for batch/none-tracked lots (Postgres allows
    # many NULLs under a unique constraint).
    barcode = Column(Text, nullable=True, unique=True)
    # Units this row represents: always 1 for serial stock, the lot size for
    # batch/none stock.
    quantity = Column(Integer, nullable=False, default=1, server_default="1")
    batch_no = Column(String(100), nullable=True, index=True)
    expiry_date = Column(Date, nullable=True)
    branch_code = Column(String(200), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    # Purchased stock comes from a GRN line; manufactured stock has no GRN and carries
    # production_order_id instead.
    good_received_note_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=True)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=True)
    production_order_id = Column(Integer, ForeignKey("mfg_production_orders.id"), nullable=True, index=True)
    # Set while the units are consumed by (issued to) a production order
    consumed_by_production_order_id = Column(Integer, ForeignKey("mfg_production_orders.id"), nullable=True, index=True)
    # The output receipt that created this row (batch traceability, quality hold)
    production_output_id = Column(Integer, ForeignKey("mfg_production_outputs.id"), nullable=True, index=True)
    warranty_month = Column(String(30), nullable=True)  
    status = Column(String(50), nullable=False, default="available", index=True)  
    is_active = Column(Boolean, nullable=False, default=True)  
    returned_date = Column(TIMESTAMP, nullable=True)  
    purchase_return_id = Column(Integer, ForeignKey("purchasing_return.id"), nullable=True)  
    # Set when this unit was received against a PO line that traces back to a
    # Sales Quotation item (PurchasingOrderItems.quote_item_id) — the unit is
    # committed to that quotation and excluded from other customers' stock
    # availability until released (quotation cancelled) or consumed (SO
    # fulfilled). NULL for stock received on ordinary, quote-less POs.
    reserved_for_quote_item_id = Column(Integer, ForeignKey("sales_quote_items.id"), nullable=True, index=True)
    added_date = Column(TIMESTAMP, nullable=False)
    # Item Catalog item (unused until central-stock phase 2; product_id stays the key for now)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=True, index=True)
    # Cost of one unit, captured when the row is created (PO line price, else the
    # production order's standard cost, else the product cost price) plus any landed
    # cost share; the issue / valuation cost of FIFO items (inventory/costing.py).
    unit_cost = Column(Numeric(18, 2), nullable=True)
    # Source of stock found by a stock count (no GRN / production order behind it)
    stock_count_id = Column(Integer, ForeignKey("stock_counts.id"), nullable=True, index=True)

    __table_args__ = (
        Index("ix_sales_stock_product_branch_status", "product_id", "branch_code", "status"),
        Index("ix_sales_stock_product_location", "product_id", "location_id"),
        Index("ix_sales_stock_good_received_note_id", "good_received_note_id"),
        CheckConstraint("product_id IS NOT NULL OR material_id IS NOT NULL", name="ck_sales_stock_product_or_material"),
    )

    product = relationship("Product", back_populates="sales_stock")
    material = relationship("Material")
    good_received_note = relationship("GoodReceivedNote", back_populates="sales_stock_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="sales_stock_items")
    purchase_return = relationship("PurchasingReturn", back_populates="returned_stock_items")
    location = relationship("Locations", back_populates="sales_stock_items")
    reserved_for_quote_item = relationship("SalesQuoteItem", foreign_keys=[reserved_for_quote_item_id])


class StockTransaction(Base):
    """Append-only stock ledger: one row per physical stock movement.

    Written automatically from SalesStock changes (see app.modules.inventory.ledger);
    never updated or deleted by the application.
    """
    __tablename__ = "stock_transactions"

    id = Column(Integer, primary_key=True)
    created_at = Column(DateTime, nullable=False, default=_sl_now)
    stock_id = Column(Integer, ForeignKey("sales_stock.id"), nullable=False, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=True)
    movement_type = Column(String(30), nullable=False)
    # Units moved (always > 0) and the signed effect on physical on-hand
    quantity = Column(Numeric(18, 3), nullable=False)
    on_hand_change = Column(Numeric(18, 3), nullable=False, default=0)
    from_status = Column(String(50), nullable=True)
    to_status = Column(String(50), nullable=True)
    branch_code = Column(String(200), nullable=True)
    from_location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    to_location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    batch_no = Column(String(100), nullable=True)
    barcode = Column(Text, nullable=True)
    unit_cost = Column(Numeric(18, 2), nullable=True)
    reference_type = Column(String(40), nullable=True)
    reference_id = Column(Integer, nullable=True)
    reference_no = Column(String(60), nullable=True)
    user_id = Column(Integer, nullable=True)

    __table_args__ = (
        Index("ix_stock_transactions_product_created", "product_id", "created_at"),
        Index("ix_stock_transactions_branch_created", "branch_code", "created_at"),
        Index("ix_stock_transactions_reference", "reference_type", "reference_id"),
        Index("ix_stock_transactions_movement_type", "movement_type"),
    )

    stock = relationship("SalesStock")


    


class StockCount(Base):
    """Stock count document (central stock phase 5): a snapshot of the available
    stock of one branch (optionally one location / item category), counted, then
    posted as count adjustments to the stock ledger and one journal entry."""
    __tablename__ = "stock_counts"

    id = Column(Integer, primary_key=True)
    count_no = Column(String(40), nullable=False, unique=True)
    branch_code = Column(String(200), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    category_id = Column(Integer, ForeignKey("material_categories.id"), nullable=True)
    # counting | posted | cancelled
    status = Column(String(20), nullable=False, default="counting", server_default="counting", index=True)
    remark = Column(Text, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, default=_sl_now)
    posted_by = Column(Integer, nullable=True)
    posted_at = Column(DateTime, nullable=True)
    cancelled_by = Column(Integer, nullable=True)
    cancel_reason = Column(Text, nullable=True)
    journal_entry_id = Column(Integer, ForeignKey("journal_entries.id"), nullable=True)

    __table_args__ = (
        CheckConstraint("status IN ('counting', 'posted', 'cancelled')", name="ck_stock_counts_status"),
    )

    lines = relationship("StockCountLine", back_populates="count", cascade="all, delete-orphan",
                         order_by="StockCountLine.id")


class StockCountLine(Base):
    __tablename__ = "stock_count_lines"

    id = Column(Integer, primary_key=True)
    count_id = Column(Integer, ForeignKey("stock_counts.id", ondelete="CASCADE"), nullable=False, index=True)
    # The snapshot stock row; NULL for a found line until posting creates its row
    stock_id = Column(Integer, ForeignKey("sales_stock.id"), nullable=True, index=True)
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=False, index=True)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    batch_no = Column(String(100), nullable=True)
    barcode = Column(Text, nullable=True)
    expiry_date = Column(Date, nullable=True)
    system_quantity = Column(Numeric(18, 3), nullable=False, default=0)
    counted_quantity = Column(Numeric(18, 3), nullable=True)
    unit_cost = Column(Numeric(18, 2), nullable=False, default=0)
    is_found = Column(Boolean, nullable=False, default=False, server_default="false")
    remark = Column(Text, nullable=True)
    # Filled when the count posts: the row's quantity at posting and counted - that
    posted_current_quantity = Column(Numeric(18, 3), nullable=True)
    difference = Column(Numeric(18, 3), nullable=True)

    __table_args__ = (
        CheckConstraint("counted_quantity IS NULL OR counted_quantity >= 0", name="ck_stock_count_lines_counted"),
    )

    count = relationship("StockCount", back_populates="lines")


# Registers the stock-ledger flush hook wherever the stock model is loaded.
from app.modules.inventory import ledger as _stock_ledger  # noqa: E402,F401
