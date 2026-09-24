"""
Centralized audit logging for TijaeroERP.

Usage:
    from app.common.audit import log_audit
    log_audit(db, user_id=user.id, action="create", entity_type="invoice", entity_id=invoice.id, changes={"status": "approved"})
"""

import logging
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from typing import Any, Mapping

from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.orm import Session
from app.db.base import Base
from app.core import timezone as tz
from app.common.base_models import AuditMixin

logger = logging.getLogger(__name__)


def _json_safe(value: Any) -> Any:
    """Coerce a single field value into something the JSON audit-log column
    can store and the frontend can render directly (no Decimal/date/Enum)."""
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def diff_changes(
    before_values: Mapping[str, Any], submitted_fields: Mapping[str, Any]
) -> dict:
    """Build the `changes` payload for an "update" audit log entry: for every
    field in `submitted_fields` whose value actually differs from
    `before_values`, record both the old and new value (JSON-safe) so the
    activity history panel can render "old -> new" instead of just the field
    name. Returns {} if nothing actually changed.
    """
    changed = {
        field: {"old": _json_safe(before_values.get(field)), "new": _json_safe(new_value)}
        for field, new_value in submitted_fields.items()
        if before_values.get(field) != new_value
    }
    if not changed:
        return {}
    return {"fields": sorted(changed.keys()), "values": changed}


class AuditLog(Base, AuditMixin):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=False, index=True)
    entity_id = Column(Integer, nullable=False)
    changes = Column(JSON)
    timestamp = Column(DateTime, default=tz.now)


def log_audit(
    db: Session,
    user_id: int,
    action: str,
    entity_type: str,
    entity_id: int,
    changes: dict | None = None,
) -> None:
    """Record an audit log entry.  Uses flush (not commit) so the log
    entry participates in the caller's transaction."""
    try:
        log = AuditLog(
            user_id=user_id,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            changes=changes,
        )
        db.add(log)
        db.flush()
    except Exception:
        logger.warning("Failed to write audit log for %s:%s", entity_type, entity_id, exc_info=True)
