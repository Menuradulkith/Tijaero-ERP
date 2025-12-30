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
        # Check if branch code already exists
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
    
    def delete_branch(self, db: Session, branch_id: int) -> None:
        success = self.repository.delete(db, branch_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Branch not found"
            )
    
    def get_total_count(self, db: Session) -> int:
        return self.repository.count(db)

branch_service = BranchService()
