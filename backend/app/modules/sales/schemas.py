from pydantic import BaseModel, Field, ConfigDict
from typing import Optional, List
from datetime import date, datetime

class InvoiceItemBase(BaseModel):
    product_id: int
    quantity: int = Field(..., gt=0)
    selling_price: float = Field(..., ge=0)
    minimum_selling_price: float = Field(..., ge=0)
    warrenty_month: str = Field(..., max_length=30)
    barcode: Optional[str] = None

class InvoiceItemCreate(InvoiceItemBase):
    pass

class InvoiceItem(InvoiceItemBase):
    id: int
    invoice_id: int
    created_date: datetime
    
    model_config = ConfigDict(from_attributes=True)

class InvoiceBase(BaseModel):
    invoice_no: str = Field(..., max_length=200)
    branch_code: str = Field(..., max_length=200)
    customer_id: int
    sale_rep_id: int
    payment_method: str = Field(..., max_length=30)
    cash_amount: float = Field(default=0, ge=0)
    card_visa_amount: float = Field(default=0, ge=0)
    card_mastercard_amount: float = Field(default=0, ge=0)
    card_amex_amount: float = Field(default=0, ge=0)
    cheque_amount: float = Field(default=0, ge=0)
    bank_transfer_amount: float = Field(default=0, ge=0)
    credit_amount: float = Field(default=0, ge=0)
    payment_adjustments: float = Field(default=0)
    remarks: Optional[str] = None
    special: bool = False
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
    tax_rate: float = Field(default=0, ge=0, le=100)
    # Discount fields
    discount_percent: float = Field(default=0, ge=0, le=100)
    discount_amount: float = Field(default=0, ge=0)

class InvoiceCreate(InvoiceBase):
    items: List[InvoiceItemCreate]

class InvoiceUpdate(BaseModel):
    remarks: Optional[str] = None
    status: Optional[bool] = None
    approval: Optional[bool] = None
    approval_status: Optional[str] = None
    items: Optional[List[InvoiceItemCreate]] = None

class Invoice(InvoiceBase):
    id: int
    created_date: date
    created_date_time: datetime
    status: bool
    approval: bool
    approval_status: str
    cupon_amount: float
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
    # Timestamps
    created_at: datetime
    updated_at: datetime
    
    model_config = ConfigDict(from_attributes=True)

class InvoiceWithItems(Invoice):
    items: List[InvoiceItem] = []
    
    model_config = ConfigDict(from_attributes=True)

class SaleReturnItemBase(BaseModel):
    barcode: str
    return_price: float = Field(..., ge=0)
    sold_price: float = Field(..., ge=0)
    branch_code: str = Field(..., max_length=200)
    invoice_item_id: Optional[int] = None
    product_id: Optional[int] = None
    quantity: int = Field(default=1, ge=1)
    condition: str = Field(default="good", max_length=50)  # good, damaged, defective, opened
    restockable: bool = True

class SaleReturnItemCreate(SaleReturnItemBase):
    pass

class SaleReturnItem(SaleReturnItemBase):
    id: int
    sale_return_id: int
    added_date: datetime
    sales_stock_id: Optional[int] = None
    restocked: bool = False
    
    model_config = ConfigDict(from_attributes=True)

class SaleReturnBase(BaseModel):
    sale_return_no: str = Field(..., max_length=200)
    branch_code: str = Field(..., max_length=200)
    invoice_id: int
    good_received_locations_id: int
    payment_method: str = Field(..., max_length=30)  # cash, bank_transfer, credit_note, cheque
    remark: Optional[str] = None
    return_reason: Optional[str] = None  # defective, wrong_item, customer_changed_mind, damaged, other

class SaleReturnCreate(SaleReturnBase):
    items: List[SaleReturnItemCreate]

class SaleReturnUpdate(BaseModel):
    remark: Optional[str] = None
    return_reason: Optional[str] = None
    status: Optional[str] = None
    payment_method: Optional[str] = None

class SaleReturn(SaleReturnBase):
    id: int
    added_date: date
    cheque_date: date
    approval_id: Optional[int] = None
    status: str = "pending"
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

# Credit Payment Settlement Schemas
class CreditPaymentCreate(BaseModel):
    invoice_id: int
    payment_method: str = Field(..., max_length=30)  # cash, cheque, card_visa, card_mastercard, card_amex, bank_transfer
    payment_amount: float = Field(..., gt=0)
    payment_date: date
    # Cheque details
    cheque_number: Optional[str] = None
    cheque_bank: Optional[str] = None
    cheque_date: Optional[date] = None
    # Card details
    card_ref_number: Optional[str] = None
    card_holder_name: Optional[str] = None
    # Bank transfer details
    bank_transfer_ref: Optional[str] = None
    bank_name: Optional[str] = None
    # General
    remarks: Optional[str] = None

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
