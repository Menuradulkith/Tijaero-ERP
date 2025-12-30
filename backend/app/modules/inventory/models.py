from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base

class GoodReceivedNote(Base):
    __tablename__ = "good_received_note"
    
    id = Column(Integer, primary_key=True, index=True)
    good_received_no = Column(String(200), unique=True, nullable=False)
    good_received_date = Column(Date, nullable=False)
    supplier_invoice_no = Column(String(200), nullable=False)
    supplier_invoice_date = Column(Date, nullable=False)
    remark = Column(Text)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(Date, nullable=False)
    good_received_locations_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=False)
    purchasingorders_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    location = relationship("Locations", back_populates="good_received_notes")
    purchasing_order = relationship("PurchasingOrder", back_populates="good_received_notes")
    purchasing_returns = relationship("PurchasingReturn", back_populates="good_received_note")
    supplier_credits_settle_transactions = relationship("SupplierCreditsSettleTransaction", back_populates="good_received_note")

class GoodReceivedItems(Base):
    __tablename__ = "good_received_items"
    
    id = Column(Integer, primary_key=True, index=True)
    good_received_note = Column(String(355), nullable=False)
    barcode = Column(Text, nullable=False)
    branch_code = Column(String(200), nullable=False)
    active = Column(Boolean, nullable=False)
    created_date = Column(Date, nullable=False)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="good_received_items")
    invoice_barcodes = relationship("InvoiceItemsBarcode", back_populates="good_received_item")

class CompanyAssets(Base):
    __tablename__ = "company_assets"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    inventory_no = Column(Text, nullable=False)
    item = Column(Text, nullable=False)
    description = Column(Text)
    branch_code = Column(String(200), nullable=False)
    asigned_to = Column(Integer)
    barcode = Column(Text)
    
    # Relationships
    product = relationship("Product", back_populates="company_assets")
    employee_assignments = relationship("EmployeesAssets", back_populates="asset")
