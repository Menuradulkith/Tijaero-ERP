from datetime import date, datetime
from typing import Annotated, Generic, List, Optional, TypeVar

from app.common.base_schemas import TijaeroBaseSchema
from pydantic import BaseModel, EmailStr, Field, StringConstraints, field_validator, model_validator
from app.common.validators import normalize_phone_number
from app.core.password_policy import validate_password_strength


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


# Input rules for the permission catalog. Resources/actions are identifiers
# (lower-case snake case) so the same permission can never exist twice under
# different spellings.
_Identifier = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100, pattern=r"^[a-z0-9_]+$")]


class PermissionCreate(PermissionBase):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)]
    resource: _Identifier
    action: _Identifier
    description: Optional[Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]] = None


class Permission(TijaeroBaseSchema, PermissionBase):
    id: int


class GroupBase(BaseModel):
    name: str = Field(..., max_length=150)


class GroupSimple(TijaeroBaseSchema):
    id: int
    name: str


# Role input rules: a real, trimmed name; valid, de-duplicated permission ids.
_RoleName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
_PermissionId = Annotated[int, Field(ge=1, le=2_147_483_647)]


class GroupCreate(BaseModel):
    name: _RoleName
    permission_ids: List[_PermissionId] = []

    @field_validator("permission_ids")
    @classmethod
    def _dedupe(cls, value):
        return list(dict.fromkeys(value))


class GroupUpdate(BaseModel):
    # Only explicitly sent values are validated, so omitting a field leaves it
    # unchanged while an explicit null/blank is rejected (it used to be silently ignored).
    name: Optional[_RoleName] = None
    permission_ids: Optional[List[_PermissionId]] = None

    @field_validator("name", "permission_ids")
    @classmethod
    def _not_null(cls, value):
        if value is None:
            raise ValueError("This field cannot be null")
        return list(dict.fromkeys(value)) if isinstance(value, list) else value


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


# --- input constraints (create / update only) -----------------------------------
# The response models (UserBase / User) stay lenient so legacy rows that predate
# these rules still serialize; new input must carry real, trimmed content.
_Id = Annotated[int, Field(ge=1, le=2_147_483_647)]
_Username = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=50, pattern=r"^[A-Za-z0-9._@-]+$")
]
_Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
_OptName = Annotated[str, StringConstraints(strip_whitespace=True, max_length=30)]
_EmployeeId = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=3, max_length=255, pattern=r"^[A-Za-z0-9_-]+$")
]
_MIN_BIRTHDATE = date(1900, 1, 1)


def _blank_to_none(value):
    """Forms send "" for an untouched optional field; treat that as "not set"."""
    if isinstance(value, str) and not value.strip():
        return None
    return value


def _clean_phone(value):
    return normalize_phone_number(_blank_to_none(value))


def _clean_email(value):
    value = _blank_to_none(value)
    return value.strip().lower() if isinstance(value, str) else value


def _dedupe_ids(value):
    return list(dict.fromkeys(value)) if value is not None else value


def _check_dates(birthdate: Optional[date], date_joined: Optional[date]) -> None:
    if birthdate is not None and birthdate < _MIN_BIRTHDATE:
        raise ValueError("Birthdate is not plausible")
    if birthdate is not None and date_joined is not None and date_joined < birthdate:
        raise ValueError("Date joined cannot be before birthdate")


class UserCreate(UserBase):
    username: _Username
    first_name: _Name
    last_name: _Name
    middle_name: Optional[_OptName] = None
    gender: Optional[_OptName] = None
    occupation: Optional[_OptName] = None
    password: str = Field(..., min_length=8, max_length=128, description="Password policy: see app.core.password_policy")
    employee_id: _EmployeeId
    date_joined: Optional[date] = None
    branch_ids: List[_Id] = Field(..., min_length=1)
    primary_branch_id: Optional[_Id] = None
    group_ids: List[_Id] = Field(..., min_length=1)

    _v_blank = field_validator(
        "middle_name", "gender", "birthdate", "occupation", "date_joined", mode="before"
    )(_blank_to_none)
    _v_email = field_validator("email", mode="before")(_clean_email)
    _v_phone = field_validator("phone_number", mode="before")(_clean_phone)
    _v_ids = field_validator("branch_ids", "group_ids")(_dedupe_ids)

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

    @model_validator(mode="after")
    def _cross_field_rules(self):
        _check_dates(self.birthdate, self.date_joined)
        validate_password_strength(self.password, self.username)
        return self


class UserUpdate(BaseModel):
    email: Optional[EmailStr] = None
    username: Optional[_Username] = None
    first_name: Optional[_Name] = None
    middle_name: Optional[_OptName] = None
    last_name: Optional[_Name] = None
    gender: Optional[_OptName] = None
    birthdate: Optional[date] = None
    date_joined: Optional[date] = None
    occupation: Optional[_OptName] = None
    phone_number: Optional[str] = Field(None, max_length=30)
    password: Optional[str] = Field(None, max_length=128)
    is_active: Optional[bool] = None
    is_staff: Optional[bool] = None
    branch_ids: Optional[List[_Id]] = None
    primary_branch_id: Optional[_Id] = None
    group_ids: Optional[List[_Id]] = None

    # Optional values the user may clear ("" / null -> NULL). Required columns
    # (username, names, flags) are *not* clearable: null is rejected below.
    _v_blank = field_validator(
        "middle_name", "gender", "birthdate", "occupation", "date_joined", mode="before"
    )(_blank_to_none)
    _v_email = field_validator("email", mode="before")(_clean_email)
    _v_phone = field_validator("phone_number", mode="before")(_clean_phone)
    _v_ids = field_validator("branch_ids", "group_ids")(_dedupe_ids)

    @field_validator("username", "first_name", "last_name", "is_active", "is_staff")
    @classmethod
    def _required_not_null(cls, value):
        if value is None:
            raise ValueError("This field cannot be null")
        return value

    @field_validator("password", mode="before")
    @classmethod
    def _empty_password_means_unchanged(cls, value):
        # The edit form submits "" when the password box is left alone.
        return None if value == "" else value

    @field_validator("password")
    @classmethod
    def _password_policy(cls, value: Optional[str]) -> Optional[str]:
        return validate_password_strength(value) if value is not None else value

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

    @model_validator(mode="after")
    def _cross_field_rules(self):
        _check_dates(self.birthdate, self.date_joined)
        if self.password is not None and self.username is not None:
            validate_password_strength(self.password, self.username)
        return self


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



T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    """One page of a server-side paged list; total is the filtered row count across all pages."""
    items: List[T]
    total: int
    page: int
    size: int
    pages: int


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
