from pydantic import BaseModel, EmailStr, Field, field_validator
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema
from app.common.enums import PurchaseOrderStatus, DocumentStatus

class SupplierBase(BaseModel):
    title: str
    full_name: str
    name_in_cheque_card: Optional[str] = None
    occupation: Optional[str] = None
    company_name: Optional[str] = None
    company_registration_number: Optional[str] = None
    company_postal_address: Optional[str] = None
    company_contact_number: Optional[str] = None
    company_website: Optional[str] = None
    postal_address: str
    permenent_address: str
    bank_details: Optional[str] = None
    birthdate: Optional[date] = None
    id_card_number: Optional[str] = None
    gender: str
    civil_status: str
    passport_no: Optional[str] = None
    no_of_kids: str
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
    title: Optional[str] = None
    full_name: Optional[str] = None
    name_in_cheque_card: Optional[str] = None
    occupation: Optional[str] = None
    company_name: Optional[str] = None
    company_registration_number: Optional[str] = None
    company_postal_address: Optional[str] = None
    company_contact_number: Optional[str] = None
    company_website: Optional[str] = None
    postal_address: Optional[str] = None
    permenent_address: Optional[str] = None
    bank_details: Optional[str] = None
    birthdate: Optional[date] = None
    id_card_number: Optional[str] = None
    gender: Optional[str] = None
    civil_status: Optional[str] = None
    passport_no: Optional[str] = None
    no_of_kids: Optional[str] = None
    email: Optional[EmailStr] = None
    home_contact_number: Optional[str] = None
    mobile_contact_number: Optional[str] = None
    credit_days: Optional[int] = None
    max_credit_limit: Optional[Decimal] = None
    active: Optional[bool] = None
    country_id: Optional[int] = None

class Supplier(SupplierBase, TijaeroBaseSchema):
    id: int
    date_joined: datetime
    left_credit_amount: Optional[Decimal] = None
    initial_credit_amount: Optional[Decimal] = None

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

