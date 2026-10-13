from pydantic import BaseModel, BeforeValidator, Field, ConfigDict, StringConstraints, model_validator
from typing import Annotated, Literal, Optional, List
from datetime import date, datetime

from app.core.money import MAX_MONEY as _CORE_MAX_MONEY

INT4_MAX = 2_147_483_647
MAX_MONEY = float(_CORE_MAX_MONEY)  # 999,999,999.99 — the shared cap in app.core.money


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def _lower(v):
    return v.strip().lower() if isinstance(v, str) else v


def _json_number(v):
    """L4: money / quantity / rate inputs must be JSON numbers. Pydantic's lax mode would coerce `true` -> 1 and
    `"2"` -> 2, silently turning a malformed payload into a valid order."""
    if isinstance(v, (bool, str)):
        raise ValueError("must be a number")
    return v


# Create/update inputs are strict; the response models below stay lenient so old rows still serialise.
Id = Annotated[int, BeforeValidator(_json_number), Field(ge=1, le=INT4_MAX)]
OptId = Annotated[Optional[int], BeforeValidator(_json_number), Field(default=None, ge=1, le=INT4_MAX)]
Money = Annotated[float, BeforeValidator(_json_number), Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)]
OptMoney = Annotated[Optional[float], BeforeValidator(_json_number), Field(default=None, ge=0, le=MAX_MONEY, allow_inf_nan=False)]
Percent100 = Annotated[float, BeforeValidator(_json_number), Field(ge=0, le=100, allow_inf_nan=False)]
OptPercent100 = Annotated[Optional[float], BeforeValidator(_json_number), Field(default=None, ge=0, le=100, allow_inf_nan=False)]
# Sales tax: the UI only offers 0-18 presets; nothing above 50% is a real sales tax, so 100% is a typo, not a rate.
MAX_TAX_RATE = 50
TaxRate = Annotated[float, BeforeValidator(_json_number), Field(ge=0, le=MAX_TAX_RATE, allow_inf_nan=False)]


def OptText(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none), Field(default=None)]


INVOICE_PAYMENT_METHODS = ("cash", "card", "card_visa", "card_mastercard", "card_amex", "cheque", "bank_transfer", "credit")
PaymentMethod = Annotated[Literal[INVOICE_PAYMENT_METHODS], BeforeValidator(_lower)]

class InvoiceItemBase(BaseModel):
    # Lenient: shared with the InvoiceItem response. Input rules are on InvoiceItemCreate.
    product_id: int
    quantity: int
    selling_price: float
    minimum_selling_price: float
    warrenty_month: str
    barcode: Optional[str] = None
    discount_percent: Optional[float] = 0
    discount_amount: Optional[float] = 0
    # Optional link to a ProductPriceTier; when provided the service uses
    # the tier's prices and the selling_price / minimum_selling_price fields
    # above are still accepted (allowing the rep to pass them for validation).
    price_tier_id: Optional[int] = None

class InvoiceItemCreate(InvoiceItemBase):
    product_id: Id
    quantity: Annotated[int, BeforeValidator(_json_number), Field(gt=0, le=100000)]
    # M2: an order line is never sold below one cent (zero-price lines would give stock away; quotes may estimate)
    selling_price: Annotated[float, BeforeValidator(_json_number), Field(ge=0.01, le=MAX_MONEY, allow_inf_nan=False)]
    minimum_selling_price: Money = 0
    warrenty_month: str = Field(..., max_length=30)
    barcode: OptText(100) = None
    discount_percent: Annotated[Optional[float], BeforeValidator(_json_number), Field(default=0, ge=0, le=100, allow_inf_nan=False)]
    discount_amount: Annotated[Optional[float], BeforeValidator(_json_number), Field(default=0, ge=0, le=MAX_MONEY, allow_inf_nan=False)]
    price_tier_id: OptId = None

class InvoiceItem(InvoiceItemBase):
    id: int
    invoice_id: int
    created_date: datetime
    line_total: Optional[float] = 0
    
    model_config = ConfigDict(from_attributes=True)

class InvoiceBase(BaseModel):
    # Lenient: shared with the Invoice response so a legacy row never 500s a list.
    # Every constrained input field is re-declared strictly on InvoiceCreate.
    invoice_no: Optional[str] = None  # Auto-generated on server
    branch_code: str
    customer_id: int
    sale_rep_id: Optional[int] = None  # NULL for orders converted from a quotation without a rep
    customer_agent_id: Optional[int] = None
    # Agent commission assigned on the sales order. When provided these take
    # precedence over the agent's default profile rate so the commission entry
    # reflects exactly what was assigned on the order.
    agent_commission_rate: Optional[float] = None
    agent_commission_amount: Optional[float] = None
    payment_method: str
    cash_amount: float = 0
    card_visa_amount: float = 0
    card_mastercard_amount: float = 0
    card_amex_amount: float = 0
    cheque_amount: float = 0
    bank_transfer_amount: float = 0
    credit_amount: float = 0
    credit_terms: Optional[str] = None
    override_credit_validation: Optional[bool] = None
    payment_adjustments: float = Field(default=0)
    remarks: Optional[str] = None
    special: bool = False
    source_quote_id: Optional[int] = None  # Link to source quotation
    source_quote_type: Optional[str] = None  # 'quotation'
    # Cheque payment details
    cheque_number: Optional[str] = None
    cheque_bank: Optional[str] = None
    cheque_date: Optional[date] = None  # Changed from str to date for proper serialization
    # Card payment details
    card_ref_number: Optional[str] = None
    card_holder_name: Optional[str] = None
    # Bank transfer details
    bank_transfer_ref: Optional[str] = None
    bank_name: Optional[str] = None
    # Tax fields
    is_tax_invoice: bool = Field(default=False, description="True for tax-inclusive, False for tax-exclusive")
    tax_rate: float = 0
    # Discount fields
    discount_percent: float = 0
    discount_amount: float = 0
    # Coupon/Discount code fields
    cupon_id: Optional[int] = None
    cupon_amount: float = 0
    # Credit note redemption
    credit_note_amount: float = 0
    # Gift voucher payment fields (legacy single voucher support)
    gift_voucher_id: Optional[int] = None
    gift_voucher_amount: float = 0

# Gift voucher redemption for invoice
class VoucherRedemptionItem(BaseModel):
    voucher_id: Id
    amount_to_redeem: Annotated[float, BeforeValidator(_json_number), Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]

class InvoiceCreate(InvoiceBase):
    branch_code: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
    customer_id: Id
    sale_rep_id: Id
    customer_agent_id: OptId = None
    agent_commission_rate: OptPercent100 = None
    agent_commission_amount: OptMoney = None
    payment_method: PaymentMethod
    cash_amount: Money = 0
    card_visa_amount: Money = 0
    card_mastercard_amount: Money = 0
    card_amex_amount: Money = 0
    cheque_amount: Money = 0
    bank_transfer_amount: Money = 0
    credit_amount: Money = 0
    credit_terms: OptText(100) = None
    payment_adjustments: Money = 0
    remarks: OptText(2000) = None
    source_quote_id: OptId = None
    source_quote_type: OptText(30) = None
    cheque_number: OptText(50) = None
    cheque_bank: OptText(100) = None
    cheque_date: Annotated[Optional[date], BeforeValidator(_blank_to_none)] = None
    card_ref_number: OptText(100) = None
    card_holder_name: OptText(100) = None
    bank_transfer_ref: OptText(100) = None
    bank_name: OptText(100) = None
    tax_rate: TaxRate = 0
    discount_percent: Percent100 = 0
    discount_amount: Money = 0
    cupon_id: OptId = None
    cupon_amount: Money = 0
    credit_note_amount: Money = 0
    # Customer advance (deposit) applied to this order. The amount defaults to
    # min(advance remaining, order payable); an explicit amount may not exceed either.
    customer_advance_payments_id: OptId = None
    customer_advance_amount: OptMoney = None
    gift_voucher_id: OptId = None
    gift_voucher_amount: Money = 0
    items: List[InvoiceItemCreate] = Field(..., min_length=1, max_length=200)
    # Multiple voucher redemptions
    voucher_redemptions: Optional[List[VoucherRedemptionItem]] = Field(default_factory=list, max_length=20)

class InvoiceUpdate(BaseModel):
    """Editable parts of an order. Approval and status are never set from here: they change only through the
    approval, bank-transfer, cancel and complete actions."""
    remarks: OptText(2000) = None
    items: Optional[List[InvoiceItemCreate]] = Field(default=None, min_length=1, max_length=200)

class Invoice(InvoiceBase):
    approval_id: Optional[int] = None  # the approver queue entry (use it to approve/reject centrally)
    id: int
    customer_agent_id: Optional[int] = None
    customer_advance_payments_id: Optional[int] = None
    created_date: date
    created_date_time: datetime
    status: bool
    approval: bool
    approval_status: str
    is_tax_invoice: bool = False
    # Calculated totals
    subtotal: float = 0
    tax_amount: float = 0
    grand_total: float = 0
    # Service charges
    service_charge_rate: float = 0
    service_charge_amount: float = 0
    # Payment tracking
    paid_amount: float = 0
    balance_due: float = 0
    payment_status: str = "unpaid"
    # Cash over-tender returned to the customer (create response only; the order books the payable)
    change_due: float = 0
    # Timestamps
    created_at: datetime
    updated_at: datetime
    # Creator tracking
    created_by: Optional[int] = None
    created_by_name: Optional[str] = None
    approved_by_name: Optional[str] = None
    approved_date: Optional[datetime] = None

    @model_validator(mode='wrap')
    @classmethod
    def _enrich_from_orm(cls, data, handler):
        instance = handler(data)
        # data may be an ORM object (SQLAlchemy model) or a dict.
        # Only enrich when coming from an ORM object with relationships.
        obj = data
        if hasattr(obj, 'creator') and obj.creator:
            u = obj.creator
            instance.created_by_name = (f"{u.first_name} {u.last_name}".strip() or u.username)
        
        # Map approved details for Bank Transfer
        if hasattr(obj, 'payment_method') and obj.payment_method and obj.payment_method.lower() == "bank_transfer":
            if hasattr(obj, 'bank_transfer_verifier') and obj.bank_transfer_verifier:
                u = obj.bank_transfer_verifier
                instance.approved_by_name = (f"{u.first_name} {u.last_name}".strip() or u.username)
            if hasattr(obj, 'bank_transfer_verified_date') and obj.bank_transfer_verified_date:
                instance.approved_date = obj.bank_transfer_verified_date

        # Map approved details for Credit / general approvals
        if hasattr(obj, 'approval_record') and obj.approval_record:
            ar = obj.approval_record
            if ar.status == 'approved' and ar.status_changed_by and ar.approver:
                u = ar.approver
                instance.approved_by_name = (f"{u.first_name} {u.last_name}".strip() or u.username)
                instance.approved_date = ar.updated_at

        # Map cheque payment details
        if hasattr(obj, 'cheque_payment') and obj.cheque_payment:
            instance.cheque_number = str(obj.cheque_payment.cheque_number) if obj.cheque_payment.cheque_number is not None else None
            instance.cheque_bank = obj.cheque_payment.bank
            instance.cheque_date = obj.cheque_payment.cheque_date
        
        # Map card payment details
        if hasattr(obj, 'card_payment') and obj.card_payment:
            instance.card_ref_number = obj.card_payment.ref_number
            instance.card_holder_name = obj.card_payment.remark
            
        # Map bank transfer details
        if hasattr(obj, 'bank_transfer') and obj.bank_transfer:
            instance.bank_name = obj.bank_transfer.bank_name
            instance.bank_transfer_ref = obj.bank_transfer.remarks
            
        return instance

    model_config = ConfigDict(from_attributes=True)


class InvoiceWithItems(Invoice):
    items: List[InvoiceItem] = []
    
    model_config = ConfigDict(from_attributes=True)

class SaleReturnItemBase(BaseModel):
    # Lenient: shared with the SaleReturnItem response. Input rules are on SaleReturnItemCreate.
    barcode: str
    return_price: float
    sold_price: float
    branch_code: str
    invoice_item_id: Optional[int] = None
    product_id: Optional[int] = None
    quantity: int = 1
    condition: str = "good"  # good, damaged, defective, opened
    restockable: bool = True

class SaleReturnItemCreate(SaleReturnItemBase):
    barcode: str = Field(..., max_length=200)
    branch_code: str = Field(..., max_length=200)
    condition: str = Field(default="good", max_length=50)
    return_price: Money
    sold_price: Money
    invoice_item_id: OptId = None
    product_id: OptId = None
    quantity: Annotated[int, BeforeValidator(_json_number), Field(ge=1, le=INT4_MAX)] = 1

class SaleReturnItem(SaleReturnItemBase):
    id: int
    sale_return_id: int
    added_date: datetime
    sales_stock_id: Optional[int] = None
    restocked: bool = False
    
    model_config = ConfigDict(from_attributes=True)

class SaleReturnBase(BaseModel):
    # Lenient: shared with the SaleReturn response (a legacy over-long remark must
    # not 500 GET /sales/returns/). Input rules are on SaleReturnCreate/Update.
    sale_return_no: Optional[str] = None  # Auto-generated on server
    branch_code: str
    invoice_id: int
    good_received_locations_id: int
    payment_method: str  # cash, bank_transfer, credit_note, cheque
    remark: Optional[str] = None
    return_reason: Optional[str] = None  # defective, wrong_item, customer_changed_mind, damaged, other

class SaleReturnCreate(SaleReturnBase):
    branch_code: str = Field(..., max_length=200)
    invoice_id: Id
    good_received_locations_id: Id
    payment_method: str = Field(..., max_length=30)
    remark: Optional[str] = Field(default=None, max_length=2000)
    return_reason: Optional[str] = Field(default=None, max_length=500)
    items: List[SaleReturnItemCreate]

class SaleReturnUpdate(BaseModel):
    remark: Optional[str] = Field(default=None, max_length=2000)
    return_reason: Optional[str] = Field(default=None, max_length=500)
    status: Optional[str] = Field(default=None, max_length=30)
    payment_method: Optional[str] = Field(default=None, max_length=30)

class SaleReturn(SaleReturnBase):
    id: int
    added_date: date
    cheque_date: date
    approval_id: Optional[int] = None
    status: str = "pending"
    invoice_no: Optional[str] = None  # Loaded from invoice relationship
    # Totals
    subtotal: float = 0
    tax_refund: float = 0
    total_refund: float = 0
    # Refund tracking
    refund_status: str = "pending"
    refund_amount: float = 0
    refund_date: Optional[date] = None
    refund_reference: Optional[str] = None
    credit_note_id: Optional[int] = None
    # User tracking
    created_by: Optional[int] = None
    approved_by: Optional[int] = None
    processed_by: Optional[int] = None
    # Timestamps
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)

class SaleReturnWithItems(SaleReturn):
    items: List[SaleReturnItem] = []
    
    model_config = ConfigDict(from_attributes=True)

# Response for processing a return
class SaleReturnProcessResponse(BaseModel):
    sale_return: SaleReturn
    credit_note_id: Optional[int] = None
    refund_reference: Optional[str] = None
    items_restocked: int = 0
    message: str


class OrderRejectRequest(BaseModel):
    reason: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]


class FullInvoiceReturnRequest(BaseModel):
    """Request body for the one-click "Return Invoice" action.

    Creates a sale return covering every not-yet-returned unit on the invoice.
    The return still flows through the normal approve → process pipeline, so the
    reversing financial records are posted on processing (maker-checker intact).
    """
    payment_method: str = Field(..., max_length=30)  # cash, bank_transfer, credit_note, cheque
    return_reason: Optional[str] = Field(default=None, max_length=500)
    remark: Optional[str] = Field(default=None, max_length=2000)
    good_received_locations_id: Optional[int] = Field(default=None, ge=1, le=INT4_MAX)


# Credit Payment Settlement Schemas
class CreditPaymentCreate(BaseModel):
    invoice_id: int = Field(default=1, ge=1, le=INT4_MAX)   # the path id wins
    payment_method: Annotated[Literal["cash", "cheque", "card", "card_visa", "card_mastercard", "card_amex", "bank_transfer"], BeforeValidator(_lower)]
    payment_amount: float = Field(..., gt=0, le=MAX_MONEY, allow_inf_nan=False)
    payment_date: date
    # Cheque details
    cheque_number: OptText(50) = None
    cheque_bank: OptText(100) = None
    cheque_date: Optional[date] = None
    # Card details
    card_ref_number: OptText(100) = None
    card_holder_name: OptText(100) = None
    service_charge_amount: OptMoney = None
    # Bank transfer details
    bank_transfer_ref: OptText(100) = None
    bank_name: OptText(100) = None
    # General
    remarks: OptText(1000) = None

class CreditPaymentResponse(BaseModel):
    invoice_id: int
    payment_amount: float
    previous_balance: float
    new_balance: float
    payment_status: str
    settlement_record_id: int
    message: str

class InvoicePaymentHistory(BaseModel):
    id: int
    payment_date: date
    payment_method: str
    payment_amount: float
    balance_after_payment: float
    remarks: Optional[str] = None
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


# Bank Transfer Confirmation Schemas
class PendingBankTransfer(BaseModel):
    id: int
    invoice_no: str
    customer_id: int
    customer_name: str
    branch_code: str
    bank_transfer_amount: float
    bank_transfer_ref: Optional[str] = None
    bank_name: Optional[str] = None
    grand_total: float
    created_date: datetime
    created_by_name: Optional[str] = None
    bank_transfer_status: str
    bank_transfer_verified_by_name: Optional[str] = None
    bank_transfer_verified_at: Optional[datetime] = None
    bank_transfer_rejection_reason: Optional[str] = None
    items: Optional[List[InvoiceItem]] = []
    # Source indicator: "sales_order" or "credit_settlement"
    source: str = "sales_order"
    # Settlement transaction ID (only for credit_settlement source)
    settlement_transaction_id: Optional[int] = None
    
    model_config = ConfigDict(from_attributes=True)


class BankTransferConfirmRequest(BaseModel):
    action: Literal["verify", "reject"] = Field(..., description="'verify' or 'reject'")
    rejection_reason: OptText(1000) = None


class BankTransferRejectRequest(BaseModel):
    reason: OptText(1000) = None


class BankTransferConfirmResponse(BaseModel):
    success: bool
    message: str
    invoice_no: str
    status: str


# =============================================================================
# Payment Card Schemas
# =============================================================================

class PaymentCardBase(BaseModel):
    # Lenient: shared with the PaymentCard response. Input rules are on PaymentCardCreate.
    card_name: str = Field(..., description="Card name (e.g., Visa, Mastercard)")
    card_type: str = Field(..., description="Card type: credit or debit")
    service_charge_percent: float = Field(default=0, description="Service charge percentage")
    description: Optional[str] = None
    active: bool = True


class PaymentCardCreate(PaymentCardBase):
    card_name: str = Field(..., max_length=100, description="Card name (e.g., Visa, Mastercard)")
    card_type: str = Field(..., pattern="^(credit|debit)$", description="Card type: credit or debit")
    service_charge_percent: Percent100 = Field(default=0, description="Service charge percentage")


class PaymentCardUpdate(BaseModel):
    card_name: Optional[str] = Field(None, max_length=100)
    card_type: Optional[str] = Field(None, pattern="^(credit|debit)$")
    service_charge_percent: OptPercent100 = None
    description: Optional[str] = None
    active: Optional[bool] = None


class PaymentCard(PaymentCardBase):
    id: int
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    model_config = ConfigDict(from_attributes=True)


class InvoiceCardPaymentCreate(BaseModel):
    payment_card_id: int
    amount: Annotated[float, BeforeValidator(_json_number), Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]
    reference_no: Optional[str] = None


class InvoiceCardPayment(BaseModel):
    id: int
    invoice_id: int
    payment_card_id: int
    amount: float
    service_charge: float
    total_amount: float
    reference_no: Optional[str] = None
    payment_card: Optional[PaymentCard] = None
    
    model_config = ConfigDict(from_attributes=True)
