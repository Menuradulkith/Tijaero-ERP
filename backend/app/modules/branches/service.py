from sqlalchemy.orm import Session
from app.modules.branches import schemas, repository
from app.auth.models import Branch
from typing import List, Optional
from fastapi import HTTPException, status

class BranchService:
    def __init__(self):
        self.repository = repository.branch_repository
    
    def get_all_branches(self, db: Session, skip: int = 0, limit: int = 100) -> List[Branch]:
        return self.repository.get_all(db, skip, limit)
    
    def get_branch(self, db: Session, branch_id: int) -> Branch:
        branch = self.repository.get_by_id(db, branch_id)
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        return branch
    
    def create_branch(self, db: Session, branch: schemas.BranchCreate) -> Branch:

        existing = self.repository.get_by_code(db, branch.branch_code)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Branch code already exists"
            )
        
        return self.repository.create(db, branch)
    
    def update_branch(self, db: Session, branch_id: int, branch: schemas.BranchUpdate) -> Branch:
        updated_branch = self.repository.update(db, branch_id, branch)
        if not updated_branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        return updated_branch
    
    def delete_branch(self, db: Session, branch_id: int) -> dict:
        branch = self.repository.get_by_id(db, branch_id)
        if not branch:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )

        from app.auth.models import User
        users_count = db.query(User).filter(User.branches.any(id=branch_id)).count()
        
        usage_checks = []
        if users_count > 0:
            usage_checks.append(f"users ({users_count})")

        try:
            from app.modules.warehouse.models import ItemTransferNote
            warehouse_count = db.query(ItemTransferNote).filter(ItemTransferNote.branch_code == branch.branch_code).count()
            if warehouse_count > 0:
                usage_checks.append(f"warehouse transfers ({warehouse_count})")
        except ImportError:
            pass
        
        try:

            from app.modules.support.models import CustomerSupport
            support_count = db.query(CustomerSupport).filter(CustomerSupport.branch_code == branch.branch_code).count()
            if support_count > 0:
                usage_checks.append(f"customer support tickets ({support_count})")
        except ImportError:
            pass
        
        try:
            from app.modules.sales.models import SalesStock
            sales_count = db.query(SalesStock).filter(SalesStock.branch_code == branch.branch_code).count()
            if sales_count > 0:
                usage_checks.append(f"sales records ({sales_count})")
        except ImportError:
            pass

        if usage_checks:
            usage_list = ", ".join(usage_checks)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete branch '{branch.branch_name}' (Code: {branch.branch_code}). It is assigned to: {usage_list}. Please reassign or remove these references first."
            )

        success = self.repository.delete(db, branch_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
        
        return {"message": f"Branch '{branch.branch_name}' deleted successfully"}
    
    def get_total_count(self, db: Session) -> int:
        return self.repository.count(db)

branch_service = BranchService()
