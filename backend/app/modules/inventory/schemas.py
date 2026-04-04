from pydantic import BaseModel
from typing import Optional
from datetime import datetime

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
    barcode: str
    branch_code: str
    location_id: Optional[int] = None  # good_received_locations_id from GRN
    good_received_note_id: int
    purchasing_order_items_id: int
    warranty_month: Optional[str] = None  # From PO item or entered in GRN
    status: StockStatus = StockStatus.AVAILABLE

class SalesStockCreate(SalesStockBase):
    pass

class SalesStock(SalesStockBase, TijaeroBaseSchema):
    id: int
    added_date: datetime
    grn_no: Optional[str] = None  # GRN number from relationship
    location_name: Optional[str] = None  # Location name from GRN
    cost_price: Optional[float] = None  # Cost price from product
    selling_price: Optional[float] = None  # Selling price from product


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

class CompanyAssetCreate(CompanyAssetBase):
    pass

class CompanyAsset(CompanyAssetBase, TijaeroBaseSchema):
    id: int
    added_date: Optional[datetime] = None


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
