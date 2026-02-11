from sqlalchemy import Column, Integer, String, Text, Enum as SQLEnum, ForeignKey, Date, Boolean, TIMESTAMP, Numeric, BigInteger, func, Table
from sqlalchemy.orm import relationship
from app.db.base import Base
from app.common.base_models import AuditMixin
from app.modules.customers.enums import CustomerType

# Association table for coupon-product many-to-many relationship
coupon_products = Table(
    'coupon_products',
    Base.metadata,
    Column('coupon_id', Integer, ForeignKey('customer_cupon_codes.id', ondelete='CASCADE'), primary_key=True),
    Column('product_id', Integer, ForeignKey('products.id', ondelete='CASCADE'), primary_key=True)
)

# Association table for coupon-category many-to-many relationship
coupon_categories = Table(
    'coupon_categories',
    Base.metadata,
    Column('coupon_id', Integer, ForeignKey('customer_cupon_codes.id', ondelete='CASCADE'), primary_key=True),
    Column('category_id', Integer, ForeignKey('category.id', ondelete='CASCADE'), primary_key=True)
)

# Association table for coupon-brand many-to-many relationship
coupon_brands = Table(
    'coupon_brands',
    Base.metadata,
    Column('coupon_id', Integer, ForeignKey('customer_cupon_codes.id', ondelete='CASCADE'), primary_key=True),
    Column('brand_id', Integer, ForeignKey('items_brand.id', ondelete='CASCADE'), primary_key=True)
)

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
    commission_rate = Column(Numeric(5, 2), nullable=True)  # Default commission rate for this agent

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
    applied_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Amount already applied to invoices
    remaining_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Remaining balance available
    is_fully_applied = Column(Boolean, nullable=False, default=False)  # True when fully consumed
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    cheque_date = Column(Date, nullable=False)
    active = Column(Boolean, nullable=False)

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
    

    customer = relationship("Customer", back_populates="credit_notes")
    # Note: Credit notes are for sale returns/vouchers, not directly linked to invoices table


class CustomerCreditsSettle(Base):
    __tablename__ = "customer_credits_settle"
    
    id = Column(Integer, primary_key=True, index=True)
    customer_credits_settle_no = Column(String(200), unique=True, nullable=False)
    branch_code = Column(String(200), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)

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
    
    credit_settle = relationship("CustomerCreditsSettle", back_populates="transactions")
    invoice = relationship("Invoice", back_populates="credits_settle_transactions")


class CustomerCuponCodes(Base):
    __tablename__ = "customer_cupon_codes"
    
    id = Column(Integer, primary_key=True, index=True)
    cupon_code = Column(String(50), unique=True, nullable=False)  # Barcode/coupon code
    description = Column(String(255))  # Optional description
    discount_type = Column(String(20), nullable=False, default="PERCENT")  # PERCENT or AMOUNT
    discount_value = Column(Numeric(60, 2), nullable=False, default=0)  # Discount value
    minimum_invoice_amount = Column(Numeric(60, 2), nullable=False, default=0)  # Minimum invoice amount required
    limit_by_usage = Column(Integer, nullable=False, default=1000)  # Total global usage limit
    limit_for_customer = Column(Integer, nullable=False, default=10)  # Per customer usage limit
    valid_until_date = Column(Date, nullable=False)
    active = Column(Boolean, nullable=False, default=True)
    usage_count = Column(Integer, nullable=False, default=0)  # Track total usage count
    created_date = Column(TIMESTAMP, server_default=func.now())
    
    # Legacy single product field (deprecated - use products relationship instead)
    limit_validity_product_id = Column(Integer, ForeignKey("products.id"))  # Specific product

    # Many-to-many relationship with products for restriction
    products = relationship("Product", secondary=coupon_products, backref="restricted_coupons")
    # Many-to-many relationship with categories for restriction
    categories = relationship("Category", secondary=coupon_categories, backref="restricted_coupons")
    # Many-to-many relationship with brands for restriction
    brands = relationship("ItemsBrand", secondary=coupon_brands, backref="restricted_coupons")
    # Legacy single product relationship (deprecated)
    product = relationship("Product", foreign_keys=[limit_validity_product_id], back_populates="cupon_codes")
    invoices = relationship("Invoice", back_populates="cupon")
    usages = relationship("CouponUsage", back_populates="coupon", cascade="all, delete-orphan")


class CouponUsage(Base):
    """Track coupon usage per customer"""
    __tablename__ = "coupon_usage"
    
    id = Column(Integer, primary_key=True, index=True)
    coupon_id = Column(Integer, ForeignKey("customer_cupon_codes.id"), nullable=False)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    discount_amount = Column(Numeric(60, 2), nullable=False)
    used_date = Column(TIMESTAMP, nullable=False)
    
    coupon = relationship("CustomerCuponCodes", back_populates="usages")
    customer = relationship("Customer")
    invoice = relationship("Invoice")


class CustomerGiftVoucher(Base):
    __tablename__ = "customer_gift_voucher"
    
    id = Column(Integer, primary_key=True, index=True)
    barcode_no = Column(String(50), unique=True, nullable=False)  # Voucher code/barcode
    amount = Column(Numeric(60, 2), nullable=False)  # Original voucher amount
    balance = Column(Numeric(60, 2), nullable=False)  # Remaining balance
    date = Column(Date, nullable=False)  # Issue date
    valid_period_in_months = Column(Integer, nullable=False, default=12)
    status = Column(String(20), nullable=False, default="active")  # active, fully_claimed, expired
    purchased_invoice_no = Column(String(200))  # Invoice where voucher was purchased
    claimed_date = Column(TIMESTAMP)  # When fully claimed
    claimed_invoice_no = Column(String(200))  # Invoice where fully claimed
    # Payment details for cashbook tracking
    payment_method = Column(String(50), default="cash")  # cash, card, bank_transfer, cheque
    branch_code = Column(String(50))  # Branch where voucher was sold
    customer_name = Column(String(200))  # Customer who purchased (optional for walk-in)
    created_at = Column(TIMESTAMP, server_default=func.now())
    
    # Relationship to track usage history
    usages = relationship("VoucherUsage", back_populates="voucher", cascade="all, delete-orphan")


class VoucherUsage(Base):
    """Track voucher usage per invoice (supports partial redemptions)"""
    __tablename__ = "voucher_usage"
    
    id = Column(Integer, primary_key=True, index=True)
    voucher_id = Column(Integer, ForeignKey("customer_gift_voucher.id"), nullable=False)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    amount_used = Column(Numeric(60, 2), nullable=False)
    used_date = Column(TIMESTAMP, nullable=False)
    
    voucher = relationship("CustomerGiftVoucher", back_populates="usages")
    invoice = relationship("Invoice")




