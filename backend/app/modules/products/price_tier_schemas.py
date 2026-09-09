from __future__ import annotations
from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field
from app.common.base_schemas import TijaeroBaseSchema


class PriceTierBase(BaseModel):
    cost_price: float = Field(..., ge=0, description="What the product costs us")
    minimum_selling_price: float = Field(..., ge=0, description="Floor price — reps cannot sell below this")
    selling_price: float = Field(..., ge=0, description="Standard retail selling price")
    website_price: Optional[float] = Field(None, ge=0, description="Public-facing website price (optional)")
    remark: Optional[str] = Field(None, description="Human-readable note e.g. 'June Import Batch'")
    is_active: bool = Field(True, description="Only active tiers appear in Sales/Quotation dropdowns")


class PriceTierCreate(PriceTierBase):
    pass


class PriceTierUpdate(BaseModel):
    cost_price: Optional[float] = Field(None, ge=0)
    minimum_selling_price: Optional[float] = Field(None, ge=0)
    selling_price: Optional[float] = Field(None, ge=0)
    website_price: Optional[float] = Field(None, ge=0)
    remark: Optional[str] = None
    is_active: Optional[bool] = None


class PriceTierOut(PriceTierBase, TijaeroBaseSchema):
    id: int
    product_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
