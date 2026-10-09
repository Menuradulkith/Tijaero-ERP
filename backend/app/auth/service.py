from datetime import date
from typing import List, Optional
import logging

from app.auth import models, schemas
from app.auth import user_access
from app.common.audit import log_audit, diff_changes
from app.core.password_policy import validate_password_strength
from app.core import timezone as tz
from app.core.exceptions import AuthenticationError
from app.core.security import (
    DUMMY_PASSWORD_HASH,
    create_access_token,
    get_password_hash,
    verify_password,
)
from app.modules.employees.models import Employee
from app.modules.settings.schemas import NotificationCreate
from app.modules.settings.service import NotificationService

logger = logging.getLogger(__name__)
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


def _ci_eq(column, value: str):
    """Case- and surrounding-whitespace-insensitive equality."""
    return func.lower(func.trim(column)) == (value or "").strip().lower()


class AuthService:
    def authenticate_user(
        self, db: Session, username: str, password: str
    ) -> models.User:
        user = db.query(models.User).filter(models.User.username == username).first()

        # Defend against timing attacks: always compute a hash even if user ignores
        if not user:
            verify_password(password, DUMMY_PASSWORD_HASH)
            raise AuthenticationError("Invalid credentials")

        if not verify_password(password, user.hashed_password):
            raise AuthenticationError("Invalid credentials")
        if not user.is_active:
            raise AuthenticationError("User account is inactive")
        if user.blocked:
            raise AuthenticationError("User account is blocked")
        user.last_login = tz.now()
        db.commit()
        return user

    def create_user(self, db: Session, user_in: schemas.UserCreate, created_by: Optional[int] = None) -> models.User:

        if self.check_username_exists(db, user_in.username):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists",
            )

        if user_in.email and self.check_email_exists(db, user_in.email):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists"
            )

        if self.check_employee_id_exists(db, user_in.employee_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Employee ID already exists",
            )

        # Resolve roles/branches before creating anything: unknown ids and
        # inactive branches are rejected with a precise message instead of
        # silently producing a user with no role or a misleading "duplicate" error.
        branches = user_access.load_branches(db, user_in.branch_ids)
        groups = user_access.load_groups(db, user_in.group_ids)

        primary_branch_id = user_in.primary_branch_id or user_in.branch_ids[0]

        user = models.User(
            email=user_in.email,
            username=user_in.username,
            hashed_password=get_password_hash(user_in.password),
            first_name=user_in.first_name,
            middle_name=user_in.middle_name or "",
            last_name=user_in.last_name,
            gender=user_in.gender,
            birthdate=user_in.birthdate,
            occupation=user_in.occupation or "",
            phone_number=user_in.phone_number,
            employee_id=user_in.employee_id,
            is_active=user_in.is_active,
            is_staff=user_in.is_staff,
            is_superuser=False,
            verify=True,
            blocked=False,
            date_joined=user_in.date_joined or tz.today(),
            primary_branch_id=primary_branch_id,
        )
        # Everything from here through the commit can race with a concurrent
        # create for the same username/email/employee_id — the pre-checks above
        # only catch an already-committed duplicate, not one still in flight.
        # Wrapping the flushes (not just the final commit) in the same
        # try/except ensures a collision always surfaces as a clean 400
        # instead of an unhandled IntegrityError from an earlier flush.
        try:
            db.add(user)
            db.flush()

            existing_emp_for_user = (
                db.query(Employee).filter(Employee.user_id == user.id).first()
            )
            if not existing_emp_for_user:
                employee = Employee(user_id=user.id, employee_id=user_in.employee_id)
                db.add(employee)
                db.flush()

            user.branches = branches
            user.groups = groups

            log_audit(
                db, user_id=created_by or 0, action="create",
                entity_type="user", entity_id=user.id,
                changes={"username": user.username, "email": user.email},
            )

            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username, email, or employee ID already exists. Please use different values.",
            )

        db.refresh(user)

        # Notify the new user
        try:
            NotificationService(db).create_notification(
                NotificationCreate(
                    user_id=user.id,
                    title="Welcome to TijaeroERP",
                    message="Your account has been successfully created and configured.",
                    notification_type="info",
                )
            )
        except Exception:
            logger.exception("Failed to send welcome notification for user_id=%s", user.id)

        return user

    def get_users(
        self, db: Session, skip: int = 0, limit: int = 100
    ) -> List[models.User]:
        # Stable order: without one, a skip/limit window can repeat or miss rows.
        return (
            db.query(models.User)
            .order_by(func.lower(models.User.username), models.User.id)
            .offset(skip)
            .limit(limit)
            .all()
        )

    _USER_SORTS = {
        "username": lambda: func.lower(models.User.username),
        "full_name": lambda: func.lower(models.User.first_name + " " + models.User.last_name),
        "email": lambda: func.lower(models.User.email),
        "employee_id": lambda: func.lower(models.User.employee_id),
        "is_active": lambda: models.User.is_active,
        "last_login": lambda: models.User.last_login,
    }

    def get_users_page(
        self, db: Session, *, page: int, size: int, q: Optional[str] = None,
        active: Optional[bool] = None, branch_id: Optional[int] = None,
        group_id: Optional[int] = None, sort_by: Optional[str] = None, order: str = "asc",
    ) -> dict:
        """Server-side paged list for the Users page. Superuser accounts are
        not listed here (by design), same as the page always did client-side."""
        from sqlalchemy import or_
        from sqlalchemy.orm import joinedload, selectinload

        query = db.query(models.User).filter(models.User.is_superuser.is_(False))
        term = (q or "").strip()
        if term:
            pat = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            query = query.filter(or_(
                models.User.username.ilike(pat, escape="\\"),
                models.User.first_name.ilike(pat, escape="\\"),
                models.User.last_name.ilike(pat, escape="\\"),
                models.User.email.ilike(pat, escape="\\"),
                models.User.employee_id.ilike(pat, escape="\\"),
            ))
        if active is not None:
            query = query.filter(models.User.is_active.is_(active))
        if branch_id:
            query = query.filter(models.User.branches.any(models.Branch.id == branch_id))
        if group_id:
            query = query.filter(models.User.groups.any(models.Group.id == group_id))

        total = query.with_entities(func.count(models.User.id)).scalar() or 0
        expr = (self._USER_SORTS.get(sort_by or "username") or self._USER_SORTS["username"])()
        expr = expr.desc() if order == "desc" else expr.asc()
        rows = (
            query.options(selectinload(models.User.branches), selectinload(models.User.groups), joinedload(models.User.primary_branch))
            .order_by(expr, models.User.id)
            .offset(page * size)
            .limit(size)
            .all()
        )
        return {"items": rows, "total": total, "page": page, "size": size, "pages": -(-total // size)}

    def check_username_exists(
        self, db: Session, username: str, exclude_user_id: Optional[int] = None
    ) -> bool:
        query = db.query(models.User).filter(_ci_eq(models.User.username, username))
        if exclude_user_id is not None:
            query = query.filter(models.User.id != exclude_user_id)
        return query.first() is not None

    def check_email_exists(
        self, db: Session, email: str, exclude_user_id: Optional[int] = None
    ) -> bool:
        query = db.query(models.User).filter(_ci_eq(models.User.email, email))
        if exclude_user_id is not None:
            query = query.filter(models.User.id != exclude_user_id)
        return query.first() is not None

    def check_employee_id_exists(
        self, db: Session, employee_id: str, exclude_user_id: Optional[int] = None
    ) -> bool:
        try:
            from app.modules.employees.models import Employee

            query = db.query(Employee).filter(_ci_eq(Employee.employee_id, employee_id))
            if exclude_user_id is not None:
                query = query.filter(Employee.user_id != exclude_user_id)
            if query.first() is not None:
                return True
        except (ImportError, Exception):
            pass

        query = db.query(models.User).filter(_ci_eq(models.User.employee_id, employee_id))
        if exclude_user_id is not None:
            query = query.filter(models.User.id != exclude_user_id)
        return query.first() is not None

    def get_user(self, db: Session, user_id: int, for_update: bool = False) -> Optional[models.User]:
        query = db.query(models.User).filter(models.User.id == user_id)
        if for_update:
            # Serialize concurrent updates of the same user: replacing the roles /
            # branches collections deletes and re-inserts association rows, and two
            # requests doing that at once used to collide (500). populate_existing
            # re-reads the row (and collections) once the lock is held.
            query = query.with_for_update(of=models.User).populate_existing()
        user = query.first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
            )
        return user

    def update_user(
        self, db: Session, user_id: int, user_in: schemas.UserUpdate, updated_by: Optional[int] = None
    ) -> models.User:
        # Two concurrent requests can both pass the duplicate pre-checks; the DB's
        # unique indexes decide, and the loser must get a clean 400, not a 500.
        try:
            return self._update_user(db, user_id, user_in, updated_by)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username, email, or employee ID already exists. Please use different values.",
            )

    def _update_user(
        self, db: Session, user_id: int, user_in: schemas.UserUpdate, updated_by: Optional[int] = None
    ) -> models.User:
        user = self.get_user(db, user_id, for_update=True)

        update_data = user_in.model_dump(exclude_unset=True)

        if "username" in update_data and update_data["username"] and update_data["username"] != user.username:
            if self.check_username_exists(db, update_data["username"], exclude_user_id=user_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Username already exists",
                )

        if "email" in update_data and update_data["email"] and update_data["email"] != user.email:
            if self.check_email_exists(db, update_data["email"], exclude_user_id=user_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already exists",
                )

        # Snapshot only the fields actually submitted, before mutation, so the
        # audit log reflects a real diff rather than "everything the form sent".
        before_values = {field: getattr(user, field, None) for field in update_data if hasattr(user, field)}
        # branch_ids/group_ids aren't real User columns (they're relationship
        # ids from the update schema), so the generic hasattr-based snapshot
        # above never sees them — track them separately as sorted label lists
        # (branch code / group name) so re-assigning a user's branches or
        # groups actually shows up in Activity History.
        before_branch_codes = sorted(b.branch_code for b in user.branches) if "branch_ids" in update_data else None
        before_group_names = sorted(g.name for g in user.groups) if "group_ids" in update_data else None

        if "password" in update_data and update_data["password"]:
            # The schema already enforced the policy; re-check against the stored
            # username when the request did not change it.
            validate_password_strength(update_data["password"], update_data.get("username") or user.username)
            update_data["hashed_password"] = get_password_hash(
                update_data.pop("password")
            )
        else:
            update_data.pop("password", None)

        # These two columns are NOT NULL (create stores ""), so "clear" means "".
        for field in ("middle_name", "occupation"):
            if field in update_data and update_data[field] is None:
                update_data[field] = ""

        # Dates must stay consistent with what is already stored.
        birthdate = update_data.get("birthdate", user.birthdate) if "birthdate" in update_data else user.birthdate
        joined = update_data.get("date_joined", user.date_joined) if "date_joined" in update_data else user.date_joined
        if birthdate and joined and joined < birthdate:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Date joined cannot be before birthdate")

        branch_ids_provided = "branch_ids" in update_data
        new_branch_ids = update_data.pop("branch_ids", None)
        if branch_ids_provided and new_branch_ids is not None:
            branches = user_access.load_branches(
                db, new_branch_ids, already_assigned=[b.id for b in user.branches]
            )
            user.branches = branches

        primary_branch_id_provided = "primary_branch_id" in update_data
        new_primary_branch_id = update_data.pop("primary_branch_id", None)
        current_branch_ids = {b.id for b in user.branches}

        if primary_branch_id_provided:
            if new_primary_branch_id is not None and new_primary_branch_id not in current_branch_ids:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Primary branch must be one of the assigned branches",
                )
            user.primary_branch_id = new_primary_branch_id
        elif branch_ids_provided and user.primary_branch_id not in current_branch_ids:
            # The previous primary branch was removed from the assignment;
            # fall back to one of the remaining branches automatically.
            user.primary_branch_id = next(iter(current_branch_ids), None)

        if "group_ids" in update_data:
            group_ids = update_data.pop("group_ids")
            if group_ids is not None:
                user.groups = user_access.load_groups(db, group_ids)

        for field, value in update_data.items():
            setattr(user, field, value)

        # Never surface the password itself (even hashed) in an old/new diff.
        after_values = {
            field: getattr(user, field, None) for field in before_values if field != "password"
        }
        changes = diff_changes(
            {k: v for k, v in before_values.items() if k != "password"}, after_values
        )
        if before_branch_codes is not None:
            after_branch_codes = sorted(b.branch_code for b in user.branches)
            if after_branch_codes != before_branch_codes:
                changes.setdefault("fields", [])
                changes["fields"] = sorted(set(changes["fields"]) | {"branches"})
                changes.setdefault("values", {})
                changes["values"]["branches"] = {"old": before_branch_codes, "new": after_branch_codes}
        if before_group_names is not None:
            after_group_names = sorted(g.name for g in user.groups)
            if after_group_names != before_group_names:
                changes.setdefault("fields", [])
                changes["fields"] = sorted(set(changes["fields"]) | {"groups"})
                changes.setdefault("values", {})
                changes["values"]["groups"] = {"old": before_group_names, "new": after_group_names}
        if changes:
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="user", entity_id=user.id,
                changes=changes,
            )

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username, email, or employee ID already exists. Please use different values.",
            )
        db.refresh(user)
        return user

    def unblock_user(self, db: Session, user_id: int, updated_by: Optional[int] = None) -> models.User:
        """Clear a user's blocked flag (e.g. after too many failed login attempts)."""
        user = self.get_user(db, user_id)
        if user.blocked:
            user.blocked = False
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="user", entity_id=user.id,
                changes={"fields": ["blocked"], "values": {"blocked": {"old": True, "new": False}}},
            )
            db.commit()
            db.refresh(user)
        return user

    def force_password_reset(self, db: Session, user_id: int, updated_by: Optional[int] = None) -> models.User:
        """Require the user to set a new password the next time they log in."""
        user = self.get_user(db, user_id)
        if not user.must_change_password:
            user.must_change_password = True
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="user", entity_id=user.id,
                changes={"fields": ["must_change_password"], "values": {"must_change_password": {"old": False, "new": True}}},
            )
            db.commit()
            db.refresh(user)
        return user

    def upload_profile_picture(self, db: Session, user_id: int, relative_path: str) -> models.User:
        from app.common.file_storage import delete_file

        user = self.get_user(db, user_id)
        old_path = user.profile_picture_path
        user.profile_picture_path = relative_path
        db.commit()
        db.refresh(user)
        if old_path and old_path != relative_path:
            delete_file(old_path)
        return user

    def remove_profile_picture(self, db: Session, user_id: int) -> models.User:
        from app.common.file_storage import delete_file

        user = self.get_user(db, user_id)
        old_path = user.profile_picture_path
        user.profile_picture_path = None
        db.commit()
        db.refresh(user)
        delete_file(old_path)
        return user

class GroupService:
    def get_groups(
        self, db: Session, skip: int = 0, limit: int = 100
    ) -> List[models.Group]:
        return db.query(models.Group).offset(skip).limit(limit).all()

    def get_group(self, db: Session, group_id: int, for_update: bool = False) -> Optional[models.Group]:
        query = db.query(models.Group).filter(models.Group.id == group_id)
        if for_update:
            # Same reason as get_user(for_update=True): permission replacement is a
            # delete + insert of association rows and must not interleave.
            query = query.with_for_update(of=models.Group).populate_existing()
        group = query.first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
            )
        return group

    def _name_taken(self, db: Session, name: str, exclude_id: Optional[int] = None) -> bool:
        query = db.query(models.Group).filter(_ci_eq(models.Group.name, name))
        if exclude_id is not None:
            query = query.filter(models.Group.id != exclude_id)
        return query.first() is not None

    def create_group(
        self, db: Session, group_in: schemas.GroupCreate, created_by: Optional[int] = None
    ) -> models.Group:

        if self._name_taken(db, group_in.name):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name already exists",
            )

        group = models.Group(name=group_in.name)
        group.permissions = user_access.load_permissions(db, group_in.permission_ids)

        # Guard the flush/commit too, not just the pre-check above — two
        # concurrent creates for the same role name can both pass that check
        # before either has committed, so the DB's unique indexes (exact and
        # case-insensitive) are the real backstop and must surface as a clean
        # 400, not a 500.
        try:
            db.add(group)
            db.flush()
            log_audit(
                db, user_id=created_by or 0, action="create",
                entity_type="group", entity_id=group.id,
                changes={"name": group.name},
            )
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name already exists",
            )
        db.refresh(group)
        return group

    def update_group(
        self, db: Session, group_id: int, group_in: schemas.GroupUpdate, updated_by: Optional[int] = None
    ) -> models.Group:
        try:
            return self._update_group(db, group_id, group_in, updated_by)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name already exists",
            )

    def _update_group(
        self, db: Session, group_id: int, group_in: schemas.GroupUpdate, updated_by: Optional[int] = None
    ) -> models.Group:
        group = self.get_group(db, group_id, for_update=True)

        changed_fields = []
        field_values: dict = {}

        if group_in.name is not None and group_in.name != group.name:
            if self._name_taken(db, group_in.name, exclude_id=group_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Group name already exists",
                )
            field_values["name"] = {"old": group.name, "new": group_in.name}
            group.name = group_in.name
            changed_fields.append("name")

        if group_in.permission_ids is not None:
            new_permission_ids = set(group_in.permission_ids)
            current_permission_ids = {p.id for p in group.permissions}
            if new_permission_ids != current_permission_ids:
                old_permission_names = sorted(p.name for p in group.permissions)
                permissions = user_access.load_permissions(db, group_in.permission_ids)
                group.permissions = permissions
                field_values["permissions"] = {
                    "old": old_permission_names,
                    "new": sorted(p.name for p in permissions),
                }
                changed_fields.append("permissions")

        if changed_fields:
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="group", entity_id=group.id,
                changes={"fields": sorted(changed_fields), "values": field_values},
            )

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name already exists",
            )
        db.refresh(group)
        return group


class PermissionService:
    def get_permissions(self, db: Session) -> List[models.Permission]:
        return db.query(models.Permission).all()

    def create_permission(
        self, db: Session, permission_in: schemas.PermissionCreate
    ) -> models.Permission:
        existing = (
            db.query(models.Permission)
            .filter(
                _ci_eq(models.Permission.resource, permission_in.resource),
                _ci_eq(models.Permission.action, permission_in.action),
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Permission already exists",
            )

        permission = models.Permission(**permission_in.model_dump())
        try:
            db.add(permission)
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Permission already exists (same name or resource/action)",
            )
        db.refresh(permission)
        return permission


auth_service = AuthService()
group_service = GroupService()
permission_service = PermissionService()
