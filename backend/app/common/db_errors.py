"""Readable text for database errors that are stored or shown to users."""
from __future__ import annotations

import re
from typing import Optional

# SQLAlchemy appends the statement, its parameters and a docs link to str(DBAPIError).
_SQLALCHEMY_TAIL_MARKERS = ("[SQL:", "[parameters:", "(Background on this error")
_DRIVER_CLASS_PREFIX = re.compile(r"^\((?:[A-Za-z_][\w]*\.)*[A-Za-z_][\w]*\)\s*")


def sanitize_db_error(message: Optional[str]) -> Optional[str]:
    """Drop the SQL statement, bound parameters, docs link and the leading
    "(psycopg.errors.X)" class name, keeping the human-readable part, e.g.
    "value too long for type character varying(355)"."""
    if not message:
        return message
    text = str(message)
    cut = min((i for i in (text.find(m) for m in _SQLALCHEMY_TAIL_MARKERS) if i >= 0), default=len(text))
    text = _DRIVER_CLASS_PREFIX.sub("", text[:cut].strip()).strip()
    return text or "Database error"
