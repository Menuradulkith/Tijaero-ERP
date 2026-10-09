from datetime import date, datetime, timedelta
from enum import Enum
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, BeforeValidator, Field, StringConstraints, field_validator, model_validator

from app.common.base_schemas import TijaeroBaseSchema, VersionedSchema

INT4_MAX = 2_147_483_647
MAX_MONEY = 999_999_999.99


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def OptStr(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none)]


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


Money = Annotated[float, Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)]
PositiveMoney = Annotated[float, Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]
Id = Annotated[int, Field(ge=1, le=INT4_MAX)]


def _valid_until_ok(v):
    if v is not None:
        today = date.today()
        if v < today:
            raise ValueError("Valid-until date cannot be in the past")
        if v > today + timedelta(days=730):
            raise ValueError("Valid-until date must be within two years")
    return v


def _valid_until_loose(v):
    """Edits resend the stored date; only a changed date is checked against today (in the service)."""
    if v is not None:
        today = date.today()
        if v < today - timedelta(days=3650) or v > today + timedelta(days=730):
            raise ValueError("Valid-until date is out of range")
    return v


def _delivery_loose(v):
    if v is not None:
        today = date.today()
        if v < today - timedelta(days=3650) or v > today + timedelta(days=1095):
            raise ValueError("Expected delivery date is out of range")
    return v


def _delivery_ok(v):
    if v is not None:
        today = date.today()
        if v < today:
            raise ValueError("Expected delivery date cannot be in the past")
        if v > today + timedelta(days=1095):
            raise ValueError("Expected delivery date must be within three years")
    return v


class QuoteTypeEnum(str, Enum):
    QUOTATION = "quotation"


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
    PARTIALLY_PROCESSED = "partially_processed"
    COMPLETED = "completed"
    SO_CREATED = "so_created"
    CANCELLED = "cancelled"
    REVISED = "revised"


class DiscountTypeEnum(str, Enum):
    NONE = "none"
    PERCENTAGE = "percentage"
    FIXED = "fixed"


# ==================== Quote Item Schemas ====================


class SalesQuoteItemBase(BaseModel):
    """A quotation line as submitted (strict)."""

    product_id: Id
    quantity: int = Field(..., ge=1, le=1_000_000)
    selling_price: Money
    minimum_selling_price: Money
    warrenty_month: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{0,3}$")]

    # Quote specific
    min_price: Optional[Money] = None  # For estimate range
    max_price: Optional[Money] = None  # For estimate range
    is_price_estimate: bool = False
    description: OptStr(1000) = None
    discount_percent: float = Field(default=0, ge=0, le=100, allow_inf_nan=False)
    tax_rate: float = Field(default=0, ge=0, le=100, allow_inf_nan=False)
    remark: OptStr(500) = None
    # Optional price tier — when set, selling/min prices come from the tier
    price_tier_id: Optional[Id] = None

    @model_validator(mode="after")
    def _price_rules(self):
        if self.selling_price <= 0 and not self.is_price_estimate:
            raise ValueError("Selling price must be greater than zero (only price-estimate lines may be 0)")
        if self.minimum_selling_price > self.selling_price:
            raise ValueError("Selling price cannot be below the minimum selling price")
        if self.min_price is not None and self.max_price is not None and self.min_price > self.max_price:
            raise ValueError("Estimate minimum cannot exceed the estimate maximum")
        return self


class SalesQuoteItemCreate(SalesQuoteItemBase):
    """Schema for creating a quote item"""

    pass


class SalesQuoteItemUpdate(BaseModel):
    """Schema for updating a quote item"""

    product_id: Optional[Id] = None
    quantity: Optional[int] = Field(None, ge=1, le=1_000_000)
    selling_price: Optional[Money] = None
    minimum_selling_price: Optional[Money] = None
    warrenty_month: Optional[Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{0,3}$")]] = None
    min_price: Optional[Money] = None
    max_price: Optional[Money] = None
    is_price_estimate: Optional[bool] = None
    description: OptStr(1000) = None
    discount_percent: Optional[float] = Field(None, ge=0, le=100, allow_inf_nan=False)
    tax_rate: Optional[float] = Field(None, ge=0, le=100, allow_inf_nan=False)
    remark: OptStr(500) = None
    price_tier_id: Optional[Id] = None


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
    item_status: str = "pending"  # pending, partial, completed, cancelled
    converted_qty: int = 0  # units already converted to SO


class SalesQuoteItemWithProduct(SalesQuoteItem):
    """Schema for quote item with product details"""

    product_name: Optional[str] = None
    product_code: Optional[str] = None


# ==================== Quote Schemas ====================


class SalesQuoteBase(BaseModel):
    """Base schema for sales quote (strict input)"""

    quote_type: QuoteTypeEnum = QuoteTypeEnum.QUOTATION
    branch_code: ReqStr(200)
    customer_id: Id
    sale_rep_id: Optional[Id] = None  # Optional - can be assigned later
    customer_agent_id: Optional[Id] = None
    valid_until: date
    expected_delivery_date: Optional[date] = None

    # Quote specific
    is_estimate: bool = True
    payment_terms: OptStr(255) = None
    delivery_terms: OptStr(255) = None

    # Notes
    remarks: OptStr(2000) = None
    customer_notes: OptStr(2000) = None
    terms_conditions: OptStr(5000) = None

    # Discount
    discount_type: DiscountTypeEnum = DiscountTypeEnum.NONE
    discount_value: Money = 0

    # Tax
    tax_mode: Literal["none", "inclusive", "exclusive"] = "none"
    tax_rate: float = Field(default=0, ge=0, le=100, allow_inf_nan=False)

    # Flags
    special: bool = False

    _v_valid = field_validator("valid_until")(_valid_until_ok)
    _v_delivery = field_validator("expected_delivery_date")(_delivery_ok)

    @model_validator(mode="after")
    def _cross_rules(self):
        if self.discount_type == DiscountTypeEnum.PERCENTAGE and self.discount_value > 100:
            raise ValueError("A percentage discount cannot exceed 100")
        if self.customer_agent_id and self.customer_agent_id == self.customer_id:
            raise ValueError("A customer cannot be their own agent")
        return self


class SalesQuoteCreate(SalesQuoteBase):
    """Schema for creating a sales quote"""

    items: List[SalesQuoteItemCreate] = Field(..., min_length=1, max_length=200)


class SalesQuoteUpdate(BaseModel):
    """Schema for updating a sales quote"""

    branch_code: Optional[ReqStr(200)] = None
    customer_id: Optional[Id] = None
    sale_rep_id: Optional[Id] = None  # Optional
    customer_agent_id: Optional[Id] = None
    valid_until: Optional[date] = None
    expected_delivery_date: Optional[date] = None

    is_estimate: Optional[bool] = None
    payment_terms: OptStr(255) = None
    delivery_terms: OptStr(255) = None

    remarks: OptStr(2000) = None
    customer_notes: OptStr(2000) = None
    terms_conditions: OptStr(5000) = None

    discount_type: Optional[DiscountTypeEnum] = None
    discount_value: Optional[Money] = None

    special: Optional[bool] = None

    items: Optional[List[SalesQuoteItemCreate]] = Field(default=None, min_length=1, max_length=200)

    # Optimistic concurrency: the `version` token of the quote you loaded.
    expected_version: Optional[str] = Field(default=None, max_length=64)

    _v_valid = field_validator("valid_until")(_valid_until_loose)
    _v_delivery = field_validator("expected_delivery_date")(_delivery_loose)

    @model_validator(mode="before")
    @classmethod
    def _no_null_required(cls, values):
        if isinstance(values, dict):
            for n in ("branch_code", "customer_id", "valid_until", "discount_type", "discount_value"):
                if n in values and values[n] is None:
                    raise ValueError(f"{n} cannot be null")
        return values

    @model_validator(mode="after")
    def _cross_rules(self):
        if self.discount_type == DiscountTypeEnum.PERCENTAGE and (self.discount_value or 0) > 100:
            raise ValueError("A percentage discount cannot exceed 100")
        return self


class SalesQuoteStatusUpdate(BaseModel):
    """Schema for updating quote status"""

    status: QuoteStatusEnum
    remarks: OptStr(2000) = None


class SalesQuote(TijaeroBaseSchema, VersionedSchema):
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
    approved_by: Optional[int] = None
    approved_by_name: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
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

    # Discount & Tax
    discount_type: DiscountTypeEnum = DiscountTypeEnum.NONE
    discount_value: float = 0
    tax_mode: str = "none"
    tax_rate: float = 0

    # Advance payment linked to this quotation
    advance_payment_id: Optional[int] = None
    advance_amount: Optional[float] = None

    created_at: datetime
    updated_at: datetime


class SalesQuoteWithItems(SalesQuote):
    """Schema for sales quote with items"""

    items: List[SalesQuoteItem] = []


class RelatedPurchaseOrderSummary(BaseModel):
    """One PO generated from this quotation, for the quote's traceability panel"""

    id: int
    purchasing_order_no: str
    status: str
    supplier_name: Optional[str] = None
    ordered_quantity: int = 0
    received_quantity: int = 0


class SalesQuoteDetail(SalesQuoteWithItems):
    """Schema for detailed sales quote with related data"""

    customer_name: Optional[str] = None
    customer_agent_name: Optional[str] = None
    sale_rep_name: Optional[str] = None
    converted_invoice_no: Optional[str] = None
    related_purchase_orders: List[RelatedPurchaseOrderSummary] = []


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
    cash_amount: Money = 0
    card_visa_amount: Money = 0
    card_mastercard_amount: Money = 0
    card_amex_amount: Money = 0
    cheque_amount: Money = 0
    cheque_date: Optional[date] = None
    bank_transfer_amount: Money = 0
    credit_amount: Money = 0
    payment_adjustments: float = Field(default=0, ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False)
    remarks: OptStr(2000) = None


class ConvertToInvoiceResponse(BaseModel):
    """Response after converting quote to invoice"""

    quote_id: int
    quote_no: str
    invoice_id: int
    invoice_no: str
    message: str


class PartialSOItemRequest(BaseModel):
    """One item to include in a partial SO conversion"""
    item_id: Id  # SalesQuoteItem.id
    quantity: int = Field(..., ge=1, le=1_000_000)  # quantity to convert (may be less than total)


class CreatePartialSORequest(BaseModel):
    """Request to create a Sales Order from selected/partial quotation items"""
    items: List[PartialSOItemRequest] = Field(..., min_length=1, max_length=200)
    payment_method: str = Field(default="cash", max_length=30)
    remarks: OptStr(2000) = None


class CancelQuoteItemRequest(BaseModel):
    """Request to cancel one item on a quotation"""
    reason: OptStr(500) = None


class CancelQuoteRequest(BaseModel):
    """Cancelling a quotation needs a reason."""
    reason: ReqStr(500)


class MarkQuoteItemsRequest(BaseModel):
    """Mark selected quotation items as procurement (PO/ITN)"""
    item_ids: List[Id] = Field(..., min_length=1, max_length=200)


# ==================== Revision Schema ====================


class CreateRevisionRequest(BaseModel):
    """Schema for creating a quote revision"""

    remarks: OptStr(500) = None  # Reason for revision


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
    branch_codes: Optional[List[str]] = None  # allowed branches (access control)
    sort_by: Optional[str] = None
    order: str = "desc"


# ==================== Stock Availability Schema ====================


class StockAvailabilityBranch(BaseModel):
    branch_code: str
    available_quantity: int


class StockAvailabilityItem(BaseModel):
    """Stock availability for a single product"""
    product_id: int
    product_name: Optional[str] = None
    requested_quantity: int
    available_quantity: int
    current_branch_available: int
    is_sufficient: bool
    other_branches: List[StockAvailabilityBranch] = []
    # Partial availability: only this much actually needs to be purchased —
    # requested_quantity minus what's already in stock at this branch.
    to_purchase_quantity: int = 0


class StockAvailabilityResponse(BaseModel):
    """Stock availability check result"""
    quote_id: int
    branch_code: str
    items: List[StockAvailabilityItem]
    all_sufficient: bool


# ==================== Procurement / Reservation Schemas ====================


class ProcurementSummaryItem(BaseModel):
    """Required vs. procured vs. reserved/available quantities for one quote item."""
    item_id: int
    product_id: int
    product_name: Optional[str] = None
    required_quantity: int
    ordered_quantity: int
    received_quantity: int
    reserved_quantity: int
    on_hand_quantity: int
    available_quantity: int
    outstanding_quantity: int
    to_purchase_quantity: int = 0


class ProcurementSummaryResponse(BaseModel):
    quote_id: int
    branch_code: str
    items: List[ProcurementSummaryItem]


class ReleaseReservationRequest(BaseModel):
    """Explicitly release procurement stock reserved for this quotation
    (or a single item on it) back to available. Business rule: reservations
    are never released automatically — only on quotation cancellation or an
    authorized user's explicit action here."""
    item_id: Optional[Id] = None
    reason: OptStr(500) = None


class ReleaseReservationResponse(BaseModel):
    quote_id: int
    units_released: int
    message: str


# ==================== Reject Quote Schema ====================


class RejectQuoteRequest(BaseModel):
    """Request to reject a quote"""
    reason: OptStr(500) = None
    cancel_linked_po: bool = False  # Whether to cancel the linked PO if one exists


# ==================== Customer Approval Schema ====================


class CustomerApprovalRequest(BaseModel):
    """Request to mark customer approval"""
    approved_by_customer: OptStr(255) = None  # Customer contact name
    remarks: OptStr(2000) = None
