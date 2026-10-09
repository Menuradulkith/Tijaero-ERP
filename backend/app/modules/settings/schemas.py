import math
import re
from datetime import date, datetime
from typing import Annotated, Any, Dict, Literal, Optional
from zoneinfo import available_timezones

from app.common.base_schemas import TijaeroBaseSchema
from pydantic import BaseModel, BeforeValidator, EmailStr, Field, StringConstraints, field_validator, model_validator
from app.common.validators import normalize_phone_number
from app.core.password_policy import validate_password_strength



# ---- input hygiene -----------------------------------------------------------
# Text columns have length limits, so over-long input is a 422 with a field
# message rather than a database error (500). Text is trimmed; optional text
# that is blank becomes None; an explicit null on a required column is a 422.
INT4_MAX = 2_147_483_647


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


def OptStr(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none)]


def _reject_null(*names):
    """Explicit null is not 'leave unchanged' for these update fields."""
    def check(cls, values):
        if isinstance(values, dict):
            for n in names:
                if n in values and values[n] is None:
                    raise ValueError(f"{n} cannot be null")
        return values
    return model_validator(mode="before")(classmethod(check))


def _finite(v):
    if v is not None and (isinstance(v, float) and (math.isnan(v) or math.isinf(v))):
        raise ValueError("Must be a finite number")
    return v


def _check_timezone(v):
    if v is not None and v not in available_timezones():
        raise ValueError(f"Unknown timezone: {v}")
    return v


def _currency_code(v):
    if v is None:
        return None
    v = str(v).strip().upper()
    if not re.fullmatch(r"[A-Z]{3}", v):
        raise ValueError("Currency code must be 3 letters, e.g. LKR")
    return v


# Notification Schemas
class NotificationBase(BaseModel):
    title: str
    message: str
    notification_type: str = "info"
    action_url: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None


class NotificationCreate(NotificationBase):
    user_id: int


class Notification(NotificationBase, TijaeroBaseSchema):
    id: int
    user_id: int
    is_read: bool
    created_date: datetime
    read_date: Optional[datetime] = None


# User Preferences Schemas
class UserPreferencesBase(BaseModel):
    theme: str = "light"
    language: str = "en"
    timezone: str = "UTC"
    notifications_enabled: bool = True
    email_notifications: bool = True
    desktop_notifications: bool = False
    default_branch: Optional[str] = None
    items_per_page: int = 25
    date_format: str = "YYYY-MM-DD"
    currency_format: str = "USD"


class UserPreferencesCreate(UserPreferencesBase):
    user_id: int


class UserPreferencesUpdate(BaseModel):
    theme: Optional[Literal["light", "dark"]] = None
    language: Optional[Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$", max_length=10)]] = None
    timezone: Optional[str] = Field(default=None, max_length=50)
    notifications_enabled: Optional[bool] = None
    email_notifications: Optional[bool] = None
    desktop_notifications: Optional[bool] = None
    default_branch: OptStr(200) = None
    items_per_page: Optional[int] = Field(default=None, ge=5, le=200)
    date_format: Optional[Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[YMDdmy][YMDdmy /.\-]{4,18}[YMDdmy]$", max_length=20)]] = None
    currency_format: Optional[str] = Field(default=None, max_length=10)

    _no_nulls = _reject_null(
        "theme", "language", "timezone", "notifications_enabled", "email_notifications",
        "desktop_notifications", "items_per_page", "date_format", "currency_format",
    )
    _v_tz = field_validator("timezone")(_check_timezone)
    _v_cur = field_validator("currency_format", mode="before")(_currency_code)


class UserPreferences(TijaeroBaseSchema):
    """Response: lenient on purpose, so a legacy row with NULL columns still
    loads (it used to 500 and lock the user out of the Preferences tab)."""
    id: int
    user_id: int
    theme: Optional[str] = "light"
    language: Optional[str] = "en"
    timezone: Optional[str] = "UTC"
    notifications_enabled: Optional[bool] = True
    email_notifications: Optional[bool] = True
    desktop_notifications: Optional[bool] = False
    default_branch: Optional[str] = None
    items_per_page: Optional[int] = 25
    date_format: Optional[str] = "YYYY-MM-DD"
    currency_format: Optional[str] = "USD"
    updated_date: Optional[datetime] = None


# Profile Update Schema
def _iso_date(v):
    """YYYY-MM-DD only (Postgres would accept words like 'yesterday')."""
    if v is None or isinstance(v, date):
        return v
    v = str(v).strip()
    if not v:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
        raise ValueError("Date must be in YYYY-MM-DD format")
    return date.fromisoformat(v)  # ValueError for 2026-02-30


class ProfileUpdate(BaseModel):
    first_name: Optional[ReqStr(30)] = None
    middle_name: OptStr(30) = None
    last_name: Optional[ReqStr(30)] = None
    gender: OptStr(30) = None
    date_joined: Annotated[Optional[date], BeforeValidator(_iso_date)] = None
    birthdate: Annotated[Optional[date], BeforeValidator(_iso_date)] = None

    _no_nulls = _reject_null("first_name", "last_name")

    @field_validator("birthdate")
    @classmethod
    def _birthdate_ok(cls, v):
        if v is not None and (v > date.today() or v.year < 1900):
            raise ValueError("Birthdate is not valid")
        return v

    @field_validator("date_joined")
    @classmethod
    def _joined_ok(cls, v):
        if v is not None and (v > date.today() or v.year < 1900):
            raise ValueError("Date joined is not valid")
        return v


class ProfileOut(BaseModel):
    """What the profile update returns — never the whole User row (that
    includes the password hash and permission data)."""
    model_config = {"from_attributes": True}

    id: int
    username: str
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    gender: Optional[str] = None
    date_joined: Optional[date] = None
    birthdate: Optional[date] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8, max_length=128)
    confirm_password: str

    @field_validator("new_password")
    @classmethod
    def _password_policy(cls, value: str) -> str:
        return validate_password_strength(value)


# Company Settings Schemas
class CompanySettingsBase(BaseModel):
    company_name: str
    company_address: str
    company_telephone_number: Optional[str] = None
    company_fax_number: Optional[str] = None
    company_email: str
    company_logo_id: Optional[int] = None
    depreciation_rate: float = 0.0
    number_of_annual_leaves: int = 14
    number_of_casual_leaves: int = 7
    number_of_medical_leaves: int = 0
    default_tax_rate: float = 0.0
    tax_inclusive_pricing: bool = True
    hide_service_charge: bool = True
    amex_card_surcharge: float = 3.0
    visa_card_surcharge: float = 2.7
    master_card_surcharge: float = 2.7
    fiscal_year_start: str = "01-01"
    default_currency: str = "LKR"
    default_timezone: str = "Asia/Colombo"
    tax_registration_number: Optional[str] = None
    # Passcode expiry: mandatory monthly cap — admin can lower (1-30), never disable
    passcode_expiry_days: int = Field(default=30, ge=1, le=30)

    @field_validator("default_timezone")
    @classmethod
    def validate_default_timezone(cls, v: str) -> str:
        if v not in available_timezones():
            raise ValueError(f"Unknown timezone: {v}")
        return v


Percent = Annotated[float, Field(ge=0, le=100, allow_inf_nan=False)]


class CompanySettingsUpdate(BaseModel):
    _v_phone = field_validator("company_telephone_number", mode="before")(normalize_phone_number)
    company_name: Optional[ReqStr(255)] = None
    company_address: Optional[ReqStr(1000)] = None
    company_telephone_number: Optional[str] = None
    company_fax_number: Annotated[Optional[Annotated[str, StringConstraints(pattern=r"^[0-9+ \-]{3,12}$")]], BeforeValidator(_blank_to_none)] = None
    company_email: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=254, pattern=r"^[^\s@]+@[^\s@]+\.[^\s@]+$")]] = None
    company_logo_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    depreciation_rate: Optional[Percent] = None
    number_of_annual_leaves: Optional[int] = Field(default=None, ge=0, le=365)
    number_of_casual_leaves: Optional[int] = Field(default=None, ge=0, le=365)
    number_of_medical_leaves: Optional[int] = Field(default=None, ge=0, le=365)
    default_tax_rate: Optional[Percent] = None
    tax_inclusive_pricing: Optional[bool] = None
    hide_service_charge: Optional[bool] = None
    amex_card_surcharge: Optional[Percent] = None
    visa_card_surcharge: Optional[Percent] = None
    master_card_surcharge: Optional[Percent] = None
    fiscal_year_start: Optional[str] = None
    default_currency: Optional[str] = None
    default_timezone: Optional[str] = Field(default=None, max_length=50)
    tax_registration_number: OptStr(50) = None
    # Passcode expiry: range 1-30 (mandatory monthly cap)
    passcode_expiry_days: Optional[int] = Field(default=None, ge=1, le=30)

    _no_nulls = _reject_null(
        "company_name", "company_address", "company_email", "depreciation_rate",
        "number_of_annual_leaves", "number_of_casual_leaves", "number_of_medical_leaves",
        "default_tax_rate", "tax_inclusive_pricing", "hide_service_charge",
        "amex_card_surcharge", "visa_card_surcharge", "master_card_surcharge",
        "fiscal_year_start", "default_currency", "default_timezone", "passcode_expiry_days",
    )
    _v_cur = field_validator("default_currency", mode="before")(_currency_code)

    @field_validator("fiscal_year_start", mode="before")
    @classmethod
    def validate_fiscal_start(cls, v):
        if v is None:
            return None
        v = str(v).strip()
        try:
            datetime.strptime("2001-" + v, "%Y-%m-%d")  # 2001: not a leap year, so 02-29 is rejected
        except ValueError:
            raise ValueError("Fiscal year start must be a real date in MM-DD format, e.g. 01-01")
        return v

    @field_validator("default_timezone")
    @classmethod
    def validate_default_timezone(cls, v: Optional[str]) -> Optional[str]:
        return _check_timezone(v)


class CompanySettings(CompanySettingsBase, TijaeroBaseSchema):
    id: int


# Currency Schemas
class CurrencyBase(BaseModel):
    code: str
    name: str
    symbol: str
    is_active: bool = True


class CurrencyCreate(BaseModel):
    code: str
    name: ReqStr(100)
    symbol: ReqStr(10)
    is_active: bool = True

    _v_code = field_validator("code", mode="before")(_currency_code)


class CurrencyUpdate(BaseModel):
    name: Optional[ReqStr(100)] = None
    symbol: Optional[ReqStr(10)] = None
    is_active: Optional[bool] = None

    _no_nulls = _reject_null("name", "symbol", "is_active")


class Currency(CurrencyBase, TijaeroBaseSchema):
    id: int


# Timezone Schemas
class TimezoneOption(BaseModel):
    name: str  # IANA id, e.g. "Asia/Colombo"
    offset: str  # current UTC offset, e.g. "UTC+05:30"


# Notification Stats
class NotificationStats(BaseModel):
    total: int
    unread: int
    read: int
