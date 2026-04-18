"""
Concurrency helpers for service-layer code.

Provides convenience wrappers around PostgreSQL row locks and advisory
locks so callers don't have to remember the exact SQL.
"""

from __future__ import annotations

from typing import Optional, Type, TypeVar

from sqlalchemy import text
from sqlalchemy.orm import Session

T = TypeVar("T")


def lock_row(db: Session, model: Type[T], pk: int) -> Optional[T]:
    """``SELECT … FOR UPDATE`` on a primary-key row.

    Returns the locked row (or ``None`` if it does not exist).  The lock
    is released when the surrounding transaction commits/rolls back.
    """
    return db.query(model).filter(model.id == pk).with_for_update().first()


def advisory_xact_lock(db: Session, key: str) -> None:
    """Take a transaction-scoped Postgres advisory lock keyed by a string.

    Used for serialising things like document-number generation where
    row-level locks aren't available because the row doesn't yet exist.
    """
    db.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"),
        {"key": key},
    )
