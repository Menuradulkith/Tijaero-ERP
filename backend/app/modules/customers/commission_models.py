"""
Customer Agent Commission Models
- CustomerAgentCommission: Tracks commission earned per invoice
- CustomerAgentCommissionPayment: Payment records for agent commissions
- CustomerAgentCommissionPaymentItem: Links payments to specific commissions
"""

from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, TIMESTAMP, func
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import AuditMixin


class CustomerAgentCommission(Base, AuditMixin):
    __tablename__ = "customer_agent_commissions"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    customer_agent_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    represented_customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    invoice_amount = Column(Numeric(60, 2), nullable=False)
    commission_type = Column(String(20), nullable=False)  # 'PERCENT' or 'AMOUNT'
    commission_rate = Column(Numeric(5, 2), nullable=True)  # percentage if type is PERCENT
    commission_amount = Column(Numeric(60, 2), nullable=False)
    status = Column(String(30), nullable=False, default="pending")  # pending, approved, paid
    approved_by = Column(Integer, nullable=True)
    approved_date = Column(TIMESTAMP, nullable=True)
    remarks = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())
    updated_at = Column(TIMESTAMP, server_default=func.now(), onupdate=func.now())

    # Relationships
    invoice = relationship("Invoice", backref="agent_commissions")
    customer_agent = relationship("Customer", foreign_keys=[customer_agent_id], backref="commissions_as_agent")
    represented_customer = relationship("Customer", foreign_keys=[represented_customer_id], backref="commissions_as_represented")
    payment_items = relationship("CustomerAgentCommissionPaymentItem", back_populates="commission")


class CustomerAgentCommissionPayment(Base, AuditMixin):
    __tablename__ = "customer_agent_commission_payments"

    id = Column(Integer, primary_key=True, index=True)
    payment_no = Column(String(200), unique=True, nullable=False)
    customer_agent_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    payment_date = Column(Date, nullable=False)
    payment_method = Column(String(30), nullable=False)  # Cash, Bank Transfer, Cheque
    payment_amount = Column(Numeric(60, 2), nullable=False)
    reference_number = Column(String(300), nullable=True)
    bank_name = Column(String(255), nullable=True)
    branch_code = Column(String(200), nullable=False)
    remarks = Column(Text, nullable=True)
    status = Column(String(30), nullable=False, default="pending")  # pending, verified, cancelled
    verified_by = Column(Integer, nullable=True)
    verified_date = Column(TIMESTAMP, nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(TIMESTAMP, server_default=func.now())

    # Relationships
    customer_agent = relationship("Customer", foreign_keys=[customer_agent_id], backref="commission_payments")
    items = relationship("CustomerAgentCommissionPaymentItem", back_populates="payment", cascade="all, delete-orphan")


class CustomerAgentCommissionPaymentItem(Base, AuditMixin):
    __tablename__ = "customer_agent_commission_payment_items"

    id = Column(Integer, primary_key=True, index=True)
    payment_id = Column(Integer, ForeignKey("customer_agent_commission_payments.id"), nullable=False)
    commission_id = Column(Integer, ForeignKey("customer_agent_commissions.id"), nullable=False)
    paid_amount = Column(Numeric(60, 2), nullable=False)
    created_at = Column(TIMESTAMP, server_default=func.now())

    # Relationships
    payment = relationship("CustomerAgentCommissionPayment", back_populates="items")
    commission = relationship("CustomerAgentCommission", back_populates="payment_items")
