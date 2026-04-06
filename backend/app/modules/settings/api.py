from typing import List

from app.auth.dependencies import get_current_user
from app.auth.models import User
from app.db.session import get_db
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from . import schemas, service

router = APIRouter(prefix="/settings", tags=["settings"])


# Notification Endpoints
@router.get("/notifications", response_model=List[schemas.Notification])
def get_notifications(
    unread_only: bool = Query(False),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Get user notifications"""
    notification_service = service.NotificationService(db)
    return notification_service.get_user_notifications(
        user_id=current_user.id, unread_only=unread_only, skip=skip, limit=limit
    )


@router.get("/notifications/stats", response_model=schemas.NotificationStats)
def get_notification_stats(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Get notification statistics"""
    notification_service = service.NotificationService(db)
    return notification_service.get_notification_stats(current_user.id)


@router.put(
    "/notifications/{notification_id}/read", response_model=schemas.Notification
)
def mark_notification_as_read(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Mark notification as read"""
    notification_service = service.NotificationService(db)
    return notification_service.mark_as_read(notification_id, current_user.id)


@router.put("/notifications/read-all")
def mark_all_notifications_as_read(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Mark all notifications as read"""
    notification_service = service.NotificationService(db)
    count = notification_service.mark_all_as_read(current_user.id)
    return {"message": f"Marked {count} notifications as read"}


@router.delete("/notifications/{notification_id}")
def delete_notification(
    notification_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a notification"""
    notification_service = service.NotificationService(db)
    notification_service.delete_notification(notification_id, current_user.id)
    return {"message": "Notification deleted"}


# User Preferences Endpoints
@router.get("/preferences", response_model=schemas.UserPreferences)
def get_preferences(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Get user preferences"""
    preferences_service = service.PreferencesService(db)
    return preferences_service.get_user_preferences(current_user.id)


@router.put("/preferences", response_model=schemas.UserPreferences)
def update_preferences(
    preferences: schemas.UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user preferences"""
    preferences_service = service.PreferencesService(db)
    return preferences_service.update_user_preferences(current_user.id, preferences)


# Profile Endpoints
@router.put("/profile")
def update_profile(
    profile: schemas.ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update user profile"""
    profile_service = service.ProfileService(db)
    return profile_service.update_profile(current_user.id, profile)


@router.post("/change-password")
def change_password(
    password_change: schemas.PasswordChange,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change user password"""
    profile_service = service.ProfileService(db)
    return profile_service.change_password(current_user.id, password_change)


# Company Settings Endpoints
@router.get("/company", response_model=schemas.CompanySettings)
def get_company_settings(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Get company wide settings"""
    # Later add a specific check for admin if needed
    comp_service = service.CompanySettingsService(db)
    return comp_service.get_company_settings()


@router.put("/company", response_model=schemas.CompanySettings)
def update_company_settings(
    settings_update: schemas.CompanySettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update company wide settings"""
    # Later add a specific check for admin if needed
    comp_service = service.CompanySettingsService(db)
    return comp_service.update_company_settings(settings_update)
