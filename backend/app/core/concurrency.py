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


def next_document_number(
    db: Session,
    column,
    prefix: str,
    width: int = 6,
) -> str:
    """Next ``<prefix><zero-padded seq>`` for a unique document-number column.

    Serialises on ``prefix`` with an advisory lock, then continues from the
    highest numeric suffix already used (not the highest row id, which breaks
    after deletes or out-of-order imports). Rows whose suffix is not purely
    numeric are ignored. Callers must keep the column ``unique`` as a safety net.
    """
    import re

    from sqlalchemy import Integer, func

    advisory_xact_lock(db, prefix)
    pattern = "^" + re.escape(prefix) + "[0-9]+$"
    last_seq = (
        db.query(func.max(func.cast(func.substr(column, len(prefix) + 1), Integer)))
        .filter(column.like(f"{prefix}%"))
        .filter(column.op("~")(pattern))
        .scalar()
    )
    return f"{prefix}{(last_seq or 0) + 1:0{width}d}"


def next_plain_number(db: Session, column, key: str, width: int = 4) -> str:
    """Next zero-padded numeric string for a column with no prefix (e.g. a
    short brand code that has no room for one).

    Same advisory-lock/safety-net shape as ``next_document_number``, but
    without a prefix: only rows whose existing value is purely numeric count
    toward the sequence, so hand-typed legacy codes (e.g. "SONY") are ignored
    rather than breaking the cast.
    """
    from sqlalchemy import Integer, func

    advisory_xact_lock(db, key)
    last_seq = (
        db.query(func.max(func.cast(column, Integer)))
        .filter(column.op("~")("^[0-9]+$"))
        .scalar()
    )
    return f"{(last_seq or 0) + 1:0{width}d}"
