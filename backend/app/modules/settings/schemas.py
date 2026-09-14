from datetime import datetime
from typing import Any, Dict, Optional
from zoneinfo import available_timezones

from app.common.base_schemas import TijaeroBaseSchema
from pydantic import BaseModel, Field, field_validator


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
    theme: Optional[str] = None
    language: Optional[str] = None
    timezone: Optional[str] = None
    notifications_enabled: Optional[bool] = None
    email_notifications: Optional[bool] = None
    desktop_notifications: Optional[bool] = None
    default_branch: Optional[str] = None
    items_per_page: Optional[int] = None
    date_format: Optional[str] = None
    currency_format: Optional[str] = None


class UserPreferences(UserPreferencesBase, TijaeroBaseSchema):
    id: int
    user_id: int
    updated_date: datetime


# Profile Update Schema
class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    gender: Optional[str] = None
    date_joined: Optional[str] = None
    birthdate: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)
    confirm_password: str


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


class CompanySettingsUpdate(BaseModel):
    company_name: Optional[str] = None
    company_address: Optional[str] = None
    company_telephone_number: Optional[str] = None
    company_fax_number: Optional[str] = None
    company_email: Optional[str] = None
    company_logo_id: Optional[int] = None
    depreciation_rate: Optional[float] = None
    number_of_annual_leaves: Optional[int] = None
    number_of_casual_leaves: Optional[int] = None
    number_of_medical_leaves: Optional[int] = None
    default_tax_rate: Optional[float] = None
    tax_inclusive_pricing: Optional[bool] = None
    hide_service_charge: Optional[bool] = None
    amex_card_surcharge: Optional[float] = None
    visa_card_surcharge: Optional[float] = None
    master_card_surcharge: Optional[float] = None
    fiscal_year_start: Optional[str] = None
    default_currency: Optional[str] = None
    default_timezone: Optional[str] = None
    tax_registration_number: Optional[str] = None
    # Passcode expiry: range 1-30 (mandatory monthly cap)
    passcode_expiry_days: Optional[int] = Field(default=None, ge=1, le=30)

    @field_validator("default_timezone")
    @classmethod
    def validate_default_timezone(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in available_timezones():
            raise ValueError(f"Unknown timezone: {v}")
        return v


class CompanySettings(CompanySettingsBase, TijaeroBaseSchema):
    id: int


# Currency Schemas
class CurrencyBase(BaseModel):
    code: str = Field(..., min_length=3, max_length=3)
    name: str
    symbol: str
    is_active: bool = True


class CurrencyCreate(CurrencyBase):
    pass


class CurrencyUpdate(BaseModel):
    name: Optional[str] = None
    symbol: Optional[str] = None
    is_active: Optional[bool] = None


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
