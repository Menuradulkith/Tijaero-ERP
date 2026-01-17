from sqlalchemy import Column, Integer, String, Text, ForeignKey, TIMESTAMP, Boolean
from sqlalchemy.orm import relationship
from app.db.base import Base


class CompanyAssets(Base):
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
    added_date = Column(TIMESTAMP, nullable=True)
    
    product = relationship("Product", back_populates="company_assets")
    employee_assignments = relationship("EmployeesAssets", back_populates="asset")
    good_received_note = relationship("GoodReceivedNote", back_populates="company_asset_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="company_asset_items")


class SalesStock(Base):
    __tablename__ = "sales_stock"
    
    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    barcode = Column(Text, nullable=False, unique=True)
    branch_code = Column(String(200), nullable=False)
    location_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=True)
    good_received_note_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False)
    purchasing_order_items_id = Column(Integer, ForeignKey("purchasing_order_items.id"), nullable=False)
    warranty_month = Column(String(30), nullable=True)  
    status = Column(String(50), nullable=False, default="available")  
    is_active = Column(Boolean, nullable=False, default=True)  
    returned_date = Column(TIMESTAMP, nullable=True)  
    purchase_return_id = Column(Integer, ForeignKey("purchasing_return.id"), nullable=True)  
    added_date = Column(TIMESTAMP, nullable=False)
    
    product = relationship("Product", back_populates="sales_stock")
    good_received_note = relationship("GoodReceivedNote", back_populates="sales_stock_items")
    purchasing_order_item = relationship("PurchasingOrderItems", back_populates="sales_stock_items")
    purchase_return = relationship("PurchasingReturn", back_populates="returned_stock_items")
    location = relationship("Locations", back_populates="sales_stock_items")


    
