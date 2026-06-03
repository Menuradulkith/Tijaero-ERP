"""
Centralized Timezone Configuration for TijaeroERP.

Import as:  from app.core import timezone as tz

Then use:
  tz.now()          → naive local datetime (for DB TIMESTAMP columns)
  tz.today()        → local date
  tz.year()         → current local year (int)
  tz.date_prefix()  → today as "20260212" string
  tz.format_now()   → formatted local datetime string
  tz.now_aware()    → timezone-aware local datetime (rarely needed)
  tz.LOCAL_TZ       → the system timezone object

The ERP uses the system's local time.
This ensures every timestamp — invoice dates, GL postings, payroll,
approvals, audit logs — uses the same consistent clock.
"""

from datetime import date as _date, datetime as _dt, timezone as _tz, timedelta as _timedelta
from app.core.config import settings

# ──────────────────────────────────────────────────────────────────────────────
# System Local Time
# Uses the server's configured timezone automatically, or defaults to Colombo if configured.
# ──────────────────────────────────────────────────────────────────────────────
if settings.TIMEZONE == "Asia/Colombo":
    LOCAL_TZ = _tz(_timedelta(hours=5, minutes=30), name="Asia/Colombo")
else:
    LOCAL_TZ = _dt.now(_tz.utc).astimezone().tzinfo

# Keep SL_TZ as alias for backward compatibility
SL_TZ = LOCAL_TZ


def now_aware() -> _dt:
    """Return the current datetime in the system's local timezone (aware)."""
    return _dt.now(LOCAL_TZ)


def now() -> _dt:
    """
    Return the current local wall-clock time as a *naive* datetime.
    This is the primary function — use for all DB columns
    (TIMESTAMP WITHOUT TIME ZONE).
    """
    return _dt.now(LOCAL_TZ).replace(tzinfo=None)


def today() -> _date:
    """Return today's date in the system's local timezone."""
    return now_aware().date()


def year() -> int:
    """Return the current year in the system's local timezone."""
    return today().year


def date_prefix(fmt: str = "%Y%m%d") -> str:
    """Return today as a string prefix (e.g. '20260212')."""
    return today().strftime(fmt)


def format_now(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Return the current local time as a formatted string."""
    return now().strftime(fmt)


# ──────────────────────────────────────────────────────────────────────────────
# SQLAlchemy helper – use in Column(server_default=...)
# ──────────────────────────────────────────────────────────────────────────────
from sqlalchemy import text as _sa_text  # noqa: E402

db_now = _sa_text("NOW()")
"""
Use as server_default for TIMESTAMP columns so PostgreSQL itself
generates the local time:

    created_at = Column(TIMESTAMP, server_default=db_now)
"""
