"""
Centralized Timezone Configuration for TijaeroERP.

Import as:  from app.core import timezone as tz

Then use:
  tz.now()          → naive SL datetime (for DB TIMESTAMP columns)
  tz.today()        → SL date
  tz.year()         → current SL year (int)
  tz.date_prefix()  → today as "20260212" string
  tz.format_now()   → formatted SL datetime string
  tz.now_aware()    → timezone-aware SL datetime (rarely needed)
  tz.SL_TZ          → the timezone object itself

The ERP runs on Asia/Colombo (Sri Lanka Standard Time, UTC+5:30).
This ensures every timestamp — invoice dates, GL postings, payroll,
approvals, audit logs — uses the same consistent clock.
"""

from datetime import date as _date, datetime as _dt, timezone as _tz, timedelta as _td

# ──────────────────────────────────────────────────────────────────────────────
# Sri Lanka Standard Time  (UTC+05:30)
# Using a fixed-offset timezone so we don't need pytz/zoneinfo.
# ──────────────────────────────────────────────────────────────────────────────
_OFFSET = _td(hours=5, minutes=30)
SL_TZ = _tz(_OFFSET, name="Asia/Colombo")


def now_aware() -> _dt:
    """Return the current datetime in Sri Lanka timezone (aware)."""
    return _dt.now(SL_TZ)


def now() -> _dt:
    """
    Return the current SL wall-clock time as a *naive* datetime.
    This is the primary function — use for all DB columns
    (TIMESTAMP WITHOUT TIME ZONE).
    """
    return now_aware().replace(tzinfo=None)


def today() -> _date:
    """Return today's date in Sri Lanka timezone."""
    return now_aware().date()


def year() -> int:
    """Return the current year in Sri Lanka timezone."""
    return now_aware().year


def date_prefix(fmt: str = "%Y%m%d") -> str:
    """Return today in Sri Lanka TZ as a string prefix (e.g. '20260212')."""
    return today().strftime(fmt)


def format_now(fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Return the current SL time as a formatted string."""
    return now_aware().strftime(fmt)


# ──────────────────────────────────────────────────────────────────────────────
# SQLAlchemy helper – use in Column(server_default=...)
# ──────────────────────────────────────────────────────────────────────────────
from sqlalchemy import text as _sa_text  # noqa: E402

db_now = _sa_text("(NOW() AT TIME ZONE 'Asia/Colombo')")
"""
Use as server_default for TIMESTAMP columns so PostgreSQL itself
generates the Sri Lanka time:

    created_at = Column(TIMESTAMP, server_default=db_now)
"""
