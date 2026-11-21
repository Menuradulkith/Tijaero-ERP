from __future__ import annotations

from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, Field, StringConstraints

from app.common.base_schemas import FormattedDateTime, TijaeroBaseSchema, VersionedSchema

DesignBriefStatus = Literal["draft", "confirmed", "rejected"]

MAX_LINES = 200
_Notes = Annotated[str, StringConstraints(strip_whitespace=True, max_length=2000)]
_Reason = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=1000)]
_Id = Annotated[int, Field(ge=1, le=2_147_483_647)]


def check_optional_url(v: Optional[str]) -> Optional[str]:
    """Blank -> None; otherwise it must be a full http(s) link."""
    if not v:
        return None
    if not v.lower().startswith(("http://", "https://")) or any(c.isspace() for c in v):
        raise ValueError("Enter a full link starting with http:// or https://")
    return v


class DesignBriefLineIn(BaseModel):
    material_id: _Id
    # Optional; blank is stored as NULL.
    brief: Optional[_Notes] = None


class _Versioned(BaseModel):
    """Optimistic-concurrency token echoed back from the last read (see app.common.concurrency)."""
    expected_version: Optional[str] = Field(None, max_length=64)


class DesignBriefSave(_Versioned):
    notes: Optional[_Notes] = None
    lines: List[DesignBriefLineIn] = Field(default_factory=list, max_length=MAX_LINES)


class DesignBriefConfirm(_Versioned):
    pass


class DesignBriefReject(_Versioned):
    reason: _Reason


class DesignBriefLineOut(TijaeroBaseSchema):
    id: int
    material_id: int
    item_code: str
    item_name: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    brief: Optional[str] = None
    sort_order: int


class DesignBriefOut(TijaeroBaseSchema, VersionedSchema):
    id: int
    product_id: int
    status: DesignBriefStatus
    notes: Optional[str] = None
    lines: List[DesignBriefLineOut] = []
    confirmed_by: Optional[int] = None
    confirmed_by_name: Optional[str] = None
    confirmed_at: Optional[FormattedDateTime] = None
    rejected_by: Optional[int] = None
    rejected_by_name: Optional[str] = None
    rejected_at: Optional[FormattedDateTime] = None
    reject_reason: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
    created_at: Optional[FormattedDateTime] = None
    updated_at: Optional[FormattedDateTime] = None


class DesignBriefItemOption(TijaeroBaseSchema):
    """An active Item Catalog item offered in the Design Brief item picker."""
    id: int
    item_code: str
    name: str
    category_id: int
    category_name: Optional[str] = None
    unit_of_measure: Optional[str] = None
    colour: Optional[str] = None
    unit_dimensions: Optional[str] = None
    design_required: bool = False
