import re
from pydantic import BaseModel, BeforeValidator, EmailStr, Field, StringConstraints, model_validator, field_validator
from app.common.validators import normalize_phone_number
from typing import Annotated, Generic, Literal, Optional, List, TypeVar
from datetime import datetime, date
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema, VersionedSchema
from app.modules.customers.enums import CustomerType


# ---- input hygiene ----------------------------------------------------------
# Every text column has a length limit, so an over-long value is a 422 with a
# field message instead of a database error (500). Text is trimmed; optional
# text/date/number that arrives blank ("" from an untouched form field)
# becomes None; an explicit null on a required field is a 422.
INT4_MAX = 2_147_483_647
T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """One page of a server-side paged list; total is the filtered row count across all pages."""
    items: List[T]
    total: int
    page: int
    size: int
    pages: int


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


def OptStr(n: int, pattern: Optional[str] = None):
    return Annotated[
        Optional[Annotated[str, StringConstraints(max_length=n, pattern=pattern)]],
        BeforeValidator(_blank_to_none),
    ]


_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
GENDERS = {"m", "f", "u", "other", "male", "female"}
CIVIL_STATUSES = {"single", "married", "separated", "divorced", "widowed", "other"}


def _check_email(v):
    if v is not None and not _EMAIL_RE.match(v):
        raise ValueError("Enter a valid email address")
    return v


def _check_birthdate(v):
    if v is not None and (v > date.today() or v.year < 1900):
        raise ValueError("Birthdate is not valid")
    return v


def _currency(v):
    if v is None:
        return None
    v = str(v).strip().upper()
    if not v:
        return None
    if not re.fullmatch(r"[A-Z]{3}", v):
        raise ValueError("Currency must be a 3-letter code, e.g. LKR")
    return v


def _reject_null(*names):
    def check(cls, values):
        if isinstance(values, dict):
            for n in names:
                if n in values and values[n] is None:
                    raise ValueError(f"{n} cannot be null")
        return values
    return model_validator(mode="before")(classmethod(check))


# Person-only fields that an individual must supply but a business need not.
_INDIVIDUAL_REQUIRED = ("title", "gender", "civil_status", "no_of_kids", "mobile_contact_number")

def _check_distinct_phones(first, second):
    if first and second and first.strip() == second.strip():
        raise ValueError("Contact No 1 and Contact No 2 must be different")


class CustomerBase(BaseModel):
    customer_type: CustomerType = Field(default=CustomerType.INDIVIDUAL, description="individual or business")
    customer_name: str = Field(..., min_length=1, max_length=255, description="Customer name (primary contact for a business)")
    title: Optional[str] = Field(None, max_length=30, description="Title (Mr/Ms/Mrs); required for individuals")
    email: Optional[str] = Field(None, max_length=75, description="Customer email address")
    mobile_contact_number: Optional[str] = Field(None, max_length=20, description="Mobile contact number; required for individuals")
    home_contact_number: Optional[str] = Field(None, max_length=20, description="Home contact number")
    company_name: Optional[str] = Field(None, max_length=255, description="Company name; required for businesses")
    tax_registration_number: Optional[str] = Field(None, max_length=50, description="Tax registration number")
    company_registration_number: Optional[str] = Field(None, max_length=50, description="Company registration number")
    occupation: Optional[str] = Field(None, max_length=255, description="Occupation")
    gender: Optional[str] = Field(None, max_length=30, description="Gender; required for individuals")
    civil_status: Optional[str] = Field(None, max_length=30, description="Civil status; required for individuals")
    no_of_kids: Optional[str] = Field(None, max_length=30, description="Number of kids; required for individuals")
    birthdate: Optional[date] = Field(None, description="Birth date")
    id_card_number: Optional[str] = Field(None, max_length=20, description="ID card number")
    passport_no: Optional[str] = Field(None, max_length=50, description="Passport number")
    billing_address_line1: Optional[str] = Field(None, max_length=255, description="Payment address line 1")
    billing_address_line2: Optional[str] = Field(None, max_length=255)
    billing_city: Optional[str] = Field(None, max_length=200)
    billing_state: Optional[str] = Field(None, max_length=200)
    billing_postal_code: Optional[str] = Field(None, max_length=20)
    billing_country_id: Optional[int] = Field(None, ge=1)
    shipping_address_line1: Optional[str] = Field(None, max_length=255, description="Delivery address line 1; empty = same as payment address")
    shipping_address_line2: Optional[str] = Field(None, max_length=255)
    shipping_city: Optional[str] = Field(None, max_length=200)
    shipping_state: Optional[str] = Field(None, max_length=200)
    shipping_postal_code: Optional[str] = Field(None, max_length=20)
    shipping_country_id: Optional[int] = Field(None, ge=1)
    payment_address: Optional[str] = Field(None, description="Payment address")
    delivery_address: Optional[str] = Field(None, description="Delivery address")
    bank_details: Optional[str] = Field(None, description="Bank details")
    bank_account_name: Optional[str] = Field(None, max_length=255, description="Bank account name; required on create")
    bank_name: Optional[str] = Field(None, max_length=255, description="Bank name; required on create")
    bank_account_no: Optional[str] = Field(None, max_length=50, description="Bank account number; required on create")
    bank_branch: Optional[str] = Field(None, max_length=255)
    bank_branch_code: Optional[str] = Field(None, max_length=30)
    bank_swift_code: Optional[str] = Field(None, max_length=20)
    name_in_cheque_card: Optional[str] = Field(None, max_length=255, description="Name in cheque/card")
    credit_days: int = Field(default=0, description="Credit days")
    max_credit_limit: int = Field(default=0, description="Maximum credit limit")
    left_credit_amount: Optional[int] = Field(None, description="Left credit amount")
    initial_credit_amount: Optional[int] = Field(None, description="Initial credit amount")
    active: bool = Field(default=True, description="Is active")
    is_customer_agent: bool = Field(default=False, description="Is customer agent")
    commission_rate: Optional[float] = Field(None, ge=0, le=100, description="Default commission rate (%)")
    country_id: Optional[int] = Field(None, description="Country ID")
    default_currency: Optional[str] = Field(None, max_length=3, description="Currency code (ISO 4217)")

class _CustomerInput(BaseModel):
    """Fields shared by create and update (all optional here; create adds the required ones).
    The credit balances (left_/initial_credit_amount) are NOT accepted: they are
    derived from max_credit_limit and the customer's documents."""
    _v_phone = field_validator("mobile_contact_number", "home_contact_number", mode="before")(normalize_phone_number)

    title: OptStr(30) = None
    email: OptStr(75) = None
    mobile_contact_number: Optional[str] = Field(None, max_length=20)
    home_contact_number: Optional[str] = Field(None, max_length=20)
    company_name: OptStr(255) = None
    tax_registration_number: OptStr(50) = None
    company_registration_number: OptStr(50) = None
    occupation: OptStr(255) = None
    gender: OptStr(30) = None
    civil_status: OptStr(30) = None
    no_of_kids: OptStr(2, pattern=r"^\d{1,2}$") = None
    birthdate: Annotated[Optional[date], BeforeValidator(_blank_to_none)] = None
    id_card_number: OptStr(12, pattern=r"^[A-Za-z0-9-]{4,12}$") = None
    passport_no: OptStr(50, pattern=r"^[A-Za-z0-9-]{4,50}$") = None
    billing_address_line1: OptStr(255) = None
    billing_address_line2: OptStr(255) = None
    billing_city: OptStr(120) = None
    billing_state: OptStr(120) = None
    billing_postal_code: OptStr(20) = None
    billing_country_id: Optional[int] = Field(None, ge=1, le=INT4_MAX)
    shipping_address_line1: OptStr(255) = None
    shipping_address_line2: OptStr(255) = None
    shipping_city: OptStr(120) = None
    shipping_state: OptStr(120) = None
    shipping_postal_code: OptStr(20) = None
    shipping_country_id: Optional[int] = Field(None, ge=1, le=INT4_MAX)
    payment_address: OptStr(1000) = None
    delivery_address: OptStr(1000) = None
    bank_details: OptStr(1000) = None
    bank_account_name: OptStr(255) = None
    bank_name: OptStr(255) = None
    bank_account_no: OptStr(50) = None
    bank_branch: OptStr(255) = None
    bank_branch_code: OptStr(30) = None
    bank_swift_code: OptStr(20) = None
    name_in_cheque_card: OptStr(255) = None
    country_id: Optional[int] = Field(None, ge=1, le=INT4_MAX)
    default_currency: Optional[str] = None
    commission_rate: Optional[float] = Field(None, ge=0, le=100, allow_inf_nan=False)
    is_customer_agent: Optional[bool] = None

    _v_cur = field_validator("default_currency", mode="before")(_currency)

    @field_validator("email")
    @classmethod
    def _email_ok(cls, v):
        return _check_email(v)

    @field_validator("birthdate")
    @classmethod
    def _birthdate_ok(cls, v):
        return _check_birthdate(v)

    @field_validator("gender")
    @classmethod
    def _gender_ok(cls, v):
        if v is not None and v.lower() not in GENDERS:
            raise ValueError("Gender must be one of: m, f, u")
        return v.lower() if v else v

    @field_validator("civil_status")
    @classmethod
    def _civil_ok(cls, v):
        if v is not None and v.lower() not in CIVIL_STATUSES:
            raise ValueError("Civil status must be one of: " + ", ".join(sorted(CIVIL_STATUSES)))
        return v.lower() if v else v


class CustomerCreate(_CustomerInput):
    customer_type: CustomerType = Field(default=CustomerType.INDIVIDUAL, description="individual or business")
    customer_name: ReqStr(255) = Field(..., description="Customer name (primary contact for a business)")
    credit_days: int = Field(default=0, ge=0, le=3650)
    max_credit_limit: int = Field(default=0, ge=0, le=INT4_MAX)
    active: bool = True
    is_customer_agent: bool = False

    @model_validator(mode="after")
    def check_required_for_type(self):
        _check_distinct_phones(self.mobile_contact_number, self.home_contact_number)
        if self.customer_type == CustomerType.BUSINESS:
            if not (self.company_name or "").strip():
                raise ValueError("company_name is required for business customers")
            if not (self.mobile_contact_number or "").strip():
                raise ValueError("mobile_contact_number is required for business customers")
        else:
            missing = [f for f in _INDIVIDUAL_REQUIRED if not (getattr(self, f) or "").strip()]
            if missing:
                raise ValueError(f"Required for individual customers: {', '.join(missing)}")
        return self


class CustomerUpdate(_CustomerInput):
    customer_type: Optional[CustomerType] = None
    customer_name: Optional[ReqStr(255)] = None
    credit_days: Optional[int] = Field(None, ge=0, le=3650)
    max_credit_limit: Optional[int] = Field(None, ge=0, le=INT4_MAX)
    active: Optional[bool] = None
    # Optimistic concurrency: the `version` token from the Customer response.
    expected_version: Optional[str] = Field(None, max_length=64)

    _no_nulls = _reject_null("customer_name", "customer_type", "credit_days", "max_credit_limit", "active", "is_customer_agent")

    @model_validator(mode="after")
    def check_distinct_phones(self):
        _check_distinct_phones(self.mobile_contact_number, self.home_contact_number)
        return self

class Customer(CustomerBase, TijaeroBaseSchema, VersionedSchema):
    id: int
    customer_no: str
    date_joined: datetime
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None

class CustomerContactPersonBase(BaseModel):
    title: Optional[str] = Field(None, max_length=30)
    full_name: str = Field(..., min_length=1, max_length=255)
    designation: Optional[str] = Field(None, max_length=255)
    email: Optional[EmailStr] = None
    phone: Optional[str] = Field(None, max_length=20)
    is_primary: bool = False

class CustomerContactPersonCreate(BaseModel):
    _v_phone = field_validator("phone", mode="before")(normalize_phone_number)
    title: ReqStr(30)
    full_name: ReqStr(255)
    designation: OptStr(255) = None
    email: OptStr(75) = None
    phone: Optional[str] = Field(None, max_length=20)
    is_primary: bool = False

    @field_validator("email")
    @classmethod
    def _email_ok(cls, v):
        return _check_email(v)

    @model_validator(mode="after")
    def check_phone(self):
        if not (self.phone or "").strip():
            raise ValueError("Contact No is required")
        return self


class CustomerContactPersonUpdate(BaseModel):
    _v_phone = field_validator("phone", mode="before")(normalize_phone_number)
    title: Optional[ReqStr(30)] = None
    full_name: Optional[ReqStr(255)] = None
    designation: OptStr(255) = None
    email: OptStr(75) = None
    phone: Optional[str] = Field(None, max_length=20)
    is_primary: Optional[bool] = None

    _no_nulls = _reject_null("title", "full_name", "phone", "is_primary")

    @field_validator("email")
    @classmethod
    def _email_ok(cls, v):
        return _check_email(v)

    @field_validator("phone")
    @classmethod
    def _phone_required(cls, v):
        if v is None:
            raise ValueError("Contact No cannot be blank")
        return v


class CustomerContactPerson(CustomerContactPersonBase, TijaeroBaseSchema):
    id: int
    customer_id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class CustomerList(BaseModel):
    total: int
    items: list[Customer]

class CustomerAdvancePaymentsBase(BaseModel):
    advance_payments_no: Optional[str] = None
    payment_method: str
    branch_code: str
    payment_amount: Decimal
    remarks: Optional[str] = None
    customer_id: int
    cheque_date: date
    active: bool = True

class CustomerAdvancePaymentsCreate(CustomerAdvancePaymentsBase):
    pass

class CustomerAdvancePaymentsUpdate(BaseModel):
    payment_method: Optional[str] = None
    branch_code: Optional[str] = None
    payment_amount: Optional[Decimal] = None
    remarks: Optional[str] = None
    cheque_date: Optional[date] = None
    active: Optional[bool] = None

class CustomerAdvancePayments(CustomerAdvancePaymentsBase, TijaeroBaseSchema):
    id: int
    created_date: date

class CustomerCreditNotesBase(BaseModel):
    customer_id: int
    amount: Decimal
    remark: str
    invoice_no: Optional[str] = None

class CustomerCreditNotesCreate(CustomerCreditNotesBase):
    pass

class CustomerCreditNotes(CustomerCreditNotesBase, TijaeroBaseSchema):
    id: int
    date: datetime


# Customer Credits Settle Schemas
class CustomerCreditsSettleTransactionBase(BaseModel):
    payment_method: str
    cheque_date: date
    payment_amount: Decimal
    payment_method_number: Optional[str] = None
    remarks: Optional[str] = None
    invoice_id: int

class CustomerCreditsSettleTransactionCreate(CustomerCreditsSettleTransactionBase):
    pass

class CustomerCreditsSettleTransaction(CustomerCreditsSettleTransactionBase, TijaeroBaseSchema):
    id: int
    customer_credit_settle_id: int
    created_date: datetime

class CustomerCreditsSettleBase(BaseModel):
    customer_credits_settle_no: Optional[str] = None
    branch_code: str
    customer_id: int

class CustomerCreditsSettleCreate(CustomerCreditsSettleBase):
    transactions: List[CustomerCreditsSettleTransactionCreate]

class CustomerCreditsSettleUpdate(BaseModel):
    branch_code: Optional[str] = None

class CustomerCreditsSettle(CustomerCreditsSettleBase, TijaeroBaseSchema):
    id: int
    created_date: datetime

class CustomerCreditsSettleWithTransactions(CustomerCreditsSettle):
    transactions: List[CustomerCreditsSettleTransaction] = []


# Customer Payment Report Schemas
class CustomerPaymentReportItem(BaseModel):
    id: int
    date: str
    customer_id: int
    customer_name: str
    document_no: str
    invoice_refs: str
    payment_method: str
    amount: float
    branch_code: str
    remarks: str

    class Config:
        from_attributes = True


class CustomerPaymentReportSummary(BaseModel):
    total_amount: float
    total_count: int
    credit_settlements: float
    credit_settlements_count: int


class CustomerPaymentReport(BaseModel):
    items: List[CustomerPaymentReportItem]
    summary: CustomerPaymentReportSummary


# Outstanding Documents Schemas
class OutstandingDocumentItem(BaseModel):
    invoice_id: int
    invoice_no: str
    invoice_date: str
    customer_id: int
    customer_name: str
    credit_amount: float
    paid_amount: float
    balance_due: float
    due_date: str
    days_overdue: int
    is_overdue: bool
    branch_code: str


class OutstandingDocumentSummary(BaseModel):
    total_documents: int = 0
    total_outstanding: float = 0
    total_overdue: float = 0
    overdue_count: int = 0


class OutstandingDocumentsReport(BaseModel):
    items: List[OutstandingDocumentItem] = []
    summary: OutstandingDocumentSummary = OutstandingDocumentSummary()


# Customer Coupon Codes Schemas
class CustomerCuponCodesBase(BaseModel):
    cupon_code: str = Field(..., min_length=1, max_length=50, description="Coupon barcode/code")
    description: Optional[str] = Field(None, max_length=255, description="Coupon description")
    discount_type: str = Field(default="PERCENT", description="PERCENT or AMOUNT")
    discount_value: Decimal = Field(default=0, ge=0, description="Discount value")
    minimum_invoice_amount: Decimal = Field(default=0, ge=0, description="Minimum invoice amount required")
    limit_by_usage: int = Field(default=1000, ge=1, description="Total global usage limit")
    limit_for_customer: int = Field(default=10, ge=1, description="Per customer usage limit")
    valid_until_date: date
    active: bool = Field(default=True, description="Is coupon active")
    limit_validity_product_id: Optional[int] = Field(None, description="Legacy single product ID (deprecated)")
    product_ids: Optional[List[int]] = Field(default=[], description="List of product IDs for validity restriction")
    category_ids: Optional[List[int]] = Field(default=[], description="List of category IDs for validity restriction")
    brand_ids: Optional[List[int]] = Field(default=[], description="List of brand IDs for validity restriction")

class CustomerCuponCodesCreate(CustomerCuponCodesBase):
    pass

class CustomerCuponCodesUpdate(BaseModel):
    cupon_code: Optional[str] = Field(None, min_length=1, max_length=50)
    description: Optional[str] = Field(None, max_length=255)
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    minimum_invoice_amount: Optional[Decimal] = None
    limit_by_usage: Optional[int] = None
    limit_for_customer: Optional[int] = None
    valid_until_date: Optional[date] = None
    active: Optional[bool] = None
    limit_validity_product_id: Optional[int] = None
    product_ids: Optional[List[int]] = None
    category_ids: Optional[List[int]] = None
    brand_ids: Optional[List[int]] = None

class CustomerCuponCodes(CustomerCuponCodesBase, TijaeroBaseSchema):
    id: int
    created_date: Optional[datetime] = None
    usage_count: int = 0  # Track total usage count
    product_ids: List[int] = []  # Computed field for restricted product IDs
    category_ids: List[int] = []  # Computed field for restricted category IDs
    brand_ids: List[int] = []  # Computed field for restricted brand IDs


# Coupon Usage Schemas
class CouponUsageBase(BaseModel):
    coupon_id: int
    customer_id: int
    invoice_id: int
    discount_amount: Decimal

class CouponUsageCreate(CouponUsageBase):
    pass

class CouponUsage(CouponUsageBase, TijaeroBaseSchema):
    id: int
    used_date: datetime
    invoice_no: Optional[str] = None
    customer_name: Optional[str] = None


# Coupon Validation Request/Response
class LineItemForCoupon(BaseModel):
    product_id: int
    quantity: int
    selling_price: Decimal

class CouponValidationRequest(BaseModel):
    coupon_code: str
    customer_id: int
    invoice_subtotal: Decimal
    invoice_discount_type: Optional[str] = Field(default=None, description="'percent' or 'amount'")
    invoice_discount_value: Optional[Decimal] = Field(default=0, description="Invoice discount percentage or amount")
    product_ids: Optional[List[int]] = Field(default=[], description="List of product IDs in invoice")
    category_ids: Optional[List[int]] = Field(default=[], description="List of category IDs in invoice")
    line_items: Optional[List[LineItemForCoupon]] = Field(default=[], description="Line items with quantities and prices")

class CouponValidationResponse(BaseModel):
    valid: bool
    coupon_id: Optional[int] = None
    discount_type: Optional[str] = None
    discount_value: Optional[Decimal] = None
    calculated_discount: Optional[Decimal] = None
    message: str


# Customer Gift Voucher Schemas
class CustomerGiftVoucherBase(BaseModel):
    date: date
    amount: Decimal
    barcode_no: int
    valid_period_in_months: int = 12
    purchased_invoice_no: Optional[str] = None

class CustomerGiftVoucherCreate(CustomerGiftVoucherBase):
    pass

class CustomerGiftVoucherUpdate(BaseModel):
    claimed_date: Optional[datetime] = None
    claimed_invoice_no: Optional[str] = None

class CustomerGiftVoucher(CustomerGiftVoucherBase, TijaeroBaseSchema):
    id: int
    claimed_date: Optional[datetime] = None
    claimed_invoice_no: Optional[str] = None


# Customer Support Schemas
class CustomerCallLogBase(BaseModel):
    contact_person: Optional[str] = None
    comment: Optional[str] = None

class CustomerCallLogCreate(CustomerCallLogBase):
    customer_support_id: Optional[int] = None

class CustomerCallLog(CustomerCallLogBase, TijaeroBaseSchema):
    id: int
    date: datetime
    customer_support_id: Optional[int] = None

class CustomerSupportBase(BaseModel):
    job_number: str
    job_type: str
    date: date
    job_description: Optional[str] = None
    contact_person: str
    branch_code: str
    assigned_user_id: int
    customer_id: Optional[int] = None
    invoice_id: Optional[int] = None

class CustomerSupportCreate(CustomerSupportBase):
    pass

class CustomerSupportUpdate(BaseModel):
    job_type: Optional[str] = None
    date: Optional[date] = None
    job_description: Optional[str] = None
    contact_person: Optional[str] = None
    branch_code: Optional[str] = None
    assigned_user_id: Optional[int] = None
    customer_id: Optional[int] = None
    invoice_id: Optional[int] = None

class CustomerSupport(CustomerSupportBase, TijaeroBaseSchema):
    id: int

class CustomerSupportWithCallLogs(CustomerSupport):
    call_logs: List[CustomerCallLog] = []


# =============================================================================
# Gift Voucher Schemas
# =============================================================================

class GiftVoucherBase(BaseModel):
    barcode_no: str = Field(..., min_length=1, max_length=50, description="Voucher barcode/code")
    amount: Decimal = Field(..., gt=0, description="Voucher amount")
    valid_period_in_months: int = Field(default=12, ge=1, le=60, description="Validity period in months")

class GiftVoucherCreate(GiftVoucherBase):
    purchased_invoice_no: Optional[str] = Field(None, description="Invoice number where voucher was purchased")
    # Payment details for cashbook entry
    payment_method: str = Field(default="cash", description="Payment method used to purchase voucher (cash, card, bank_transfer, cheque)")
    branch_code: Optional[str] = Field(None, description="Branch where voucher was sold")
    customer_name: Optional[str] = Field(None, description="Customer who purchased the voucher (optional for walk-in)")

class GiftVoucherUpdate(BaseModel):
    amount: Optional[Decimal] = None
    valid_period_in_months: Optional[int] = None
    status: Optional[str] = None

class GiftVoucher(GiftVoucherBase, TijaeroBaseSchema):
    id: int
    balance: Decimal
    date: date
    status: str
    purchased_invoice_no: Optional[str] = None
    claimed_date: Optional[datetime] = None
    claimed_invoice_no: Optional[str] = None
    created_at: Optional[datetime] = None

class VoucherUsageBase(BaseModel):
    voucher_id: int
    invoice_id: int
    amount_used: Decimal

class VoucherUsageCreate(VoucherUsageBase):
    pass

class VoucherUsage(VoucherUsageBase, TijaeroBaseSchema):
    id: int
    used_date: datetime
    invoice_no: Optional[str] = None

class VoucherValidationRequest(BaseModel):
    barcode_no: str = Field(..., description="Voucher barcode/code to validate")
    invoice_amount_due: Decimal = Field(..., ge=0, description="Invoice amount due")

class VoucherValidationResponse(BaseModel):
    valid: bool
    voucher_id: Optional[int] = None
    barcode_no: Optional[str] = None
    original_amount: Optional[Decimal] = None
    balance: Optional[Decimal] = None
    redeemable_amount: Optional[Decimal] = None  # min(balance, invoice_amount_due)
    expiry_date: Optional[date] = None
    message: str

class VoucherRedeemRequest(BaseModel):
    barcode_no: str = Field(..., description="Voucher barcode/code")
    invoice_id: int = Field(..., description="Invoice to apply voucher to")
    amount_to_redeem: Decimal = Field(..., gt=0, description="Amount to redeem")

class VoucherRedeemResponse(BaseModel):
    success: bool
    voucher_id: int
    amount_redeemed: Decimal
    remaining_balance: Decimal
    message: str
