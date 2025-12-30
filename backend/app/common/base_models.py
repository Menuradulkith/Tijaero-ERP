from sqlalchemy import Column, DateTime, Integer, String
from datetime import datetime

class TimestampMixin:
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

class AuditMixin(TimestampMixin):
    created_by = Column(Integer, nullable=True)
    updated_by = Column(Integer, nullable=True)
