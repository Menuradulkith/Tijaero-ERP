"""SQLAlchemy models for the notification system."""

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.common.base_models import AuditMixin
from app.core import timezone as tz
from app.db.base import Base


class Notification(Base, AuditMixin):
    """A single notification message (content), created once per event.

    Delivery to individual users is handled by :class:`NotificationRecipient`
    so the same message can fan out to one user, to every user in a branch, or
    to everyone (broadcast) while keeping per-user read state.
    """

    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    # info | success | warning | error
    notification_type = Column(String(50), nullable=False, default="info")
    # Functional area: system, sales, purchasing, inventory, warehouse,
    # finance, hr, support, approvals ...
    category = Column(String(50), nullable=False, default="system", index=True)
    # Optional deep-link the UI navigates to when the notification is clicked.
    action_url = Column(String(500))
    # Arbitrary structured payload (entity ids, amounts, etc.).
    extra_data = Column(JSON)
    # The branch this notification relates to (NULL for user-targeted or
    # global/broadcast notifications). Enables branch-scoped filtering/auditing.
    branch_code = Column(String(255), index=True)
    created_date = Column(DateTime, default=tz.now, nullable=False, index=True)

    recipients = relationship(
        "NotificationRecipient",
        back_populates="notification",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class NotificationRecipient(Base, AuditMixin):
    """Per-user delivery + read state for a :class:`Notification`."""

    __tablename__ = "notification_recipients"

    id = Column(Integer, primary_key=True, index=True)
    notification_id = Column(
        Integer,
        ForeignKey("notifications.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer, ForeignKey("accounts_user.id"), nullable=False, index=True
    )
    is_read = Column(Boolean, default=False, nullable=False)
    read_date = Column(DateTime)

    notification = relationship("Notification", back_populates="recipients")

    __table_args__ = (
        UniqueConstraint(
            "notification_id", "user_id", name="uq_notification_recipient"
        ),
        # Hot path: unread badge/count and inbox listing per user.
        Index("ix_notification_recipient_user_unread", "user_id", "is_read"),
    )
