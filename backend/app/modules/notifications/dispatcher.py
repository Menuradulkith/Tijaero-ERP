"""Safe notification dispatch facade.

Business code anywhere in the ERP emits notifications through these helpers.
Design goals:

* **Never break business logic** – every call is wrapped so a notification
  failure is logged, not raised.
* **Transaction-isolated** – dispatch runs in its own short-lived session, so it
  can neither see-and-commit nor roll back the caller's transaction. Call these
  helpers *after* the business commit so the data the user is notified about is
  durable.
* **Import-light** – heavy imports are deferred to call time to avoid circular
  imports when low-level services notify.

Examples
--------
>>> from app.modules.notifications import dispatcher as notify
>>> notify.branch("BR01", title="New Sale", message="INV-1024 created (Rs. 25,000)",
...               category=notify.SALES, notification_type=notify.SUCCESS,
...               action_url="/sales/invoices/1024")
>>> notify.user(42, title="Payroll approved", message="June batch approved.",
...             category=notify.HR, notification_type=notify.SUCCESS)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)

# Severity levels --------------------------------------------------------------
INFO = "info"
SUCCESS = "success"
WARNING = "warning"
ERROR = "error"

# Functional categories (used for filtering + iconography on the client) -------
SYSTEM = "system"
SALES = "sales"
PURCHASING = "purchasing"
INVENTORY = "inventory"
WAREHOUSE = "warehouse"
FINANCE = "finance"
HR = "hr"
SUPPORT = "support"
APPROVALS = "approvals"


def _emit(
    *,
    title: str,
    message: str,
    notification_type: str,
    category: str,
    action_url: Optional[str],
    extra_data: Optional[Dict[str, Any]],
    branch_code: Optional[str],
    user_ids: Optional[Iterable[int]],
    broadcast: bool,
    exclude_user_id: Optional[int],
) -> None:
    """Run a dispatch in an isolated session, swallowing any error."""
    # Deferred imports keep this module import-safe from anywhere.
    from app.db.session import SessionLocal
    from .service import NotificationService

    db = SessionLocal()
    try:
        NotificationService(db).dispatch(
            title=title,
            message=message,
            notification_type=notification_type,
            category=category,
            action_url=action_url,
            extra_data=extra_data,
            branch_code=branch_code,
            user_ids=user_ids,
            broadcast=broadcast,
            exclude_user_id=exclude_user_id,
        )
    except Exception:  # pragma: no cover - defensive, must never bubble up
        logger.exception("Notification dispatch failed (title=%r)", title)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        db.close()


def user(
    user_id: int,
    *,
    title: str,
    message: str,
    notification_type: str = INFO,
    category: str = SYSTEM,
    action_url: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    branch_code: Optional[str] = None,
) -> None:
    """Notify a single user."""
    _emit(
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        extra_data=extra_data,
        branch_code=branch_code,
        user_ids=[user_id],
        broadcast=False,
        exclude_user_id=None,
    )


def users(
    user_ids: Iterable[int],
    *,
    title: str,
    message: str,
    notification_type: str = INFO,
    category: str = SYSTEM,
    action_url: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    branch_code: Optional[str] = None,
) -> None:
    """Notify an explicit set of users."""
    _emit(
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        extra_data=extra_data,
        branch_code=branch_code,
        user_ids=user_ids,
        broadcast=False,
        exclude_user_id=None,
    )


def branch(
    branch_code: str,
    *,
    title: str,
    message: str,
    notification_type: str = INFO,
    category: str = SYSTEM,
    action_url: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    exclude_user_id: Optional[int] = None,
) -> None:
    """Notify every active user assigned to ``branch_code``.

    ``exclude_user_id`` lets you skip the actor who triggered the event so they
    are not notified about their own action.
    """
    _emit(
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        extra_data=extra_data,
        branch_code=branch_code,
        user_ids=None,
        broadcast=False,
        exclude_user_id=exclude_user_id,
    )


def broadcast(
    *,
    title: str,
    message: str,
    notification_type: str = INFO,
    category: str = SYSTEM,
    action_url: Optional[str] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    exclude_user_id: Optional[int] = None,
) -> None:
    """Notify every active user in the system."""
    _emit(
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        extra_data=extra_data,
        branch_code=None,
        user_ids=None,
        broadcast=True,
        exclude_user_id=exclude_user_id,
    )
