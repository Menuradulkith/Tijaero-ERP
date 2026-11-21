"""Material master: an item catalog for materials, kept apart from the product
catalog (own tables and own categories) but sharing its brands."""
from sqlalchemy import (
    TIMESTAMP, Boolean, CheckConstraint, Column, Date, ForeignKey, Integer, Numeric, String, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.db.base import Base


class MaterialCategory(Base, AuditMixin):
    """Material categories — same shape as the product catalog's `category`, but separate."""
    __tablename__ = "material_categories"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    category_code = Column(String(255), nullable=False)
    memo = Column(String(255))
    description = Column(Text)
    active = Column(Boolean, nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)


class Material(Base, AuditMixin):
    __tablename__ = "materials"
    __table_args__ = (
        CheckConstraint("tracking_type IN ('serial', 'batch', 'none')", name="ck_materials_tracking_type"),
        CheckConstraint("item_type IN ('stock_item', 'expense')", name="ck_materials_item_type"),
        CheckConstraint("over_receipt_tolerance_pct >= 0 AND over_receipt_tolerance_pct <= 100", name="ck_materials_over_tolerance"),
        CheckConstraint("under_receipt_tolerance_pct >= 0 AND under_receipt_tolerance_pct <= 100", name="ck_materials_under_tolerance"),
    )

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    item_code = Column(String(255), unique=True, nullable=False)
    model = Column(String(255))
    # stock_item | expense — see schemas.MaterialItemType
    item_type = Column(String(30), nullable=False)
    unit_of_measure = Column(String(20), nullable=False, server_default="pcs")
    tracking_type = Column(String(10), nullable=False, server_default="serial")
    over_receipt_tolerance_pct = Column(Numeric(5, 2), nullable=False, server_default="0")
    under_receipt_tolerance_pct = Column(Numeric(5, 2), nullable=False, server_default="0")
    shelf_life_days = Column(Integer, nullable=True)
    requires_qc = Column(Boolean, nullable=False, server_default="false", default=False)
    description = Column(Text)
    website_active = Column(Boolean, nullable=False)
    website_price = Column(Numeric(60, 2))
    selling_price = Column(Numeric(60, 2))
    active = Column(Boolean, nullable=False, index=True)
    cost_price = Column(Numeric(60, 2), nullable=False)
    tax_rate = Column(Numeric(5, 2), nullable=False, server_default="0")
    created_date = Column(Date, nullable=False)
    category_id = Column(Integer, ForeignKey("material_categories.id"), nullable=False, index=True)
    # Brands are shared with the product catalog (same items_brand table).
    # Optional for materials.
    items_brand_id = Column(Integer, ForeignKey("items_brand.id"), nullable=True, index=True)
    added_date = Column(TIMESTAMP, nullable=False)
    image_url = Column(Text, nullable=True)
    # Material master extras (Item Catalog > General).
    unit_dimensions = Column(String(120))          # e.g. "120 x 60 x 40 mm"
    hs_code = Column(String(20))                   # customs Harmonized System code
    required_certificate = Column(String(255))     # e.g. "ISO 9001, RoHS"
    colour = Column(String(60))
    # fifo | lifo | weighted_average — see schemas.InventoryValuationMethod
    inventory_valuation_method = Column(String(20), nullable=False, server_default="fifo")
    # fifo | fefo — see schemas.StockIssuingMethod
    stock_issuing_method = Column(String(10), nullable=False, server_default="fifo")
    # Company-wide moving average cost of one unit (weighted-average items only), kept by
    # app.modules.inventory.costing on every stock receipt; read-only in the API.
    average_cost = Column(Numeric(18, 4), nullable=True)
    product_family = Column(String(120))           # required on create (API rule)
    design_url = Column(String(500))
    # Check stock availability before the item is used / issued.
    check_for_availability = Column(Boolean, nullable=False, server_default="false", default=False)
    # The item needs a design (drawing) before it can be made / bought.
    design_required = Column(Boolean, nullable=False, server_default="false", default=False)

    category = relationship("MaterialCategory")
    # One-directional: ItemsBrand keeps its product-only back_populates.
    brand = relationship("ItemsBrand")
    minimum_prices = relationship("MaterialMinimumPrice", back_populates="material", cascade="all, delete-orphan")
    supplier_links = relationship("MaterialSupplier", back_populates="material", cascade="all, delete-orphan")


class MaterialMinimumPrice(Base, AuditMixin):
    __tablename__ = "material_minimum_price"

    id = Column(Integer, primary_key=True, index=True)
    minimum_price = Column(Numeric(60, 2), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    material_id = Column(Integer, ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True)

    material = relationship("Material", back_populates="minimum_prices")


class MaterialSupplier(Base, AuditMixin):
    """Which suppliers can supply a material, and on what terms (mirrors supplier_product)."""
    __tablename__ = "material_suppliers"
    __table_args__ = (
        UniqueConstraint("supplier_id", "material_id", name="uq_material_suppliers"),
    )

    id = Column(Integer, primary_key=True, index=True)
    supplier_id = Column(Integer, ForeignKey("supplier.id", ondelete="CASCADE"), nullable=False, index=True)
    material_id = Column(Integer, ForeignKey("materials.id", ondelete="CASCADE"), nullable=False, index=True)
    supplier_sku = Column(String(255))
    cost_price = Column(Numeric(60, 2), nullable=False)
    minimum_order_qty = Column(Integer)
    is_preferred = Column(Boolean, nullable=False, default=False, server_default="false")
    active = Column(Boolean, nullable=False, default=True, server_default="true")

    supplier = relationship("Supplier")
    material = relationship("Material", back_populates="supplier_links")
