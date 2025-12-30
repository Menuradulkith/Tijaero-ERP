from pydantic import BaseModel, EmailStr
from typing import Optional
from datetime import datetime

class BranchBase(BaseModel):
    branch_name: str
    branch_code: str
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None

class BranchCreate(BranchBase):
    pass

class BranchUpdate(BaseModel):
    branch_name: Optional[str] = None
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = None

class Branch(BranchBase):
    id: int
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
