from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from app.db.base import Base


class UserNotification(Base):
    """User notifications"""
    __tablename__ = "user_notifications"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("accounts_user.id"), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    notification_type = Column(String(50), nullable=False)  # info, success, warning, error
    is_read = Column(Boolean, default=False, nullable=False)
    created_date = Column(DateTime, default=datetime.utcnow, nullable=False)
    read_date = Column(DateTime)
    action_url = Column(String(500))
    extra_data = Column(JSON)  # Additional data as JSON


class UserPreferences(Base):
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
    updated_date = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# Note: The 'settings' table already exists in the database for company-wide settings
# We're using 'user_preferences' and 'user_notifications' for user-specific data
