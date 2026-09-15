from datetime import date
from typing import List, Optional
import logging

from app.auth import models, schemas
from app.common.audit import log_audit
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
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session


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

        if (
            db.query(models.User)
            .filter(models.User.username == user_in.username)
            .first()
        ):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists",
            )

        if user_in.email and db.query(models.User).filter(models.User.email == user_in.email).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Email already exists"
            )

        existing_employee = (
            db.query(Employee)
            .filter(Employee.employee_id == user_in.employee_id)
            .first()
        )
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Employee ID already exists",
            )

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

            if user_in.branch_ids:
                branches = (
                    db.query(models.Branch)
                    .filter(models.Branch.id.in_(user_in.branch_ids))
                    .all()
                )
                user.branches = branches
            if user_in.group_ids:
                groups = (
                    db.query(models.Group)
                    .filter(models.Group.id.in_(user_in.group_ids))
                    .all()
                )
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
        return db.query(models.User).offset(skip).limit(limit).all()

    def check_username_exists(
        self, db: Session, username: str, exclude_user_id: Optional[int] = None
    ) -> bool:
        query = db.query(models.User).filter(models.User.username == username)
        if exclude_user_id is not None:
            query = query.filter(models.User.id != exclude_user_id)
        return query.first() is not None

    def check_email_exists(
        self, db: Session, email: str, exclude_user_id: Optional[int] = None
    ) -> bool:
        query = db.query(models.User).filter(models.User.email == email)
        if exclude_user_id is not None:
            query = query.filter(models.User.id != exclude_user_id)
        return query.first() is not None

    def check_employee_id_exists(
        self, db: Session, employee_id: str, exclude_user_id: Optional[int] = None
    ) -> bool:
        try:
            from app.modules.employees.models import Employee

            query = db.query(Employee).filter(Employee.employee_id == employee_id)
            if exclude_user_id is not None:
                query = query.filter(Employee.user_id != exclude_user_id)
            if query.first() is not None:
                return True
        except (ImportError, Exception):
            pass

        query = db.query(models.User).filter(models.User.employee_id == employee_id)
        if exclude_user_id is not None:
            query = query.filter(models.User.id != exclude_user_id)
        return query.first() is not None

    def get_user(self, db: Session, user_id: int) -> Optional[models.User]:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
            )
        return user

    def update_user(
        self, db: Session, user_id: int, user_in: schemas.UserUpdate, updated_by: Optional[int] = None
    ) -> models.User:
        user = self.get_user(db, user_id)

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

        if "password" in update_data and update_data["password"]:
            update_data["hashed_password"] = get_password_hash(
                update_data.pop("password")
            )

        branch_ids_provided = "branch_ids" in update_data
        new_branch_ids = update_data.pop("branch_ids", None)
        if branch_ids_provided and new_branch_ids is not None:
            branches = (
                db.query(models.Branch)
                .filter(models.Branch.id.in_(new_branch_ids))
                .all()
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
                groups = (
                    db.query(models.Group).filter(models.Group.id.in_(group_ids)).all()
                )
                user.groups = groups

        for field, value in update_data.items():
            setattr(user, field, value)

        changed_fields = sorted(
            field for field, before in before_values.items()
            if field != "password" and before != getattr(user, field, None)
        )
        if changed_fields:
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="user", entity_id=user.id,
                changes={"fields": changed_fields},
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
                changes={"fields": ["blocked"]},
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
                changes={"fields": ["must_change_password"]},
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

    def delete_user(self, db: Session, user_id: int, deleted_by: Optional[int] = None):
        user = self.get_user(db, user_id)
        if user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete superuser",
            )

        # Delete the auto-created Employee record first (always safe to remove with the user)
        try:
            from app.modules.employees.models import Employee

            db.query(Employee).filter(Employee.user_id == user_id).delete()
        except (ImportError, Exception):
            pass

        errors = []

        try:
            from app.modules.support.models import SupportTicket

            ticket_count = (
                db.query(SupportTicket)
                .filter(SupportTicket.assigned_user_id == user_id)
                .count()
            )
            if ticket_count > 0:
                errors.append(f"User is assigned to {ticket_count} support ticket(s)")
        except (ImportError, Exception):
            pass

        try:
            from app.modules.warehouse.models import GoodReceiveNote

            grn_count = (
                db.query(GoodReceiveNote)
                .filter(GoodReceiveNote.approved_user_id == user_id)
                .count()
            )
            if grn_count > 0:
                errors.append(f"User has approved {grn_count} warehouse transaction(s)")
        except (ImportError, Exception):
            pass

        try:
            from app.modules.reporting.models import ReportDefinition, ReportExecution

            report_def_count = (
                db.query(ReportDefinition)
                .filter(ReportDefinition.created_by == user_id)
                .count()
            )
            report_exec_count = (
                db.query(ReportExecution)
                .filter(ReportExecution.executed_by == user_id)
                .count()
            )
            if report_def_count > 0:
                errors.append(
                    f"User has created {report_def_count} report definition(s)"
                )
            if report_exec_count > 0:
                errors.append(f"User has {report_exec_count} report execution(s)")
        except (ImportError, Exception):
            pass

        try:
            from app.modules.marketing.models import Campaign

            campaign_count = (
                db.query(Campaign).filter(Campaign.author_id == user_id).count()
            )
            if campaign_count > 0:
                errors.append(
                    f"User is author of {campaign_count} marketing campaign(s)"
                )
        except (ImportError, Exception):
            pass

        try:
            from app.common.attachments import Attachment

            attachment_count = (
                db.query(Attachment).filter(Attachment.uploaded_by == user_id).count()
            )
            if attachment_count > 0:
                errors.append(f"User has uploaded {attachment_count} attachment(s)")
        except (ImportError, Exception):
            pass

        try:
            from app.common.workflow import WorkflowStep

            workflow_count = (
                db.query(WorkflowStep)
                .filter(WorkflowStep.approver_id == user_id)
                .count()
            )
            if workflow_count > 0:
                errors.append(f"User is approver in {workflow_count} workflow step(s)")
        except (ImportError, Exception):
            pass

        if errors:
            error_message = "Cannot delete user. " + "; ".join(errors) + "."
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=error_message
            )

        log_audit(
            db, user_id=deleted_by or 0, action="delete",
            entity_type="user", entity_id=user.id,
            changes={"username": user.username, "email": user.email},
        )
        db.delete(user)
        db.commit()
        return {"message": "User deleted successfully"}


class GroupService:
    def get_groups(
        self, db: Session, skip: int = 0, limit: int = 100
    ) -> List[models.Group]:
        return db.query(models.Group).offset(skip).limit(limit).all()

    def get_group(self, db: Session, group_id: int) -> Optional[models.Group]:
        group = db.query(models.Group).filter(models.Group.id == group_id).first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
            )
        return group

    def create_group(
        self, db: Session, group_in: schemas.GroupCreate, created_by: Optional[int] = None
    ) -> models.Group:

        if db.query(models.Group).filter(models.Group.name == group_in.name).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name already exists",
            )

        group = models.Group(name=group_in.name)

        if group_in.permission_ids:
            permissions = (
                db.query(models.Permission)
                .filter(models.Permission.id.in_(group_in.permission_ids))
                .all()
            )
            group.permissions = permissions

        # Guard the flush/commit too, not just the pre-check above — two
        # concurrent creates for the same role name can both pass that check
        # before either has committed, so the DB's unique constraint is the
        # real backstop and needs to surface as a clean 400, not a 500.
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
        group = self.get_group(db, group_id)

        changed_fields = []

        if group_in.name and group_in.name != group.name:

            existing = (
                db.query(models.Group)
                .filter(models.Group.name == group_in.name, models.Group.id != group_id)
                .first()
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Group name already exists",
                )
            group.name = group_in.name
            changed_fields.append("name")

        if group_in.permission_ids is not None:
            new_permission_ids = set(group_in.permission_ids)
            current_permission_ids = {p.id for p in group.permissions}
            if new_permission_ids != current_permission_ids:
                permissions = (
                    db.query(models.Permission)
                    .filter(models.Permission.id.in_(group_in.permission_ids))
                    .all()
                )
                group.permissions = permissions
                changed_fields.append("permissions")

        if changed_fields:
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="group", entity_id=group.id,
                changes={"fields": sorted(changed_fields)},
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

    def delete_group(self, db: Session, group_id: int, deleted_by: Optional[int] = None):
        # Lock the group row so a concurrent "assign this role to a user"
        # request can't slip in between the usage check below and the delete
        # — mirrors the same guard on delete_branch.
        group = db.query(models.Group).filter(models.Group.id == group_id).with_for_update().first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Group not found"
            )

        user_count = db.query(models.User).filter(models.User.groups.any(id=group_id)).count()
        if user_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete role '{group.name}'. It is assigned to {user_count} user(s). "
                       f"Reassign them to another role first.",
            )

        log_audit(
            db, user_id=deleted_by or 0, action="delete",
            entity_type="group", entity_id=group.id,
            changes={"name": group.name},
        )
        db.delete(group)
        db.commit()
        return {"message": "Group deleted successfully"}


class PermissionService:
    def get_permissions(self, db: Session) -> List[models.Permission]:
        return db.query(models.Permission).all()

    def create_permission(
        self, db: Session, permission_in: schemas.PermissionCreate
    ) -> models.Permission:
        existing = (
            db.query(models.Permission)
            .filter(
                models.Permission.resource == permission_in.resource,
                models.Permission.action == permission_in.action,
            )
            .first()
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Permission already exists",
            )

        permission = models.Permission(**permission_in.model_dump())
        db.add(permission)
        db.commit()
        db.refresh(permission)
        return permission


auth_service = AuthService()
group_service = GroupService()
permission_service = PermissionService()
