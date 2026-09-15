from datetime import date, datetime
from typing import List, Optional

from app.common.base_schemas import TijaeroBaseSchema
from pydantic import BaseModel, EmailStr, Field, field_validator


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
    email: Optional[EmailStr] = None
    username: str = Field(..., max_length=50)
    first_name: str = Field(..., max_length=30)
    middle_name: Optional[str] = Field(None, max_length=30)
    last_name: str = Field(..., max_length=30)
    gender: Optional[str] = Field(None, max_length=30)
    birthdate: Optional[date] = None
    occupation: Optional[str] = Field(None, max_length=30)
    phone_number: Optional[str] = Field(None, max_length=30)
    is_active: bool = True
    is_staff: bool = False

    @field_validator("birthdate")
    @classmethod
    def birthdate_not_in_future(cls, value: Optional[date]) -> Optional[date]:
        if value is not None and value > date.today():
            raise ValueError("Birthdate cannot be in the future")
        return value


class UserCreate(UserBase):
    password: str = Field(
        ..., min_length=8, description="Password must be at least 8 characters long"
    )
    employee_id: str = Field(..., max_length=255)
    date_joined: Optional[date] = None
    branch_ids: List[int] = Field(..., min_length=1)
    primary_branch_id: Optional[int] = None
    group_ids: List[int] = Field(..., min_length=1)

    @field_validator("primary_branch_id")
    @classmethod
    def primary_branch_must_be_assigned(cls, value: Optional[int], info) -> Optional[int]:
        branch_ids = info.data.get("branch_ids")
        if value is not None and branch_ids is not None and value not in branch_ids:
            raise ValueError("Primary branch must be one of the assigned branches")
        return value

    @field_validator("date_joined")
    @classmethod
    def date_joined_not_in_future(cls, value: Optional[date]) -> Optional[date]:
        if value is not None and value > date.today():
            raise ValueError("Date joined cannot be in the future")
        return value


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
    phone_number: Optional[str] = Field(None, max_length=30)
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_staff: Optional[bool] = None
    branch_ids: Optional[List[int]] = None
    primary_branch_id: Optional[int] = None
    group_ids: Optional[List[int]] = None

    @field_validator("birthdate")
    @classmethod
    def birthdate_not_in_future(cls, value: Optional[date]) -> Optional[date]:
        if value is not None and value > date.today():
            raise ValueError("Birthdate cannot be in the future")
        return value

    @field_validator("date_joined")
    @classmethod
    def date_joined_not_in_future(cls, value: Optional[date]) -> Optional[date]:
        if value is not None and value > date.today():
            raise ValueError("Date joined cannot be in the future")
        return value

    @field_validator("branch_ids")
    @classmethod
    def branch_ids_not_empty(cls, value: Optional[List[int]]) -> Optional[List[int]]:
        if value is not None and len(value) == 0:
            raise ValueError("At least one branch is required")
        return value

    @field_validator("group_ids")
    @classmethod
    def group_ids_not_empty(cls, value: Optional[List[int]]) -> Optional[List[int]]:
        if value is not None and len(value) == 0:
            raise ValueError("At least one role is required")
        return value


class User(TijaeroBaseSchema, UserBase):
    id: int
    is_superuser: bool
    employee_id: str
    verify: bool
    blocked: bool
    must_change_password: bool = False
    profile_picture_path: Optional[str] = None
    date_joined: date
    last_login: Optional[datetime] = None
    branches: List[BranchSimple] = []
    primary_branch: Optional[BranchSimple] = None
    groups: List[Group] = []
    permissions: List[Permission] = []
    created_at: datetime
    updated_at: datetime


class UserList(TijaeroBaseSchema):
    id: int
    username: str
    email: Optional[str] = None
    first_name: str
    middle_name: Optional[str] = None
    last_name: str
    gender: Optional[str] = None
    birthdate: Optional[date] = None
    phone_number: Optional[str] = None
    is_active: bool
    is_superuser: bool
    is_staff: bool
    blocked: bool = False
    must_change_password: bool = False
    profile_picture_path: Optional[str] = None
    employee_id: str
    occupation: Optional[str] = None
    last_login: Optional[datetime] = None
    branches: List[BranchSimple] = []
    primary_branch: Optional[BranchSimple] = None
    groups: List[GroupSimple] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    refresh_token: Optional[str] = None  # Deprecated: now sent via HttpOnly cookie


class RefreshTokenRequest(BaseModel):
    pass  # Deprecated due to HttpOnly cookie approach


class TokenData(BaseModel):
    user_id: Optional[int] = None


class PaginatedResponse(BaseModel):
    items: List
    total: int
    page: int
    size: int
    pages: int


# ---------------------------------------------------------------------------
# Passcode schemas
# ---------------------------------------------------------------------------

class PasscodeLoginRequest(BaseModel):
    """Body for POST /auth/passcode-login."""
    username: str = Field(..., description="The user's login username")
    passcode: str = Field(
        ...,
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
        description="Exactly 6 numeric digits",
    )


class PasscodeLoginResponse(Token):
    """Extends the standard Token response with an expiry flag used to
    prompt the user to set a new passcode after a password login."""
    passcode_expired: bool = False
    must_change_password: bool = False


class SetPasscodeRequest(BaseModel):
    """Body for POST /auth/passcode (set or change passcode)."""
    passcode: str = Field(
        ...,
        min_length=6,
        max_length=6,
        pattern=r"^\d{6}$",
        description="Exactly 6 numeric digits",
    )
    confirm_passcode: str = Field(
        ...,
        min_length=6,
        max_length=6,
        description="Must match passcode",
    )


class PasscodeStatus(BaseModel):
    """Returned by GET /auth/passcode/status."""
    has_passcode: bool
    locked_out: bool
    failed_attempts: int
    expires_at: Optional[str] = None    # ISO datetime string
    is_expired: bool
    days_until_expiry: Optional[int] = None
