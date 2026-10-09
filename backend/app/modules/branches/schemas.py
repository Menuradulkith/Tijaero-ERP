from datetime import datetime
from typing import Annotated, Optional

from app.common.base_schemas import TijaeroBaseSchema
from app.common.validators import normalize_phone_number
from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator

# Name/code must carry real content: trimmed (so "X " == "X"), non-blank, and
# within the String(255) column so an over-long value is a 422, not a DB 500.
_NameCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]

EMAIL_MAX = 75


def _check_email(v):
    """Store emails lower-cased (they are case-insensitive in practice) and
    within the String(75) column."""
    if v is None:
        return v
    v = str(v).strip().lower()
    if len(v) > EMAIL_MAX:
        raise ValueError(f"Email must be at most {EMAIL_MAX} characters")
    return v


class BranchBase(BaseModel):
    """Shape of a stored branch (also the response shape). Deliberately has no
    input constraints: legacy rows may hold blank/long values and must still
    serialize. Constraints live on BranchCreate / BranchUpdate."""
    branch_name: str
    branch_code: str
    address: Optional[str] = None
    address_line1: Optional[str] = None
    address_line2: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    postal_code: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None
    active: bool = True


class _AddressInput(BaseModel):
    address: Optional[str] = Field(None, max_length=1000)
    address_line1: Optional[str] = Field(None, max_length=255)
    address_line2: Optional[str] = Field(None, max_length=255)
    city: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=120)
    postal_code: Optional[str] = Field(None, max_length=20)


class BranchCreate(_AddressInput):
    branch_name: _NameCode
    branch_code: _NameCode
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None
    active: bool = True

    _v_phone = field_validator("contact_number", mode="before")(normalize_phone_number)
    _v_email = field_validator("email")(_check_email)


class BranchUpdate(_AddressInput):
    # NB: only *explicitly sent* values are validated (unset defaults are not),
    # so the null-rejection below applies to `"branch_name": null` in the body.
    branch_name: Optional[_NameCode] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None
    active: Optional[bool] = None

    _v_phone = field_validator("contact_number", mode="before")(normalize_phone_number)
    _v_email = field_validator("email")(_check_email)

    @field_validator("branch_name", "active")
    @classmethod
    def _not_null(cls, v):
        if v is None:
            raise ValueError("This field cannot be null")
        return v


class Branch(BranchBase, TijaeroBaseSchema):
    id: int
    active: bool
    created_at: datetime
    updated_at: datetime
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


class BranchPerformance(BaseModel):
    """Quick sales/stock KPIs for a branch, for the detail-panel widget."""
    sales_today: float = 0
    sales_month: float = 0
    orders_today: int = 0
    orders_month: int = 0
    in_stock: int = 0
    reserved: int = 0
    sold_today: int = 0
    returned: int = 0
