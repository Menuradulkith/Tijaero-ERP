from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import date, datetime

# Branch Schemas
class BranchBase(BaseModel):
    branch_name: str = Field(..., max_length=255)
    branch_code: str = Field(..., max_length=255)
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = Field(None, max_length=255)

class BranchSimple(BaseModel):
    id: int
    branch_name: str
    branch_code: str
    
    class Config:
        from_attributes = True

# Group/Role Schemas
class PermissionBase(BaseModel):
    name: str = Field(..., max_length=255)
    resource: str
    action: str
    description: Optional[str] = None

class PermissionCreate(PermissionBase):
    pass

class Permission(PermissionBase):
    id: int
    
    class Config:
        from_attributes = True

class GroupBase(BaseModel):
    name: str = Field(..., max_length=150)

class GroupCreate(GroupBase):
    permission_ids: List[int] = []

class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=150)
    permission_ids: Optional[List[int]] = None

class Group(GroupBase):
    id: int
    permissions: List[Permission] = []
    
    class Config:
        from_attributes = True

# User Schemas
class UserBase(BaseModel):
    email: EmailStr
    username: str = Field(..., max_length=50)
    first_name: str = Field(..., max_length=30)
    middle_name: Optional[str] = Field(None, max_length=30)
    last_name: str = Field(..., max_length=30)
    gender: str = Field(..., max_length=30)
    birthdate: date
    occupation: str = Field(..., max_length=30)
    is_active: bool = True
    is_staff: bool = False

class UserCreate(UserBase):
    password: str
    employee_id: str = Field(..., max_length=255)
    branch_ids: List[int] = []
    group_ids: List[int] = []

class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[str] = Field(None, max_length=50)
    first_name: Optional[str] = Field(None, max_length=30)
    middle_name: Optional[str] = Field(None, max_length=30)
    last_name: Optional[str] = Field(None, max_length=30)
    gender: Optional[str] = Field(None, max_length=30)
    birthdate: Optional[date] = None
    occupation: Optional[str] = Field(None, max_length=30)
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_staff: Optional[bool] = None
    branch_ids: Optional[List[int]] = None
    group_ids: Optional[List[int]] = None

class User(UserBase):
    id: int
    is_superuser: bool
    employee_id: str
    verify: bool
    blocked: bool
    date_joined: date
    branches: List[BranchSimple] = []
    groups: List[Group] = []
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True

class UserList(BaseModel):
    id: int
    username: str
    email: str
    first_name: str
    last_name: str
    is_active: bool
    is_superuser: bool
    employee_id: str
    branches: List[BranchSimple] = []
    
    class Config:
        from_attributes = True

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    user_id: Optional[int] = None

# Pagination
class PaginatedResponse(BaseModel):
    items: List
    total: int
    page: int
    size: int
    pages: int
