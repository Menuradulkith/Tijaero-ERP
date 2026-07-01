"""
Debtors Management Models

Models for tracking invoice payments and customer follow-ups for debtors management.
"""

from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, Numeric, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import AuditMixin


class FollowupType(str, Enum):
    """Types of customer follow-ups"""
    CALL = "call"
    EMAIL = "email"
    SMS = "sms"
    VISIT = "visit"
    REMINDER = "reminder"


class InvoicePayment(Base, AuditMixin):
    """Track individual payments made against invoices"""
    __tablename__ = "invoice_payments"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    amount = Column(Numeric(60, 2), nullable=False)
    payment_date = Column(Date, nullable=False, index=True)
    payment_method = Column(String(50), nullable=False)  # bank_transfer, cheque, cash, credit_card, online
    reference_no = Column(String(100), nullable=True)    # cheque number, transaction ID, etc.
    notes = Column(Text, nullable=True)
    branch_code = Column(String(200), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, nullable=True)

    # Relationships
    invoice = relationship("Invoice", back_populates="invoice_payments", foreign_keys=[invoice_id])
    customer = relationship("Customer", back_populates="invoice_payments", foreign_keys=[customer_id])


class CustomerFollowup(Base, AuditMixin):
    """Track follow-up interactions with customers regarding payments"""
    __tablename__ = "customer_followups"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id", ondelete="CASCADE"), nullable=False, index=True)
    followup_date = Column(Date, nullable=False, index=True)
    followup_type = Column(String(20), nullable=False)  # call, email, sms, visit, reminder
    notes = Column(Text, nullable=False)
    amount_promised = Column(Numeric(60, 2), nullable=True)  # Amount customer promised to pay
    promised_payment_date = Column(Date, nullable=True)      # When customer promised to pay
    branch_code = Column(String(200), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = Column(Integer, nullable=True)
    is_resolved = Column(Integer, nullable=False, default=0)  # 1 = resolved, 0 = pending

    # Relationships
    customer = relationship("Customer", back_populates="customer_followups", foreign_keys=[customer_id])
