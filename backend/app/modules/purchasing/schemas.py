from pydantic import BaseModel, BeforeValidator, EmailStr, Field, StringConstraints, field_validator, field_serializer, model_validator
from app.common.validators import normalize_phone_number
from datetime import date, datetime
from typing import Annotated, Generic, Optional, List, TypeVar
from decimal import Decimal
import re

from app.common.base_schemas import TijaeroBaseSchema, AuditSchema, VersionedSchema, format_datetime
from app.common.enums import PurchaseOrderStatus, DocumentStatus, SupplierTaxArea, SupplierPaymentMethodType


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """One page of a server-side paged list; total is the filtered row count across all pages."""
    items: List[T]
    total: int
    page: int
    size: int
    pages: int


# ---- input hygiene shared by the supplier schemas -------------------------
# Every text column has a length limit, so an over-long value is a 422 with a
# field message instead of a database error (500). Text is trimmed; optional
# text that is blank becomes None.
INT4_MAX = 2_147_483_647
MAX_MONEY = Decimal("9999999999999.99")


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


def OptStr(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none)]


Text255 = Annotated[str, StringConstraints(strip_whitespace=True, max_length=255)]


def _check_website(v):
    if v and not re.match(r"^https?://[^\s]+$", v, re.I):
        raise ValueError("Website must start with http:// or https://")
    return v


def _check_email_len(v):
    if v and len(str(v)) > 75:
        raise ValueError("Email cannot exceed 75 characters")
    return v


def _upper_currency(v):
    if v is None:
        return None
    v = str(v).strip().upper()
    if not v:
        return None
    if not re.fullmatch(r"[A-Z]{3}", v):
        raise ValueError("Currency must be a 3-letter code, e.g. LKR")
    return v


def _check_distinct_phones(first, second):
    if first and second and first.strip() == second.strip():
        raise ValueError("Contact No 1 and Contact No 2 must be different")


class SupplierBase(BaseModel):
    company_name: str = Field(..., min_length=1)
    company_registration_number: Optional[str] = None
    tax_registration_number: Optional[str] = None
    tax_area: Optional[SupplierTaxArea] = None
    company_website: Optional[str] = None
    # Address and payment terms live in their own sections of the create
    # form and are filled in after the supplier's main details are saved, so
    # they default rather than being required at creation time (mirrors
    # ProductBase.selling_price, which lives in the Pricing section).
    billing_address_line1: str = ""
    billing_address_line2: Optional[str] = None
    billing_city: Optional[str] = None
    billing_state: Optional[str] = None
    billing_postal_code: Optional[str] = None
    billing_country_id: Optional[int] = None
    shipping_address_line1: Optional[str] = None
    shipping_address_line2: Optional[str] = None
    shipping_city: Optional[str] = None
    shipping_state: Optional[str] = None
    shipping_postal_code: Optional[str] = None
    shipping_country_id: Optional[int] = None
    email: Optional[EmailStr] = None
    home_contact_number: Optional[str] = None
    mobile_contact_number: str = Field(..., min_length=1)
    credit_days: int = 0
    max_credit_limit: Decimal = Decimal("0")
    active: bool = True
    country_id: Optional[int] = None
    # Manually-set planning default (days) — see models.Supplier.lead_time_days.
    lead_time_days: Optional[int] = Field(default=None, ge=0)
    # 3-letter ISO 4217 code (e.g. "LKR", "USD") — see models.Supplier.default_currency.
    default_currency: Optional[str] = Field(default=None, max_length=3)

class SupplierInputBase(BaseModel):
    company_name: ReqStr(255)
    company_registration_number: OptStr(255) = None
    tax_registration_number: OptStr(255) = None
    tax_area: Optional[SupplierTaxArea] = None
    company_website: OptStr(200) = None
    # Address and payment terms live in their own sections of the create
    # form and are filled in after the supplier's main details are saved, so
    # they default rather than being required at creation time (mirrors
    # ProductBase.selling_price, which lives in the Pricing section).
    billing_address_line1: Text255 = ""
    billing_address_line2: OptStr(255) = None
    billing_city: OptStr(120) = None
    billing_state: OptStr(120) = None
    billing_postal_code: OptStr(20) = None
    billing_country_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    shipping_address_line1: OptStr(255) = None
    shipping_address_line2: OptStr(255) = None
    shipping_city: OptStr(120) = None
    shipping_state: OptStr(120) = None
    shipping_postal_code: OptStr(20) = None
    shipping_country_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    email: Optional[EmailStr] = None
    home_contact_number: Optional[str] = None
    mobile_contact_number: str = Field(..., min_length=1)
    credit_days: int = Field(default=0, ge=0, le=3650)
    max_credit_limit: Decimal = Field(default=Decimal("0"), ge=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    active: bool = True
    country_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    # Manually-set planning default (days) — see models.Supplier.lead_time_days.
    lead_time_days: Optional[int] = Field(default=None, ge=0, le=3650)
    # 3-letter ISO 4217 code (e.g. "LKR", "USD"); upper-cased here and checked
    # against the currencies table by SupplierService.
    default_currency: Optional[str] = None

    _v_website = field_validator("company_website")(_check_website)
    _v_email_len = field_validator("email")(_check_email_len)
    _v_currency = field_validator("default_currency", mode="before")(_upper_currency)

class SupplierCreate(SupplierInputBase):
    _v_phone = field_validator("mobile_contact_number", "home_contact_number", mode="before")(normalize_phone_number)

    @model_validator(mode="after")
    def check_distinct_phones(self):
        _check_distinct_phones(self.mobile_contact_number, self.home_contact_number)
        return self
    pass

class SupplierUpdate(BaseModel):
    _v_phone = field_validator("mobile_contact_number", "home_contact_number", mode="before")(normalize_phone_number)

    @model_validator(mode="after")
    def check_distinct_phones(self):
        _check_distinct_phones(self.mobile_contact_number, self.home_contact_number)
        return self
    company_name: Optional[ReqStr(255)] = None
    company_registration_number: OptStr(255) = None
    tax_registration_number: OptStr(255) = None
    tax_area: Optional[SupplierTaxArea] = None
    company_website: OptStr(200) = None
    billing_address_line1: Optional[Text255] = None
    billing_address_line2: OptStr(255) = None
    billing_city: OptStr(120) = None
    billing_state: OptStr(120) = None
    billing_postal_code: OptStr(20) = None
    billing_country_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    shipping_address_line1: OptStr(255) = None
    shipping_address_line2: OptStr(255) = None
    shipping_city: OptStr(120) = None
    shipping_state: OptStr(120) = None
    shipping_postal_code: OptStr(20) = None
    shipping_country_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    email: Optional[EmailStr] = None
    home_contact_number: Optional[str] = None
    mobile_contact_number: Optional[str] = None
    credit_days: Optional[int] = Field(default=None, ge=0, le=3650)
    max_credit_limit: Optional[Decimal] = Field(default=None, ge=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    active: Optional[bool] = None
    country_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    lead_time_days: Optional[int] = Field(default=None, ge=0, le=3650)
    default_currency: Optional[str] = None

    _v_website = field_validator("company_website")(_check_website)
    _v_email_len = field_validator("email")(_check_email_len)
    _v_currency = field_validator("default_currency", mode="before")(_upper_currency)
    # Optimistic concurrency check: the `updated_at` the client last saw for
    # this supplier. If omitted, no check is performed (backward compatible).
    # If it no longer matches the current row, the update is rejected with a
    # 409 instead of silently overwriting someone else's more recent change.
    expected_updated_at: Optional[datetime] = None
    # Preferred over expected_updated_at: the exact `version` token from the
    # Supplier response (full precision, catches same-second changes too).
    expected_version: Optional[str] = None

class Supplier(SupplierBase, AuditSchema, VersionedSchema):
    id: int
    supplier_no: str
    date_joined: datetime
    left_credit_amount: Optional[Decimal] = None
    initial_credit_amount: Optional[Decimal] = None
    logo_path: Optional[str] = None
    average_lead_time_days: Optional[float] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None


class SupplierActivityLogEntry(BaseModel):
    """One row of the supplier's "Activity History" modification history,
    backed by the generic audit_logs table."""
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


def _birthdate_plausible(v: Optional[date]) -> Optional[date]:
    v = _validate_birthdate_not_future(v)
    if v is not None and v.year < 1900:
        raise ValueError("Birthdate is not valid")
    return v


class SupplierContactPersonInputBase(BaseModel):
    title: OptStr(30) = None
    full_name: ReqStr(255)
    occupation: OptStr(255) = None
    gender: OptStr(30) = None
    birthdate: Optional[date] = None
    id_card_number: OptStr(12) = None
    passport_no: OptStr(50) = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None

    @field_validator("birthdate")
    @classmethod
    def _birthdate_not_future(cls, v):
        return _birthdate_plausible(v)

    _v_email_len = field_validator("email")(_check_email_len)


class SupplierContactPersonCreate(SupplierContactPersonInputBase):
    _v_phone = field_validator("phone", mode="before")(normalize_phone_number)

    @model_validator(mode="after")
    def check_title_and_phone(self):
        if not (self.title or "").strip():
            raise ValueError("Title is required")
        if not (self.phone or "").strip():
            raise ValueError("Contact No is required")
        return self


class SupplierContactPersonUpdate(BaseModel):
    _v_phone = field_validator("phone", mode="before")(normalize_phone_number)
    title: OptStr(30) = None
    full_name: Optional[ReqStr(255)] = None
    occupation: OptStr(255) = None
    gender: OptStr(30) = None
    birthdate: Optional[date] = None
    id_card_number: OptStr(12) = None
    passport_no: OptStr(50) = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None

    @field_validator("birthdate")
    @classmethod
    def _birthdate_not_future(cls, v):
        return _birthdate_plausible(v)

    _v_email_len = field_validator("email")(_check_email_len)


class SupplierContactPerson(SupplierContactPersonBase, AuditSchema):
    id: int
    supplier_id: int


class SupplierPaymentMethodBase(BaseModel):
    method_type: SupplierPaymentMethodType
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    account_holder_name: Optional[str] = None
    # Bank-transfer-only wire details.
    branch: Optional[str] = None
    bank_branch_code: Optional[str] = None
    swift_code: Optional[str] = None
    correspondent_bank_name: Optional[str] = None
    correspondent_bank_swift_code: Optional[str] = None
    # Direct Debit / ACH only (reuses bank_name/bank_branch_code/
    # account_number/account_holder_name above for the mandate's bank).
    mandate_reference: Optional[str] = None
    mandate_date: Optional[date] = None
    # Letter of Credit only.
    lc_number: Optional[str] = None
    issuing_bank_name: Optional[str] = None
    advising_bank_name: Optional[str] = None
    lc_amount: Optional[Decimal] = Field(default=None, ge=0)
    lc_currency: Optional[str] = Field(default=None, max_length=3)
    lc_type: Optional[str] = None
    lc_issue_date: Optional[date] = None
    lc_expiry_date: Optional[date] = None
    latest_shipment_date: Optional[date] = None
    # Credit Card only — PCI-DSS: never accept/store the full PAN, only the
    # last 4 digits for display/identification.
    card_type: Optional[str] = None
    card_last4: Optional[str] = Field(default=None, max_length=4)
    card_expiry: Optional[str] = Field(default=None, max_length=7)  # "MM/YYYY"
    cardholder_name: Optional[str] = None
    # Digital Wallet only.
    wallet_provider: Optional[str] = None
    wallet_id: Optional[str] = None
    is_default: bool = False
    active: bool = True

    @field_validator("card_last4")
    @classmethod
    def _validate_card_last4(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.isdigit():
            raise ValueError("card_last4 must contain only digits")
        return v




def check_payment_method_rules(d: dict) -> None:
    """Cross-field rules for a supplier payment method, on a plain dict so the
    create schema and the update service (merged with the stored row) share it."""
    t = d.get("method_type")
    t = getattr(t, "value", t)

    def need(*names):
        for n in names:
            if not d.get(n):
                raise ValueError(f"{n.replace('_', ' ').capitalize()} is required for {str(t).replace('_', ' ')}")

    acct = d.get("account_number")
    if acct and not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 \-]{2,33}", acct):
        raise ValueError("Account number must be 3-34 letters, digits, spaces or dashes")
    for name in ("swift_code", "correspondent_bank_swift_code"):
        v = d.get(name)
        if v and not re.fullmatch(r"[A-Za-z0-9]{8}([A-Za-z0-9]{3})?", v):
            raise ValueError("SWIFT/BIC code must be 8 or 11 letters/digits")
    if t == "bank_transfer":
        need("bank_name", "account_number")
    elif t == "direct_debit":
        need("bank_name", "account_number")
    elif t == "letter_of_credit":
        need("lc_number")
    elif t == "digital_wallet":
        need("wallet_provider", "wallet_id")
    elif t == "credit_card":
        need("card_last4")
    lc_cur = d.get("lc_currency")
    if lc_cur and not re.fullmatch(r"[A-Z]{3}", lc_cur):
        raise ValueError("LC currency must be a 3-letter code, e.g. USD")
    issue, expiry, ship = d.get("lc_issue_date"), d.get("lc_expiry_date"), d.get("latest_shipment_date")
    if issue and expiry and expiry < issue:
        raise ValueError("LC expiry date cannot be before the issue date")
    if ship and expiry and ship > expiry:
        raise ValueError("Latest shipment date cannot be after the LC expiry date")
    ce = d.get("card_expiry")
    if ce:
        m = re.fullmatch(r"(0[1-9]|1[0-2])/(\d{4})", ce)
        if not m:
            raise ValueError("Card expiry must be MM/YYYY")
        today = date.today()
        if (int(m.group(2)), int(m.group(1))) < (today.year, today.month):
            raise ValueError("Card has expired")
    if d.get("mandate_date") and d["mandate_date"].year < 1900:
        raise ValueError("Mandate date is not valid")

class SupplierPaymentMethodInputBase(BaseModel):
    method_type: SupplierPaymentMethodType
    bank_name: OptStr(255) = None
    account_number: OptStr(100) = None
    account_holder_name: OptStr(255) = None
    # Bank-transfer-only wire details.
    branch: OptStr(255) = None
    bank_branch_code: OptStr(50) = None
    swift_code: OptStr(20) = None
    correspondent_bank_name: OptStr(255) = None
    correspondent_bank_swift_code: OptStr(20) = None
    # Direct Debit / ACH only (reuses bank_name/bank_branch_code/
    # account_number/account_holder_name above for the mandate's bank).
    mandate_reference: OptStr(100) = None
    mandate_date: Optional[date] = None
    # Letter of Credit only.
    lc_number: OptStr(100) = None
    issuing_bank_name: OptStr(255) = None
    advising_bank_name: OptStr(255) = None
    lc_amount: Optional[Decimal] = Field(default=None, ge=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    lc_currency: Optional[str] = None
    lc_type: OptStr(30) = None
    lc_issue_date: Optional[date] = None
    lc_expiry_date: Optional[date] = None
    latest_shipment_date: Optional[date] = None
    # Credit Card only — PCI-DSS: never accept/store the full PAN, only the
    # last 4 digits for display/identification.
    card_type: OptStr(20) = None
    card_last4: OptStr(4) = None
    card_expiry: OptStr(7) = None  # "MM/YYYY"
    cardholder_name: OptStr(255) = None
    # Digital Wallet only.
    wallet_provider: OptStr(50) = None
    wallet_id: OptStr(255) = None
    is_default: bool = False
    active: bool = True

    @field_validator("card_last4")
    @classmethod
    def _validate_card_last4(cls, v: Optional[str]) -> Optional[str]:
        if v and not v.isdigit():
            raise ValueError("card_last4 must contain only digits")
        return v


    _v_lc_cur = field_validator("lc_currency", mode="before")(_upper_currency)

    @model_validator(mode="after")
    def _method_rules(self):
        check_payment_method_rules(self.model_dump())
        return self


class SupplierPaymentMethodCreate(SupplierPaymentMethodInputBase):
    pass


class SupplierPaymentMethodUpdate(BaseModel):
    method_type: Optional[SupplierPaymentMethodType] = None
    bank_name: OptStr(255) = None
    account_number: OptStr(100) = None
    account_holder_name: OptStr(255) = None
    branch: OptStr(255) = None
    bank_branch_code: OptStr(50) = None
    swift_code: OptStr(20) = None
    correspondent_bank_name: OptStr(255) = None
    correspondent_bank_swift_code: OptStr(20) = None
    mandate_reference: OptStr(100) = None
    mandate_date: Optional[date] = None
    lc_number: OptStr(100) = None
    issuing_bank_name: OptStr(255) = None
    advising_bank_name: OptStr(255) = None
    lc_amount: Optional[Decimal] = Field(default=None, ge=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    lc_currency: Optional[str] = None
    lc_type: OptStr(30) = None
    lc_issue_date: Optional[date] = None
    lc_expiry_date: Optional[date] = None
    latest_shipment_date: Optional[date] = None
    card_type: OptStr(20) = None
    card_last4: OptStr(4) = None
    card_expiry: OptStr(7) = None
    cardholder_name: OptStr(255) = None
    wallet_provider: OptStr(50) = None
    wallet_id: OptStr(255) = None
    is_default: Optional[bool] = None
    active: Optional[bool] = None

    _v_lc_cur = field_validator("lc_currency", mode="before")(_upper_currency)


class SupplierPaymentMethod(SupplierPaymentMethodBase, AuditSchema):
    id: int
    supplier_id: int


class SupplierProductBase(BaseModel):
    product_id: int = Field(..., ge=1, le=INT4_MAX)
    supplier_sku: OptStr(255) = None
    cost_price: Decimal = Field(..., ge=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    minimum_order_qty: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    is_preferred: bool = False
    active: bool = True


class SupplierProductCreate(SupplierProductBase):
    pass


class SupplierProductUpdate(BaseModel):
    supplier_sku: OptStr(255) = None
    cost_price: Optional[Decimal] = Field(default=None, ge=0, le=MAX_MONEY, max_digits=18, decimal_places=2)
    minimum_order_qty: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
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
    # Set when this line was sourced from a Sales Quotation — links back to
    # the exact SalesQuoteItem it fulfills.
    quote_item_id: Optional[int] = None

PO_PAYMENT_METHODS = {"credit", "non-credit", "noncredit", "cash", "bank-transfer", "cheque", "card", "online"}


def _check_po_payment_method(v):
    # "Non-credit", "non_credit" and "non credit" are the same method
    if v is not None and v.strip().lower().replace("_", "-").replace(" ", "-") not in PO_PAYMENT_METHODS:
        raise ValueError("Payment method must be one of: Credit, Non-credit, Cash, Bank transfer, Cheque, Card, Online")
    return v


def _po_date_window(v):
    if v is not None:
        today = date.today()
        if v < date(today.year - 1, today.month, 1) or v > date(today.year + 1, today.month, 1):
            raise ValueError("Date must be within a year of today")
    return v


def _zero_to_none(v):
    return None if v in (0, "0", "") else v


class PurchasingOrderItemCreate(BaseModel):
    """A purchase-order line as submitted (strict). The response model above stays lenient."""
    product_id: int = Field(..., ge=1, le=INT4_MAX)
    quantity: int = Field(..., ge=1, le=1_000_000)
    unit_price: Decimal = Field(..., gt=0, le=MAX_MONEY, allow_inf_nan=False)
    warrenty_month: Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\d{1,3}$")]
    remark: OptStr(500) = None
    # Set when this line was sourced from a Sales Quotation (links to the exact SalesQuoteItem).
    quote_item_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)

    @field_validator("unit_price")
    @classmethod
    def _two_decimals(cls, v):
        return v.quantize(Decimal("0.01"))


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
    # Optional "needed by" date for the order as a whole — set per supplier
    # group in the product-first PO creation wizard's Step 2. Distinct from
    # good_received_note_date, which is the expected delivery date computed
    # from the supplier's lead time.
    required_date: Optional[date] = None
    remarks: Optional[str] = None
    credit_date: Optional[int] = None
    first_suppliers_id: int
    second_suppliers_id: Optional[int] = None
    sales_quote_id: Optional[int] = None  # Link to source quotation

class PurchasingOrderCreate(BaseModel):
    purchasing_order_no: Optional[str] = Field(default=None, max_length=200)  # ignored: generated on the server
    purchasing_invoice_no: OptStr(200) = None
    branch_code: ReqStr(200)
    payment_method: ReqStr(30)
    purchasing_order_date: date
    good_received_note_date: date
    required_date: Optional[date] = None
    remarks: OptStr(2000) = None
    credit_date: Optional[int] = Field(default=None, ge=0, le=3650)
    first_suppliers_id: int = Field(..., ge=1, le=INT4_MAX)
    second_suppliers_id: Optional[int] = Field(default=None, ge=0, le=INT4_MAX)
    sales_quote_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)  # link to source quotation
    items: List[PurchasingOrderItemCreate] = Field(..., min_length=1, max_length=200)

    _v_pay = field_validator("payment_method")(_check_po_payment_method)
    _v_order_date = field_validator("purchasing_order_date")(_po_date_window)
    _v_second = field_validator("second_suppliers_id")(_zero_to_none)

    @model_validator(mode="after")
    def _cross_rules(self):
        if self.good_received_note_date < self.purchasing_order_date:
            raise ValueError("Expected delivery date cannot be before the order date")
        if self.required_date and self.required_date < self.purchasing_order_date:
            raise ValueError("Required date cannot be before the order date")
        if self.second_suppliers_id and self.second_suppliers_id == self.first_suppliers_id:
            raise ValueError("Second supplier must differ from the first supplier")
        return self

class PurchasingOrderUpdate(BaseModel):
    """Editable fields. `status` is deliberately not one of them: it only changes through the
    approval, cancel and short-close actions (an edit to an approved PO sends it back for re-approval)."""
    purchasing_invoice_no: OptStr(200) = None
    branch_code: Optional[ReqStr(200)] = None
    payment_method: Optional[ReqStr(30)] = None
    purchasing_order_date: Optional[date] = None
    good_received_note_date: Optional[date] = None
    required_date: Optional[date] = None
    remarks: OptStr(2000) = None
    credit_date: Optional[int] = Field(default=None, ge=0, le=3650)
    first_suppliers_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)
    second_suppliers_id: Optional[int] = Field(default=None, ge=0, le=INT4_MAX)
    items: Optional[List[PurchasingOrderItemCreate]] = Field(default=None, min_length=1, max_length=200)

    _v_pay = field_validator("payment_method")(_check_po_payment_method)
    _v_order_date = field_validator("purchasing_order_date")(_po_date_window)
    _v_second = field_validator("second_suppliers_id")(_zero_to_none)

    @model_validator(mode="before")
    @classmethod
    def _no_null_required(cls, values):
        if isinstance(values, dict):
            for n in ("branch_code", "payment_method", "purchasing_order_date", "good_received_note_date", "first_suppliers_id"):
                if n in values and values[n] is None:
                    raise ValueError(f"{n} cannot be null")
        return values

    @model_validator(mode="after")
    def _cross_rules(self):
        if self.good_received_note_date and self.purchasing_order_date and self.good_received_note_date < self.purchasing_order_date:
            raise ValueError("Expected delivery date cannot be before the order date")
        if self.second_suppliers_id and self.first_suppliers_id and self.second_suppliers_id == self.first_suppliers_id:
            raise ValueError("Second supplier must differ from the first supplier")
        return self

class PurchasingOrder(PurchasingOrderBase, TijaeroBaseSchema):
    id: int
    created_date: date
    added_date: datetime
    approval_id: Optional[int] = None
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    approved_by: Optional[int] = None
    approved_by_name: Optional[str] = None
    updated_by: Optional[int] = None
    updated_by_name: Optional[str] = None
    status: PurchaseOrderStatus = PurchaseOrderStatus.PENDING
    total_amount: Decimal = Decimal("0.00")
    paid_amount: Decimal = Decimal("0.00")
    # Derived from line items (see PurchasingOrder.total_quantity on the
    # model) — shown as a browse-table column.
    total_quantity: int = 0
    sales_quote_id: Optional[int] = None
    sales_quote_no: Optional[str] = None  # Populated from sales_quote relationship
    supplier_name: Optional[str] = None  # Populated from first_supplier relationship
    # Set when this PO was created as part of a multi-supplier product-first
    # checkout — every sibling PO from that same checkout shares this value.
    purchase_batch_id: Optional[str] = None
    # Why the approver rejected the PO (from the approval record); only set
    # when the PO is rejected.
    rejection_reason: Optional[str] = None
    cancellation_reason: Optional[str] = None
    cancelled_date: Optional[datetime] = None
    cancelled_by: Optional[int] = None
    short_close_reason: Optional[str] = None
    short_closed_date: Optional[datetime] = None
    short_closed_by: Optional[int] = None

    @field_validator('status', mode='before')
    @classmethod
    def default_status(cls, v):
        return v if v is not None else PurchaseOrderStatus.PENDING

class PurchasingOrderWithItems(PurchasingOrder):
    items: List[PurchasingOrderItem] = []


class PurchasingOrderCancelRequest(BaseModel):
    reason: ReqStr(500)


class PurchasingOrderShortCloseRequest(BaseModel):
    reason: ReqStr(500)


class PurchasingOrderBatchCreate(BaseModel):
    """
    Product-first, multi-supplier PO checkout: the frontend groups the
    lines the user added by the supplier chosen for each product, and sends
    one group per supplier here. The backend creates one PurchasingOrder per
    group, all tagged with the same freshly-generated purchase_batch_id, in
    a single transaction (all-or-nothing).
    """
    groups: List[PurchasingOrderCreate] = Field(..., min_length=1)


class PurchasingOrderBatchResponse(BaseModel):
    purchase_batch_id: str
    orders: List[PurchasingOrderWithItems]


# ==================== Procurement Queue (TOP page) ====================


class ProcurementQueueItemCreate(BaseModel):
    quote_item_id: int = Field(..., ge=1, le=INT4_MAX)
    supplier_id: int = Field(..., ge=1, le=INT4_MAX)
    quantity: int = Field(..., ge=1, le=1_000_000)
    unit_price: Decimal = Field(..., gt=0, le=MAX_MONEY, allow_inf_nan=False)

    @field_validator("unit_price")
    @classmethod
    def _two_decimals(cls, v):
        return v.quantize(Decimal("0.01"))


class ProcurementQueueItemBatchCreate(BaseModel):
    items: List[ProcurementQueueItemCreate] = Field(..., min_length=1, max_length=200)

    @model_validator(mode="after")
    def _unique_items(self):
        ids = [i.quote_item_id for i in self.items]
        if len(ids) != len(set(ids)):
            raise ValueError("The same quotation item appears more than once")
        return self


class ProcurementQueueItem(BaseModel):
    """One queued line, enriched for display on the TOP page."""
    id: int
    quote_item_id: int
    quote_id: int
    quote_no: str
    branch_code: str
    supplier_id: int
    supplier_name: Optional[str] = None
    product_id: int
    product_name: Optional[str] = None
    quantity: int
    unit_price: Decimal
    added_date: datetime
    # Procurement quantities — required/available/ordered/to-purchase — so
    # the TOP page can show *why* the queued quantity is what it is, and the
    # frontend can cap edits to avoid accidental over-purchasing.
    required_quantity: int = 0
    available_quantity: int = 0
    ordered_quantity: int = 0
    to_purchase_quantity: int = 0


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
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None

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
    # Free-text match on PO number — mirrors the browse grid's client-side
    # search box, so a filtered CSV export matches what's on screen.
    search: Optional[str] = None
    for_grn: bool = False  # When True, only return POs eligible for GRN creation (approved/partially_completed)
    batch_id: Optional[str] = None  # POs created together in one multi-supplier purchase
    requested_by: Optional[str] = None  # name / username of the person who created the PO
    added_from: Optional[date] = None  # created-on range (added_date), inclusive
    added_to: Optional[date] = None
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

