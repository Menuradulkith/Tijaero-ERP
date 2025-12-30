from pydantic import BaseModel, EmailStr, Field
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

# Supplier Schemas
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
    max_credit_limit: int
    active: bool = True
    country_id: Optional[int] = None

class SupplierCreate(SupplierBase):
    pass

class SupplierUpdate(BaseModel):
    full_name: Optional[str] = None
    company_name: Optional[str] = None
    email: Optional[EmailStr] = None
    mobile_contact_number: Optional[str] = None
    credit_days: Optional[int] = None
    max_credit_limit: Optional[int] = None
    active: Optional[bool] = None

class Supplier(SupplierBase):
    id: int
    date_joined: datetime
    left_credit_amount: Optional[int] = None
    initial_credit_amount: Optional[int] = None
    
    class Config:
        from_attributes = True

# Purchase Order Schemas
class PurchasingOrderItemBase(BaseModel):
    product_id: int
    quantity: int
    unit_price: Decimal
    warrenty_month: str
    remark: Optional[str] = None

class PurchasingOrderItemCreate(PurchasingOrderItemBase):
    pass

class PurchasingOrderItem(PurchasingOrderItemBase):
    id: int
    purchasingorders_id: int
    created_date: date
    added_date: datetime
    
    class Config:
        from_attributes = True

class PurchasingOrderBase(BaseModel):
    purchasing_order_no: str
    purchasing_invoice_no: str
    branch_code: str
    payment_method: str
    purchasing_order_date: date
    good_received_note_date: date
    remarks: Optional[str] = None
    credit_date: Optional[int] = None
    first_suppliers_id: int
    second_suppliers_id: int
    expected_delivery_date: Optional[date] = None

class PurchasingOrderCreate(PurchasingOrderBase):
    items: List[PurchasingOrderItemCreate]

class PurchasingOrderUpdate(BaseModel):
    status: Optional[str] = None
    actual_delivery_date: Optional[date] = None
    remarks: Optional[str] = None

class PurchasingOrder(PurchasingOrderBase):
    id: int
    created_date: date
    added_date: datetime
    approval_id: Optional[int] = None
    status: str = "pending"
    total_amount: Decimal = Decimal("0.00")
    paid_amount: Decimal = Decimal("0.00")
    actual_delivery_date: Optional[date] = None
    
    class Config:
        from_attributes = True

class PurchasingOrderWithItems(PurchasingOrder):
    items: List[PurchasingOrderItem] = []

# Purchase Return Schemas
class PurchasingReturnItemBase(BaseModel):
    product_id: int
    purchasing_price: Decimal
    return_price: Decimal
    barcode: str

class PurchasingReturnItemCreate(PurchasingReturnItemBase):
    pass

class PurchasingReturnItem(PurchasingReturnItemBase):
    id: int
    purchasingreturn_id: int
    branch_code: str
    added_date: datetime
    
    class Config:
        from_attributes = True

class PurchasingReturnBase(BaseModel):
    purchasing_return_no: str
    branch_code: str
    remark: Optional[str] = None
    goodreceivednote_id: int

class PurchasingReturnCreate(PurchasingReturnBase):
    items: List[PurchasingReturnItemCreate]

class PurchasingReturn(PurchasingReturnBase):
    id: int
    added_date: date
    approval_id: Optional[int] = None
    
    class Config:
        from_attributes = True

class PurchasingReturnWithItems(PurchasingReturn):
    items: List[PurchasingReturnItem] = []

# Supplier Credit Settlement Schemas (using existing table)
class SupplierCreditsSettleTransactionBase(BaseModel):
    payment_method: str
    cheque_date: date
    payment_amount: Decimal
    payment_method_number: Optional[str] = None
    remarks: Optional[str] = None
    good_received_id: int

class SupplierCreditsSettleTransactionCreate(SupplierCreditsSettleTransactionBase):
    pass

class SupplierCreditsSettleTransaction(SupplierCreditsSettleTransactionBase):
    id: int
    created_date: datetime
    supplier_credit_settle_id: Optional[int] = None
    
    class Config:
        from_attributes = True

# List and Filter Schemas
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
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100
