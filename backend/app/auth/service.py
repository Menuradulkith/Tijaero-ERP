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
        
        # Check if employee exists
        employee = db.query(Employee).filter(Employee.employee_id == user_in.employee_id).first()
        if not employee:
            # Create employee record
            employee = Employee(
                user_id=0,  # Temporary, will update after user creation
                employee_id=user_in.employee_id
            )
            db.add(employee)
            db.flush()
        
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
        
        # Update employee user_id
        employee.user_id = user.id
        
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
