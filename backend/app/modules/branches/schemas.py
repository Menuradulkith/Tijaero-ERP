from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

from app.common.base_schemas import TijaeroBaseSchema

class BranchBase(BaseModel):
    branch_name: str
    branch_code: str
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None
    active: bool = True

class BranchCreate(BranchBase):
    pass

class BranchUpdate(BaseModel):
    branch_name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None
    active: Optional[bool] = None

class Branch(BranchBase, TijaeroBaseSchema):
    id: int
    active: bool
    created_at: datetime
    updated_at: datetime
