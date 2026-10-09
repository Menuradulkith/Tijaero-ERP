from typing import Annotated, List

from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.branches import schemas, service
from fastapi import APIRouter, Depends, Path, Query
from sqlalchemy.orm import Session

# Ids are int4 in Postgres; bound them so an out-of-range id is a 422, not a DB 500.
BranchId = Annotated[int, Path(ge=1, le=2_147_483_647)]
ExcludeId = Annotated[int | None, Query(ge=1, le=2_147_483_647)]

router = APIRouter(
    prefix="/branches",
    tags=["branches"],
    dependencies=[Depends(require_permission(*Permissions.BRANCH_VIEW))],
)


@router.get("/", response_model=dict)
def get_branches(
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100000),
    active_only: bool = Query(False, description="Only return active branches"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):

    skip = (page - 1) * size
    branches = service.branch_service.get_all_branches(db, skip=skip, limit=size, active_only=active_only)
    total = service.branch_service.get_total_count(db, active_only=active_only)

    branch_schemas = [schemas.Branch.model_validate(branch) for branch in branches]

    return {
        "items": branch_schemas,
        "total": total,
        "page": page,
        "size": size,
        "pages": (total + size - 1) // size,
    }


@router.get("/{branch_id}", response_model=schemas.Branch)
def get_branch(
    branch_id: BranchId,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get a specific branch by ID
    """
    return service.branch_service.get_branch(db, branch_id)


@router.get("/{branch_id}/performance", response_model=schemas.BranchPerformance)
def get_branch_performance(
    branch_id: BranchId,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Quick sales/stock KPIs for a branch, for the detail-panel widget."""
    return service.branch_service.get_branch_performance(db, branch_id)


@router.get("/check-code/{branch_code}")
def check_branch_code_exists(
    branch_code: str,
    exclude_id: ExcludeId = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Check if a branch code already exists."""
    existing = service.branch_service.repository.get_by_code(db, branch_code)
    exists = existing is not None and existing.id != exclude_id
    return {"exists": exists, "branch_code": branch_code}


@router.get("/check-name/{branch_name}")
def check_branch_name_exists(
    branch_name: str,
    exclude_id: ExcludeId = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Check if a branch name already exists."""
    existing = service.branch_service.repository.get_by_name(db, branch_name)
    exists = existing is not None and existing.id != exclude_id
    return {"exists": exists, "branch_name": branch_name}


@router.get("/check-email/{email}")
def check_branch_email_exists(
    email: str,
    exclude_id: ExcludeId = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Check if a branch email already exists."""
    existing = service.branch_service.repository.get_by_email(db, email)
    exists = existing is not None and existing.id != exclude_id
    return {"exists": exists, "email": email}


@router.post(
    "/",
    response_model=schemas.Branch,
    status_code=201,
    dependencies=[Depends(require_permission(*Permissions.BRANCH_CREATE))],
)
def create_branch(
    branch: schemas.BranchCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):

    return service.branch_service.create_branch(db, branch, created_by=current_user.id)


@router.put(
    "/{branch_id}",
    response_model=schemas.Branch,
    dependencies=[Depends(require_permission(*Permissions.BRANCH_UPDATE))],
)
def update_branch(
    branch_id: BranchId,
    branch: schemas.BranchUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):

    return service.branch_service.update_branch(db, branch_id, branch, updated_by=current_user.id)
