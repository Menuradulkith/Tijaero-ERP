from __future__ import annotations

from decimal import Decimal
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.common.base_schemas import FormattedDateTime, TijaeroBaseSchema, VersionedSchema
from app.modules.products.design_brief_schemas import (
    MAX_LINES, DesignBriefStatus, _Id, _Notes, _Versioned, check_optional_url,
)

_Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
_Url = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]


class DesignDetailLineIn(BaseModel):
    material_id: _Id
    quantity: Decimal = Field(..., gt=0, le=Decimal("999999999"), decimal_places=3)
    # Optional; blank is stored as NULL. For an item from the confirmed brief the brief's own text is used.
    brief: Optional[_Notes] = None
    colour: Optional[_Short] = None
    size: Optional[_Short] = None
    design_url: Optional[_Url] = None

    _v_design_url = field_validator("design_url")(check_optional_url)


class DesignDetailSave(_Versioned):
    special_instructions: Optional[_Notes] = None
    packing_instructions: Optional[_Notes] = None
    lines: List[DesignDetailLineIn] = Field(default_factory=list, max_length=MAX_LINES)


class DesignDetailLineOut(TijaeroBaseSchema):
    id: int
    material_id: int
    item_code: str
    item_name: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    brief: Optional[str] = None
    quantity: float
    colour: Optional[str] = None
    size: Optional[str] = None
    design_url: Optional[str] = None
    sort_order: int


class DesignDetailOut(TijaeroBaseSchema, VersionedSchema):
    id: int
    product_id: int
    status: DesignBriefStatus
    special_instructions: Optional[str] = None
    packing_instructions: Optional[str] = None
    lines: List[DesignDetailLineOut] = []
    confirmed_by_name: Optional[str] = None
    confirmed_at: Optional[FormattedDateTime] = None
    rejected_by_name: Optional[str] = None
    rejected_at: Optional[FormattedDateTime] = None
    reject_reason: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
    created_at: Optional[FormattedDateTime] = None
    updated_at: Optional[FormattedDateTime] = None
