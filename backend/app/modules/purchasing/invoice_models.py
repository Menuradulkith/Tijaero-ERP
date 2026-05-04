"""
Purchase Invoice (Supplier Bill) Models

Standard ERP Design:
- PO = Planning document (what we intend to buy)
- GRN = Stock movement (what we physically received)
- Purchase Invoice = Liability (what the supplier bills us)
- Payment = Settlement of liability (paying the invoice)

Key relationships:
- One Purchase Invoice can reference MULTIPLE GRNs
- One GRN can be partially invoiced across MULTIPLE invoices
- Payment is ALWAYS against invoices, not POs or GRNs

Workflow:
1. GRN is created → stock increases (no invoice number needed)
2. Supplier sends invoice → Create Purchase Invoice
   - Select GRN(s) to link
   - Enter supplier invoice number, date, amounts
   - System validates quantities against GRN
3. Payment is made against Purchase Invoice(s)
   - One payment can settle multiple invoices
   - Partial payments supported
"""

from sqlalchemy import (
    Column, Integer, String, Text, ForeignKey, Date, Numeric,
    Boolean, TIMESTAMP, text, Index, UniqueConstraint
)
from sqlalchemy.orm import relationship
from app.db.base import Base


class PurchaseInvoice(Base):
    """
    Purchase Invoice (Supplier Bill) - What the supplier is billing us for.
    
    This is the LIABILITY document. AP is recognized here, not at GRN.
    
    Status flow: draft → verified → partially_paid → paid → cancelled
    """
    __tablename__ = "purchase_invoices"

    id = Column(Integer, primary_key=True, index=True)
    
    # Auto-generated internal reference
    invoice_no = Column(String(200), unique=True, nullable=False, index=True)  # PI-YYYY-XXXXX
    
    # Supplier's invoice details
    supplier_invoice_no = Column(String(200), nullable=False)  # The number on supplier's paper invoice
    supplier_invoice_date = Column(Date, nullable=False)  # Date on supplier's invoice
    
    # Supplier
    supplier_id = Column(Integer, ForeignKey("supplier.id"), nullable=False, index=True)
    
    # Branch
    branch_code = Column(String(200), nullable=False, index=True)
    
    # Dates
    received_date = Column(Date, nullable=False)  # Date we received the invoice
    due_date = Column(Date, nullable=False)  # Payment due date (calculated from credit terms)
    
    # Amounts
    subtotal = Column(Numeric(18, 2), nullable=False, default=0)  # Sum of line items
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0)  # Tax if applicable
    discount_amount = Column(Numeric(18, 2), nullable=False, default=0)  # Any discount
    total_amount = Column(Numeric(18, 2), nullable=False, default=0)  # Final payable amount
    paid_amount = Column(Numeric(18, 2), nullable=False, default=0)  # Amount paid so far
    balance_due = Column(Numeric(18, 2), nullable=False, default=0)  # Remaining to pay
    
    # Payment type (inherited from PO: Credit or Non-credit)
    payment_type = Column(String(30), nullable=False, default="non_credit", index=True)
    # "credit" or "non_credit" - determines flow in supplier payments
    
    # Status
    status = Column(String(30), nullable=False, default="draft", index=True)
    # draft → verified → partially_paid → paid → cancelled
    
    # Payment tracking
    payment_status = Column(String(30), nullable=False, default="unpaid", index=True)
    # unpaid → partial → paid
    
    # Remarks
    remarks = Column(Text, nullable=True)
    
    # Audit
    created_by = Column(Integer, nullable=True)
    verified_by = Column(Integer, nullable=True)
    verified_date = Column(TIMESTAMP, nullable=True)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP"))
    
    # Relationships
    supplier = relationship("Supplier", backref="purchase_invoices")
    items = relationship("PurchaseInvoiceItem", back_populates="purchase_invoice", cascade="all, delete-orphan")
    payment_allocations = relationship("PurchaseInvoicePayment", back_populates="purchase_invoice", cascade="all, delete-orphan")

    __table_args__ = (
        # Same supplier invoice number should be unique per supplier
        UniqueConstraint("supplier_id", "supplier_invoice_no", name="uq_supplier_invoice"),
        Index("idx_pi_supplier_status", "supplier_id", "status"),
        Index("idx_pi_due_date", "due_date"),
    )


class PurchaseInvoiceItem(Base):
    """
    Purchase Invoice Line Item - Maps invoice lines to GRN received items.
    
    Each line references a GRN and optionally specific PO items.
    This enables:
    - One invoice → multiple GRNs
    - Partial invoicing of a GRN
    - Quantity & amount validation against GRN
    """
    __tablename__ = "purchase_invoice_items"

    id = Column(Integer, primary_key=True, index=True)
    purchase_invoice_id = Column(Integer, ForeignKey("purchase_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Link to GRN
    grn_id = Column(Integer, ForeignKey("good_received_note.id"), nullable=False, index=True)
    
    # Link to PO (for reference)
    purchasing_order_id = Column(Integer, ForeignKey("purchasing_orders.id"), nullable=True)
    
    # Product (optional - for line-level detail)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=True)
    
    # Quantities
    quantity = Column(Integer, nullable=False)  # Quantity being invoiced from this GRN
    
    # Amounts
    unit_price = Column(Numeric(18, 2), nullable=False)
    line_total = Column(Numeric(18, 2), nullable=False)  # quantity * unit_price
    tax_amount = Column(Numeric(18, 2), nullable=False, default=0)
    
    # Description (from supplier's invoice)
    description = Column(Text, nullable=True)
    
    # Audit
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # Relationships
    purchase_invoice = relationship("PurchaseInvoice", back_populates="items")
    good_received_note = relationship("GoodReceivedNote", backref="invoice_items")
    purchasing_order = relationship("PurchasingOrder", backref="invoice_items")
    product = relationship("Product", backref="purchase_invoice_items")


class PurchaseInvoicePayment(Base):
    """
    Payment Allocation - Links payments to specific invoices with amounts.
    
    Standard ERP pattern:
    - One payment can settle MULTIPLE invoices
    - One invoice can be settled by MULTIPLE payments (partial)
    - This is the M:N join with amount
    
    Example:
      Payment of Rs. 2,000,000
        → Invoice INV001: Rs. 800,000 (fully paid)
        → Invoice INV002: Rs. 1,200,000 (fully paid)
    """
    __tablename__ = "purchase_invoice_payments"

    id = Column(Integer, primary_key=True, index=True)
    
    # Link to purchase invoice
    purchase_invoice_id = Column(Integer, ForeignKey("purchase_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Link to supplier payment
    supplier_payment_id = Column(Integer, ForeignKey("supplier_payments.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Amount allocated from this payment to this invoice
    allocated_amount = Column(Numeric(18, 2), nullable=False)
    
    # Audit
    allocated_date = Column(Date, nullable=False)
    remarks = Column(Text, nullable=True)
    created_at = Column(TIMESTAMP, server_default=text("CURRENT_TIMESTAMP"))

    # Relationships
    purchase_invoice = relationship("PurchaseInvoice", back_populates="payment_allocations")
    supplier_payment = relationship("SupplierPayment", backref="invoice_allocations")

    __table_args__ = (
        # One payment can only be allocated once to a specific invoice
        UniqueConstraint("purchase_invoice_id", "supplier_payment_id", name="uq_invoice_payment"),
        Index("idx_pip_payment", "supplier_payment_id"),
    )
