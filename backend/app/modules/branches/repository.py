from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.auth.models import Branch
from app.common.audit import log_audit, diff_changes
from app.modules.branches import schemas
from typing import List, Optional
from fastapi import HTTPException, status

class BranchRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[Branch]:
        query = db.query(Branch)
        if active_only:
            query = query.filter(Branch.active == True)
        return query.offset(skip).limit(limit).all()
    
    def get_by_id(self, db: Session, branch_id: int) -> Optional[Branch]:
        return db.query(Branch).filter(Branch.id == branch_id).first()
    
    def get_by_code(self, db: Session, branch_code: str) -> Optional[Branch]:
        return db.query(Branch).filter(Branch.branch_code == branch_code).first()

    def get_by_name(self, db: Session, branch_name: str) -> Optional[Branch]:
        return db.query(Branch).filter(Branch.branch_name == branch_name).first()

    def get_by_email(self, db: Session, email: str) -> Optional[Branch]:
        return db.query(Branch).filter(Branch.email == email).first()
    
    def create(self, db: Session, branch: schemas.BranchCreate, created_by: Optional[int] = None) -> Branch:
        data = branch.model_dump()
        data["email"] = data.get("email") or None
        db_branch = Branch(**data)
        db.add(db_branch)
        try:
            db.flush()
            log_audit(
                db, user_id=created_by or 0, action="create",
                entity_type="branch", entity_id=db_branch.id,
                changes={"branch_code": db_branch.branch_code, "branch_name": db_branch.branch_name},
            )
            db.commit()
            db.refresh(db_branch)
            return db_branch
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch code, name, or email already exists"
            )

    def update(self, db: Session, branch_id: int, branch: schemas.BranchUpdate, updated_by: Optional[int] = None) -> Optional[Branch]:
        db_branch = self.get_by_id(db, branch_id)
        if not db_branch:
            return None

        update_data = branch.model_dump(exclude_unset=True)
        if "email" in update_data:
            update_data["email"] = update_data.get("email") or None
        before_values = {field: getattr(db_branch, field, None) for field in update_data if hasattr(db_branch, field)}

        for field, value in update_data.items():
            setattr(db_branch, field, value)

        changes = diff_changes(before_values, update_data)
        if changes:
            log_audit(
                db, user_id=updated_by or 0, action="update",
                entity_type="branch", entity_id=db_branch.id,
                changes=changes,
            )

        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch code, name, or email already exists"
            )
        db.refresh(db_branch)
        return db_branch
    
    def delete(self, db: Session, branch_id: int) -> bool:
        db_branch = self.get_by_id(db, branch_id)
        if not db_branch:
            return False
        
        db.delete(db_branch)
        db.commit()
        return True
    
    def count(self, db: Session) -> int:
        return db.query(Branch).count()

branch_repository = BranchRepository()
