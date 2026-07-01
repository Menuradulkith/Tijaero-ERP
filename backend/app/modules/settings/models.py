from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON, Float
from sqlalchemy.orm import relationship
from app.core import timezone as tz
from app.db.base import Base
from app.common.base_models import AuditMixin


class Settings(Base, AuditMixin):
    """Company-wide settings and configuration"""
    __tablename__ = "settings"
    
    id = Column(Integer, primary_key=True, index=True)
    company_name = Column(String(255), nullable=False)
    company_address = Column(Text, nullable=False)
    company_telephone_number = Column(String(12))
    company_fax_number = Column(String(12))
    company_email = Column(String(254), nullable=False)
    company_logo_id = Column(Integer)
    
    # Financial settings
    depreciation_rate = Column(Float, nullable=False, default=0.0)
    
    # Leave settings
    number_of_annual_leaves = Column(Integer, nullable=False, default=14)
    number_of_casual_leaves = Column(Integer, nullable=False, default=7)
    number_of_medical_leaves = Column(Integer, nullable=False, default=0)
    
    # Tax normalization settings
    default_tax_rate = Column(Float, nullable=False, default=0.0)  # Default VAT/GST rate (e.g., 18.0 for 18%)
    tax_inclusive_pricing = Column(Boolean, nullable=False, default=True)  # True = prices shown include tax (hidden from customer)
    hide_service_charge = Column(Boolean, nullable=False, default=True)  # True = card surcharge baked into total silently
    
    # Card surcharge settings
    amex_card_surcharge = Column(Float, nullable=False, default=3.0)
    visa_card_surcharge = Column(Float, nullable=False, default=2.7)
    master_card_surcharge = Column(Float, nullable=False, default=2.7)
    
    # Additional settings
    fiscal_year_start = Column(String(10), default="01-01")  # MM-DD format
    default_currency = Column(String(3), default="LKR")
    tax_registration_number = Column(String(50))

    # Passcode security settings
    # Mandatory monthly reset: admin can only lower (1–30 days), default is 30
    passcode_expiry_days = Column(Integer, nullable=False, default=30)
    

class UserNotification(Base, AuditMixin):
    """User notifications"""
    __tablename__ = "user_notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("accounts_user.id"), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String(50), nullable=False)  # info, success, warning, error
    is_read = Column(Boolean, default=False, nullable=False)
    created_date = Column(DateTime, default=tz.now, nullable=False)
    read_date = Column(DateTime)
    action_url = Column(String(500))
    extra_data = Column(JSON)  # Additional data as JSON


class UserPreferences(Base, AuditMixin):
    """User preferences and settings"""
    __tablename__ = "user_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("accounts_user.id"), unique=True, nullable=False)
    theme = Column(String(20), default="light")  # light, dark
    language = Column(String(10), default="en")
    timezone = Column(String(50), default="UTC")
    notifications_enabled = Column(Boolean, default=True)
    email_notifications = Column(Boolean, default=True)
    desktop_notifications = Column(Boolean, default=False)
    default_branch = Column(String(200))
    items_per_page = Column(Integer, default=25)
    date_format = Column(String(20), default="YYYY-MM-DD")
    currency_format = Column(String(10), default="USD")
    updated_date = Column(DateTime, default=tz.now, onupdate=tz.now)


# Note: The 'settings' table already exists in the database for company-wide settings
# We're using 'user_preferences' and 'user_notifications' for user-specific data
