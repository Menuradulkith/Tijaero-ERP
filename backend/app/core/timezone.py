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

The ERP uses a configurable timezone (Settings.default_timezone, managed via
Settings > Company Configuration > Company Details), defaulting to Asia/Colombo.
This ensures every timestamp — invoice dates, GL postings, payroll,
approvals, audit logs — uses the same consistent clock.
"""

from datetime import date as _date, datetime as _dt
from zoneinfo import ZoneInfo as _ZoneInfo
from app.core.config import settings

# ──────────────────────────────────────────────────────────────────────────────
# System Local Time
# Uses the ERP's configured timezone (Settings.default_timezone), defaulting to
# the app config's TIMEZONE (itself defaulting to "Asia/Colombo") until the
# company settings singleton is loaded at startup. Mutable so that changing
# the setting takes effect immediately in this process — see set_timezone().
# ──────────────────────────────────────────────────────────────────────────────
LOCAL_TZ = _ZoneInfo(settings.TIMEZONE or "Asia/Colombo")

# Keep SL_TZ as alias for backward compatibility
SL_TZ = LOCAL_TZ


def set_timezone(tz_name: str) -> None:
    """Update the ERP's active timezone in-process.

    Called after Settings.default_timezone changes so that subsequent
    tz.now() calls (audit timestamps, PDF generation, reports) immediately
    reflect the new zone without a process restart. Note: with multiple
    worker processes, only the worker that handles the update (or a worker
    that re-reads company settings on its own next request) picks this up —
    other workers keep their previous zone until they do the same.
    """
    global LOCAL_TZ, SL_TZ
    LOCAL_TZ = _ZoneInfo(tz_name)
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
