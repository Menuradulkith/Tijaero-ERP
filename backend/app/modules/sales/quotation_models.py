import enum

from app.common.base_models import TimestampMixin
from app.db.base import Base
from sqlalchemy import TIMESTAMP, Boolean, Column, Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship


class QuoteType(str, enum.Enum):
    """Type of sales quote"""

    QUOTATION = "quotation"  # Estimate - prices can be ranges
    PROFORMA = "proforma"  # Exact prices - like a pre-invoice


class QuoteStatus(str, enum.Enum):
    """Status workflow for quotes"""

    DRAFT = "draft"  # Being created/edited
    PENDING_APPROVAL = "pending_approval"  # Awaiting approval
    APPROVED = "approved"  # Approved, ready to send
    SENT = "sent"  # Sent to customer
    ACCEPTED = "accepted"  # Customer accepted
    REJECTED = "rejected"  # Customer rejected
    EXPIRED = "expired"  # Validity period ended
    CONVERTED = "converted"  # Converted to Invoice
    CANCELLED = "cancelled"  # Cancelled internally
    REVISED = "revised"  # Superseded by new revision (quotation only)


class DiscountType(str, enum.Enum):
    """Type of discount applied"""

    NONE = "none"
    PERCENTAGE = "percentage"
    FIXED = "fixed"


class SalesQuote(Base, TimestampMixin):
    """
    Sales Quote - Quotation or Proforma Invoice

    Quotation: Estimate with approximate/range prices
    Proforma: Exact prices, like a pre-invoice

    Both can be converted to Invoice
    """

    __tablename__ = "sales_quotes"

    id = Column(Integer, primary_key=True, index=True)
    quote_no = Column(String(200), unique=True, nullable=False, index=True)
    quote_type = Column(
        String(30), nullable=False, default=QuoteType.QUOTATION.value
    )  # quotation or proforma
    branch_code = Column(String(200), nullable=False)

    # Customer & Sales Rep (same as Invoice)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    sale_rep_id = Column(Integer, ForeignKey("employees.id"), nullable=False)
    customer_agent_id = Column(Integer, ForeignKey("customers.id"), nullable=True)

    # Dates
    created_date = Column(Date, nullable=False)
    created_date_time = Column(TIMESTAMP, nullable=False)
    valid_until = Column(Date, nullable=False)  # Validity expiry date
    expected_delivery_date = Column(Date, nullable=True)  # For proforma

    # Status & Approval (similar to Invoice)
    status = Column(String(30), nullable=False, default=QuoteStatus.DRAFT.value)
    approval = Column(Boolean, nullable=False, default=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)
    special = Column(Boolean, nullable=False, default=False)
    sys_code = Column(Integer, nullable=True)

    # Quote Specific Fields
    is_estimate = Column(
        Boolean, nullable=False, default=True
    )  # True for quotation, False for proforma
    revision_number = Column(
        Integer, nullable=False, default=1
    )  # For quotation revisions
    parent_quote_id = Column(
        Integer, ForeignKey("sales_quotes.id"), nullable=True
    )  # Parent for revisions

    # Proforma Specific Fields
    payment_terms = Column(Text, nullable=True)  # "50% advance, 50% on delivery"
    delivery_terms = Column(Text, nullable=True)  # "FOB Colombo"

    # Notes
    remarks = Column(Text, nullable=True)  # Internal notes
    customer_notes = Column(Text, nullable=True)  # Notes printed on document
    terms_conditions = Column(Text, nullable=True)  # T&C text

    # Totals (Calculated)
    subtotal = Column(Numeric(60, 2), nullable=False, default=0)
    discount_type = Column(String(30), nullable=False, default=DiscountType.NONE.value)
    discount_value = Column(Numeric(60, 2), nullable=False, default=0)
    tax_amount = Column(Numeric(60, 2), nullable=False, default=0)
    total_amount = Column(Numeric(60, 2), nullable=False, default=0)

    # Conversion Tracking
    converted_to_invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    converted_at = Column(TIMESTAMP, nullable=True)
    converted_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)

    # Relationships
    customer = relationship(
        "Customer", foreign_keys=[customer_id], backref="sales_quotes"
    )
    customer_agent = relationship(
        "Customer", foreign_keys=[customer_agent_id], backref="agent_sales_quotes"
    )
    sale_rep = relationship("Employee", backref="sales_quotes")
    approval_record = relationship(
        "Approvals", backref="sales_quotes", foreign_keys=[approval_id]
    )
    converted_invoice = relationship(
        "Invoice", foreign_keys=[converted_to_invoice_id], backref="source_quotes"
    )
    converted_by_user = relationship(
        "User", foreign_keys=[converted_by], backref="converted_quotes"
    )
    parent_quote = relationship("SalesQuote", remote_side=[id], backref="revisions")
    items = relationship(
        "SalesQuoteItem", back_populates="quote", cascade="all, delete-orphan"
    )


class SalesQuoteItem(Base, TimestampMixin):
    """
    Sales Quote Line Item

    Similar to InvoiceItems but with additional fields for estimate ranges
    """

    __tablename__ = "sales_quote_items"

    id = Column(Integer, primary_key=True, index=True)
    quote_id = Column(Integer, ForeignKey("sales_quotes.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    # Quantity
    quantity = Column(Integer, nullable=False)

    # Pricing (same as InvoiceItems)
    selling_price = Column(Numeric(60, 2), nullable=False)  # Unit price (exact)
    minimum_selling_price = Column(
        Numeric(60, 2), nullable=False
    )  # Minimum allowed price
    warrenty_month = Column(String(30), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)

    # Quote Specific - Price Range (for quotation estimates)
    min_price = Column(Numeric(60, 2), nullable=True)  # For estimate: min range
    max_price = Column(Numeric(60, 2), nullable=True)  # For estimate: max range
    is_price_estimate = Column(
        Boolean, nullable=False, default=False
    )  # True if price is a range

    # Additional Quote Fields
    description = Column(Text, nullable=True)  # Custom item description
    discount_percent = Column(
        Numeric(5, 2), nullable=False, default=0
    )  # Line discount %
    tax_rate = Column(Numeric(5, 2), nullable=False, default=0)  # Tax rate %
    line_total = Column(
        Numeric(60, 2), nullable=False, default=0
    )  # Calculated line total
    remark = Column(Text, nullable=True)  # Line item note

    # Relationships
    quote = relationship("SalesQuote", back_populates="items")
    product = relationship("Product", backref="sales_quote_items")
    # Relationships
    quote = relationship("SalesQuote", back_populates="items")
    product = relationship("Product", backref="sales_quote_items")
