from pydantic import BaseModel
from typing import Optional, List, Any
from datetime import datetime
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema

class CountryBase(BaseModel):
    name: str
    iso: str
    iso3: str
    currency_code: Optional[str] = None
    currency_name: Optional[str] = None
    phone: Optional[str] = None

class Country(CountryBase, TijaeroBaseSchema):
    id: int
    iso_numeric: int

class LocationBase(BaseModel):
    name: str
    branch_code: str

class LocationCreate(LocationBase):
    pass

class Location(LocationBase, TijaeroBaseSchema):
    id: int
    created_date: datetime

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

class Approval(ApprovalBase, TijaeroBaseSchema):
    id: int
    status_changed_by: Optional[int] = None
    next_approval_group: Optional[str] = None
    next_user_to_approve: Optional[int] = None

class ReferenceDataResponse(TijaeroBaseSchema):

    branches: Optional[List[Any]] = None
    categories: Optional[List[Any]] = None
    brands: Optional[List[Any]] = None
    locations: Optional[List[Any]] = None
    products: Optional[List[Any]] = None
    countries: Optional[List[Any]] = None
    suppliers: Optional[List[Any]] = None
    customers: Optional[List[Any]] = None
    employees: Optional[List[Any]] = None
    sales_stock: Optional[List[Any]] = None
