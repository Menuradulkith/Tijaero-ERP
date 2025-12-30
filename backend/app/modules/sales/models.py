from sqlalchemy import Column, Integer, String, Text, ForeignKey, Date, Numeric, Boolean, TIMESTAMP
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import TimestampMixin

class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"
    
    id = Column(Integer, primary_key=True, index=True)
    invoice_no = Column(String(200), unique=True, nullable=False)
    branch_code = Column(String(200), nullable=False)
    payment_method = Column(String(30), nullable=False)
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    sale_rep_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    customer_agent_id = Column(Integer, ForeignKey("customers.id"))
    approval = Column(Boolean, nullable=False)
    customer_advance_payments_id = Column(Integer, ForeignKey("customer_advance_payments.id"))
    bank_transfer_amount = Column(Numeric(60, 2), nullable=False)
    card_amex_amount = Column(Numeric(60, 2), nullable=False)
    card_mastercard_amount = Column(Numeric(60, 2), nullable=False)
    card_visa_amount = Column(Numeric(60, 2), nullable=False)
    cash_amount = Column(Numeric(60, 2), nullable=False)
    cheque_date = Column(Date, nullable=False)
    cheque_amount = Column(Numeric(60, 2), nullable=False)
    payment_adjustments = Column(Numeric(60, 2), nullable=False)
    credit_amount = Column(Numeric(60, 2), nullable=False)
    cupon_amount = Column(Numeric(60, 2), nullable=False, default=0)
    credit_note_amount = Column(Numeric(60, 2), nullable=False, default=0)
    special = Column(Boolean, nullable=False)
    sys_code = Column(Integer)
    created_date_time = Column(TIMESTAMP, nullable=False)
    status = Column(Boolean, nullable=False)
    cheque_payment_id = Column(Integer, ForeignKey("cheque_payments.id"))
    bank_transfer_id = Column(Integer, ForeignKey("bank_deposits.id"))
    credit_payment_id = Column(Integer, ForeignKey("credit_payments.id"))
    card_payment_id = Column(Integer, ForeignKey("card_payments.id"))
    voucher_id = Column(Integer, ForeignKey("vouchers.id"))
    cupon_id = Column(Integer, ForeignKey("customer_cupon_codes.id"))
    credit_note_id = Column(Integer, ForeignKey("customer_credit_notes.id"))
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    
    # Relationships
    customer = relationship("Customer", foreign_keys=[customer_id], back_populates="invoices")
    customer_agent = relationship("Customer", foreign_keys=[customer_agent_id], back_populates="agent_invoices")
    sale_rep = relationship("Employee", back_populates="invoices")
    advance_payment = relationship("CustomerAdvancePayments", back_populates="invoices")
    cheque_payment = relationship("ChequePayments", back_populates="invoices")
    bank_transfer = relationship("BankDeposits", back_populates="invoices")
    credit_payment = relationship("CreditPayments", back_populates="invoices")
    card_payment = relationship("CardPayments", back_populates="invoices")
    voucher = relationship("Vouchers", back_populates="invoices")
    cupon = relationship("CustomerCuponCodes", back_populates="invoices")
    credit_note = relationship("CustomerCreditNotes", back_populates="invoices")
    approval_record = relationship("Approvals", back_populates="invoices", foreign_keys=[approval_id])
    items = relationship("InvoiceItems", back_populates="invoice")
    sale_returns = relationship("SaleReturn", back_populates="invoice")
    warranty_claims = relationship("WarrantyClaims", back_populates="order")
    customer_support = relationship("CustomerSupport", back_populates="invoice")
    credits_settle_transactions = relationship("CustomerCreditsSettleTransaction", back_populates="invoice")

class InvoiceItems(Base, TimestampMixin):
    __tablename__ = "invoice_items"
    
    id = Column(Integer, primary_key=True, index=True)
    warrenty_month = Column(String(30), nullable=False)
    selling_price = Column(Numeric(60, 2), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, nullable=False)
    minimum_selling_price = Column(Numeric(60, 2), nullable=False)
    
    # Relationships
    invoice = relationship("Invoice", back_populates="items")
    product = relationship("Product", back_populates="invoice_items")
    barcodes = relationship("InvoiceItemsBarcode", back_populates="invoice_item")
    sale_return_items = relationship("SaleReturnItems", back_populates="invoice_item")

class InvoiceItemsBarcode(Base):
    __tablename__ = "invoice_items_barcode"
    
    id = Column(Integer, primary_key=True, index=True)
    created_date = Column(TIMESTAMP, nullable=False)
    good_received_items_id = Column(Integer, ForeignKey("good_received_items.id"), nullable=False)
    invoice_items_id = Column(Integer, ForeignKey("invoice_items.id"), nullable=False)
    
    # Relationships
    good_received_item = relationship("GoodReceivedItems", back_populates="invoice_barcodes")
    invoice_item = relationship("InvoiceItems", back_populates="barcodes")

class SaleReturn(Base):
    __tablename__ = "sale_return"
    
    id = Column(Integer, primary_key=True, index=True)
    sale_return_no = Column(String(200), unique=True, nullable=False)
    branch_code = Column(String(200), nullable=False)
    remark = Column(Text)
    added_date = Column(Date, nullable=False)
    good_received_locations_id = Column(Integer, ForeignKey("good_received_locations.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    cheque_date = Column(Date, nullable=False)
    payment_method = Column(String(30), nullable=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    
    # Relationships
    location = relationship("Locations", back_populates="sale_returns")
    invoice = relationship("Invoice", back_populates="sale_returns")
    approval = relationship("Approvals", back_populates="sale_returns")
    items = relationship("SaleReturnItems", back_populates="sale_return")

class SaleReturnItems(Base):
    __tablename__ = "sale_return_items"
    
    id = Column(Integer, primary_key=True, index=True)
    barcode = Column(Text, nullable=False)
    return_price = Column(Numeric(60, 2), nullable=False)
    branch_code = Column(String(200), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    sale_return_id = Column(Integer, ForeignKey("sale_return.id"), nullable=False)
    sold_price = Column(Numeric(60, 2), nullable=False)
    invoice_item_id = Column(Integer, ForeignKey("invoice_items.id"))
    
    # Relationships
    sale_return = relationship("SaleReturn", back_populates="items")
    invoice_item = relationship("InvoiceItems", back_populates="sale_return_items")
