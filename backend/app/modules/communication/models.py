from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
from app.db.base import Base
from app.common.base_models import AuditMixin
from app.core import timezone as tz

class EmailTemplate(Base, AuditMixin):
    """Stores email templates for different document types."""
    __tablename__ = "communication_email_templates"

    id = Column(Integer, primary_key=True, index=True)
    document_type = Column(String(50), nullable=False, unique=True, index=True)
    subject_template = Column(String(255), nullable=False)
    body_template = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)


class EmailLog(Base, AuditMixin):
    """Tracks status of sent emails."""
    __tablename__ = "communication_email_logs"

    id = Column(Integer, primary_key=True, index=True)
    document_type = Column(String(50), nullable=False) # e.g. quotation, proforma, sales-order, invoice
    document_id = Column(Integer, nullable=False)
    display_id = Column(String(200), nullable=True, index=True)
    to_email = Column(String(255), nullable=False)
    cc_email = Column(String(255), nullable=True)
    subject = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending, sent, failed
    error_message = Column(Text, nullable=True)
    sent_at = Column(DateTime, nullable=True)
