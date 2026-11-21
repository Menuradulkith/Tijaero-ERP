"""Material master schemas. Request/response shapes deliberately match the
product catalog's (app.modules.products.schemas), so the same UI can drive both."""
import re
from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.common.base_schemas import AuditSchema, TijaeroBaseSchema
from app.modules.products import schemas as product_schemas
from app.modules.purchasing.schemas import INT4_MAX, MAX_MONEY, OptStr, SupplierProductUpdate

Page = product_schemas.Page
# Product-only fields (product type, HS code lookup, target market) have no materials column.
PRODUCT_ONLY_FIELDS = {"product_type_id", "hs_code_id", "target_market", "material_id"}
NON_COLUMN_UPDATE_FIELDS = product_schemas.NON_COLUMN_UPDATE_FIELDS | PRODUCT_ONLY_FIELDS


class MaterialCategoryCreate(product_schemas.CategoryCreate):
    pass


class MaterialCategoryUpdate(product_schemas.CategoryUpdate):
    pass


class MaterialCategory(product_schemas.Category):
    # Same response fields as a product category (incl. version).
    pass


class MaterialItemType(str, Enum):
    """Item types offered in the Item Catalog."""
    STOCK_ITEM = "stock_item"
    EXPENSE = "expense"


class InventoryValuationMethod(str, Enum):
    """How the stock value (cost of issues) is calculated."""
    FIFO = "fifo"
    LIFO = "lifo"
    WEIGHTED_AVERAGE = "weighted_average"


class StockIssuingMethod(str, Enum):
    """Which lot is picked first when stock is issued."""
    FIFO = "fifo"   # first in, first out
    FEFO = "fefo"   # first expired, first out


def _check_design_url(v):
    if v and not re.match(r"^https?://[^\s]+$", v, re.I):
        raise ValueError("Design URL must start with http:// or https://")
    return v


class _MaterialExtras(BaseModel):
    """Material master fields that products don't have (Item Catalog > General)."""
    unit_dimensions: OptStr(120) = None
    hs_code: Optional[str] = Field(default=None, max_length=20, pattern=r"^[0-9][0-9.\- ]{1,19}$")
    required_certificate: OptStr(255) = None
    colour: OptStr(60) = None
    design_url: OptStr(500) = None

    _v_design_url = field_validator("design_url")(_check_design_url)

    @field_validator("hs_code", mode="before")
    @classmethod
    def _blank_hs(cls, v):
        return (str(v).strip() or None) if v is not None else None


class MaterialCreate(_MaterialExtras, product_schemas.ProductCreate):
    # Product-only fields are not used by materials (ignored on save).
    product_type_id: Optional[int] = None
    hs_code_id: Optional[int] = None
    target_market: Optional[str] = None
    item_type: MaterialItemType
    unit_of_measure: product_schemas._Uom  # mandatory: no "pcs" default for materials
    items_brand_id: Optional[product_schemas._Id] = None  # brand is optional for materials
    # Optional for items: the price that matters is each supplier's cost (supplier links). 0 = not set.
    cost_price: product_schemas._Price = 0
    check_for_availability: bool = False
    design_required: bool = False
    # Mandatory on a new item.
    inventory_valuation_method: InventoryValuationMethod
    stock_issuing_method: StockIssuingMethod
    product_family: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class MaterialUpdate(_MaterialExtras, product_schemas.ProductUpdate):
    item_type: Optional[MaterialItemType] = None
    check_for_availability: Optional[bool] = None
    design_required: Optional[bool] = None

    # Same as ProductUpdate's rule, but the brand may be cleared (sent as null).
    @field_validator(
        "name", "item_type", "unit_of_measure", "tracking_type", "over_receipt_tolerance_pct",
        "under_receipt_tolerance_pct", "website_active", "active", "cost_price", "category_id",
        "requires_qc", "check_for_availability", "design_required",
    )
    @classmethod
    def _required_not_null(cls, value):
        if value is None:
            raise ValueError("This field cannot be null")
        return value

    inventory_valuation_method: Optional[InventoryValuationMethod] = None
    stock_issuing_method: Optional[StockIssuingMethod] = None
    product_family: Optional[Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]] = None

    @field_validator("inventory_valuation_method", "stock_issuing_method", "product_family")
    @classmethod
    def _mandatory_not_cleared(cls, v, info):
        if v is None:
            raise ValueError(f"{info.field_name.replace('_', ' ').capitalize()} cannot be empty")
        return v


class LinkedProduct(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    item_code: str
    name: str
    active: bool


class Material(product_schemas.Product):
    # Same fields as Product (price_tiers stays [] — materials have no price tiers) plus the extras.
    unit_dimensions: Optional[str] = None
    hs_code: Optional[str] = None
    required_certificate: Optional[str] = None
    colour: Optional[str] = None
    inventory_valuation_method: Optional[str] = None
    stock_issuing_method: Optional[str] = None
    # Moving average unit cost (weighted-average items); read-only, kept by stock receipts
    average_cost: Optional[Decimal] = None
    product_family: Optional[str] = None
    design_url: Optional[str] = None
    items_brand_id: Optional[int] = None
    check_for_availability: bool = False
    design_required: bool = False
    # Products that sell this item (filled on the single-item GET only).
    linked_products: List[LinkedProduct] = []


class MinimumPriceCreate(product_schemas.MinimumPriceCreate):
    pass


class MaterialMinimumPrice(product_schemas.MinimumPriceBase, TijaeroBaseSchema):
    id: int
    material_id: int
    created_date: datetime
    created_at: datetime
    updated_at: datetime


class MaterialSupplierBase(BaseModel):
    supplier_sku: OptStr(255) = None
    # The price purchasing would pick up for this supplier, so it must be a real (> 0) price.
    cost_price: Decimal = Field(..., gt=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    minimum_order_qty: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    is_preferred: bool = False
    active: bool = True


class MaterialSupplierCreate(MaterialSupplierBase):
    supplier_id: int = Field(..., ge=1, le=INT4_MAX)


class MaterialSupplierUpdate(SupplierProductUpdate):
    pass


class MaterialSupplier(MaterialSupplierBase, AuditSchema):
    id: int
    supplier_id: int
    material_id: int
    material_name: Optional[str] = None
    material_item_code: Optional[str] = None
    supplier_company_name: Optional[str] = None
