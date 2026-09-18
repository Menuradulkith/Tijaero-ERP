from pydantic import BaseModel, EmailStr, Field, field_validator, field_serializer
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema, AuditSchema, format_datetime
from app.common.enums import PurchaseOrderStatus, DocumentStatus

class SupplierBase(BaseModel):
    company_name: str = Field(..., min_length=1)
    company_registration_number: Optional[str] = None
    tax_registration_number: Optional[str] = None
    company_website: Optional[str] = None
    billing_address_line1: str
    billing_address_line2: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_postal_code: Optional[str] = None
    shipping_address_line1: Optional[str] = None
    shipping_address_line2: Optional[str] = None
    shipping_city: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_postal_code: Optional[str] = None
    email: Optional[EmailStr] = None
    home_contact_number: Optional[str] = None
    mobile_contact_number: str
    credit_days: int
    max_credit_limit: Decimal
    active: bool = True
    country_id: Optional[int] = None

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
    company_name: Optional[str] = Field(default=None, min_length=1)
    company_registration_number: Optional[str] = None
    tax_registration_number: Optional[str] = None
    company_website: Optional[str] = None
    billing_address_line1: Optional[str] = None
    billing_address_line2: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_postal_code: Optional[str] = None
    shipping_address_line1: Optional[str] = None
    shipping_address_line2: Optional[str] = None
    shipping_city: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_postal_code: Optional[str] = None
    email: Optional[EmailStr] = None
    home_contact_number: Optional[str] = None
    mobile_contact_number: Optional[str] = None
    credit_days: Optional[int] = None
    max_credit_limit: Optional[Decimal] = None
    active: Optional[bool] = None
    country_id: Optional[int] = None
    # Optimistic concurrency check: the `updated_at` the client last saw for
    # this supplier. If omitted, no check is performed (backward compatible).
    # If it no longer matches the current row, the update is rejected with a
    # 409 instead of silently overwriting someone else's more recent change.
    expected_updated_at: Optional[datetime] = None

class Supplier(SupplierBase, AuditSchema):
    id: int
    date_joined: datetime
    left_credit_amount: Optional[Decimal] = None
    initial_credit_amount: Optional[Decimal] = None
    logo_path: Optional[str] = None
    average_lead_time_days: Optional[float] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


class SupplierActivityLogEntry(BaseModel):
    """One row of the supplier's modification history (Record Information ->
    Activity History), backed by the generic audit_logs table."""
    id: int
    action: str
    changes: Optional[dict] = None
    timestamp: datetime
    user_id: int
    user_name: Optional[str] = None

    @field_serializer('timestamp')
    def _serialize_timestamp(self, dt: datetime) -> str:
        return format_datetime(dt)


def _validate_birthdate_not_future(v: Optional[date]) -> Optional[date]:
    if v is not None and v > date.today():
        raise ValueError("Birthdate cannot be a future date")
    return v


class SupplierContactPersonBase(BaseModel):
    title: Optional[str] = None
    full_name: str
    occupation: Optional[str] = None
    gender: Optional[str] = None
    birthdate: Optional[date] = None
    id_card_number: Optional[str] = None
    passport_no: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None

    @field_validator("birthdate")
    @classmethod
    def _birthdate_not_future(cls, v):
        return _validate_birthdate_not_future(v)


class SupplierContactPersonCreate(SupplierContactPersonBase):
    pass


class SupplierContactPersonUpdate(BaseModel):
    title: Optional[str] = None
    full_name: Optional[str] = None
    occupation: Optional[str] = None
    gender: Optional[str] = None
    birthdate: Optional[date] = None
    id_card_number: Optional[str] = None
    passport_no: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None

    @field_validator("birthdate")
    @classmethod
    def _birthdate_not_future(cls, v):
        return _validate_birthdate_not_future(v)


class SupplierContactPerson(SupplierContactPersonBase, AuditSchema):
    id: int
    supplier_id: int


class SupplierPaymentMethodBase(BaseModel):
    method_type: str  # cash, bank_transfer, cheque
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    is_default: bool = False
    active: bool = True


class SupplierPaymentMethodCreate(SupplierPaymentMethodBase):
    pass


class SupplierPaymentMethodUpdate(BaseModel):
    method_type: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    is_default: Optional[bool] = None
    active: Optional[bool] = None


class SupplierPaymentMethod(SupplierPaymentMethodBase, AuditSchema):
    id: int
    supplier_id: int


class SupplierProductBase(BaseModel):
    product_id: int
    supplier_sku: Optional[str] = None
    cost_price: Decimal = Field(..., ge=0)
    lead_time_days: Optional[int] = Field(default=None, ge=0)
    minimum_order_qty: Optional[int] = Field(default=None, ge=1)
    is_preferred: bool = False
    active: bool = True


class SupplierProductCreate(SupplierProductBase):
    pass


class SupplierProductUpdate(BaseModel):
    supplier_sku: Optional[str] = None
    cost_price: Optional[Decimal] = Field(default=None, ge=0)
    lead_time_days: Optional[int] = Field(default=None, ge=0)
    minimum_order_qty: Optional[int] = Field(default=None, ge=1)
    is_preferred: Optional[bool] = None
    active: Optional[bool] = None


class SupplierProduct(SupplierProductBase, AuditSchema):
    id: int
    supplier_id: int
    # Populated by the service for display — the product's own name/code
    # when listing from the supplier side, and the supplier's company name
    # when listing from the product side.
    product_name: Optional[str] = None
    product_item_code: Optional[str] = None
    supplier_company_name: Optional[str] = None


class PurchasingOrderItemBase(BaseModel):
    product_id: int
    quantity: int
    unit_price: Decimal
    warrenty_month: str
    remark: Optional[str] = None

class PurchasingOrderItemCreate(PurchasingOrderItemBase):
    pass

class PurchasingOrderItem(PurchasingOrderItemBase, TijaeroBaseSchema):
    id: int
    purchasingorders_id: int
    created_date: date
    added_date: datetime

class PurchasingOrderBase(BaseModel):
    purchasing_order_no: Optional[str] = None  # Auto-generated on server
    purchasing_invoice_no: Optional[str] = None
    branch_code: str
    payment_method: str
    purchasing_order_date: date
    good_received_note_date: date
    remarks: Optional[str] = None
    credit_date: Optional[int] = None
    first_suppliers_id: int
    second_suppliers_id: Optional[int] = None
    sales_quote_id: Optional[int] = None  # Link to source proforma/quotation

class PurchasingOrderCreate(PurchasingOrderBase):
    items: List[PurchasingOrderItemCreate]

class PurchasingOrderUpdate(BaseModel):
    purchasing_invoice_no: Optional[str] = None
    branch_code: Optional[str] = None
    payment_method: Optional[str] = None
    purchasing_order_date: Optional[date] = None
    good_received_note_date: Optional[date] = None
    remarks: Optional[str] = None
    credit_date: Optional[int] = None
    first_suppliers_id: Optional[int] = None
    second_suppliers_id: Optional[int] = None
    status: Optional[str] = None
    items: Optional[List[PurchasingOrderItemCreate]] = None

class PurchasingOrder(PurchasingOrderBase, TijaeroBaseSchema):
    id: int
    created_date: date
    added_date: datetime
    approval_id: Optional[int] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    approved_by: Optional[int] = None
    approved_by_name: Optional[str] = None
    status: PurchaseOrderStatus = PurchaseOrderStatus.PENDING
    total_amount: Decimal = Decimal("0.00")
    paid_amount: Decimal = Decimal("0.00")
    sales_quote_id: Optional[int] = None
    supplier_name: Optional[str] = None  # Populated from first_supplier relationship
    
    @field_validator('status', mode='before')
    @classmethod
    def default_status(cls, v):
        return v if v is not None else PurchaseOrderStatus.PENDING

class PurchasingOrderWithItems(PurchasingOrder):
    items: List[PurchasingOrderItem] = []

class PurchasingReturnItemBase(BaseModel):
    product_id: int
    purchasing_price: Decimal
    return_price: Decimal
    barcode: str
    sales_stock_id: Optional[int] = None 

class PurchasingReturnItemCreate(PurchasingReturnItemBase):
    pass

class PurchasingReturnItem(PurchasingReturnItemBase, TijaeroBaseSchema):
    id: int
    purchasingreturn_id: int
    branch_code: str
    added_date: datetime
    product_name: Optional[str] = None
    warranty_month: Optional[str] = None

class PurchasingReturnBase(BaseModel):
    purchasing_return_no: Optional[str] = None 
    branch_code: str
    remark: Optional[str] = None
    goodreceivednote_id: int

class PurchasingReturnCreate(PurchasingReturnBase):
    items: List[PurchasingReturnItemCreate]
    require_approval: bool = False 

class PurchasingReturn(PurchasingReturnBase, TijaeroBaseSchema):
    id: int
    added_date: date
    status: str = DocumentStatus.DRAFT
    approved_date: Optional[datetime] = None
    approval_id: Optional[int] = None
    grn_no: Optional[str] = None  # Populated from good_received_note relationship
    po_no: Optional[str] = None  # Populated from GRN→PO
    supplier_name: Optional[str] = None  # Populated from GRN→PO→supplier

class PurchasingReturnWithItems(PurchasingReturn):
    items: List[PurchasingReturnItem] = []

class BarcodeValidationRequest(BaseModel):
    barcode: str
    grn_id: int
    branch_code: str

class BarcodeValidationResponse(BaseModel):
    valid: bool
    barcode: str
    message: str
    sales_stock_id: Optional[int] = None
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    purchasing_price: Optional[Decimal] = None
    status: Optional[str] = None
    warranty_month: Optional[str] = None  # Warranty period from stock item
    warranty_expired: bool = False  # True if warranty period has passed
    warranty_expiry_date: Optional[str] = None  # When warranty expires


class PurchaseReturnApprovalRequest(BaseModel):
    return_id: int
    approve: bool 
    remarks: Optional[str] = None



class SupplierListFilter(BaseModel):
    active: Optional[bool] = None
    country_id: Optional[int] = None
    search: Optional[str] = None
    min_credit_limit: Optional[int] = None
    skip: int = 0
    limit: int = 100

class PurchaseOrderListFilter(BaseModel):
    status: Optional[str] = None
    supplier_id: Optional[int] = None
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # For branch-based access control
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    for_grn: bool = False  # When True, only return POs eligible for GRN creation (approved/partially_completed)
    skip: int = 0
    limit: int = 100

class GoodReceivedNoteBase(BaseModel):
    good_received_no: Optional[str] = None  # Auto-generated on server
    good_received_date: date
    supplier_invoice_no: str
    supplier_invoice_date: date
    remark: Optional[str] = None
    branch_code: str
    good_received_locations_id: int
    purchasingorders_id: int

class GoodReceivedNoteCreate(GoodReceivedNoteBase):
    pass

class GoodReceivedNote(GoodReceivedNoteBase, TijaeroBaseSchema):
    id: int
    created_date: date
    added_date: datetime
    po_no: Optional[str] = None  # Populated from purchasing_order relationship
    supplier_name: Optional[str] = None  # Populated from PO→supplier

class GoodReceivedItemBase(BaseModel):
    good_received_note: str
    barcode: str
    branch_code: str
    active: bool = True
    purchasing_order_items_id: int

class GoodReceivedItemCreate(GoodReceivedItemBase):
    pass

class GoodReceivedItem(GoodReceivedItemBase, TijaeroBaseSchema):
    id: int
    created_date: date
    added_date: datetime


class GoodReceivedItemWithDetails(GoodReceivedItem):
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    saved_to_sales_stock: bool = False
    saved_to_company_assets: bool = False

class GoodReceivedNoteListFilter(BaseModel):
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # For multi-branch access control
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100

class SupplierCreditsSettleTransactionBase(BaseModel):
    payment_method: str
    cheque_date: date
    payment_amount: Decimal
    payment_method_number: Optional[str] = None
    remarks: Optional[str] = None
    good_received_id: int

class SupplierCreditsSettleTransactionCreate(SupplierCreditsSettleTransactionBase):
    pass

class SupplierCreditsSettleTransaction(SupplierCreditsSettleTransactionBase, TijaeroBaseSchema):
    id: int
    supplier_credit_settle_id: int
    created_date: datetime
    grn_no: Optional[str] = None
    po_no: Optional[str] = None
    invoice_no: Optional[str] = None

class SupplierCreditsSettleBase(BaseModel):
    supplier_credits_settle_no: str
    branch_code: str
    suppliers_id: int

class SupplierCreditsSettleCreate(SupplierCreditsSettleBase):
    transactions: List[SupplierCreditsSettleTransactionCreate]

class SupplierCreditsSettleUpdate(BaseModel):
    branch_code: Optional[str] = None
    status: Optional[str] = None

class SupplierCreditsSettle(TijaeroBaseSchema, SupplierCreditsSettleBase):
    id: int
    created_date: datetime
    status: str
    verified_by: Optional[int] = None
    verified_date: Optional[datetime] = None

class SupplierCreditsSettleWithTransactions(SupplierCreditsSettle):
    transactions: List[SupplierCreditsSettleTransaction] = []

class DailyPOLimitCheck(BaseModel):
    branch_code: str
    date: date
    count: int
    limit: int
    remaining: int
    can_create: bool
    message: str

class CreditCheckResult(BaseModel):
    allowed: bool
    requires_approval: bool = False
    current_outstanding: float
    po_value: float
    projected_outstanding: float
    max_credit_limit: float
    available_credit: float
    will_exceed_limit: bool
    excess_amount: float
    overdue_count: int
    has_overdue: bool
    message: str
    warning_level: str = "none" 

class POCreditCheckResponse(BaseModel):
    can_save: bool
    requires_approval: bool
    suggested_status: str
    credit_check: CreditCheckResult
    message: str


class GRNCreditCheckResponse(BaseModel):
    can_post: bool
    requires_override: bool
    credit_check: CreditCheckResult
    message: str


class SupplierPaymentBase(BaseModel):
    supplier_id: int
    purchasing_order_id: Optional[int] = None
    payment_date: date
    payment_method: str 
    payment_amount: Decimal
    reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    branch_code: str
    payment_for: str 
    invoice_reference: Optional[str] = None
    remarks: Optional[str] = None


class SupplierPaymentCreate(SupplierPaymentBase):
    pass


class SupplierPaymentUpdate(BaseModel):
    payment_date: Optional[date] = None
    payment_method: Optional[str] = None
    payment_amount: Optional[Decimal] = None
    reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    payment_for: Optional[str] = None
    invoice_reference: Optional[str] = None
    remarks: Optional[str] = None
    status: Optional[str] = None


class SupplierPaymentCancel(BaseModel):
    remarks: Optional[str] = None


class SupplierPayment(SupplierPaymentBase, TijaeroBaseSchema):
    id: int
    payment_no: str
    status: str
    verified_by: Optional[int] = None
    verified_date: Optional[datetime] = None
    created_date: datetime
    created_by: Optional[int] = None
    
    supplier_name: Optional[str] = None
    po_no: Optional[str] = None


class SupplierPaymentListFilter(BaseModel):
    supplier_id: Optional[int] = None
    branch_code: Optional[str] = None
    payment_method: Optional[str] = None
    payment_for: Optional[str] = None
    status: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100


# ==================== SUPPLIER ADVANCE PAYMENT SCHEMAS ====================

class SupplierAdvancePaymentBase(BaseModel):
    supplier_id: int
    purchasing_order_id: Optional[int] = None
    payment_date: date
    payment_method: str  # Cash, Bank Transfer, Cheque
    original_amount: Decimal  # Original advance amount
    reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    branch_code: str
    remarks: Optional[str] = None


class SupplierAdvancePaymentCreate(SupplierAdvancePaymentBase):
    pass


class SupplierAdvancePaymentUpdate(BaseModel):
    payment_date: Optional[date] = None
    payment_method: Optional[str] = None
    reference_number: Optional[str] = None
    bank_name: Optional[str] = None
    remarks: Optional[str] = None


class SupplierAdvanceReturnCreate(BaseModel):
    return_amount: Decimal
    return_date: date
    return_method: str  # Cash, Bank Transfer, Cheque
    return_reference: Optional[str] = None
    return_remarks: Optional[str] = None


class SupplierAdvancePayment(SupplierAdvancePaymentBase, TijaeroBaseSchema):
    id: int
    advance_no: str
    payment_voucher_id: Optional[int] = None
    applied_amount: Decimal  # Amount already applied
    remaining_amount: Decimal  # Remaining balance
    is_fully_applied: bool  # True when fully applied
    returned_amount: Decimal = Decimal("0")
    return_date: Optional[date] = None
    return_method: Optional[str] = None
    return_reference: Optional[str] = None
    return_remarks: Optional[str] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    # Loaded from relationships
    supplier_name: Optional[str] = None
    po_no: Optional[str] = None


class SupplierAdvancePaymentWithApplications(SupplierAdvancePayment):
    applications: List["SupplierAdvanceApplication"] = []


class SupplierAdvancePaymentListFilter(BaseModel):
    supplier_id: Optional[int] = None
    branch_code: Optional[str] = None
    is_fully_applied: Optional[bool] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100


# ==================== SUPPLIER ADVANCE APPLICATION SCHEMAS ====================

class SupplierAdvanceApplicationBase(BaseModel):
    advance_id: int
    grn_id: Optional[int] = None
    purchase_invoice_id: Optional[int] = None
    applied_amount: Decimal
    application_date: date
    remarks: Optional[str] = None


class SupplierAdvanceApplicationCreate(SupplierAdvanceApplicationBase):
    pass


class SupplierAdvanceApplication(SupplierAdvanceApplicationBase, TijaeroBaseSchema):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    # Loaded from relationships
    grn_no: Optional[str] = None
    purchase_invoice_no: Optional[str] = None
    advance_no: Optional[str] = None


class SupplierAdvanceBalanceSummary(BaseModel):
    """Summary of advance payment balance for a supplier"""
    supplier_id: int
    supplier_name: str
    total_advances: Decimal
    total_applied: Decimal
    available_balance: Decimal
    active_advance_count: int
    advances: List[SupplierAdvancePayment] = []


# ==================== PAYMENT REPORT SCHEMAS ====================

class PaymentReportItem(BaseModel):
    """Unified payment report row — covers direct payments, credit settlements, and advance applications."""
    id: int
    date: str
    type: str  # "Direct Payment" | "Credit Settlement" | "Advance Application"
    supplier_id: int
    supplier_name: str
    document_no: str
    po_no: Optional[str] = None
    invoice_no: Optional[str] = None
    grn_reference: Optional[str] = None
    payment_method: Optional[str] = None
    amount: float
    status: str
    branch_code: Optional[str] = None
    remarks: Optional[str] = None


class PaymentReportSummary(BaseModel):
    total_amount: float = 0
    total_count: int = 0
    direct_payments: float = 0
    direct_payments_count: int = 0
    credit_settlements: float = 0
    credit_settlements_count: int = 0
    advance_payments: float = 0
    advance_payments_count: int = 0
    advance_applications: float = 0
    advance_applications_count: int = 0
    pending_amount: float = 0
    pending_count: int = 0


class PaymentReportResponse(BaseModel):
    items: List[PaymentReportItem] = []
    summary: PaymentReportSummary = PaymentReportSummary()


# Outstanding Documents Schemas
class SupplierOutstandingDocItem(BaseModel):
    document_id: int           # grn_id for credit, po_id for non-credit
    document_no: str           # grn_no or po_no
    document_type: str         # "Credit GRN" or "Non-Credit PO"
    document_date: str         # grn_date or po_date
    reference_no: str          # supplier_invoice_no (GRN) or purchasing_invoice_no (PO)
    po_no: str                 # always the PO number
    supplier_id: int
    supplier_name: str
    total_amount: float
    paid_amount: float
    balance_due: float
    due_date: str
    days_overdue: int
    is_overdue: bool
    branch_code: str


class SupplierOutstandingDocSummary(BaseModel):
    total_documents: int = 0
    total_outstanding: float = 0
    total_overdue: float = 0
    overdue_count: int = 0


class SupplierOutstandingDocsReport(BaseModel):
    items: List[SupplierOutstandingDocItem] = []
    summary: SupplierOutstandingDocSummary = SupplierOutstandingDocSummary()

