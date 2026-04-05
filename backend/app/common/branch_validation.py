"""
Reusable utility to validate that a branch is active.
Call this before any create operation that accepts a branch_code.
"""
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.auth.models import Branch


def validate_branch_is_active(db: Session, branch_code: str) -> Branch:
    """
    Validates that the given branch_code exists and is active.
    Returns the Branch object if valid.
    Raises HTTPException if not found or inactive.
    """
    branch = db.query(Branch).filter(Branch.branch_code == branch_code).first()
    if not branch:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Branch with code '{branch_code}' not found"
        )
    if not branch.active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Branch '{branch.branch_name}' ({branch_code}) is inactive. Please reactivate the branch before performing this operation."
        )
    return branch
