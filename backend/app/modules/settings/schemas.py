from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime


# Notification Schemas
class NotificationBase(BaseModel):
    title: str
    message: str
    notification_type: str = "info"
    action_url: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None


class NotificationCreate(NotificationBase):
    user_id: int


class Notification(NotificationBase):
    id: int
    user_id: int
    is_read: bool
    created_date: datetime
    read_date: Optional[datetime] = None

    class Config:
        from_attributes = True


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


class UserPreferences(UserPreferencesBase):
    id: int
    user_id: int
    updated_date: datetime

    class Config:
        from_attributes = True


# Profile Update Schema
class ProfileUpdate(BaseModel):
    first_name: Optional[str] = None
    middle_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    occupation: Optional[str] = None
    birthdate: Optional[str] = None


class PasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)
    confirm_password: str


# Notification Stats
class NotificationStats(BaseModel):
    total: int
    unread: int
    read: int
