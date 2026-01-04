from sqlalchemy import Column, Integer, String, Text, Enum as SQLEnum, ForeignKey, Date, Boolean, TIMESTAMP, Numeric, BigInteger
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


class CustomerAdvancePayments(Base):
    __tablename__ = "customer_advance_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    advance_payments_no = Column(String(200), unique=True, nullable=False)
    payment_method = Column(String(30), nullable=False)
    branch_code = Column(String(200), nullable=False)
    payment_amount = Column(Numeric(60, 2), nullable=False)
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    cheque_date = Column(Date, nullable=False)
    active = Column(Boolean, nullable=False)
    
    # Relationships
    customer = relationship("Customer", back_populates="advance_payments")
    invoices = relationship("Invoice", back_populates="advance_payment")


class CustomerCreditNotes(Base):
    __tablename__ = "customer_credit_notes"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    date = Column(TIMESTAMP, nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    remark = Column(Text, nullable=False)
    invoice_no = Column(String(200))
    
    # Relationships
    customer = relationship("Customer", back_populates="credit_notes")
    invoices = relationship("Invoice", back_populates="credit_note")


class CustomerCreditsSettle(Base):
    __tablename__ = "customer_credits_settle"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_credits_settle_no = Column(String(200), unique=True, nullable=False)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    
    # Relationships
    customer = relationship("Customer", back_populates="credits_settle")
    transactions = relationship("CustomerCreditsSettleTransaction", back_populates="credit_settle")


class CustomerCreditsSettleTransaction(Base):
    __tablename__ = "customer_credits_settle_transaction"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_method = Column(String(30), nullable=False)
    cheque_date = Column(Date, nullable=False)
    payment_amount = Column(Numeric(60, 2), nullable=False)
    payment_method_number = Column(String(300))
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    customer_credit_settle_id = Column(Integer, ForeignKey("customer_credits_settle.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    
    # Relationships
    credit_settle = relationship("CustomerCreditsSettle", back_populates="transactions")
    invoice = relationship("Invoice", back_populates="credits_settle_transactions")


class CustomerCuponCodes(Base):
    __tablename__ = "customer_cupon_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    cupon_code = Column(String(10), nullable=False)
    limit_by_usage = Column(Integer, nullable=False, default=1000)
    limit_for_customer = Column(Integer, nullable=False, default=10)
    valid_until_date = Column(Date, nullable=False)
    limit_validity_product_id = Column(Integer, ForeignKey("products.id"))
    
    # Relationships
    product = relationship("Product", back_populates="cupon_codes")
    invoices = relationship("Invoice", back_populates="cupon")


class CustomerGiftVoucher(Base):
    __tablename__ = "customer_gift_voucher"
    
    id = Column(Integer, primary_key=True, index=True)
    date = Column(Date, nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    barcode_no = Column(Integer, nullable=False)
    valid_period_in_months = Column(Integer, nullable=False, default=12)
    claimed_date = Column(TIMESTAMP)
    purchased_invoice_no = Column(String(200))
    claimed_invoice_no = Column(String(200))


# NOTE: CustomerSupport, CustomerCallLog, and CSJobItem models are defined in
# app.modules.support.models to avoid duplication.
# Import them from there when needed:
# from app.modules.support.models import CustomerSupport, CustomerCallLog, CSJobItem
