from sqlalchemy import Column, Integer, String, Text, Enum as SQLEnum, ForeignKey, Date, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import AuditMixin
from app.modules.customers.enums import CustomerType

class Customer(Base, AuditMixin):
    __tablename__ = "customers"
    
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(30), nullable=False)
    customer_name = Column(String(255), nullable=False)
    name_in_cheque_card = Column(String(255))
    occupation = Column(String(255))
    company_name = Column(String(255))
    payment_address = Column(Text)
    delivery_address = Column(Text)
    bank_details = Column(Text)
    date_joined = Column(TIMESTAMP, nullable=False)
    birthdate = Column(Date)
    id_card_number = Column(String(12))
    gender = Column(String(30), nullable=False)
    civil_status = Column(String(30), nullable=False)
    passport_no = Column(String(50))
    no_of_kids = Column(String(30), nullable=False)
    email = Column(String(75))
    home_contact_number = Column(String(12))
    mobile_contact_number = Column(String(12), nullable=False)
    credit_days = Column(Integer, nullable=False)
    max_credit_limit = Column(Integer, nullable=False)
    left_credit_amount = Column(Integer)
    active = Column(Boolean, nullable=False)
    country_id = Column(Integer, ForeignKey("country.id"))
    initial_credit_amount = Column(Integer)
    is_customer_agent = Column(Boolean, nullable=False, default=False)
    
    # Relationships
    country = relationship("Country", back_populates="customers")
    invoices = relationship("Invoice", foreign_keys="Invoice.customer_id", back_populates="customer")
    agent_invoices = relationship("Invoice", foreign_keys="Invoice.customer_agent_id", back_populates="customer_agent")
    advance_payments = relationship("CustomerAdvancePayments", back_populates="customer")
    credits_settle = relationship("CustomerCreditsSettle", back_populates="customer")
    support_tickets = relationship("CustomerSupport", back_populates="customer")
    credit_notes = relationship("CustomerCreditNotes", back_populates="customer")
