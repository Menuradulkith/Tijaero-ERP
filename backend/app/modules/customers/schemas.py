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
    cupon_code: str
    limit_by_usage: int = 1000
    limit_for_customer: int = 10
    valid_until_date: date
    limit_validity_product_id: Optional[int] = None

class CustomerCuponCodesCreate(CustomerCuponCodesBase):
    pass

class CustomerCuponCodesUpdate(BaseModel):
    cupon_code: Optional[str] = None
    limit_by_usage: Optional[int] = None
    limit_for_customer: Optional[int] = None
    valid_until_date: Optional[date] = None
    limit_validity_product_id: Optional[int] = None

class CustomerCuponCodes(CustomerCuponCodesBase):
    id: int
    
    class Config:
        from_attributes = True


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
