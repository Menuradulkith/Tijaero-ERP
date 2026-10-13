from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema
from app.common.enums import StockStatus, AssetStatus


class ProductBase(BaseModel):
    sku: str
    name: str
    description: Optional[str] = None
    unit_price: float
    stock_quantity: float = 0.0

class ProductCreate(ProductBase):
    pass

class Product(ProductBase, TijaeroBaseSchema):
    id: int


# Sales Stock Schemas
class SalesStockBase(BaseModel):
    product_id: int
    # Required for serial-tracked products; None for batch/none lots.
    barcode: Optional[str] = None
    branch_code: str
    location_id: Optional[int] = None  # good_received_locations_id from GRN
    good_received_note_id: int
    purchasing_order_items_id: int
    warranty_month: Optional[str] = None  # From PO item or entered in GRN
    status: StockStatus = StockStatus.AVAILABLE
    # Units this row represents: 1 for serial stock, lot size for batch/none.
    quantity: int = 1
    batch_no: Optional[str] = Field(default=None, max_length=100)
    expiry_date: Optional[date] = None

class SalesStockCreate(SalesStockBase):
    quantity: int = Field(default=1, ge=1)

class SalesStock(SalesStockBase, TijaeroBaseSchema):
    id: int
    added_date: datetime
    grn_no: Optional[str] = None  # GRN number from relationship
    location_name: Optional[str] = None  # Location name from GRN
    cost_price: Optional[Decimal] = None  # Cost price from product/tier
    selling_price: Optional[Decimal] = None  # Selling price from product/tier
    minimum_price: Optional[Decimal] = None  # Minimum price from product/tier
    # Set server-side (never client-supplied) when this unit was received
    # against a PO line traced back to a Sales Quotation item — see
    # SalesStockService.create.
    reserved_for_quote_item_id: Optional[int] = None
    minimum_selling_price: Optional[Decimal] = None  # Minimum selling price for frontend mapping
    price_tier_id: Optional[int] = None  # Active price tier ID


class SalesStockSummary(BaseModel):
    """Branch-scoped KPI counters for the sales-stock dashboard."""
    in_stock: int = 0
    reserved: int = 0
    sold_today: int = 0
    returned: int = 0


class SalesStockPaginated(BaseModel):
    """Server-side paginated sales-stock response with a branch-scoped summary."""
    items: List[SalesStock]
    total: int
    summary: SalesStockSummary


# Company Assets Schemas - Real table for company-owned items
class CompanyAssetBase(BaseModel):
    product_id: Optional[int] = None
    inventory_no: str
    item: str
    description: Optional[str] = None
    branch_code: str
    asigned_to: Optional[int] = None
    barcode: Optional[str] = None
    warranty_month: Optional[str] = None  # Warranty period from PO or entered in GRN
    good_received_note_id: Optional[int] = None
    purchasing_order_items_id: Optional[int] = None
    status: AssetStatus = AssetStatus.AVAILABLE
    return_reason: Optional[str] = None  # Reason for return (from sale return)
    sale_return_id: Optional[int] = None  # Link to sale return record
    source: Optional[str] = "grn"  # 'grn' or 'sale_return'

class CompanyAssetCreate(CompanyAssetBase):
    pass

class CompanyAsset(CompanyAssetBase, TijaeroBaseSchema):
    id: int
    added_date: Optional[datetime] = None
    # Enriched fields from relationships
    product_name: Optional[str] = None
    item_code: Optional[str] = None
    brand_id: Optional[int] = None
    cost_price: Optional[Decimal] = None
    grn_no: Optional[str] = None


class ReclassifyRequest(BaseModel):
    """Move a serial unit between sales stock and company assets."""
    reason: str = Field(..., min_length=3, max_length=500)
    location_id: Optional[int] = None  # target location when returning an asset to stock


class ReclassifyResponse(BaseModel):
    success: bool
    message: str
    barcode: str
    sales_stock_id: int
    company_asset_id: int


# GRN Stock Save Request - for saving items to sales_stock and/or company_assets
class GRNStockItemCreate(BaseModel):
    product_id: int
    barcode: str
    branch_code: str
    purchasing_order_items_id: int
    save_to_sales_stock: bool = False
    save_to_company_assets: bool = False
    # For company assets
    inventory_no: Optional[str] = None
    item_name: Optional[str] = None
    description: Optional[str] = None
