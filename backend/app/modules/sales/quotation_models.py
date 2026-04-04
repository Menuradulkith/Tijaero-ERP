import enum

from app.common.base_models import TimestampMixin
from app.db.base import Base
from sqlalchemy import TIMESTAMP, Boolean, Column, Date
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship


class QuoteType(str, enum.Enum):
    QUOTATION = "quotation" 
    PROFORMA = "proforma" 


class QuoteStatus(str, enum.Enum):

    DRAFT = "draft"  
    PENDING_APPROVAL = "pending_approval" 
    SUBMITTED = "submitted"  # Sent/submitted to customer
    UNDER_REVIEW = "under_review"  # Customer reviewing (proforma stage)
    APPROVED = "approved" 
    SENT = "sent" 
    ACCEPTED = "accepted" 
    REJECTED = "rejected" 
    EXPIRED = "expired"  
    CONVERTED = "converted" 
    CONVERTED_TO_INVOICE = "converted_to_invoice"  # Successfully converted to invoice
    PO_CREATED = "po_created"  # PO raised from this quotation
    ITEM_RECEIVED = "item_received"  # GRN completed for linked PO
    SO_CREATED = "so_created"  # Sales Order created from proforma
    CANCELLED = "cancelled" 
    REVISED = "revised" 

class DiscountType(str, enum.Enum):
    NONE = "none"
    PERCENTAGE = "percentage"
    FIXED = "fixed"


class SalesQuote(Base, TimestampMixin):


    __tablename__ = "sales_quotes"

    id = Column(Integer, primary_key=True, index=True)
    quote_no = Column(String(200), unique=True, nullable=False, index=True)
    quote_type = Column(
        String(30), nullable=False, default=QuoteType.QUOTATION.value
    )  
    branch_code = Column(String(200), nullable=False) 
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=False)
    sale_rep_id = Column(Integer, ForeignKey("employees.id"), nullable=True)  # Optional
    customer_agent_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    created_date = Column(Date, nullable=False)
    created_date_time = Column(TIMESTAMP, nullable=False)
    valid_until = Column(Date, nullable=False)  
    expected_delivery_date = Column(Date, nullable=True)  

    status = Column(String(30), nullable=False, default=QuoteStatus.DRAFT.value)
    approval = Column(Boolean, nullable=False, default=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)
    special = Column(Boolean, nullable=False, default=False)
    sys_code = Column(Integer, nullable=True)

    is_estimate = Column(
        Boolean, nullable=False, default=True
    )  
    remarks = Column(Text, nullable=True)  
    customer_notes = Column(Text, nullable=True)
    discount_type = Column(
        String(30), nullable=False, default=DiscountType.NONE.value
    )
    discount_percentage = Column(Numeric(60, 2), nullable=False, default=0) 
    total_amount = Column(Numeric(60, 2), nullable=False, default=0)

    converted_to_invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=True)
    converted_at = Column(TIMESTAMP, nullable=True)
    converted_by = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    
    # Workflow date tracking
    submitted_date = Column(TIMESTAMP, nullable=True)  # When submitted to customer
    po_created_date = Column(TIMESTAMP, nullable=True)  # When PO was created from this quote
    approved_date = Column(TIMESTAMP, nullable=True)  # When customer approved
    approved_by_customer = Column(String(200), nullable=True)  # Customer contact who approved
    rejection_date = Column(TIMESTAMP, nullable=True)  # When rejected
    conversion_date = Column(TIMESTAMP, nullable=True)  # When converted to invoice
    
    # Linked PO tracking
    linked_po_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=True)
    
    # Revision tracking
    parent_quote_id = Column(Integer, ForeignKey("sales_quotes.id"), nullable=True)
    revision_number = Column(Integer, nullable=False, default=1)
    
    # Rejection / expiry tracking
    rejection_reason = Column(Text, nullable=True)
    
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
    linked_po = relationship(
        "PurchasingOrder", foreign_keys="SalesQuote.linked_po_id", backref="source_quote_link"
    )
    items = relationship(
        "SalesQuoteItem", back_populates="quote", cascade="all, delete-orphan"
    )
    
    @property
    def is_proforma(self):
        """Check if this quote is a proforma invoice"""
        return self.quote_type == QuoteType.PROFORMA.value


class SalesQuoteItem(Base, TimestampMixin):

    __tablename__ = "sales_quote_items"

    id = Column(Integer, primary_key=True, index=True)
    quote_id = Column(Integer, ForeignKey("sales_quotes.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)

    quantity = Column(Integer, nullable=False)

    selling_price = Column(Numeric(60, 2), nullable=False)  
    minimum_selling_price = Column(
        Numeric(60, 2), nullable=False
    )  
    discount_percentage = Column(Numeric(60, 2), nullable=False, default=0) 
    warrenty_month = Column(String(30), nullable=False)
    created_date = Column(TIMESTAMP, nullable=False)

    is_price_estimate = Column(
        Boolean, nullable=False, default=False
    )  
    stock_status = Column(
        String(30), nullable=True, default=None
    )  # 'in_stock', 'needs_procurement', or None (not checked)
    description = Column(Text, nullable=True)  
    remark = Column(Text, nullable=True)  

    quote = relationship("SalesQuote", back_populates="items")
    product = relationship("Product", backref="sales_quote_items")
