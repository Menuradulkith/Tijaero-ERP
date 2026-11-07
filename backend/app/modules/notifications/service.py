"""Notification service: inbox queries + fan-out dispatch.

The same :class:`NotificationService` is used two ways:

* by the API (with the request-scoped ``db``) for listing / read-state changes;
* by :mod:`app.modules.notifications.dispatcher` (with its own short-lived
  session) to create notifications from business events.

Dispatch is *fan-out on write*: one :class:`Notification` row holds the content
and one :class:`NotificationRecipient` row is created per target user.
"""

import logging
from typing import Iterable, List, Optional, Sequence

logger = logging.getLogger(__name__)

from fastapi import HTTPException, status
from sqlalchemy import and_, desc, func
from sqlalchemy.orm import Session

from app.auth.models import Branch, User, user_branches
from app.core import timezone as tz

from . import models, schemas


class NotificationService:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------ #
    # Inbox queries (per recipient)
    # ------------------------------------------------------------------ #
    def list_for_user(
        self,
        user_id: int,
        unread_only: bool = False,
        category: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> List[schemas.NotificationOut]:
        """Return a user's notifications (newest first) as merged DTOs."""
        query = (
            self.db.query(models.NotificationRecipient, models.Notification)
            .join(
                models.Notification,
                models.Notification.id
                == models.NotificationRecipient.notification_id,
            )
            .filter(models.NotificationRecipient.user_id == user_id)
        )

        if unread_only:
            query = query.filter(models.NotificationRecipient.is_read.is_(False))
        if category:
            query = query.filter(models.Notification.category == category)

        rows = (
            query.order_by(desc(models.Notification.created_date))
            .offset(skip)
            .limit(limit)
            .all()
        )

        return [self._to_out(recipient, notification) for recipient, notification in rows]

    def get_stats(self, user_id: int) -> schemas.NotificationStats:
        base = self.db.query(func.count(models.NotificationRecipient.id)).filter(
            models.NotificationRecipient.user_id == user_id
        )
        total = base.scalar() or 0
        unread = (
            base.filter(models.NotificationRecipient.is_read.is_(False)).scalar() or 0
        )
        return schemas.NotificationStats(
            total=total, unread=unread, read=total - unread
        )

    def mark_as_read(self, recipient_id: int, user_id: int) -> schemas.NotificationOut:
        recipient = self._get_owned_recipient(recipient_id, user_id)
        if not recipient.is_read:
            recipient.is_read = True
            recipient.read_date = tz.now()
            self.db.commit()
            self.db.refresh(recipient)
        notification = self.db.get(models.Notification, recipient.notification_id)
        return self._to_out(recipient, notification)

    def mark_all_as_read(self, user_id: int) -> int:
        count = (
            self.db.query(models.NotificationRecipient)
            .filter(
                and_(
                    models.NotificationRecipient.user_id == user_id,
                    models.NotificationRecipient.is_read.is_(False),
                )
            )
            .update(
                {"is_read": True, "read_date": tz.now()},
                synchronize_session=False,
            )
        )
        self.db.commit()
        return count

    def delete_for_user(self, recipient_id: int, user_id: int) -> None:
        recipient = self._get_owned_recipient(recipient_id, user_id)
        self.db.delete(recipient)
        self.db.commit()

    # ------------------------------------------------------------------ #
    # Dispatch (fan-out on write)
    # ------------------------------------------------------------------ #
    def dispatch(
        self,
        *,
        title: str,
        message: str,
        notification_type: str = "info",
        category: str = "system",
        action_url: Optional[str] = None,
        extra_data: Optional[dict] = None,
        branch_code: Optional[str] = None,
        user_ids: Optional[Iterable[int]] = None,
        broadcast: bool = False,
        exclude_user_id: Optional[int] = None,
    ) -> Optional[models.Notification]:
        """Create a notification and deliver it to the resolved recipients.

        Recipients are the union of explicit ``user_ids``, every active user in
        ``branch_code``, and (when ``broadcast``) all active users. Returns the
        created :class:`Notification`, or ``None`` when there are no recipients.
        """
        recipient_ids = set(user_ids or [])
        # An explicit recipient list is not widened by the branch tag. Branch
        # fan-out is only for calls that name a branch and nobody else.
        if branch_code and not user_ids:
            recipient_ids.update(self._branch_user_ids(branch_code))
        if broadcast:
            recipient_ids.update(self._all_active_user_ids())
        if exclude_user_id is not None:
            recipient_ids.discard(exclude_user_id)
        recipient_ids = self._without_opt_outs(recipient_ids)

        if not recipient_ids:
            return None

        notification = models.Notification(
            title=title,
            message=message,
            notification_type=notification_type,
            category=category,
            action_url=action_url,
            extra_data=extra_data,
            branch_code=branch_code,
        )
        self.db.add(notification)
        self.db.flush()  # assign notification.id

        self.db.add_all(
            models.NotificationRecipient(
                notification_id=notification.id, user_id=uid
            )
            for uid in recipient_ids
        )
        self.db.commit()
        self.db.refresh(notification)
        self._email_copy(recipient_ids, title, message)
        return notification

    # ------------------------------------------------------------------ #
    # Internal helpers
    # ------------------------------------------------------------------ #
    def _get_owned_recipient(
        self, recipient_id: int, user_id: int
    ) -> models.NotificationRecipient:
        recipient = (
            self.db.query(models.NotificationRecipient)
            .filter(
                and_(
                    models.NotificationRecipient.id == recipient_id,
                    models.NotificationRecipient.user_id == user_id,
                )
            )
            .first()
        )
        if not recipient:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Notification not found",
            )
        return recipient

    def _without_opt_outs(self, user_ids: set) -> set:
        """Drop users who turned in-app notifications off. Missing prefs stay on."""
        if not user_ids:
            return user_ids
        from app.modules.settings.models import UserPreferences

        disabled = {
            uid
            for (uid,) in self.db.query(UserPreferences.user_id).filter(
                UserPreferences.user_id.in_(list(user_ids)),
                UserPreferences.notifications_enabled.is_(False),
            )
        }
        return set(user_ids) - disabled

    def _email_copy(self, user_ids: set, title: str, message: str) -> None:
        """Best-effort email for users who left email notifications on.

        Skipped entirely when SMTP is not configured, and never raises into
        the business transaction (the in-app row is already committed).
        """
        try:
            from app.core.config import settings

            if not (getattr(settings, "SMTP_HOST", "") and getattr(settings, "SMTP_FROM_EMAIL", "")):
                return
            from app.modules.settings.models import UserPreferences

            opted_out = {
                uid
                for (uid,) in self.db.query(UserPreferences.user_id).filter(
                    UserPreferences.user_id.in_(list(user_ids)),
                    UserPreferences.email_notifications.is_(False),
                )
            }
            targets = [uid for uid in user_ids if uid not in opted_out]
            if not targets:
                return
            emails = [
                email
                for (email,) in self.db.query(User.email).filter(
                    User.id.in_(targets), User.email.isnot(None), User.email != ""
                )
            ]
            if not emails:
                return
            from app.core.email import send_plain_email

            send_plain_email(emails, title, message)
        except Exception:
            logger.exception("Notification email failed (title=%r)", title)

    def _branch_user_ids(self, branch_code: str) -> Sequence[int]:
        rows = (
            self.db.query(User.id)
            .join(user_branches, user_branches.c.user_id == User.id)
            .join(Branch, Branch.id == user_branches.c.branches_id)
            .filter(Branch.branch_code == branch_code, User.is_active.is_(True))
            .all()
        )
        return [r[0] for r in rows]

    def _all_active_user_ids(self) -> Sequence[int]:
        rows = self.db.query(User.id).filter(User.is_active.is_(True)).all()
        return [r[0] for r in rows]

    @staticmethod
    def _to_out(
        recipient: models.NotificationRecipient,
        notification: models.Notification,
    ) -> schemas.NotificationOut:
        return schemas.NotificationOut(
            id=recipient.id,
            notification_id=notification.id,
            title=notification.title,
            message=notification.message,
            notification_type=notification.notification_type,
            category=notification.category,
            action_url=notification.action_url,
            extra_data=notification.extra_data,
            branch_code=notification.branch_code,
            is_read=recipient.is_read,
            created_date=notification.created_date,
            read_date=recipient.read_date,
        )
