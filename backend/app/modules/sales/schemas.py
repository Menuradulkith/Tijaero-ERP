from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime

class InvoiceItemBase(BaseModel):
    product_id: int
    quantity: int = Field(..., gt=0)
    selling_price: float = Field(..., ge=0)
    minimum_selling_price: float = Field(..., ge=0)
    warrenty_month: str = Field(..., max_length=30)

class InvoiceItemCreate(InvoiceItemBase):
    pass

class InvoiceItem(InvoiceItemBase):
    id: int
    invoice_id: int
    created_date: datetime
    
    class Config:
        from_attributes = True

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

class InvoiceCreate(InvoiceBase):
    items: List[InvoiceItemCreate]

class InvoiceUpdate(BaseModel):
    remarks: Optional[str] = None
    status: Optional[bool] = None
    approval: Optional[bool] = None

class Invoice(InvoiceBase):
    id: int
    created_date: date
    created_date_time: datetime
    status: bool
    approval: bool
    cupon_amount: float
    credit_note_amount: float
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class InvoiceWithItems(Invoice):
    items: List[InvoiceItem] = []
    
    class Config:
        from_attributes = True

class SaleReturnItemBase(BaseModel):
    barcode: str
    return_price: float = Field(..., ge=0)
    sold_price: float = Field(..., ge=0)
    branch_code: str = Field(..., max_length=200)
    invoice_item_id: Optional[int] = None

class SaleReturnItemCreate(SaleReturnItemBase):
    pass

class SaleReturnItem(SaleReturnItemBase):
    id: int
    sale_return_id: int
    added_date: datetime
    
    class Config:
        from_attributes = True

class SaleReturnBase(BaseModel):
    sale_return_no: str = Field(..., max_length=200)
    branch_code: str = Field(..., max_length=200)
    invoice_id: int
    good_received_locations_id: int
    payment_method: str = Field(..., max_length=30)
    remark: Optional[str] = None

class SaleReturnCreate(SaleReturnBase):
    items: List[SaleReturnItemCreate]

class SaleReturn(SaleReturnBase):
    id: int
    added_date: date
    cheque_date: date
    approval_id: Optional[int] = None
    
    class Config:
        from_attributes = True
