"""Pydantic schemas for the notification system."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.common.base_schemas import TijaeroBaseSchema

# Allowed notification severities and a small helper for validation.
NOTIFICATION_TYPES = ("info", "success", "warning", "error")


class NotificationOut(TijaeroBaseSchema):
    """A notification as seen by a single recipient (content + read state)."""

    # Recipient row id — this is what the client uses to mark-read / delete,
    # so each user only ever acts on their own copy.
    id: int = Field(..., description="Recipient id (per-user delivery row)")
    notification_id: int
    title: str
    message: str
    notification_type: str
    category: str
    action_url: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = None
    branch_code: Optional[str] = None
    is_read: bool
    created_date: datetime
    read_date: Optional[datetime] = None


class NotificationStats(BaseModel):
    total: int
    unread: int
    read: int


class NotificationCreate(BaseModel):
    """Admin/manual notification payload.

    At least one target must be provided: ``user_ids``, ``branch_codes`` or
    ``broadcast=True``.
    """

    title: str = Field(..., min_length=1, max_length=200)
    message: str = Field(..., min_length=1, max_length=5000)
    notification_type: str = "info"
    category: str = Field("system", min_length=1, max_length=50)
    # An in-app path ("/sales/orders") or an http(s) link; never javascript: and the like.
    action_url: Optional[str] = Field(None, max_length=500)
    extra_data: Optional[Dict[str, Any]] = None

    # Targeting
    user_ids: Optional[List[int]] = None
    branch_codes: Optional[List[str]] = None
    broadcast: bool = False

    @field_validator("title", "message", "category", mode="before")
    @classmethod
    def _strip(cls, v):
        return v.strip() if isinstance(v, str) else v

    @field_validator("action_url")
    @classmethod
    def _safe_url(cls, v: Optional[str]) -> Optional[str]:
        if v is None or not v.strip():
            return None
        v = v.strip()
        lower = v.lower()
        if (v.startswith("/") and not v.startswith("//")) or lower.startswith(("https://", "http://")):
            return v
        raise ValueError("action_url must be an in-app path starting with / or an http(s) link")

    @model_validator(mode="after")
    def _validate(self) -> "NotificationCreate":
        if self.notification_type not in NOTIFICATION_TYPES:
            raise ValueError(
                f"notification_type must be one of {NOTIFICATION_TYPES}"
            )
        if not self.user_ids and not self.branch_codes and not self.broadcast:
            raise ValueError(
                "Provide at least one target: user_ids, branch_codes, or broadcast=true"
            )
        return self


class MessageResponse(BaseModel):
    message: str
