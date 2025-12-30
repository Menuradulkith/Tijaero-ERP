from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/support", tags=["support"])

# Customer Support Endpoints
@router.post("/tickets", response_model=schemas.CustomerSupport, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    ticket: schemas.CustomerSupportCreate,
    db: Session = Depends(get_db)
):
    """Create a new support ticket"""
    support_service = service.CustomerSupportService(db)
    return support_service.create_support_ticket(ticket)

@router.get("/tickets/{ticket_id}", response_model=schemas.CustomerSupport)
def get_support_ticket(ticket_id: int, db: Session = Depends(get_db)):
    """Get support ticket by ID"""
    support_service = service.CustomerSupportService(db)
    return support_service.get_support_ticket(ticket_id)

@router.get("/tickets", response_model=List[schemas.CustomerSupport])
def list_support_tickets(
    branch_code: Optional[str] = None,
    job_type: Optional[str] = None,
    assigned_user_id: Optional[int] = None,
    customer_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all support tickets with optional filters"""
    support_service = service.CustomerSupportService(db)
    filters = schemas.SupportListFilter(
        branch_code=branch_code,
        job_type=job_type,
        assigned_user_id=assigned_user_id,
        customer_id=customer_id,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return support_service.list_support_tickets(filters)

@router.put("/tickets/{ticket_id}", response_model=schemas.CustomerSupport)
def update_support_ticket(
    ticket_id: int,
    ticket: schemas.CustomerSupportCreate,
    db: Session = Depends(get_db)
):
    """Update a support ticket"""
    support_service = service.CustomerSupportService(db)
    return support_service.update_support_ticket(ticket_id, ticket)

@router.delete("/tickets/{ticket_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_support_ticket(ticket_id: int, db: Session = Depends(get_db)):
    """Delete a support ticket"""
    support_service = service.CustomerSupportService(db)
    support_service.delete_support_ticket(ticket_id)

# CS Job Item Endpoints
@router.post("/job-items", response_model=schemas.CSJobItem, status_code=status.HTTP_201_CREATED)
def create_job_item(
    item: schemas.CSJobItemCreate,
    db: Session = Depends(get_db)
):
    """Create a new job item"""
    item_service = service.CSJobItemService(db)
    return item_service.create_job_item(item)

@router.get("/job-items/{item_id}", response_model=schemas.CSJobItem)
def get_job_item(item_id: int, db: Session = Depends(get_db)):
    """Get job item by ID"""
    item_service = service.CSJobItemService(db)
    return item_service.get_job_item(item_id)

@router.get("/tickets/{ticket_id}/job-items", response_model=List[schemas.CSJobItem])
def list_job_items_by_ticket(ticket_id: int, db: Session = Depends(get_db)):
    """List all job items for a support ticket"""
    item_service = service.CSJobItemService(db)
    return item_service.list_job_items_by_ticket(ticket_id)

@router.put("/job-items/{item_id}", response_model=schemas.CSJobItem)
def update_job_item(
    item_id: int,
    item: schemas.CSJobItemCreate,
    db: Session = Depends(get_db)
):
    """Update a job item"""
    item_service = service.CSJobItemService(db)
    return item_service.update_job_item(item_id, item)

@router.delete("/job-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_item(item_id: int, db: Session = Depends(get_db)):
    """Delete a job item"""
    item_service = service.CSJobItemService(db)
    item_service.delete_job_item(item_id)

# Customer Call Log Endpoints
@router.post("/call-logs", response_model=schemas.CustomerCallLog, status_code=status.HTTP_201_CREATED)
def create_call_log(
    log: schemas.CustomerCallLogCreate,
    db: Session = Depends(get_db)
):
    """Create a new call log"""
    log_service = service.CustomerCallLogService(db)
    return log_service.create_call_log(log)

@router.get("/call-logs/{log_id}", response_model=schemas.CustomerCallLog)
def get_call_log(log_id: int, db: Session = Depends(get_db)):
    """Get call log by ID"""
    log_service = service.CustomerCallLogService(db)
    return log_service.get_call_log(log_id)

@router.get("/tickets/{ticket_id}/call-logs", response_model=List[schemas.CustomerCallLog])
def list_call_logs_by_ticket(ticket_id: int, db: Session = Depends(get_db)):
    """List all call logs for a support ticket"""
    log_service = service.CustomerCallLogService(db)
    return log_service.list_call_logs_by_ticket(ticket_id)

@router.put("/call-logs/{log_id}", response_model=schemas.CustomerCallLog)
def update_call_log(
    log_id: int,
    log: schemas.CustomerCallLogCreate,
    db: Session = Depends(get_db)
):
    """Update a call log"""
    log_service = service.CustomerCallLogService(db)
    return log_service.update_call_log(log_id, log)

@router.delete("/call-logs/{log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_call_log(log_id: int, db: Session = Depends(get_db)):
    """Delete a call log"""
    log_service = service.CustomerCallLogService(db)
    log_service.delete_call_log(log_id)

# Warranty Claims Endpoints
@router.post("/warranty-claims", response_model=schemas.WarrantyClaim, status_code=status.HTTP_201_CREATED)
def create_warranty_claim(
    claim: schemas.WarrantyClaimCreate,
    db: Session = Depends(get_db)
):
    """Create a new warranty claim"""
    claim_service = service.WarrantyClaimService(db)
    return claim_service.create_warranty_claim(claim)

@router.get("/warranty-claims/{claim_id}", response_model=schemas.WarrantyClaim)
def get_warranty_claim(claim_id: int, db: Session = Depends(get_db)):
    """Get warranty claim by ID"""
    claim_service = service.WarrantyClaimService(db)
    return claim_service.get_warranty_claim(claim_id)

@router.get("/warranty-claims", response_model=List[schemas.WarrantyClaim])
def list_warranty_claims(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all warranty claims with optional filters"""
    claim_service = service.WarrantyClaimService(db)
    filters = schemas.SupportListFilter(
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return claim_service.list_warranty_claims(filters)

@router.put("/warranty-claims/{claim_id}", response_model=schemas.WarrantyClaim)
def update_warranty_claim(
    claim_id: int,
    claim: schemas.WarrantyClaimCreate,
    db: Session = Depends(get_db)
):
    """Update a warranty claim"""
    claim_service = service.WarrantyClaimService(db)
    return claim_service.update_warranty_claim(claim_id, claim)

@router.delete("/warranty-claims/{claim_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_warranty_claim(claim_id: int, db: Session = Depends(get_db)):
    """Delete a warranty claim"""
    claim_service = service.WarrantyClaimService(db)
    claim_service.delete_warranty_claim(claim_id)
