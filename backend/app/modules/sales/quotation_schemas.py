from datetime import date, datetime
from enum import Enum
from typing import List, Optional

from pydantic import BaseModel, Field

from app.common.base_schemas import TijaeroBaseSchema


class QuoteTypeEnum(str, Enum):
    QUOTATION = "quotation"
    PROFORMA = "proforma"


class QuoteStatusEnum(str, Enum):
    DRAFT = "draft"
    PENDING_APPROVAL = "pending_approval"
    SUBMITTED = "submitted"
    UNDER_REVIEW = "under_review"
    APPROVED = "approved"
    SENT = "sent"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    EXPIRED = "expired"
    CONVERTED = "converted"
    CONVERTED_TO_INVOICE = "converted_to_invoice"
    PO_CREATED = "po_created"
    ITEM_RECEIVED = "item_received"
    SO_CREATED = "so_created"
    CANCELLED = "cancelled"
    REVISED = "revised"


class DiscountTypeEnum(str, Enum):
    NONE = "none"
    PERCENTAGE = "percentage"
    FIXED = "fixed"


# ==================== Quote Item Schemas ====================


class SalesQuoteItemBase(BaseModel):
    """Base schema for quote items"""

    product_id: int
    quantity: int = Field(..., gt=0)
    selling_price: float = Field(..., ge=0)
    minimum_selling_price: float = Field(..., ge=0)
    warrenty_month: str = Field(..., max_length=30)

    # Quote specific
    min_price: Optional[float] = Field(None, ge=0)  # For estimate range
    max_price: Optional[float] = Field(None, ge=0)  # For estimate range
    is_price_estimate: bool = False
    description: Optional[str] = None
    discount_percent: float = Field(default=0, ge=0, le=100)
    tax_rate: float = Field(default=0, ge=0, le=100)
    remark: Optional[str] = None


class SalesQuoteItemCreate(SalesQuoteItemBase):
    """Schema for creating a quote item"""

    pass


class SalesQuoteItemUpdate(BaseModel):
    """Schema for updating a quote item"""

    product_id: Optional[int] = None
    quantity: Optional[int] = Field(None, gt=0)
    selling_price: Optional[float] = Field(None, ge=0)
    minimum_selling_price: Optional[float] = Field(None, ge=0)
    warrenty_month: Optional[str] = Field(None, max_length=30)
    min_price: Optional[float] = Field(None, ge=0)
    max_price: Optional[float] = Field(None, ge=0)
    is_price_estimate: Optional[bool] = None
    description: Optional[str] = None
    discount_percent: Optional[float] = Field(None, ge=0, le=100)
    tax_rate: Optional[float] = Field(None, ge=0, le=100)
    remark: Optional[str] = None


class SalesQuoteItem(TijaeroBaseSchema):
    """Schema for quote item response"""

    id: int
    quote_id: int
    product_id: int
    quantity: int
    selling_price: float
    minimum_selling_price: float
    warrenty_month: str
    created_date: datetime
    is_price_estimate: bool = False
    stock_status: Optional[str] = None  # 'in_stock', 'needs_procurement', or None
    description: Optional[str] = None
    remark: Optional[str] = None
    discount_percentage: float = 0


class SalesQuoteItemWithProduct(SalesQuoteItem):
    """Schema for quote item with product details"""

    product_name: Optional[str] = None
    product_code: Optional[str] = None


# ==================== Quote Schemas ====================


class SalesQuoteBase(BaseModel):
    """Base schema for sales quote"""

    quote_type: QuoteTypeEnum = QuoteTypeEnum.QUOTATION
    branch_code: str = Field(..., max_length=200)
    customer_id: int
    sale_rep_id: Optional[int] = None  # Optional - can be assigned later
    customer_agent_id: Optional[int] = None
    valid_until: date
    expected_delivery_date: Optional[date] = None

    # Quote specific
    is_estimate: bool = True  # True for quotation, False for proforma
    payment_terms: Optional[str] = None
    delivery_terms: Optional[str] = None

    # Notes
    remarks: Optional[str] = None
    customer_notes: Optional[str] = None
    terms_conditions: Optional[str] = None

    # Discount
    discount_type: DiscountTypeEnum = DiscountTypeEnum.NONE
    discount_value: float = Field(default=0, ge=0)

    # Flags
    special: bool = False


class SalesQuoteCreate(SalesQuoteBase):
    """Schema for creating a sales quote"""

    items: List[SalesQuoteItemCreate]


class SalesQuoteUpdate(BaseModel):
    """Schema for updating a sales quote"""

    branch_code: Optional[str] = Field(None, max_length=200)
    customer_id: Optional[int] = None
    sale_rep_id: Optional[int] = None  # Optional
    customer_agent_id: Optional[int] = None
    valid_until: Optional[date] = None
    expected_delivery_date: Optional[date] = None

    is_estimate: Optional[bool] = None
    payment_terms: Optional[str] = None
    delivery_terms: Optional[str] = None

    remarks: Optional[str] = None
    customer_notes: Optional[str] = None
    terms_conditions: Optional[str] = None

    discount_type: Optional[DiscountTypeEnum] = None
    discount_value: Optional[float] = Field(None, ge=0)

    special: Optional[bool] = None

    items: Optional[List[SalesQuoteItemCreate]] = None


class SalesQuoteStatusUpdate(BaseModel):
    """Schema for updating quote status"""

    status: QuoteStatusEnum
    remarks: Optional[str] = None


class SalesQuote(TijaeroBaseSchema):
    """Schema for sales quote response"""

    id: int
    quote_no: str
    quote_type: QuoteTypeEnum
    branch_code: str
    customer_id: int
    sale_rep_id: Optional[int] = None
    customer_agent_id: Optional[int] = None
    created_date: date
    created_date_time: datetime
    valid_until: date
    expected_delivery_date: Optional[date] = None
    status: QuoteStatusEnum
    approval: bool
    approval_id: Optional[int] = None
    special: bool = False
    sys_code: Optional[int] = None
    is_estimate: bool = True
    remarks: Optional[str] = None
    customer_notes: Optional[str] = None
    total_amount: float

    # Conversion
    converted_to_invoice_id: Optional[int] = None
    converted_at: Optional[datetime] = None
    converted_by: Optional[int] = None
    
    # Workflow date tracking
    submitted_date: Optional[datetime] = None
    po_created_date: Optional[datetime] = None
    approved_date: Optional[datetime] = None
    approved_by_customer: Optional[str] = None
    rejection_date: Optional[datetime] = None
    conversion_date: Optional[datetime] = None
    linked_po_id: Optional[int] = None

    # Revision tracking
    parent_quote_id: Optional[int] = None
    revision_number: int = 1

    # Rejection
    rejection_reason: Optional[str] = None

    created_at: datetime
    updated_at: datetime


class SalesQuoteWithItems(SalesQuote):
    """Schema for sales quote with items"""

    items: List[SalesQuoteItem] = []


class SalesQuoteDetail(SalesQuoteWithItems):
    """Schema for detailed sales quote with related data"""

    customer_name: Optional[str] = None
    customer_agent_name: Optional[str] = None
    sale_rep_name: Optional[str] = None
    converted_invoice_no: Optional[str] = None


class SalesQuoteList(BaseModel):
    """Schema for paginated list of quotes"""

    items: List[SalesQuote]
    total: int
    page: int
    per_page: int
    pages: int


# ==================== Conversion Schemas ====================


class ConvertToInvoiceRequest(BaseModel):
    """Schema for converting quote to invoice"""

    payment_method: str = Field(..., max_length=30)
    cash_amount: float = Field(default=0, ge=0)
    card_visa_amount: float = Field(default=0, ge=0)
    card_mastercard_amount: float = Field(default=0, ge=0)
    card_amex_amount: float = Field(default=0, ge=0)
    cheque_amount: float = Field(default=0, ge=0)
    cheque_date: Optional[date] = None
    bank_transfer_amount: float = Field(default=0, ge=0)
    credit_amount: float = Field(default=0, ge=0)
    payment_adjustments: float = Field(default=0)
    remarks: Optional[str] = None


class ConvertToInvoiceResponse(BaseModel):
    """Response after converting quote to invoice"""

    quote_id: int
    quote_no: str
    invoice_id: int
    invoice_no: str
    message: str


# ==================== Revision Schema ====================


class CreateRevisionRequest(BaseModel):
    """Schema for creating a quote revision"""

    remarks: Optional[str] = None  # Reason for revision


class CreateRevisionResponse(BaseModel):
    """Response after creating a revision"""

    original_quote_id: int
    original_quote_no: str
    new_quote_id: int
    new_quote_no: str
    revision_number: int
    message: str


# ==================== Filter/Search Schemas ====================


class SalesQuoteFilter(BaseModel):
    """Schema for filtering quotes"""

    quote_type: Optional[QuoteTypeEnum] = None
    status: Optional[QuoteStatusEnum] = None
    customer_id: Optional[int] = None
    sale_rep_id: Optional[int] = None
    branch_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    is_expired: Optional[bool] = None
    search: Optional[str] = None  # Search in quote_no, customer name


# ==================== Stock Availability Schema ====================


class StockAvailabilityItem(BaseModel):
    """Stock availability for a single product"""
    product_id: int
    product_name: Optional[str] = None
    requested_quantity: int
    available_quantity: int
    is_sufficient: bool


class StockAvailabilityResponse(BaseModel):
    """Stock availability check result"""
    quote_id: int
    branch_code: str
    items: List[StockAvailabilityItem]
    all_sufficient: bool


# ==================== Create PO from Quotation Schema ====================


class CreatePOFromQuoteRequest(BaseModel):
    """Request to create a PO from an accepted quotation"""
    first_suppliers_id: int
    second_suppliers_id: int
    payment_method: str = Field(..., max_length=30)
    purchasing_invoice_no: str = Field(..., max_length=200)
    good_received_note_date: date
    remarks: Optional[str] = None
    credit_date: Optional[int] = None


class CreatePOFromQuoteResponse(BaseModel):
    """Response after creating PO from quotation"""
    quote_id: int
    quote_no: str
    purchasing_order_id: int
    purchasing_order_no: str
    message: str


# ==================== Proforma Toggle Schema ====================


class ToggleProformaRequest(BaseModel):
    """Request to toggle proforma invoice status"""
    is_proforma: bool


class ToggleProformaResponse(BaseModel):
    """Response after toggling proforma status"""
    quote_id: int
    quote_no: str
    is_proforma: bool
    quote_type: str
    message: str


# ==================== Reject Quote Schema ====================


class RejectQuoteRequest(BaseModel):
    """Request to reject a quote"""
    reason: Optional[str] = None
    cancel_linked_po: bool = False  # Whether to cancel the linked PO if one exists


# ==================== Customer Approval Schema ====================


class CustomerApprovalRequest(BaseModel):
    """Request to mark customer approval"""
    approved_by_customer: Optional[str] = None  # Customer contact name
    remarks: Optional[str] = None
