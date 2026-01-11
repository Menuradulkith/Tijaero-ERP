from pydantic import BaseModel, EmailStr, Field, field_validator
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
    max_credit_limit: Optional[int] = None
    active: Optional[bool] = None
    country_id: Optional[int] = None

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

class PurchasingOrder(PurchasingOrderBase):
    id: int
    created_date: date
    added_date: datetime
    approval_id: Optional[int] = None
    status: str = "pending"
    total_amount: Decimal = Decimal("0.00")
    paid_amount: Decimal = Decimal("0.00")
    
    @field_validator('status', mode='before')
    @classmethod
    def default_status(cls, v):
        return v if v is not None else "pending"
    
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
    sales_stock_id: Optional[int] = None  # Link to the stock item being returned

class PurchasingReturnItemCreate(PurchasingReturnItemBase):
    pass

class PurchasingReturnItem(PurchasingReturnItemBase):
    id: int
    purchasingreturn_id: int
    branch_code: str
    added_date: datetime
    product_name: Optional[str] = None  # Loaded from product relationship
    
    class Config:
        from_attributes = True

class PurchasingReturnBase(BaseModel):
    purchasing_return_no: Optional[str] = None  # Auto-generated if not provided
    branch_code: str
    remark: Optional[str] = None
    goodreceivednote_id: int

class PurchasingReturnCreate(PurchasingReturnBase):
    items: List[PurchasingReturnItemCreate]
    require_approval: bool = False  # Whether to submit for approval or approve immediately

class PurchasingReturn(PurchasingReturnBase):
    id: int
    added_date: date
    status: str = "draft"  # draft, pending, approved, rejected
    approved_date: Optional[datetime] = None
    approval_id: Optional[int] = None
    
    class Config:
        from_attributes = True

class PurchasingReturnWithItems(PurchasingReturn):
    items: List[PurchasingReturnItem] = []


# Barcode Validation Schemas for Purchase Return
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
    status: Optional[str] = None  # Current stock status


class PurchaseReturnApprovalRequest(BaseModel):
    return_id: int
    approve: bool  # True to approve, False to reject
    remarks: Optional[str] = None

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

# Good Received Note Schemas
class GoodReceivedNoteBase(BaseModel):
    good_received_no: str
    good_received_date: date
    supplier_invoice_no: str
    supplier_invoice_date: date
    remark: Optional[str] = None
    branch_code: str
    good_received_locations_id: int
    purchasingorders_id: int

class GoodReceivedNoteCreate(GoodReceivedNoteBase):
    pass

class GoodReceivedNote(GoodReceivedNoteBase):
    id: int
    created_date: date
    added_date: datetime
    
    class Config:
        from_attributes = True

# Good Received Items Schemas
class GoodReceivedItemBase(BaseModel):
    good_received_note: str
    barcode: str
    branch_code: str
    active: bool = True
    purchasing_order_items_id: int

class GoodReceivedItemCreate(GoodReceivedItemBase):
    pass

class GoodReceivedItem(GoodReceivedItemBase):
    id: int
    created_date: date
    added_date: datetime
    
    class Config:
        from_attributes = True


class GoodReceivedItemWithDetails(GoodReceivedItem):
    """Enhanced GRN item with product name and saved-to info"""
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    saved_to_sales_stock: bool = False
    saved_to_company_assets: bool = False
    
    class Config:
        from_attributes = True

class GoodReceivedNoteListFilter(BaseModel):
    branch_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100


# Supplier Credits Settle Schemas
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
    supplier_credit_settle_id: int
    created_date: datetime
    # GRN details for display
    grn_no: Optional[str] = None
    po_no: Optional[str] = None
    invoice_no: Optional[str] = None
    
    class Config:
        from_attributes = True

class SupplierCreditsSettleBase(BaseModel):
    supplier_credits_settle_no: str
    branch_code: str
    suppliers_id: int

class SupplierCreditsSettleCreate(SupplierCreditsSettleBase):
    transactions: List[SupplierCreditsSettleTransactionCreate]

class SupplierCreditsSettleUpdate(BaseModel):
    branch_code: Optional[str] = None

class SupplierCreditsSettle(SupplierCreditsSettleBase):
    id: int
    created_date: datetime
    
    class Config:
        from_attributes = True

class SupplierCreditsSettleWithTransactions(SupplierCreditsSettle):
    transactions: List[SupplierCreditsSettleTransaction] = []


# Daily PO Limit Check Schema
class DailyPOLimitCheck(BaseModel):
    branch_code: str
    date: date
    count: int
    limit: int
    remaining: int
    can_create: bool
    message: str
