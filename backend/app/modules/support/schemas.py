from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional, List

# Customer Support Schemas
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

class CustomerSupport(CustomerSupportBase):
    id: int
    
    class Config:
        from_attributes = True

# CS Job Item Schemas
class CSJobItemBase(BaseModel):
    fault_type: str
    job_status: str
    quantity: Optional[int] = None
    active: bool = True
    comment: Optional[str] = None
    customer_support_id: int
    product_id: int
    warrent_claim_id: Optional[int] = None

class CSJobItemCreate(CSJobItemBase):
    pass

class CSJobItem(CSJobItemBase):
    id: int
    date: datetime
    
    class Config:
        from_attributes = True

# Customer Call Log Schemas
class CustomerCallLogBase(BaseModel):
    contact_person: Optional[str] = None
    comment: Optional[str] = None
    customer_support_id: int

class CustomerCallLogCreate(CustomerCallLogBase):
    pass

class CustomerCallLog(CustomerCallLogBase):
    id: int
    date: datetime
    
    class Config:
        from_attributes = True

# Warranty Claims Schemas
class WarrantyClaimBase(BaseModel):
    warranty_type: str
    warranty_status: str
    product_barcode_old_code: str
    product_barcode_new_code: Optional[str] = None
    comment: Optional[str] = None
    order_id: int
    supplier_warrenty_claims: bool = False

class WarrantyClaimCreate(WarrantyClaimBase):
    pass

class WarrantyClaim(WarrantyClaimBase):
    id: int
    created_date: datetime
    
    class Config:
        from_attributes = True

# Customer Support with Items
class CustomerSupportWithItems(CustomerSupport):
    job_items: List[CSJobItem] = []
    call_logs: List[CustomerCallLog] = []

# Filter Schemas
class SupportListFilter(BaseModel):
    branch_code: Optional[str] = None
    job_type: Optional[str] = None
    job_status: Optional[str] = None
    assigned_user_id: Optional[int] = None
    customer_id: Optional[int] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100
