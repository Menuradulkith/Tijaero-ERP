from __future__ import annotations
from typing import Annotated, Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, StringConstraints, field_validator
from app.common.base_schemas import TijaeroBaseSchema

# Prices are NUMERIC(60,2) in the database; a trillion is far beyond any real price
# and keeps an absurd value a 422 instead of a database 500.
MAX_PRICE = 999_999_999_999.99
_Price = Annotated[float, Field(ge=0, le=MAX_PRICE)]
_Remark = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class PriceTierBase(BaseModel):
    """Shape of a stored tier (also the response shape). Deliberately lenient: a
    legacy row that breaks today's input rules must still serialize, otherwise one
    bad row makes the whole product list fail."""
    cost_price: float = Field(..., description="What the product costs us")
    minimum_selling_price: float = Field(..., description="Floor price — reps cannot sell below this")
    selling_price: float = Field(..., description="Standard retail selling price")
    website_price: Optional[float] = Field(None, description="Public-facing website price (optional)")
    remark: Optional[str] = Field(None, description="Human-readable note e.g. 'June Import Batch'")
    is_active: bool = Field(True, description="Only active tiers appear in Sales/Quotation dropdowns")


class PriceTierCreate(PriceTierBase):
    cost_price: _Price = Field(..., description="What the product costs us")
    minimum_selling_price: _Price = Field(..., description="Floor price — reps cannot sell below this")
    selling_price: _Price = Field(..., description="Standard retail selling price")
    website_price: Optional[_Price] = Field(None, description="Public-facing website price (optional)")
    remark: Optional[_Remark] = Field(None, description="Human-readable note e.g. 'June Import Batch'")


class PriceTierUpdate(BaseModel):
    cost_price: Optional[_Price] = None
    minimum_selling_price: Optional[_Price] = None
    selling_price: Optional[_Price] = None
    website_price: Optional[_Price] = None
    remark: Optional[_Remark] = None
    is_active: Optional[bool] = None

    @field_validator("cost_price", "minimum_selling_price", "selling_price", "is_active")
    @classmethod
    def _required_not_null(cls, value):
        # Only explicitly sent values are validated: omit a field to leave it unchanged,
        # but an explicit null would hit a NOT NULL column (it used to be a 500).
        if value is None:
            raise ValueError("This field cannot be null")
        return value


class PriceTierOut(PriceTierBase, TijaeroBaseSchema):
    id: int
    product_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
