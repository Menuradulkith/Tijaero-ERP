"""Optimistic-concurrency helpers shared by services that accept an
`expected_updated_at` on update (the "lost update" guard)."""
from datetime import datetime
from typing import Optional

from fastapi import HTTPException, status

from app.core import timezone as tz


def normalize_timestamp_for_compare(dt: Optional[datetime]) -> Optional[datetime]:
    """Make a DB-naive-local and a client-sent-aware `updated_at` comparable.

    Audit timestamps are stored naive (already local wall-clock time, per
    app.core.timezone), but the API serializes them with a UTC offset
    attached (see format_datetime), so a value round-tripped from the client
    comes back timezone-aware. Also truncate to whole seconds, matching the
    precision format_datetime actually sends the client (sub-second changes
    within the same second are not distinguishable to a caller either way)."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(tz.LOCAL_TZ).replace(tzinfo=None)
    return dt.replace(microsecond=0)


def is_unique_violation(exc: Exception) -> bool:
    """True only for a unique-constraint/index violation (SQLSTATE 23505) —
    not a foreign-key (23503), NOT NULL (23502) or check (23514) violation,
    which must not be reported to the user as "already exists"."""
    return getattr(getattr(exc, "orig", None), "sqlstate", None) == "23505"


def integrity_error_detail(exc: Exception) -> str:
    """User-facing message for an IntegrityError that is NOT a duplicate."""
    sqlstate = getattr(getattr(exc, "orig", None), "sqlstate", None)
    if sqlstate == "23503":
        return "A linked record (for example the selected category, brand or supplier) no longer exists. Refresh and try again."
    return "The data could not be saved because it breaks a database rule. Check the values and try again."


def version_token(dt: Optional[datetime]) -> Optional[str]:
    """Opaque, full-precision (microsecond) version of a row's updated_at.

    `updated_at` itself is sent to clients truncated to whole seconds (see
    format_datetime), so two saves inside the same second look identical.
    This token keeps the microseconds, so a client can echo it back as
    `expected_version` and every change is detectable. It's only ever
    compared against another token built from a DB-read value, never parsed."""
    return dt.isoformat() if dt is not None else None


def ensure_not_stale(
    current_updated_at: Optional[datetime],
    expected_updated_at: Optional[datetime],
    label: str,
    expected_version: Optional[str] = None,
) -> None:
    """Raise 409 if the row changed since the client loaded it.

    Prefers the exact `expected_version` token; falls back to the
    second-precision `expected_updated_at` for clients that only send that.
    No-op when the client sent neither (older/other callers)."""
    if expected_version is not None:
        stale = version_token(current_updated_at) != expected_version
    elif expected_updated_at is not None:
        stale = normalize_timestamp_for_compare(current_updated_at) != normalize_timestamp_for_compare(expected_updated_at)
    else:
        return
    if stale:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"{label} was modified by someone else since you loaded it. Refresh and try again.",
        )
