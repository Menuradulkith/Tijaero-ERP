from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin

class BankDeposits(Base):
    __tablename__ = "bank_deposits"
    
    id = Column(Integer, primary_key=True, index=True)
    deposits_amount = Column(Numeric(60, 2), nullable=False)
    remarks = Column(Text)
    created_date = Column(TIMESTAMP, nullable=False)
    branch_code = Column(String(200), nullable=False)
    bank_name = Column(String(20))
    user_id = Column(Integer, nullable=True)  # Made nullable, no FK for now
    payment_for = Column(Text)
    invoice_no = Column(String(200))
    verified = Column(Boolean, default=False)
    returned = Column(Boolean)
    
    # Relationships
    invoices = relationship("Invoice", back_populates="bank_transfer")

class CardPayments(Base):
    __tablename__ = "card_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    card_type = Column(String(10), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    date_time = Column(TIMESTAMP, nullable=False)
    remark = Column(Text)
    ref_number = Column(String(30))
    invoice_no = Column(String(200))
    deposited = Column(Boolean, nullable=False, default=True)
    
    # Relationships
    invoices = relationship("Invoice", back_populates="card_payment")

class ChequePayments(Base):
    __tablename__ = "cheque_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    cheque_number = Column(Numeric(10, 0), nullable=False)
    branch_code = Column(Integer, nullable=False)
    from_party = Column(String(50), nullable=False, name="from")
    bank = Column(String(20), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    cheque_date = Column(Date, nullable=False)
    deposit_date = Column(Date, nullable=False)
    remark = Column(String(255))
    payment_for = Column(Text)
    invoice_no = Column(String(200))
    
    # Relationships
    invoices = relationship("Invoice", back_populates="cheque_payment")

class CreditPayments(Base):
    __tablename__ = "credit_payments"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Relationships
    invoices = relationship("Invoice", back_populates="credit_payment")

class Vouchers(Base):
    __tablename__ = "vouchers"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # Relationships
    invoices = relationship("Invoice", back_populates="voucher")

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
    
    # Relationship
    customer = relationship("Customer", back_populates="credits_settle")

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
    invoice = relationship("Invoice", back_populates="credits_settle_transactions")

class SupplierCreditsSettle(Base):
    __tablename__ = "supplier_credits_settle"
    
    id = Column(Integer, primary_key=True, index=True)
    supplier_credits_settle_no = Column(String(200), nullable=False)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    suppliers_id = Column(Integer)

class SupplierCreditsSettleTransaction(Base):
    __tablename__ = "supplier_credits_settle_transaction"
    
    id = Column(Integer, primary_key=True, index=True)
    payment_method = Column(String(30), nullable=False)
    cheque_date = Column(Date, nullable=False)
    payment_amount = Column(Numeric(60, 2), nullable=False)
    payment_method_number = Column(String(300))
    remarks = Column(Text)
    created_date = Column(TIMESTAMP, nullable=False)
    good_received_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False)
    supplier_credit_settle_id = Column(Integer)
    
    # Relationships
    good_received_note = relationship("GoodReceivedNote", back_populates="supplier_credits_settle_transactions")

class Expenses(Base):
    __tablename__ = "expenses"
    
    id = Column(Integer, primary_key=True, index=True)
    expenses_no = Column(String(200), nullable=False)
    expenses_method = Column(String(30), nullable=False)
    expense_amount = Column(Numeric(60, 2), nullable=False)
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    branch_code = Column(String(200), nullable=False)
    bill_reference = Column(String(200))

