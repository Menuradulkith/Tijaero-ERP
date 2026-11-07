"""Daily operational digests.

There is no job runner in the project. A daemon thread started with the app
checks once an hour and sends the low-stock, receivables, and material-shortage
digests at most once per local day. A marker row with no recipients records
that today's check already ran, so the bell stays quiet.
"""

from __future__ import annotations

import logging
import os
import sys
import threading
import time

logger = logging.getLogger(__name__)

_LOCK_KEY = 867530901


def start_digest_scheduler() -> None:
    if os.getenv("DISABLE_NOTIFICATION_DIGESTS") or "pytest" in sys.modules:
        return
    threading.Thread(target=_loop, name="notification-digests", daemon=True).start()


def _loop() -> None:
    time.sleep(45)
    while True:
        try:
            run_due_digests()
        except Exception:
            logger.exception("Notification digest scheduler failed")
        time.sleep(3600)


def run_due_digests() -> bool:
    """Send today's digests once. Returns True when this call performed the run."""
    from sqlalchemy import text

    from app.core import timezone as tz
    from app.db.session import SessionLocal

    from .alerts import (
        run_low_stock_digest,
        run_material_shortage_digest,
        run_outstanding_payments_digest,
    )
    from .models import Notification

    db = SessionLocal()
    try:
        locked = db.execute(text("SELECT pg_try_advisory_lock(:key)"), {"key": _LOCK_KEY}).scalar()
        if not locked:
            return False
        try:
            start = tz.now().replace(hour=0, minute=0, second=0, microsecond=0)
            already = (
                db.query(Notification.id)
                .filter(
                    Notification.created_date >= start,
                    Notification.extra_data["digest"].astext == "daily-check",
                )
                .first()
            )
            if already:
                return False
            db.add(
                Notification(
                    title="Daily digest check",
                    message="Operational alerts were checked for today.",
                    notification_type="info",
                    category="system",
                    extra_data={"digest": "daily-check"},
                )
            )
            db.commit()
        finally:
            db.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": _LOCK_KEY})
            db.commit()
    finally:
        db.close()

    run_low_stock_digest()
    run_outstanding_payments_digest()
    run_material_shortage_digest()
    return True
