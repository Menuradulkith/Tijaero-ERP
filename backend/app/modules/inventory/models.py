from sqlalchemy import Column, Integer, String, Text, ForeignKey, TIMESTAMP, Boolean, Date
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import AuditMixin


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
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False, index=True)
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
    
    product = relationship("Product", back_populates="sales_stock")
    good_received_note = relationship("GoodReceivedNote", back_populates="sales_stock_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="sales_stock_items")
    purchase_return = relationship("PurchasingReturn", back_populates="returned_stock_items")
    location = relationship("Locations", back_populates="sales_stock_items")
    reserved_for_quote_item = relationship("SalesQuoteItem", foreign_keys=[reserved_for_quote_item_id])


    
