from sqlalchemy import Column, Integer, String, Text, ForeignKey, TIMESTAMP, Boolean
from sqlalchemy.orm import relationship
from app.db.base import Base


class CompanyAssets(Base):
    """Company assets - Real table for company-owned items (not for sale)"""
    __tablename__ = "company_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    inventory_no = Column(Text, nullable=False, unique=True)  # Unique inventory number
    item = Column(Text, nullable=False)
    description = Column(Text)
    branch_code = Column(String(200), nullable=False)
    asigned_to = Column(Integer)
    barcode = Column(Text, unique=True)  # Unique barcode - same barcode should never store twice
    warranty_month = Column(String(30), nullable=True)  # Warranty period
    good_received_note_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=True)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=True)
    status = Column(String(50), nullable=False, default="available")  # available, in_use, retired, disposed
    added_date = Column(TIMESTAMP, nullable=True)
    
    # Relationships
    product = relationship("Product", back_populates="company_assets")
    employee_assignments = relationship("EmployeesAssets", back_populates="asset")
    good_received_note = relationship("GoodReceivedNote", back_populates="company_asset_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="company_asset_items")


class SalesStock(Base):
    """Sales stock items received from GRN - items available for sale"""
    __tablename__ = "sales_stock"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    barcode = Column(Text, nullable=False, unique=True)  # Unique constraint - same barcode should never store twice
    branch_code = Column(String(200), nullable=False)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)  # Current location of item
    good_received_note_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=False)
    warranty_month = Column(String(30), nullable=True)  # Warranty period from PO or entered in GRN
    status = Column(String(50), nullable=False, default="available")  # available, sold, reserved, returned_to_supplier, return_pending, transfer_pending, in_transit, transferred, damaged
    is_active = Column(Boolean, nullable=False, default=True)  # Soft delete flag
    returned_date = Column(TIMESTAMP, nullable=True)  # When item was returned
    purchase_return_id = Column(Integer, ForeignKey("purchasing_return.id"), nullable=True)  # Link to return record
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    product = relationship("Product", back_populates="sales_stock")
    good_received_note = relationship("GoodReceivedNote", back_populates="sales_stock_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="sales_stock_items")
    purchase_return = relationship("PurchasingReturn", back_populates="returned_stock_items")
    location = relationship("Locations", back_populates="sales_stock_items")
