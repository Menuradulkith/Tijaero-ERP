from pydantic import BaseModel, Field, StringConstraints, field_validator, model_validator
from typing import Annotated, Generic, Optional, List, TypeVar

T = TypeVar("T")
from datetime import date, datetime

from app.common.base_schemas import TijaeroBaseSchema, VersionedSchema
from app.modules.products.price_tier_schemas import MAX_PRICE, PriceTierOut

# ---- input rules (create / update only) ------------------------------------------------
# The *Base / response models below stay lenient so a legacy row that predates these
# rules still serializes; new input must carry real, trimmed content within the column
# limits. Without this, blank names/codes were accepted, and one bad row could make a
# whole list endpoint return 500.
_Id = Annotated[int, Field(ge=1, le=2_147_483_647)]
_Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
_Code255 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
_BrandCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=4)]
_Memo = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
_Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)]
_Model = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]
# item_type / unit_of_measure are short identifiers ("inventory", "service", "pcs", "kg", "general"…).
_Short = lambda n: Annotated[  # noqa: E731
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n, pattern=r"^[A-Za-z0-9][A-Za-z0-9 _./-]*$")
]
_ItemType = _Short(30)
_Uom = _Short(20)
_Price = Annotated[float, Field(ge=0, le=MAX_PRICE)]


def _blank_to_none(value):
    """Forms send "" for an untouched optional field; treat that as "not set"."""
    if isinstance(value, str) and not value.strip():
        return None
    return value

class CategoryBase(BaseModel):
    name: str = Field(..., max_length=255)
    category_code: str = Field(..., max_length=255)
    memo: Optional[str] = Field(None, max_length=255)
    description: Optional[str] = None
    active: bool = True

class CategoryCreate(CategoryBase):
    name: _Name
    category_code: _Code255
    memo: Optional[_Memo] = None
    description: Optional[_Description] = None

    _v_blank = field_validator("memo", "description", mode="before")(_blank_to_none)

class CategoryUpdate(BaseModel):
    name: Optional[_Name] = None
    category_code: Optional[_Code255] = None
    memo: Optional[_Memo] = None
    description: Optional[_Description] = None
    active: Optional[bool] = None

    _v_blank = field_validator("memo", "description", mode="before")(_blank_to_none)

    @field_validator("name", "category_code", "active")
    @classmethod
    def _required_not_null(cls, value):
        if value is None:
            raise ValueError("This field cannot be null")
        return value

    # Optimistic-concurrency check — see ProductUpdate.expected_version.
    expected_updated_at: Optional[datetime] = None
    expected_version: Optional[str] = None

class Category(CategoryBase, TijaeroBaseSchema, VersionedSchema):
    id: int
    created_date: datetime
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None

class BrandBase(BaseModel):
    brand_name: str = Field(..., max_length=255)
    brand_code: str = Field(..., max_length=4)
    description: Optional[str] = None
    active: bool = True

class BrandCreate(BrandBase):
    brand_name: _Name
    brand_code: _BrandCode
    description: Optional[_Description] = None

    _v_blank = field_validator("description", mode="before")(_blank_to_none)

class BrandUpdate(BaseModel):
    brand_name: Optional[_Name] = None
    brand_code: Optional[_BrandCode] = None
    description: Optional[_Description] = None
    active: Optional[bool] = None

    _v_blank = field_validator("description", mode="before")(_blank_to_none)

    @field_validator("brand_name", "brand_code", "active")
    @classmethod
    def _required_not_null(cls, value):
        if value is None:
            raise ValueError("This field cannot be null")
        return value

    # Optimistic-concurrency check — see ProductUpdate.expected_version.
    expected_updated_at: Optional[datetime] = None
    expected_version: Optional[str] = None

class Brand(BrandBase, TijaeroBaseSchema, VersionedSchema):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None

class ProductBase(BaseModel):
    name: str = Field(..., max_length=255)
    item_code: str = Field(..., max_length=255)
    model: Optional[str] = Field(None, max_length=255)
    item_type: str = Field(..., max_length=30)
    unit_of_measure: str = Field(default="pcs", max_length=20)
    description: Optional[str] = None
    website_active: bool = False
    website_price: Optional[float] = None
    selling_price: Optional[float] = None
    active: bool = True
    cost_price: float = Field(..., ge=0)
    category_id: int
    items_brand_id: int
    image_url: Optional[str] = None

class ProductCreate(BaseModel):
    name: _Name
    item_code: _Code255
    model: Optional[_Model] = None
    item_type: _ItemType
    unit_of_measure: _Uom = "pcs"
    description: Optional[_Description] = None
    website_active: bool = False
    website_price: Optional[_Price] = None
    selling_price: Optional[_Price] = None
    active: bool = True
    cost_price: _Price
    category_id: _Id
    items_brand_id: _Id
    # NB: no image_url — the upload/remove image endpoints are its only writers.
    # Optional initial minimum selling price, recorded as a MinimumPrice
    # history row in the same transaction as the product itself.
    minimum_selling_price: Optional[_Price] = None

    _v_blank = field_validator("model", "description", mode="before")(_blank_to_none)

    @model_validator(mode="after")
    def _cross_field_rules(self):
        if self.website_active and not self.website_price:
            raise ValueError("Website price is required when the product is active on the website")
        if (
            self.minimum_selling_price is not None
            and self.selling_price is not None
            and self.minimum_selling_price > self.selling_price
        ):
            raise ValueError("Minimum selling price cannot be greater than the selling price")
        return self

class ProductUpdate(BaseModel):
    name: Optional[_Name] = None
    model: Optional[_Model] = None
    item_type: Optional[_ItemType] = None
    unit_of_measure: Optional[_Uom] = None
    description: Optional[_Description] = None
    website_active: Optional[bool] = None
    website_price: Optional[_Price] = None
    selling_price: Optional[_Price] = None
    active: Optional[bool] = None
    cost_price: Optional[_Price] = None
    category_id: Optional[_Id] = None
    items_brand_id: Optional[_Id] = None
    # image_url is intentionally absent: the upload/remove image endpoints
    # are its only writers, so a form save can't revert a just-uploaded image.
    # When set, a new MinimumPrice history row is written in the same
    # transaction as the product update (only if the value changed).
    minimum_selling_price: Optional[_Price] = None
    # The `updated_at` the client last saw. If it no longer matches the row,
    # the update is rejected with a 409 instead of silently overwriting a
    # newer change. Omitted → no check (backward compatible).
    expected_updated_at: Optional[datetime] = None
    # Preferred over expected_updated_at: the exact `version` token from the
    # response (full precision, so same-second changes are caught too).
    expected_version: Optional[str] = None

    _v_blank = field_validator("model", "description", mode="before")(_blank_to_none)

    @field_validator(
        "name", "item_type", "unit_of_measure", "website_active", "active", "cost_price", "category_id", "items_brand_id"
    )
    @classmethod
    def _required_not_null(cls, value):
        # Only explicitly sent values are validated: omit a field to leave it unchanged,
        # but an explicit null on a required column used to be a vague 400.
        if value is None:
            raise ValueError("This field cannot be null")
        return value

# Fields on the update schemas that aren't real columns.
NON_COLUMN_UPDATE_FIELDS = {"expected_updated_at", "expected_version", "minimum_selling_price"}

class Product(ProductBase, TijaeroBaseSchema, VersionedSchema):
    id: int
    created_date: date
    added_date: datetime
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
    price_tiers: List[PriceTierOut] = []
    # Bulk-attached by the service (see _attach_minimum_prices /
    # _attach_preferred_suppliers in service.py) — not real DB columns on
    # Product, so both default to None for any code path that doesn't call
    # those (e.g. create/update responses).
    minimum_selling_price: Optional[float] = None
    preferred_supplier_name: Optional[str] = None
    # Filled by the paged list so the grid needn't load every category/brand.
    category_name: Optional[str] = None
    brand_name: Optional[str] = None

class ProductWithDetails(Product):
    category: Optional[Category] = None
    brand: Optional[Brand] = None

class MinimumPriceBase(BaseModel):
    minimum_price: float

class MinimumPriceCreate(BaseModel):
    minimum_price: _Price

class MinimumPrice(MinimumPriceBase, TijaeroBaseSchema):
    id: int
    product_id: int
    created_date: datetime
    created_at: datetime
    updated_at: datetime


class Page(BaseModel, Generic[T]):
    """One page of a server-side paged list; total is the filtered row count
    across all pages so the grid can show 1-25 of N."""
    items: List[T]
    total: int
    page: int
    size: int
    pages: int
