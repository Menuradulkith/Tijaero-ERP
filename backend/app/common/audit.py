"""
Centralized audit logging for TijaeroERP.

Usage:
    from app.common.audit import log_audit
    log_audit(db, user_id=user.id, action="create", entity_type="invoice", entity_id=invoice.id, changes={"status": "approved"})
"""

import logging
from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.orm import Session
from app.db.base import Base
from app.core import timezone as tz
from app.common.base_models import AuditMixin

logger = logging.getLogger(__name__)


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
