from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import date
from app.auth import models, schemas
from app.core.security import get_password_hash, verify_password, create_access_token
from app.core.exceptions import AuthenticationError
from app.modules.employees.models import Employee

class AuthService:
    def authenticate_user(self, db: Session, username: str, password: str) -> models.User:
        user = db.query(models.User).filter(models.User.username == username).first()
        if not user or not verify_password(password, user.hashed_password):
            raise AuthenticationError("Invalid credentials")
        if not user.is_active:
            raise AuthenticationError("User account is inactive")
        if user.blocked:
            raise AuthenticationError("User account is blocked")
        return user
    
    def create_user(self, db: Session, user_in: schemas.UserCreate) -> models.User:
        # Check if username exists
        if db.query(models.User).filter(models.User.username == user_in.username).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already exists"
            )
        
        # Check if email exists
        if db.query(models.User).filter(models.User.email == user_in.email).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already exists"
            )
        
        # Check if employee_id already exists
        existing_employee = db.query(Employee).filter(Employee.employee_id == user_in.employee_id).first()
        if existing_employee:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Employee ID already exists"
            )
        
        # Create user
        user = models.User(
            email=user_in.email,
            username=user_in.username,
            hashed_password=get_password_hash(user_in.password),
            first_name=user_in.first_name,
            middle_name=user_in.middle_name or "",
            last_name=user_in.last_name,
            gender=user_in.gender,
            birthdate=user_in.birthdate,
            occupation=user_in.occupation,
            employee_id=user_in.employee_id,
            is_active=user_in.is_active,
            is_staff=user_in.is_staff,
            is_superuser=False,
            verify=True,
            blocked=False,
            date_joined=date.today()
        )
        db.add(user)
        db.flush()
        
        # Create employee record (check if one already exists for this user)
        existing_emp_for_user = db.query(Employee).filter(Employee.user_id == user.id).first()
        if not existing_emp_for_user:
            employee = Employee(
                user_id=user.id,
                employee_id=user_in.employee_id
            )
            db.add(employee)
            db.flush()
        
        # Assign branches
        if user_in.branch_ids:
            branches = db.query(models.Branch).filter(models.Branch.id.in_(user_in.branch_ids)).all()
            user.branches = branches
        
        # Assign groups
        if user_in.group_ids:
            groups = db.query(models.Group).filter(models.Group.id.in_(user_in.group_ids)).all()
            user.groups = groups
        
        db.commit()
        db.refresh(user)
        return user
    
    def get_users(self, db: Session, skip: int = 0, limit: int = 100) -> List[models.User]:
        return db.query(models.User).offset(skip).limit(limit).all()
    
    def check_username_exists(self, db: Session, username: str) -> bool:
        user = db.query(models.User).filter(models.User.username == username).first()
        return user is not None
    
    def check_employee_id_exists(self, db: Session, employee_id: str) -> bool:
        try:
            from app.modules.employees.models import Employee
            employee = db.query(Employee).filter(Employee.employee_id == employee_id).first()
            return employee is not None
        except (ImportError, Exception):
            # If employees module doesn't exist or table doesn't exist, check users table
            user = db.query(models.User).filter(models.User.employee_id == employee_id).first()
            return user is not None
    
    def get_user(self, db: Session, user_id: int) -> Optional[models.User]:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        return user
    
    def update_user(self, db: Session, user_id: int, user_in: schemas.UserUpdate) -> models.User:
        user = self.get_user(db, user_id)
        
        update_data = user_in.model_dump(exclude_unset=True)
        
        # Handle password separately
        if "password" in update_data and update_data["password"]:
            update_data["hashed_password"] = get_password_hash(update_data.pop("password"))
        
        # Handle branches
        if "branch_ids" in update_data:
            branch_ids = update_data.pop("branch_ids")
            if branch_ids is not None:
                branches = db.query(models.Branch).filter(models.Branch.id.in_(branch_ids)).all()
                user.branches = branches
        
        # Handle groups
        if "group_ids" in update_data:
            group_ids = update_data.pop("group_ids")
            if group_ids is not None:
                groups = db.query(models.Group).filter(models.Group.id.in_(group_ids)).all()
                user.groups = groups
        
        # Update other fields
        for field, value in update_data.items():
            setattr(user, field, value)
        
        db.commit()
        db.refresh(user)
        return user
    
    def delete_user(self, db: Session, user_id: int):
        user = self.get_user(db, user_id)
        if user.is_superuser:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete superuser"
            )
        
        # Check for foreign key references
        errors = []
        
        # Check employees table
        try:
            from app.modules.employees.models import Employee
            employee_count = db.query(Employee).filter(Employee.user_id == user_id).count()
            if employee_count > 0:
                errors.append(f"User is linked to {employee_count} employee record(s)")
        except (ImportError, Exception):
            pass
        
        # Check support tickets
        try:
            from app.modules.support.models import SupportTicket
            ticket_count = db.query(SupportTicket).filter(SupportTicket.assigned_user_id == user_id).count()
            if ticket_count > 0:
                errors.append(f"User is assigned to {ticket_count} support ticket(s)")
        except (ImportError, Exception):
            pass
        
        # Check warehouse approvals
        try:
            from app.modules.warehouse.models import GoodReceiveNote
            grn_count = db.query(GoodReceiveNote).filter(GoodReceiveNote.approved_user_id == user_id).count()
            if grn_count > 0:
                errors.append(f"User has approved {grn_count} warehouse transaction(s)")
        except (ImportError, Exception):
            pass
        
        # Check reports
        try:
            from app.modules.reporting.models import ReportDefinition, ReportExecution
            report_def_count = db.query(ReportDefinition).filter(ReportDefinition.created_by == user_id).count()
            report_exec_count = db.query(ReportExecution).filter(ReportExecution.executed_by == user_id).count()
            if report_def_count > 0:
                errors.append(f"User has created {report_def_count} report definition(s)")
            if report_exec_count > 0:
                errors.append(f"User has {report_exec_count} report execution(s)")
        except (ImportError, Exception):
            pass
        
        # Check marketing campaigns
        try:
            from app.modules.marketing.models import Campaign
            campaign_count = db.query(Campaign).filter(Campaign.author_id == user_id).count()
            if campaign_count > 0:
                errors.append(f"User is author of {campaign_count} marketing campaign(s)")
        except (ImportError, Exception):
            pass
        
        # Check attachments (skip if table doesn't exist)
        try:
            from app.common.attachments import Attachment
            attachment_count = db.query(Attachment).filter(Attachment.uploaded_by == user_id).count()
            if attachment_count > 0:
                errors.append(f"User has uploaded {attachment_count} attachment(s)")
        except (ImportError, Exception):
            pass
        
        # Check workflow approvals (skip if table doesn't exist)
        try:
            from app.common.workflow import WorkflowInstance
            workflow_count = db.query(WorkflowInstance).filter(WorkflowInstance.approver_id == user_id).count()
            if workflow_count > 0:
                errors.append(f"User is approver in {workflow_count} workflow instance(s)")
        except (ImportError, Exception):
            pass
        
        if errors:
            error_message = "Cannot delete user. " + "; ".join(errors) + "."
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=error_message
            )
        
        db.delete(user)
        db.commit()
        return {"message": "User deleted successfully"}

class GroupService:
    def get_groups(self, db: Session, skip: int = 0, limit: int = 100) -> List[models.Group]:
        return db.query(models.Group).offset(skip).limit(limit).all()
    
    def get_group(self, db: Session, group_id: int) -> Optional[models.Group]:
        group = db.query(models.Group).filter(models.Group.id == group_id).first()
        if not group:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Group not found"
            )
        return group
    
    def create_group(self, db: Session, group_in: schemas.GroupCreate) -> models.Group:
        # Check if group name exists
        if db.query(models.Group).filter(models.Group.name == group_in.name).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Group name already exists"
            )
        
        group = models.Group(name=group_in.name)
        
        # Assign permissions
        if group_in.permission_ids:
            permissions = db.query(models.Permission).filter(
                models.Permission.id.in_(group_in.permission_ids)
            ).all()
            group.permissions = permissions
        
        db.add(group)
        db.commit()
        db.refresh(group)
        return group
    
    def update_group(self, db: Session, group_id: int, group_in: schemas.GroupUpdate) -> models.Group:
        group = self.get_group(db, group_id)
        
        if group_in.name:
            # Check if new name already exists
            existing = db.query(models.Group).filter(
                models.Group.name == group_in.name,
                models.Group.id != group_id
            ).first()
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Group name already exists"
                )
            group.name = group_in.name
        
        # Update permissions
        if group_in.permission_ids is not None:
            permissions = db.query(models.Permission).filter(
                models.Permission.id.in_(group_in.permission_ids)
            ).all()
            group.permissions = permissions
        
        db.commit()
        db.refresh(group)
        return group
    
    def delete_group(self, db: Session, group_id: int):
        group = self.get_group(db, group_id)
        db.delete(group)
        db.commit()
        return {"message": "Group deleted successfully"}

class PermissionService:
    def get_permissions(self, db: Session) -> List[models.Permission]:
        return db.query(models.Permission).all()
    
    def create_permission(self, db: Session, permission_in: schemas.PermissionCreate) -> models.Permission:
        # Check if permission exists
        existing = db.query(models.Permission).filter(
            models.Permission.resource == permission_in.resource,
            models.Permission.action == permission_in.action
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Permission already exists"
            )
        
        permission = models.Permission(**permission_in.model_dump())
        db.add(permission)
        db.commit()
        db.refresh(permission)
        return permission

auth_service = AuthService()
group_service = GroupService()
permission_service = PermissionService()
