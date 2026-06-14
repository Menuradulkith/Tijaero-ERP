from pydantic import BaseModel, Field
from typing import Optional
from datetime import date, datetime

from app.common.base_schemas import TijaeroBaseSchema

class CategoryBase(BaseModel):
    name: str = Field(..., max_length=255)
    category_code: str = Field(..., max_length=255)
    memo: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    active: bool = True

class CategoryCreate(CategoryBase):
    pass

class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    category_code: Optional[str] = Field(None, max_length=255)
    memo: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    active: Optional[bool] = None

class Category(CategoryBase, TijaeroBaseSchema):
    id: int
    created_date: datetime
    created_at: datetime
    updated_at: datetime

class BrandBase(BaseModel):
    brand_name: str = Field(..., max_length=255)
    brand_code: str = Field(..., max_length=4)
    description: Optional[str] = None
    active: bool = True

class BrandCreate(BrandBase):
    pass

class BrandUpdate(BaseModel):
    brand_name: Optional[str] = Field(None, max_length=255)
    brand_code: Optional[str] = Field(None, max_length=4)
    description: Optional[str] = None
    active: Optional[bool] = None

class Brand(BrandBase, TijaeroBaseSchema):
    id: int

class ProductBase(BaseModel):
    name: str = Field(..., max_length=255)
    item_code: str = Field(..., max_length=255)
    model: Optional[str] = Field(None, max_length=255)
    item_type: str = Field(..., max_length=30)
    description: Optional[str] = None
    website_active: bool = False
    website_price: Optional[float] = None
    selling_price: Optional[float] = None
    active: bool = True
    cost_price: float = Field(..., ge=0)
    category_id: int
    items_brand_id: int
    image_url: Optional[str] = None

class ProductCreate(ProductBase):
    pass

class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=255)
    model: Optional[str] = Field(None, max_length=255)
    item_type: Optional[str] = Field(None, max_length=30)
    description: Optional[str] = None
    website_active: Optional[bool] = None
    website_price: Optional[float] = None
    selling_price: Optional[float] = None
    active: Optional[bool] = None
    cost_price: Optional[float] = Field(None, ge=0)
    category_id: Optional[int] = None
    items_brand_id: Optional[int] = None
    image_url: Optional[str] = None

class Product(ProductBase, TijaeroBaseSchema):
    id: int
    created_date: date
    added_date: datetime
    created_at: datetime
    updated_at: datetime

class ProductWithDetails(Product):
    category: Optional[Category] = None
    brand: Optional[Brand] = None

class MinimumPriceBase(BaseModel):
    minimum_price: float = Field(..., ge=0)

class MinimumPriceCreate(BaseModel):
    minimum_price: float = Field(..., ge=0)

class MinimumPrice(MinimumPriceBase, TijaeroBaseSchema):
    id: int
    product_id: int
    created_date: datetime
    created_at: datetime
    updated_at: datetime
