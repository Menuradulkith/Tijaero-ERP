from sqlalchemy import Column, DateTime, Integer, String


def _sl_now():
    """Current Sri Lankan local time (Asia/Colombo, UTC+5:30) as a naive
    datetime. Imported lazily to avoid a circular import
    (config → base_models → timezone → config)."""
    from app.core import timezone as tz
    return tz.now()


class TimestampMixin:
    # Use Sri Lankan local time for all timestamps, not UTC.
    created_at = Column(DateTime, default=_sl_now, nullable=False)
    updated_at = Column(DateTime, default=_sl_now, onupdate=_sl_now, nullable=False)

class AuditMixin(TimestampMixin):
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)
