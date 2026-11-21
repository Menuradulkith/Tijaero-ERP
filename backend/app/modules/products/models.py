from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin, AuditMixin

class Category(Base, AuditMixin):
    __tablename__ = "category"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    category_code = Column(String(255), nullable=False)
    memo = Column(String(255))
    description = Column(Text)
    active = Column(Boolean, nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)


    products = relationship("Product", back_populates="category")

class ItemsBrand(Base, AuditMixin):
    __tablename__ = "items_brand"
    
    id = Column(Integer, primary_key=True, index=True)
    brand_name = Column(String(255), nullable=False)
    brand_code = Column(String(4), nullable=False)
    description = Column(Text)
    active = Column(Boolean, nullable=False, default=True, index=True)
    
    products = relationship("Product", back_populates="brand")

class ProductType(Base, AuditMixin):
    """User-maintained list of product types (e.g. Laptop, Accessory) shown on the product form."""
    __tablename__ = "product_types"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(120), nullable=False)
    active = Column(Boolean, nullable=False, default=True, server_default="true")


class HsCode(Base, AuditMixin):
    """Customs Harmonized System codes users pick (or add) on the product form."""
    __tablename__ = "hs_codes"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(20), nullable=False)
    description = Column(String(255))
    active = Column(Boolean, nullable=False, default=True, server_default="true")


class Product(Base, AuditMixin):
    __tablename__ = "products"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    item_code = Column(String(255), unique=True, nullable=False)
    model = Column(String(255))
    item_type = Column(String(30), nullable=False)
    unit_of_measure = Column(String(20), nullable=False, server_default="pcs")
    # 'serial' | 'batch' | 'none' — see app.common.enums.TrackingType. Decides how
    # GRN receipts create stock rows. Locked once the product has stock rows.
    tracking_type = Column(String(10), nullable=False, server_default="serial")
    # Receipt tolerances (% of the ordered quantity): a PO line may be over-received up to
    # +over% and counts as fully received once -under% has arrived. 0 = exact quantity.
    over_receipt_tolerance_pct = Column(Numeric(5, 2), nullable=False, server_default="0")
    under_receipt_tolerance_pct = Column(Numeric(5, 2), nullable=False, server_default="0")
    # Manufactured goods: a finished batch expires this many days after it is produced
    shelf_life_days = Column(Integer, nullable=True)
    # Manufactured goods: output is held (stock status frozen) until a quality check passes it
    requires_qc = Column(Boolean, nullable=False, server_default="false", default=False)
    description = Column(Text)
    website_active = Column(Boolean, nullable=False)
    website_price = Column(Numeric(60, 2))
    selling_price = Column(Numeric(60, 2))
    active = Column(Boolean, nullable=False, index=True)
    cost_price = Column(Numeric(60, 2), nullable=False)
    # VAT/tax percentage added to this product's purchase order lines.
    tax_rate = Column(Numeric(5, 2), nullable=False, server_default="0")
    created_date = Column(Date, nullable=False)
    category_id = Column(Integer, ForeignKey("category.id"), nullable=False, index=True)
    items_brand_id = Column(Integer, ForeignKey("items_brand.id"), nullable=False, index=True)
    added_date = Column(TIMESTAMP, nullable=False)
    image_url = Column(Text, nullable=True)
    # General section (product master). Required on create by the API; nullable for older rows.
    product_type_id = Column(Integer, ForeignKey("product_types.id"), nullable=True, index=True)
    hs_code_id = Column(Integer, ForeignKey("hs_codes.id"), nullable=True, index=True)
    product_family = Column(String(120))
    target_market = Column(String(120))
    required_certificate = Column(String(255))
    # Item Catalog item this product sells (central stock): stock is kept per item,
    # so selling the product takes its item's stock. NULL for service / non-stock
    # products. Several products may share one item.
    material_id = Column(Integer, ForeignKey("materials.id"), nullable=True, index=True)

    product_type = relationship("ProductType")
    hs_code_ref = relationship("HsCode")
    material = relationship("Material")

    @property
    def material_item_code(self):
        return self.material.item_code if self.material else None

    @property
    def material_name(self):
        return self.material.name if self.material else None

    @property
    def product_type_name(self):
        return self.product_type.name if self.product_type else None

    @property
    def hs_code(self):
        return self.hs_code_ref.code if self.hs_code_ref else None

    @property
    def hs_code_description(self):
        return self.hs_code_ref.description if self.hs_code_ref else None

    category = relationship("Category", back_populates="products")
    brand = relationship("ItemsBrand", back_populates="products")
    invoice_items = relationship("InvoiceItems", back_populates="product")
    minimum_prices = relationship("MinimumPrice", back_populates="product", cascade="all, delete-orphan")
    price_tiers = relationship("ProductPriceTier", back_populates="product", cascade="all, delete-orphan", order_by="ProductPriceTier.id")
    purchasing_order_items = relationship("PurchasingOrderItems", back_populates="product")
    purchasing_return_items = relationship("PurchasingReturnItems", back_populates="product")
    cs_job_items = relationship("CSJobItem", back_populates="product")
    item_transfer_note_items = relationship("ItemTransferNoteItems", back_populates="product")
    item_transfer_note_item_products = relationship("ItemTransferNoteItemProduct", back_populates="product")
    supplier_products = relationship("SupplierProduct", back_populates="product", cascade="all, delete-orphan")
    cupon_codes = relationship("CustomerCuponCodes", back_populates="product")
    company_assets = relationship("CompanyAssets", back_populates="product")
    sales_stock = relationship("SalesStock", back_populates="product")

class MinimumPrice(Base, AuditMixin):
    __tablename__ = "minimum_price"
    
    id = Column(Integer, primary_key=True, index=True)
    minimum_price = Column(Numeric(60, 2), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)
    
    product = relationship("Product", back_populates="minimum_prices")
