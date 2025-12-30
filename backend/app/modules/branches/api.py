from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from app.db.session import get_db
from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.modules.branches import schemas, service

router = APIRouter()

@router.get("/", response_model=dict)
def get_branches(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get all branches with pagination
    """
    skip = (page - 1) * size
    branches = service.branch_service.get_all_branches(db, skip=skip, limit=size)
    total = service.branch_service.get_total_count(db)
    
    # Convert SQLAlchemy models to Pydantic schemas
    branch_schemas = [schemas.Branch.model_validate(branch) for branch in branches]
    
    return {
        "items": branch_schemas,
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size
    }

@router.get("/{branch_id}", response_model=schemas.Branch)
def get_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Get a specific branch by ID
    """
    return service.branch_service.get_branch(db, branch_id)

@router.post("/", response_model=schemas.Branch, status_code=201)
def create_branch(
    branch: schemas.BranchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Create a new branch
    """
    return service.branch_service.create_branch(db, branch)

@router.put("/{branch_id}", response_model=schemas.Branch)
def update_branch(
    branch_id: int,
    branch: schemas.BranchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Update an existing branch
    """
    return service.branch_service.update_branch(db, branch_id, branch)

@router.delete("/{branch_id}", status_code=204)
def delete_branch(
    branch_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user)
):
    """
    Delete a branch
    """
    service.branch_service.delete_branch(db, branch_id)
    return None
