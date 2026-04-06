from datetime import date, datetime
from typing import List, Optional

from app.common.base_schemas import TijaeroBaseSchema
from pydantic import BaseModel, EmailStr, Field


class BranchBase(BaseModel):
    branch_name: str = Field(..., max_length=255)
    branch_code: str = Field(..., max_length=255)
    address: Optional[str] = None
    email: Optional[EmailStr] = None
    contact_number: Optional[str] = Field(None, max_length=255)


class BranchSimple(TijaeroBaseSchema):
    id: int
    branch_name: str
    branch_code: str


class PermissionBase(BaseModel):
    name: str = Field(..., max_length=255)
    resource: str
    action: str
    description: Optional[str] = None


class PermissionCreate(PermissionBase):
    pass


class Permission(TijaeroBaseSchema, PermissionBase):
    id: int


class GroupBase(BaseModel):
    name: str = Field(..., max_length=150)


class GroupSimple(TijaeroBaseSchema):
    id: int
    name: str


class GroupCreate(GroupBase):
    permission_ids: List[int] = []


class GroupUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=150)
    permission_ids: Optional[List[int]] = None


class Group(TijaeroBaseSchema, GroupBase):
    id: int
    permissions: List[Permission] = []


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
    date_joined: Optional[date] = None
    occupation: Optional[str] = Field(None, max_length=30)
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_staff: Optional[bool] = None
    branch_ids: Optional[List[int]] = None
    group_ids: Optional[List[int]] = None


class User(TijaeroBaseSchema, UserBase):
    id: int
    is_superuser: bool
    employee_id: str
    verify: bool
    blocked: bool
    date_joined: date
    last_login: Optional[datetime] = None
    branches: List[BranchSimple] = []
    groups: List[Group] = []
    permissions: List[Permission] = []
    created_at: datetime
    updated_at: datetime


class UserList(TijaeroBaseSchema):
    id: int
    username: str
    email: str
    first_name: str
    middle_name: Optional[str] = None
    last_name: str
    gender: str
    birthdate: date
    is_active: bool
    is_superuser: bool
    is_staff: bool
    employee_id: str
    occupation: str
    last_login: Optional[datetime] = None
    branches: List[BranchSimple] = []
    groups: List[GroupSimple] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class Token(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class TokenData(BaseModel):
    user_id: Optional[int] = None


class PaginatedResponse(BaseModel):
    items: List
    total: int
    page: int
    size: int
    pages: int
