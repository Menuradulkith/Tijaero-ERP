from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin

class Category(Base, TimestampMixin):
    __tablename__ = "category"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    category_code = Column(String(255), nullable=False)
    memo = Column(String(255))
    description = Column(Text)
    active = Column(Boolean, nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    products = relationship("Product", back_populates="category")

class ItemsBrand(Base):
    __tablename__ = "items_brand"
    
    id = Column(Integer, primary_key=True, index=True)
    brand_name = Column(String(255), nullable=False)
    brand_code = Column(String(4), nullable=False)
    description = Column(Text)
    
    # Relationships
    products = relationship("Product", back_populates="brand")

class Product(Base, TimestampMixin):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    item_code = Column(String(255), unique=True, nullable=False)
    model = Column(String(255))
    item_type = Column(String(30), nullable=False)
    description = Column(Text)
    website_active = Column(Boolean, nullable=False)
    website_price = Column(Numeric(60, 2))
    active = Column(Boolean, nullable=False)
    cost_price = Column(Numeric(60, 2), nullable=False)
    created_date = Column(Date, nullable=False)
    category_id = Column(Integer, ForeignKey("category.id"), nullable=False)
    items_brand_id = Column(Integer, ForeignKey("items_brand.id"), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    
    # Relationships
    category = relationship("Category", back_populates="products")
    brand = relationship("ItemsBrand", back_populates="products")
    invoice_items = relationship("InvoiceItems", back_populates="product")
    minimum_prices = relationship("MinimumPrice", back_populates="product", cascade="all, delete-orphan")
    purchasing_order_items = relationship("PurchasingOrderItems", back_populates="product")
    purchasing_return_items = relationship("PurchasingReturnItems", back_populates="product")
    cs_job_items = relationship("CSJobItem", back_populates="product")
    item_transfer_note_items = relationship("ItemTransferNoteItems", back_populates="product")
    item_transfer_note_item_products = relationship("ItemTransferNoteItemProduct", back_populates="product")
    cupon_codes = relationship("CustomerCuponCodes", back_populates="product")
    company_assets = relationship("CompanyAssets", back_populates="product")
    sales_stock = relationship("SalesStock", back_populates="product")

class MinimumPrice(Base, TimestampMixin):
    __tablename__ = "minimum_price"
    
    id = Column(Integer, primary_key=True, index=True)
    minimum_price = Column(Numeric(60, 2), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    
    # Relationships
    product = relationship("Product", back_populates="minimum_prices")
