from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from decimal import Decimal

# Country Schemas
class CountryBase(BaseModel):
    name: str
    iso: str
    iso3: str
    currency_code: Optional[str] = None
    currency_name: Optional[str] = None
    phone: Optional[str] = None

class Country(CountryBase):
    id: int
    iso_numeric: int
    
    class Config:
        from_attributes = True

# Location Schemas
class LocationBase(BaseModel):
    name: str
    branch_code: str

class LocationCreate(LocationBase):
    pass

class Location(LocationBase):
    id: int
    created_date: datetime
    
    class Config:
        from_attributes = True

# Approval Schemas
class ApprovalBase(BaseModel):
    approval_for: Optional[str] = None
    status: Optional[str] = None
    remark: Optional[str] = None

class ApprovalCreate(ApprovalBase):
    pass

class ApprovalUpdate(BaseModel):
    status: Optional[str] = None
    status_changed_by: Optional[int] = None
    next_approval_group: Optional[str] = None
    next_user_to_approve: Optional[int] = None
    remark: Optional[str] = None

class Approval(ApprovalBase):
    id: int
    status_changed_by: Optional[int] = None
    next_approval_group: Optional[str] = None
    next_user_to_approve: Optional[int] = None
    
    class Config:
        from_attributes = True
