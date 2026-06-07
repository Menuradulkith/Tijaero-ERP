"""
Purchase Invoice Schemas
"""
from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal


# ==================== PURCHASE INVOICE ITEM SCHEMAS ====================

class PurchaseInvoiceItemBase(BaseModel):
    grn_id: int
    purchasing_order_id: Optional[int] = None
    product_id: Optional[int] = None
    quantity: int
    unit_price: Decimal
    line_total: Decimal
    tax_amount: Decimal = Decimal("0")
    description: Optional[str] = None


class PurchaseInvoiceItemCreate(PurchaseInvoiceItemBase):
    pass


class PurchaseInvoiceItemResponse(PurchaseInvoiceItemBase):
    id: int
    purchase_invoice_id: int
    created_at: Optional[datetime] = None
    # Enriched fields
    grn_no: Optional[str] = None
    po_no: Optional[str] = None
    product_name: Optional[str] = None

    class Config:
        from_attributes = True


# ==================== PURCHASE INVOICE SCHEMAS ====================

class PurchaseInvoiceBase(BaseModel):
    supplier_invoice_no: str
    supplier_invoice_date: date
    supplier_id: int
    branch_code: str
    received_date: date
    due_date: date
    payment_type: str = "non_credit"  # "credit" or "non_credit" - inherited from PO
    subtotal: Decimal = Decimal("0")
    tax_amount: Decimal = Decimal("0")
    discount_amount: Decimal = Decimal("0")
    total_amount: Decimal = Decimal("0")
    remarks: Optional[str] = None


class PurchaseInvoiceCreate(PurchaseInvoiceBase):
    items: List[PurchaseInvoiceItemCreate]


class PurchaseInvoiceUpdate(BaseModel):
    supplier_invoice_no: Optional[str] = None
    supplier_invoice_date: Optional[date] = None
    received_date: Optional[date] = None
    due_date: Optional[date] = None
    subtotal: Optional[Decimal] = None
    tax_amount: Optional[Decimal] = None
    discount_amount: Optional[Decimal] = None
    total_amount: Optional[Decimal] = None
    remarks: Optional[str] = None
    items: Optional[List[PurchaseInvoiceItemCreate]] = None


class PurchaseInvoiceResponse(PurchaseInvoiceBase):
    id: int
    invoice_no: str
    paid_amount: Decimal = Decimal("0")
    balance_due: Decimal = Decimal("0")
    status: str = "draft"
    payment_status: str = "unpaid"
    created_by: Optional[int] = None
    verified_by: Optional[int] = None
    verified_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # Enriched
    supplier_name: Optional[str] = None
    items: List[PurchaseInvoiceItemResponse] = []

    class Config:
        from_attributes = True


class PurchaseInvoiceListResponse(PurchaseInvoiceBase):
    """Lighter response for list views (no items)."""
    id: int
    invoice_no: str
    paid_amount: float = 0.0
    balance_due: float = 0.0
    status: str = "unpaid"
    payment_status: str = "unpaid"
    created_at: Optional[datetime] = None
    supplier_name: Optional[str] = None
    days_overdue: int = 0
    is_overdue: bool = False
    advance_amount: float = 0.0
    po_nos: Optional[str] = None  # Comma-separated PO numbers linked to this invoice

    class Config:
        from_attributes = True


# ==================== PAYMENT ALLOCATION SCHEMAS ====================

class PaymentAllocationItem(BaseModel):
    """Single allocation line: how much of a payment goes to one invoice."""
    purchase_invoice_id: int
    allocated_amount: Decimal


class PaymentWithAllocationsCreate(BaseModel):
    """
    Create a supplier payment with explicit allocations to invoices.
    
    This is the standard ERP way:
    1. User selects invoices to pay
    2. Enters total payment amount
    3. Allocates amount across selected invoices
    4. System posts payment + updates invoice balances
    """
    supplier_id: int
    payment_date: date
    payment_method: str  # Cash, Bank Transfer, Cheque
    payment_amount: Decimal  # Total payment amount
    reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    branch_code: str
    remarks: Optional[str] = None
    # Allocations to invoices
    allocations: List[PaymentAllocationItem]


class PaymentAllocationResponse(BaseModel):
    id: int
    purchase_invoice_id: int
    supplier_payment_id: int
    allocated_amount: Decimal
    allocated_date: date
    remarks: Optional[str] = None
    # Enriched
    invoice_no: Optional[str] = None
    supplier_invoice_no: Optional[str] = None

    class Config:
        from_attributes = True


# ==================== FILTER / LIST SCHEMAS ====================

class PurchaseInvoiceListFilter(BaseModel):
    supplier_id: Optional[int] = None
    branch_code: Optional[str] = None
    status: Optional[str] = None
    payment_status: Optional[str] = None
    payment_type: Optional[str] = None  # "credit" or "non_credit"
    po_no: Optional[str] = None  # Filter by PO number (substring match)
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    overdue_only: Optional[bool] = False
    skip: int = 0
    limit: int = 100


# ==================== GRN INVOICEABLE STATUS ====================

class GRNInvoiceableProductDetail(BaseModel):
    """Product-level breakdown within a GRN."""
    product_id: int
    product_name: str
    po_item_id: int
    unit_price: float
    quantity: int
    line_total: float


class GRNInvoiceableItem(BaseModel):
    """Shows how much of a GRN has been invoiced vs remaining."""
    grn_id: int
    grn_no: str
    grn_date: str
    po_id: int
    po_no: str
    supplier_invoice_no: Optional[str] = None  # From GRN (legacy field, for reference)
    total_received_qty: int
    already_invoiced_qty: int
    remaining_qty: int
    total_received_amount: float
    already_invoiced_amount: float
    remaining_amount: float
    branch_code: str
    products: List[GRNInvoiceableProductDetail] = []


class OutstandingGRNItem(BaseModel):
    """Outstanding GRN across all suppliers - for the Outstanding GRNs report page."""
    grn_id: int
    grn_no: str
    grn_date: str
    po_id: int
    po_no: str
    supplier_id: int
    supplier_name: str
    supplier_invoice_no: Optional[str] = None
    total_received_qty: int
    total_received_amount: float
    remaining_amount: float
    branch_code: str
    days_since_grn: int = 0
