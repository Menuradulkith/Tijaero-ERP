from app.common.base_models import TimestampMixin
from app.db.base import Base
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Column,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship


class Invoice(Base, TimestampMixin):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, index=True)
    is_tax_invoice = Column(Boolean, nullable=False, default=False)  # True: tax-inclusive, False: tax-exclusive
    invoice_no = Column(String(200), unique=True, nullable=False)
    branch_code = Column(String(200), nullable=False)
    payment_method = Column(String(30), nullable=False)
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    sale_rep_id = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    customer_agent_id = Column(Integer, ForeignKey("customers.id"))
    approval = Column(Boolean, nullable=False)
    approval_status = Column(String(30), nullable=False, default="pending_approval")  # pending_approval, approved, completed
    customer_advance_payments_id = Column(
        Integer, ForeignKey("customer_advance_payments.id")
    )
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
    special = Column(Boolean, nullable=False)
    sys_code = Column(Integer)
    created_date_time = Column(TIMESTAMP, nullable=False)
    status = Column(Boolean, nullable=False)
    
    # Tax fields
    tax_rate = Column(Numeric(5, 2), nullable=False, default=0)  # Tax percentage
    tax_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Calculated tax amount
    
    # Discount fields
    discount_percent = Column(Numeric(5, 2), nullable=False, default=0)  # Discount percentage
    discount_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Fixed discount amount
    
    # Payment tracking
    subtotal = Column(Numeric(60, 2), nullable=False, default=0)  # Sum of line items before tax/discount
    grand_total = Column(Numeric(60, 2), nullable=False, default=0)  # Final total after tax/discount
    paid_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Amount paid so far
    balance_due = Column(Numeric(60, 2), nullable=False, default=0)  # Outstanding balance
    payment_status = Column(String(30), nullable=False, default="unpaid")  # unpaid, partial, paid
    
    # Service charges (for card payments)
    service_charge_rate = Column(Numeric(5, 3), nullable=False, default=0)  # e.g., 0.03 for 3%
    service_charge_amount = Column(Numeric(60, 2), nullable=False, default=0)
    
    # Bank transfer status tracking
    bank_transfer_status = Column(String(30), nullable=True)  # pending_verification, verified, rejected
    bank_transfer_verified_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    bank_transfer_verified_date = Column(TIMESTAMP, nullable=True)
    bank_transfer_rejection_reason = Column(Text, nullable=True)
    
    cheque_payment_id = Column(Integer, ForeignKey("cheque_payments.id"))
    bank_transfer_id = Column(Integer, ForeignKey("bank_deposits.id"))
    credit_payment_id = Column(Integer, ForeignKey("credit_payments.id"))
    card_payment_id = Column(Integer, ForeignKey("card_payments.id"))
    voucher_id = Column(Integer, ForeignKey("vouchers.id"))
    gift_voucher_id = Column(Integer, ForeignKey("customer_gift_voucher.id"))  # Gift voucher used
    gift_voucher_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Amount redeemed from gift voucher
    cupon_id = Column(Integer, ForeignKey("customer_cupon_codes.id"))
    cupon_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Coupon discount amount
    credit_note_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Credit note redeemed amount
    
    approval_id = Column(Integer, ForeignKey("approvals.id"))

    # Source tracking - for invoices converted from quotes/proforma
    source_quote_id = Column(Integer, ForeignKey("sales_quotes.id"), nullable=True)
    source_quote_type = Column(String(30), nullable=True)  # 'quotation' or 'proforma'

    # Relationships
    customer = relationship(
        "Customer", foreign_keys=[customer_id], back_populates="invoices"
    )
    customer_agent = relationship(
        "Customer", foreign_keys=[customer_agent_id], back_populates="agent_invoices"
    )
    sale_rep = relationship("User", foreign_keys=[sale_rep_id])
    bank_transfer_verifier = relationship("User", foreign_keys=[bank_transfer_verified_by])
    advance_payment = relationship("CustomerAdvancePayments", back_populates="invoices")
    cheque_payment = relationship("ChequePayments", back_populates="invoices")
    bank_transfer = relationship("BankDeposits", back_populates="invoices")
    credit_payment = relationship("CreditPayments", back_populates="invoices")
    card_payment = relationship("CardPayments", back_populates="invoices")
    voucher = relationship("Vouchers", back_populates="invoices")
    cupon = relationship("CustomerCuponCodes", back_populates="invoices")
    approval_record = relationship(
        "Approvals", back_populates="invoices", foreign_keys=[approval_id]
    )
    items = relationship("InvoiceItems", back_populates="invoice")
    sale_returns = relationship("SaleReturn", back_populates="invoice")
    warranty_claims = relationship("WarrantyClaims", back_populates="order")
    customer_support = relationship("CustomerSupport", back_populates="invoice")
    credits_settle_transactions = relationship(
        "CustomerCreditsSettleTransaction", back_populates="invoice"
    )


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
    
    # Link to specific sales stock item (barcode-based tracking)
    sales_stock_id = Column(Integer, ForeignKey("sales_stock.id"), nullable=True)
    barcode = Column(String(200), nullable=True)  # Store barcode for reference
    
    # Tax at item level (inherits from product or override)
    tax_rate = Column(Numeric(5, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(60, 2), nullable=False, default=0)
    
    # Discount at item level
    discount_percent = Column(Numeric(5, 2), nullable=False, default=0)
    discount_amount = Column(Numeric(60, 2), nullable=False, default=0)
    
    # Line total
    line_total = Column(Numeric(60, 2), nullable=False, default=0)  # quantity * price - discount + tax


    invoice = relationship("Invoice", back_populates="items")
    product = relationship("Product", back_populates="invoice_items")
    sales_stock = relationship("SalesStock", backref="invoice_items")
    barcodes = relationship("InvoiceItemsBarcode", back_populates="invoice_item")
    sale_return_items = relationship("SaleReturnItems", back_populates="invoice_item")


class InvoiceItemsBarcode(Base):
    __tablename__ = "invoice_items_barcode"

    id = Column(Integer, primary_key=True, index=True)
    created_date = Column(TIMESTAMP, nullable=False)
    good_received_items_id = Column(
        Integer, ForeignKey("good_received_items.id"), nullable=False
    )
    invoice_items_id = Column(Integer, ForeignKey("invoice_items.id"), nullable=False)

    good_received_item = relationship(
        "GoodReceivedItems", back_populates="invoice_barcodes"
    )
    invoice_item = relationship("InvoiceItems", back_populates="barcodes")


class SaleReturn(Base, TimestampMixin):
    __tablename__ = "sale_return"

    id = Column(Integer, primary_key=True, index=True)
    sale_return_no = Column(String(200), unique=True, nullable=False)
    branch_code = Column(String(200), nullable=False)
    remark = Column(Text)
    added_date = Column(Date, nullable=False)
    good_received_locations_id = Column(
        Integer, ForeignKey("good_received_locations.id"), nullable=False
    )
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    cheque_date = Column(Date, nullable=False)
    payment_method = Column(String(30), nullable=False)  # cash, bank_transfer, credit_note, cheque
    approval_id = Column(Integer, ForeignKey("approvals.id"))
    
    # Return status tracking
    status = Column(String(30), nullable=False, default="pending")  # pending, approved, processed, rejected
    
    # Return reason
    return_reason = Column(String(100), nullable=True)  # defective, wrong_item, customer_changed_mind, damaged, other
    
    # Return totals
    subtotal = Column(Numeric(60, 2), nullable=False, default=0)  # Sum of return items
    tax_refund = Column(Numeric(60, 2), nullable=False, default=0)  # Tax refund amount
    total_refund = Column(Numeric(60, 2), nullable=False, default=0)  # Total refund amount
    
    # Refund tracking
    refund_status = Column(String(30), nullable=False, default="pending")  # pending, processed, partial
    refund_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Amount actually refunded
    refund_date = Column(Date, nullable=True)  # When refund was processed
    refund_reference = Column(String(200), nullable=True)  # Reference number for refund
    
    # Credit note reference (if refund method is credit_note)
    credit_note_id = Column(Integer, ForeignKey("customer_credit_notes.id"), nullable=True)
    
    # User tracking
    created_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    approved_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    processed_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)

    # Relationships
    location = relationship("Locations", back_populates="sale_returns")
    invoice = relationship("Invoice", back_populates="sale_returns")
    approval = relationship("Approvals", back_populates="sale_returns")
    items = relationship("SaleReturnItems", back_populates="sale_return", cascade="all, delete-orphan")
    credit_note = relationship("CustomerCreditNotes", backref="sale_returns")


class SaleReturnItems(Base, TimestampMixin):
    __tablename__ = "sale_return_items"

    id = Column(Integer, primary_key=True, index=True)
    barcode = Column(Text, nullable=False)
    return_price = Column(Numeric(60, 2), nullable=False)
    branch_code = Column(String(200), nullable=False)
    added_date = Column(TIMESTAMP, nullable=False)
    sale_return_id = Column(Integer, ForeignKey("sale_return.id"), nullable=False)
    sold_price = Column(Numeric(60, 2), nullable=False)
    invoice_item_id = Column(Integer, ForeignKey("invoice_items.id"))
    
    # Link to sales stock for tracking
    sales_stock_id = Column(Integer, ForeignKey("sales_stock.id"), nullable=True)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    quantity = Column(Integer, nullable=False, default=1)
    
    # Condition of returned item
    condition = Column(String(50), nullable=False, default="good")  # good, damaged, defective, opened
    
    # Whether item can be restocked
    restockable = Column(Boolean, nullable=False, default=True)
    restocked = Column(Boolean, nullable=False, default=False)  # Whether it was actually restocked

    # Relationships
    sale_return = relationship("SaleReturn", back_populates="items")
    invoice_item = relationship("InvoiceItems", back_populates="sale_return_items")
    sales_stock = relationship("SalesStock", backref="return_items")
    product = relationship("Product", backref="sale_return_items")


class PaymentCard(Base, TimestampMixin):
    """
    Payment card configuration for credit/debit cards.
    Allows defining different card types with their service charges.
    """
    __tablename__ = "payment_cards"

    id = Column(Integer, primary_key=True, index=True)
    card_name = Column(String(100), nullable=False, unique=True)  # e.g., "Visa", "Mastercard", "Amex"
    card_type = Column(String(20), nullable=False)  # "credit" or "debit"
    service_charge_percent = Column(Numeric(5, 2), nullable=False, default=0)  # e.g., 2.5%
    description = Column(Text, nullable=True)
    active = Column(Boolean, nullable=False, default=True)
    
    # Relationships - track which invoices used this card
    invoice_payments = relationship("InvoiceCardPayment", back_populates="payment_card")


class InvoiceCardPayment(Base, TimestampMixin):
    """
    Tracks card payments for invoices with calculated service charges.
    """
    __tablename__ = "invoice_card_payments"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    payment_card_id = Column(Integer, ForeignKey("payment_cards.id"), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)  # Base amount
    service_charge = Column(Numeric(60, 2), nullable=False, default=0)  # Calculated service charge
    total_amount = Column(Numeric(60, 2), nullable=False)  # amount + service_charge
    reference_no = Column(String(100), nullable=True)  # Card transaction reference
    
    # Relationships
    invoice = relationship("Invoice", backref="card_payments")
    payment_card = relationship("PaymentCard", back_populates="invoice_payments")
