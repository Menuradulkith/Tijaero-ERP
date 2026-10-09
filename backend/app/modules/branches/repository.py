from sqlalchemy import func
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
    
    # Lookups are case- and surrounding-whitespace-insensitive so "Main" and
    # "main " are the same branch (matches how the API now normalizes input).
    def get_by_code(self, db: Session, branch_code: str) -> Optional[Branch]:
        return db.query(Branch).filter(func.lower(func.trim(Branch.branch_code)) == (branch_code or "").strip().lower()).first()

    def get_by_name(self, db: Session, branch_name: str) -> Optional[Branch]:
        return db.query(Branch).filter(func.lower(func.trim(Branch.branch_name)) == (branch_name or "").strip().lower()).first()

    def get_by_email(self, db: Session, email: str) -> Optional[Branch]:
        return db.query(Branch).filter(func.lower(func.trim(Branch.email)) == (email or "").strip().lower()).first()

    _ADDRESS_PARTS = ("address_line1", "address_line2", "city", "state", "postal_code")

    @classmethod
    def _sync_legacy_address(cls, data: dict, sent: set, current: Optional[Branch] = None) -> None:
        """Keep the legacy single-line `address` consistent with the structured
        columns. If a client only sends the legacy `address`, carry it into
        line 1 so older callers keep working."""
        sent_structured = any(k in sent for k in cls._ADDRESS_PARTS)
        if sent_structured:
            parts = [
                data[k] if k in data else getattr(current, k, None)
                for k in cls._ADDRESS_PARTS
            ]
            data["address"] = ", ".join(p.strip() for p in parts if p and p.strip()) or None
        elif data.get("address") and "address" in sent:
            data["address_line1"] = data["address"][:255]

    def create(self, db: Session, branch: schemas.BranchCreate, created_by: Optional[int] = None) -> Branch:
        data = branch.model_dump()
        data["email"] = data.get("email") or None
        self._sync_legacy_address(data, branch.model_fields_set)
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
        try:
            return self._update(db, branch_id, branch, updated_by)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch code, name, or email already exists"
            )

    def _update(self, db: Session, branch_id: int, branch: schemas.BranchUpdate, updated_by: Optional[int] = None) -> Optional[Branch]:
        db_branch = self.get_by_id(db, branch_id)
        if not db_branch:
            return None

        update_data = branch.model_dump(exclude_unset=True)
        if "email" in update_data:
            update_data["email"] = update_data.get("email") or None
        self._sync_legacy_address(update_data, set(update_data), db_branch)
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
    
    def count(self, db: Session, active_only: bool = False) -> int:
        query = db.query(Branch)
        if active_only:
            query = query.filter(Branch.active == True)
        return query.count()

branch_repository = BranchRepository()
