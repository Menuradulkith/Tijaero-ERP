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


def diff_line_items(
    before_items: list,
    after_items: list,
    key_field: str = "product_id",
    tracked_fields: tuple = ("quantity", "unit_price"),
) -> list:
    """Diff two line-item lists that get wholesale deleted + recreated on
    every save (quote items, PO items, ...) — they have no stable id across
    an edit, so lines are matched by `key_field` (their product) instead.
    Returns a list of per-line entries: {key, action: "added"/"removed"/
    "changed", item: {...} | changes: {field: {old, new}}}, empty if nothing
    changed. Caller attaches a display label (e.g. product_name) per `key`,
    since this module has no DB access of its own.
    """
    def _group(items: list) -> dict:
        grouped: dict = {}
        for item in items:
            grouped.setdefault(item.get(key_field), []).append(item)
        return grouped

    before_by_key = _group(before_items)
    after_by_key = _group(after_items)

    entries = []
    seen_keys = set()
    for key in list(before_by_key.keys()) + list(after_by_key.keys()):
        if key in seen_keys:
            continue
        seen_keys.add(key)
        befores = before_by_key.get(key, [])
        afters = after_by_key.get(key, [])
        for i in range(max(len(befores), len(afters))):
            before = befores[i] if i < len(befores) else None
            after = afters[i] if i < len(afters) else None
            if before is None:
                entries.append({
                    "key": key,
                    "action": "added",
                    "item": {f: _json_safe(after.get(f)) for f in tracked_fields if f in after},
                })
            elif after is None:
                entries.append({
                    "key": key,
                    "action": "removed",
                    "item": {f: _json_safe(before.get(f)) for f in tracked_fields if f in before},
                })
            else:
                field_changes = {
                    f: {"old": _json_safe(before.get(f)), "new": _json_safe(after.get(f))}
                    for f in tracked_fields
                    if before.get(f) != after.get(f)
                }
                if field_changes:
                    entries.append({"key": key, "action": "changed", "changes": field_changes})
    return entries


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
    entry participates in the caller's transaction.

    The caller's own pending changes are flushed first, *outside* the try: a
    problem there (e.g. a unique-constraint violation from a concurrent
    request) belongs to the caller. Swallowing it here as an "audit failure"
    used to leave the session in a failed state and turn a clean 400 into a 500.
    """
    db.flush()
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
