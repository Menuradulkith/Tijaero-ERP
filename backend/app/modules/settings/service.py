from datetime import datetime
from typing import List, Optional

from app.core import timezone as tz
from app.core.security import get_password_hash, verify_password
from fastapi import HTTPException, status
from sqlalchemy import and_, desc, func, text
from sqlalchemy.orm import Session

from . import models, schemas


class NotificationService:
    def __init__(self, db: Session):
        self.db = db

    def create_notification(
        self, notification: schemas.NotificationCreate
    ) -> models.UserNotification:
        """Create a new notification"""
        db_notification = models.UserNotification(**notification.dict())
        self.db.add(db_notification)
        self.db.commit()
        self.db.refresh(db_notification)
        return db_notification

    def get_user_notifications(
        self, user_id: int, unread_only: bool = False, skip: int = 0, limit: int = 50
    ) -> List[models.UserNotification]:
        """Get notifications for a user"""
        query = self.db.query(models.UserNotification).filter(
            models.UserNotification.user_id == user_id
        )

        if unread_only:
            query = query.filter(models.UserNotification.is_read == False)

        return (
            query.order_by(desc(models.UserNotification.created_date))
            .offset(skip)
            .limit(limit)
            .all()
        )

    def mark_as_read(
        self, notification_id: int, user_id: int
    ) -> models.UserNotification:
        """Mark notification as read"""
        notification = (
            self.db.query(models.UserNotification)
            .filter(
                and_(
                    models.UserNotification.id == notification_id,
                    models.UserNotification.user_id == user_id,
                )
            )
            .first()
        )

        if not notification:
            raise HTTPException(status_code=404, detail="Notification not found")

        notification.is_read = True
        notification.read_date = tz.now()
        self.db.commit()
        self.db.refresh(notification)
        return notification

    def mark_all_as_read(self, user_id: int) -> int:
        """Mark all notifications as read for a user"""
        count = (
            self.db.query(models.UserNotification)
            .filter(
                and_(
                    models.UserNotification.user_id == user_id,
                    models.UserNotification.is_read == False,
                )
            )
            .update({"is_read": True, "read_date": tz.now()})
        )
        self.db.commit()
        return count

    def delete_notification(self, notification_id: int, user_id: int):
        """Delete a notification"""
        notification = (
            self.db.query(models.UserNotification)
            .filter(
                and_(
                    models.UserNotification.id == notification_id,
                    models.UserNotification.user_id == user_id,
                )
            )
            .first()
        )

        if not notification:
            raise HTTPException(status_code=404, detail="Notification not found")

        self.db.delete(notification)
        self.db.commit()

    def get_notification_stats(self, user_id: int) -> schemas.NotificationStats:
        """Get notification statistics"""
        total = (
            self.db.query(func.count(models.UserNotification.id))
            .filter(models.UserNotification.user_id == user_id)
            .scalar()
            or 0
        )

        unread = (
            self.db.query(func.count(models.UserNotification.id))
            .filter(
                and_(
                    models.UserNotification.user_id == user_id,
                    models.UserNotification.is_read == False,
                )
            )
            .scalar()
            or 0
        )

        return schemas.NotificationStats(
            total=total, unread=unread, read=total - unread
        )


class PreferencesService:
    def __init__(self, db: Session):
        self.db = db

    def get_user_preferences(self, user_id: int) -> models.UserPreferences:
        """Get user preferences, create default if not exists"""
        preferences = (
            self.db.query(models.UserPreferences)
            .filter(models.UserPreferences.user_id == user_id)
            .first()
        )

        if not preferences:
            preferences = models.UserPreferences(user_id=user_id)
            self.db.add(preferences)
            self.db.commit()
            self.db.refresh(preferences)

        return preferences

    def update_user_preferences(
        self, user_id: int, preferences_update: schemas.UserPreferencesUpdate
    ) -> models.UserPreferences:
        """Update user preferences"""
        preferences = self.get_user_preferences(user_id)

        update_data = preferences_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(preferences, field, value)

        preferences.updated_date = tz.now()
        self.db.commit()
        self.db.refresh(preferences)
        return preferences


class ProfileService:
    def __init__(self, db: Session):
        self.db = db

    def update_profile(self, user_id: int, profile_update: schemas.ProfileUpdate):
        """Update user profile"""
        from app.auth.models import User

        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        update_data = profile_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(user, field, value)

        self.db.commit()
        self.db.refresh(user)
        return user

    def change_password(self, user_id: int, password_change: schemas.PasswordChange):
        """Change user password"""
        from app.auth.models import User

        if password_change.new_password != password_change.confirm_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Passwords do not match"
            )

        user = self.db.query(User).filter(User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        if not verify_password(password_change.current_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is incorrect",
            )

        user.hashed_password = get_password_hash(password_change.new_password)
        self.db.commit()
        return {"message": "Password changed successfully"}


class CompanySettingsService:
    def __init__(self, db: Session):
        self.db = db

    def get_company_settings(self) -> models.Settings:
        # Assuming only one company settings record per tenant/installation
        settings = self.db.query(models.Settings).first()
        if not settings:
            # Advisory-lock the check-then-create so two concurrent first
            # requests (e.g. right after a fresh deploy) can't both find no
            # row and both insert a default one.
            self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext('company_settings_singleton'))"))
            settings = self.db.query(models.Settings).first()
            if not settings:
                settings = models.Settings(
                    company_name="Tijaero Default",
                    company_address="Default Address",
                    company_email="admin@tijaero.local",
                )
                self.db.add(settings)
                self.db.commit()
                self.db.refresh(settings)
        return settings

    def update_company_settings(
        self, settings_update: schemas.CompanySettingsUpdate
    ) -> models.Settings:
        settings = self.get_company_settings()
        update_data = settings_update.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(settings, field, value)

        self.db.commit()
        self.db.refresh(settings)
        return settings
