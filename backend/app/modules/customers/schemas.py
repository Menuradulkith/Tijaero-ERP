from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal

class CustomerBase(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255, description="Customer name")
    title: str = Field(..., max_length=30, description="Title (Mr/Ms/Mrs)")
    email: Optional[str] = Field(None, max_length=75, description="Customer email address")
    mobile_contact_number: str = Field(..., max_length=12, description="Mobile contact number")
    home_contact_number: Optional[str] = Field(None, max_length=12, description="Home contact number")
    company_name: Optional[str] = Field(None, max_length=255, description="Company name")
    occupation: Optional[str] = Field(None, max_length=255, description="Occupation")
    gender: str = Field(..., max_length=30, description="Gender")
    civil_status: str = Field(..., max_length=30, description="Civil status")
    no_of_kids: str = Field(..., max_length=30, description="Number of kids")
    birthdate: Optional[date] = Field(None, description="Birth date")
    id_card_number: Optional[str] = Field(None, max_length=12, description="ID card number")
    passport_no: Optional[str] = Field(None, max_length=50, description="Passport number")
    payment_address: Optional[str] = Field(None, description="Payment address")
    delivery_address: Optional[str] = Field(None, description="Delivery address")
    bank_details: Optional[str] = Field(None, description="Bank details")
    name_in_cheque_card: Optional[str] = Field(None, max_length=255, description="Name in cheque/card")
    credit_days: int = Field(default=0, description="Credit days")
    max_credit_limit: int = Field(default=0, description="Maximum credit limit")
    left_credit_amount: Optional[int] = Field(None, description="Left credit amount")
    initial_credit_amount: Optional[int] = Field(None, description="Initial credit amount")
    active: bool = Field(default=True, description="Is active")
    is_customer_agent: bool = Field(default=False, description="Is customer agent")
    country_id: Optional[int] = Field(None, description="Country ID")

class CustomerCreate(CustomerBase):
    pass

class CustomerUpdate(BaseModel):
    customer_name: Optional[str] = Field(None, min_length=1, max_length=255)
    title: Optional[str] = Field(None, max_length=30)
    email: Optional[str] = Field(None, max_length=75)
    mobile_contact_number: Optional[str] = Field(None, max_length=12)
    home_contact_number: Optional[str] = Field(None, max_length=12)
    company_name: Optional[str] = Field(None, max_length=255)
    occupation: Optional[str] = Field(None, max_length=255)
    gender: Optional[str] = Field(None, max_length=30)
    civil_status: Optional[str] = Field(None, max_length=30)
    no_of_kids: Optional[str] = Field(None, max_length=30)
    birthdate: Optional[date] = None
    id_card_number: Optional[str] = Field(None, max_length=12)
    passport_no: Optional[str] = Field(None, max_length=50)
    payment_address: Optional[str] = None
    delivery_address: Optional[str] = None
    bank_details: Optional[str] = None
    name_in_cheque_card: Optional[str] = Field(None, max_length=255)
    credit_days: Optional[int] = None
    max_credit_limit: Optional[int] = None
    left_credit_amount: Optional[int] = None
    initial_credit_amount: Optional[int] = None
    active: Optional[bool] = None
    is_customer_agent: Optional[bool] = None
    country_id: Optional[int] = None

class Customer(CustomerBase):
    id: int
    date_joined: datetime
    created_at: datetime
    updated_at: datetime
    created_by: Optional[int] = None
    updated_by: Optional[int] = None
    
    class Config:
        from_attributes = True

class CustomerList(BaseModel):
    total: int
    items: list[Customer]
    
    class Config:
        from_attributes = True

class CustomerAdvancePaymentsBase(BaseModel):
    advance_payments_no: str
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

class CustomerAdvancePayments(CustomerAdvancePaymentsBase):
    id: int
    created_date: date
    
    class Config:
        from_attributes = True

class CustomerCreditNotesBase(BaseModel):
    customer_id: int
    amount: Decimal
    remark: str
    invoice_no: Optional[str] = None

class CustomerCreditNotesCreate(CustomerCreditNotesBase):
    pass

class CustomerCreditNotes(CustomerCreditNotesBase):
    id: int
    date: datetime
    
    class Config:
        from_attributes = True


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

class CustomerCreditsSettleTransaction(CustomerCreditsSettleTransactionBase):
    id: int
    customer_credit_settle_id: int
    created_date: date
    
    class Config:
        from_attributes = True

class CustomerCreditsSettleBase(BaseModel):
    customer_credits_settle_no: str
    branch_code: str
    customer_id: int

class CustomerCreditsSettleCreate(CustomerCreditsSettleBase):
    transactions: List[CustomerCreditsSettleTransactionCreate]

class CustomerCreditsSettleUpdate(BaseModel):
    branch_code: Optional[str] = None

class CustomerCreditsSettle(CustomerCreditsSettleBase):
    id: int
    created_date: datetime
    
    class Config:
        from_attributes = True

class CustomerCreditsSettleWithTransactions(CustomerCreditsSettle):
    transactions: List[CustomerCreditsSettleTransaction] = []


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

class CustomerCuponCodes(CustomerCuponCodesBase):
    id: int
    created_date: Optional[datetime] = None
    usage_count: int = 0  # Track total usage count
    product_ids: List[int] = []  # Computed field for restricted product IDs
    
    class Config:
        from_attributes = True


# Coupon Usage Schemas
class CouponUsageBase(BaseModel):
    coupon_id: int
    customer_id: int
    invoice_id: int
    discount_amount: Decimal

class CouponUsageCreate(CouponUsageBase):
    pass

class CouponUsage(CouponUsageBase):
    id: int
    used_date: datetime
    invoice_no: Optional[str] = None
    customer_name: Optional[str] = None
    
    class Config:
        from_attributes = True


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

class CustomerGiftVoucher(CustomerGiftVoucherBase):
    id: int
    claimed_date: Optional[datetime] = None
    claimed_invoice_no: Optional[str] = None
    
    class Config:
        from_attributes = True


# Customer Support Schemas
class CustomerCallLogBase(BaseModel):
    contact_person: Optional[str] = None
    comment: Optional[str] = None

class CustomerCallLogCreate(CustomerCallLogBase):
    customer_support_id: Optional[int] = None

class CustomerCallLog(CustomerCallLogBase):
    id: int
    date: datetime
    customer_support_id: Optional[int] = None
    
    class Config:
        from_attributes = True

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

class CustomerSupport(CustomerSupportBase):
    id: int
    
    class Config:
        from_attributes = True

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

class GiftVoucherUpdate(BaseModel):
    amount: Optional[Decimal] = None
    valid_period_in_months: Optional[int] = None
    status: Optional[str] = None

class GiftVoucher(GiftVoucherBase):
    id: int
    balance: Decimal
    date: date
    status: str
    purchased_invoice_no: Optional[str] = None
    claimed_date: Optional[datetime] = None
    claimed_invoice_no: Optional[str] = None
    created_at: Optional[datetime] = None
    
    class Config:
        from_attributes = True

class VoucherUsageBase(BaseModel):
    voucher_id: int
    invoice_id: int
    amount_used: Decimal

class VoucherUsageCreate(VoucherUsageBase):
    pass

class VoucherUsage(VoucherUsageBase):
    id: int
    used_date: datetime
    invoice_no: Optional[str] = None
    
    class Config:
        from_attributes = True

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
