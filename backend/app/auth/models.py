from typing import TYPE_CHECKING

from app.common.base_models import TimestampMixin
from app.db.base import Base
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Column,
    Date,
    ForeignKey,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import relationship

if TYPE_CHECKING:
    from app.modules.common.models import Country
    from app.modules.employees.models import Employee
    from app.modules.finance.models import BankDeposits
    from app.modules.support.models import CustomerSupport
    from app.modules.warehouse.models import ItemTransferNoteApproved

user_groups = Table(
    "accounts_user_groups",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("accounts_user.id")),
    Column("group_id", Integer, ForeignKey("auth_group.id")),
)

group_permissions = Table(
    "auth_group_permissions",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("group_id", Integer, ForeignKey("auth_group.id")),
    Column("permission_id", Integer, ForeignKey("auth_permission.id")),
)

user_permissions = Table(
    "accounts_user_user_permissions",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("accounts_user.id")),
    Column("permission_id", Integer, ForeignKey("auth_permission.id")),
)

user_branches = Table(
    "accounts_user_branches",
    Base.metadata,
    Column("id", Integer, primary_key=True),
    Column("user_id", Integer, ForeignKey("accounts_user.id")),
    Column("branches_id", Integer, ForeignKey("branches.id")),
)


class User(Base, TimestampMixin):
    __tablename__ = "accounts_user"

    id = Column(Integer, primary_key=True, index=True)
    hashed_password = Column(String(128), nullable=False)
    last_login = Column(TIMESTAMP)
    is_superuser = Column(Boolean, nullable=False)
    username = Column(String(50), unique=True, nullable=False)
    email = Column(String(75), unique=True, nullable=False)
    first_name = Column(String(30), nullable=False)
    middle_name = Column(String(30))
    last_name = Column(String(30), nullable=False)
    gender = Column(String(30), nullable=False)
    is_staff = Column(Boolean, nullable=False)
    is_active = Column(Boolean, nullable=False)
    date_joined = Column(Date, nullable=False)
    birthdate = Column(Date, nullable=False)
    employee_id = Column(String(255), nullable=False)
    verify = Column(Boolean, nullable=False)
    blocked = Column(Boolean, nullable=False)
    occupation = Column(String(30), nullable=False)
    country_id = Column(Integer, ForeignKey("country.id"))
    profile_picture_id = Column(Integer)

    groups = relationship(
        "Group", secondary=user_groups, back_populates="users", lazy="select"
    )
    permissions = relationship(
        "Permission",
        secondary=user_permissions,
        back_populates="users",
        lazy="select",
    )
    branches = relationship(
        "Branch", secondary=user_branches, back_populates="users", lazy="select"
    )
    country = relationship("Country", back_populates="users", lazy="select")


class Group(Base, TimestampMixin):
    __tablename__ = "auth_group"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(150), unique=True, nullable=False)

    users = relationship("User", secondary=user_groups, back_populates="groups")
    permissions = relationship(
        "Permission",
        secondary=group_permissions,
        back_populates="groups",
        lazy="selectin",
    )


class Permission(Base, TimestampMixin):
    __tablename__ = "auth_permission"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, nullable=False)
    resource = Column(String, nullable=False)
    action = Column(String, nullable=False)
    description = Column(String)

    groups = relationship(
        "Group", secondary=group_permissions, back_populates="permissions"
    )
    users = relationship(
        "User", secondary=user_permissions, back_populates="permissions"
    )


class Branch(Base, TimestampMixin):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, index=True)
    branch_name = Column(String(255), unique=True, nullable=False)
    address = Column(Text)
    email = Column(String(75))
    contact_number = Column(String(255))
    branch_code = Column(String(255), unique=True, nullable=False)

    users = relationship("User", secondary=user_branches, back_populates="branches")


class LoginShortcode(Base):

    __tablename__ = "login_shortcodes"

    user_id = Column(
        Integer, ForeignKey("accounts_user.id"), primary_key=True, index=True
    )
    login_short_code = Column(Text, unique=True)
    barcode = Column(Text)
