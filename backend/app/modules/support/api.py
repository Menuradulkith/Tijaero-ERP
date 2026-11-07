from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.db.session import get_db
from app.auth.dependencies import get_current_active_user, get_user_branch_filter, validate_branch_access
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from . import schemas, service

# All support endpoints require authentication
router = APIRouter(
    prefix="/support",
    tags=["support"],
    dependencies=[Depends(get_current_active_user)],
)

# Customer Support Endpoints
@router.post("/tickets", response_model=schemas.CustomerSupport, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.SUPPORT_TICKET_CREATE))])
def create_support_ticket(
    ticket: schemas.CustomerSupportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new support ticket"""
    support_service = service.CustomerSupportService(db, current_user)
    created = support_service.create_support_ticket(ticket)
    from app.modules.notifications import events
    events.tell_branch(
        created.branch_code,
        title="Support ticket opened",
        message=f"Ticket {created.job_number} ({created.job_type}) was opened.",
        category="support",
        notification_type="info",
        action_url="/support",
        exclude_user_id=current_user.id,
    )
    events.tell_user(
        created.assigned_user_id,
        title="Support ticket assigned",
        message=f"Ticket {created.job_number} was assigned to you.",
        category="support",
        notification_type="info",
        action_url="/support",
        exclude_user_id=current_user.id,
    )
    return created

@router.get("/tickets/{ticket_id}", response_model=schemas.CustomerSupport, dependencies=[Depends(require_permission(*Permissions.SUPPORT_TICKET_VIEW))])
def get_support_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Get support ticket by ID"""
    support_service = service.CustomerSupportService(db, current_user)
    return support_service.get_support_ticket(ticket_id)

@router.get("/tickets", response_model=List[schemas.CustomerSupport], dependencies=[Depends(require_permission(*Permissions.SUPPORT_TICKET_VIEW))])
def list_support_tickets(
    branch_code: Optional[str] = None,
    job_type: Optional[str] = None,
    assigned_user_id: Optional[int] = None,
    customer_id: Optional[int] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all support tickets with optional filters"""
    support_service = service.CustomerSupportService(db, current_user)
    filters = schemas.SupportListFilter(
        branch_code=branch_code,
        job_type=job_type,
        assigned_user_id=assigned_user_id,
        customer_id=customer_id,
        date_from=date_from,
        date_to=date_to,
        branch_codes=service._branch_codes(current_user),
        skip=skip,
        limit=limit
    )
    return support_service.list_support_tickets(filters)

@router.put("/tickets/{ticket_id}", response_model=schemas.CustomerSupport, dependencies=[Depends(require_permission(*Permissions.SUPPORT_TICKET_UPDATE))])
def update_support_ticket(
    ticket_id: int,
    ticket: schemas.CustomerSupportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a support ticket"""
    support_service = service.CustomerSupportService(db, current_user)
    return support_service.update_support_ticket(ticket_id, ticket)

@router.delete("/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_permission(*Permissions.SUPPORT_TICKET_DELETE))])
def delete_support_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Delete a support ticket"""
    support_service = service.CustomerSupportService(db, current_user)
    support_service.delete_support_ticket(ticket_id)

# CS Job Item Endpoints
@router.post("/job-items", response_model=schemas.CSJobItem, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.JOB_ITEM_CREATE))])
def create_job_item(
    item: schemas.CSJobItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new job item"""
    item_service = service.CSJobItemService(db, current_user)
    created = item_service.create_job_item(item)
    _notify_ticket_assignee(db, created.customer_support_id, current_user.id, "Job item added", "A job item was added to your support ticket.")
    return created

@router.get("/job-items/{item_id}", response_model=schemas.CSJobItem, dependencies=[Depends(require_permission(*Permissions.JOB_ITEM_VIEW))])
def get_job_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Get job item by ID"""
    item_service = service.CSJobItemService(db, current_user)
    return item_service.get_job_item(item_id)

@router.get("/tickets/{ticket_id}/job-items", response_model=List[schemas.CSJobItem], dependencies=[Depends(require_permission(*Permissions.JOB_ITEM_VIEW))])
def list_job_items_by_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """List all job items for a support ticket"""
    item_service = service.CSJobItemService(db, current_user)
    return item_service.list_job_items_by_ticket(ticket_id)

@router.put("/job-items/{item_id}", response_model=schemas.CSJobItem, dependencies=[Depends(require_permission(*Permissions.JOB_ITEM_UPDATE))])
def update_job_item(
    item_id: int,
    item: schemas.CSJobItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a job item"""
    item_service = service.CSJobItemService(db, current_user)
    return item_service.update_job_item(item_id, item)

@router.delete("/job-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_permission(*Permissions.JOB_ITEM_DELETE))])
def delete_job_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Delete a job item"""
    item_service = service.CSJobItemService(db, current_user)
    item_service.delete_job_item(item_id)

# Customer Call Log Endpoints
@router.post("/call-logs", response_model=schemas.CustomerCallLog, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CALL_LOG_CREATE))])
def create_call_log(
    log: schemas.CustomerCallLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new call log"""
    log_service = service.CustomerCallLogService(db, current_user)
    created = log_service.create_call_log(log)
    _notify_ticket_assignee(db, created.customer_support_id, current_user.id, "Call logged", "A call was logged on your support ticket.")
    return created

@router.get("/call-logs/{log_id}", response_model=schemas.CustomerCallLog, dependencies=[Depends(require_permission(*Permissions.CALL_LOG_VIEW))])
def get_call_log(log_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Get call log by ID"""
    log_service = service.CustomerCallLogService(db, current_user)
    return log_service.get_call_log(log_id)

@router.get("/tickets/{ticket_id}/call-logs", response_model=List[schemas.CustomerCallLog], dependencies=[Depends(require_permission(*Permissions.CALL_LOG_VIEW))])
def list_call_logs_by_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """List all call logs for a support ticket"""
    log_service = service.CustomerCallLogService(db, current_user)
    return log_service.list_call_logs_by_ticket(ticket_id)

@router.put("/call-logs/{log_id}", response_model=schemas.CustomerCallLog, dependencies=[Depends(require_permission(*Permissions.CALL_LOG_UPDATE))])
def update_call_log(
    log_id: int,
    log: schemas.CustomerCallLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a call log"""
    log_service = service.CustomerCallLogService(db, current_user)
    return log_service.update_call_log(log_id, log)

@router.delete("/call-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_permission(*Permissions.CALL_LOG_DELETE))])
def delete_call_log(log_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Delete a call log"""
    log_service = service.CustomerCallLogService(db, current_user)
    log_service.delete_call_log(log_id)

# Warranty Claims Endpoints
@router.post("/warranty-claims", response_model=schemas.WarrantyClaim, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.WARRANTY_CLAIM_CREATE))])
def create_warranty_claim(
    claim: schemas.WarrantyClaimCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new warranty claim"""
    claim_service = service.WarrantyClaimService(db, current_user)
    created = claim_service.create_warranty_claim(claim)
    from app.modules.notifications import events
    from app.modules.sales.models import Invoice
    branch = db.query(Invoice.branch_code).filter(Invoice.id == created.order_id).scalar()
    events.tell_branch(
        branch,
        title="Warranty claim opened",
        message=f"A {created.warranty_type} warranty claim was opened for barcode {created.product_barcode_old_code}.",
        category="support",
        notification_type="warning",
        action_url="/support",
        exclude_user_id=current_user.id,
    )
    return created

@router.get("/warranty-claims/{claim_id}", response_model=schemas.WarrantyClaim, dependencies=[Depends(require_permission(*Permissions.WARRANTY_CLAIM_VIEW))])
def get_warranty_claim(claim_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Get warranty claim by ID"""
    claim_service = service.WarrantyClaimService(db, current_user)
    return claim_service.get_warranty_claim(claim_id)

@router.get("/warranty-claims", response_model=List[schemas.WarrantyClaim], dependencies=[Depends(require_permission(*Permissions.WARRANTY_CLAIM_VIEW))])
def list_warranty_claims(
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all warranty claims with optional filters"""
    claim_service = service.WarrantyClaimService(db, current_user)
    filters = schemas.SupportListFilter(
        date_from=date_from,
        date_to=date_to,
        branch_codes=service._branch_codes(current_user),
        skip=skip,
        limit=limit
    )
    return claim_service.list_warranty_claims(filters)

@router.put("/warranty-claims/{claim_id}", response_model=schemas.WarrantyClaim, dependencies=[Depends(require_permission(*Permissions.WARRANTY_CLAIM_UPDATE))])
def update_warranty_claim(
    claim_id: int,
    claim: schemas.WarrantyClaimCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a warranty claim"""
    claim_service = service.WarrantyClaimService(db, current_user)
    return claim_service.update_warranty_claim(claim_id, claim)

@router.delete("/warranty-claims/{claim_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_permission(*Permissions.WARRANTY_CLAIM_DELETE))])
def delete_warranty_claim(claim_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)):
    """Delete a warranty claim"""
    claim_service = service.WarrantyClaimService(db, current_user)
    claim_service.delete_warranty_claim(claim_id)


def _notify_ticket_assignee(db, ticket_id: int, actor_id: int, title: str, message: str) -> None:
    from app.modules.notifications import events
    from .models import CustomerSupport

    assignee = db.query(CustomerSupport.assigned_user_id).filter(CustomerSupport.id == ticket_id).scalar()
    events.tell_user(
        assignee,
        title=title,
        message=message,
        category="support",
        notification_type="info",
        action_url="/support",
        exclude_user_id=actor_id,
    )
