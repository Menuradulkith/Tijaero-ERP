from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException, status
from typing import List
from datetime import datetime
from sqlalchemy import text
from app.core import timezone as tz
from . import schemas
from .models import CustomerSupport, CSJobItem, CustomerCallLog, WarrantyClaims

# Customer Support Service
class CustomerSupportService:
    def __init__(self, db: Session):
        self.db = db
    
    def _get_next_ticket_number(self, branch_code: str = None) -> str:
        """Generate next Support Ticket number: TKT-{BranchCode}-YYYY-XXXXX with advisory lock"""
        year = tz.year()
        
        # Extract branch code with default
        branch_code = branch_code or "HQ"
        
        prefix = f"TKT-{branch_code}-{year}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            self.db.query(CustomerSupport)
            .filter(CustomerSupport.job_number.like(f"{prefix}-%"))
            .order_by(CustomerSupport.id.desc())
            .first()
        )
        if last:
            try:
                last_seq = int(last.job_number.split("-")[-1])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}-{next_seq:05d}"
    
    def create_support_ticket(self, ticket: schemas.CustomerSupportCreate) -> CustomerSupport:
        # Extract branch code with default
        branch_code = ticket.branch_code or "HQ"
        # Generate job number
        job_number = self._get_next_ticket_number(branch_code)
        # Create ticket with auto-generated job number
        db_ticket = CustomerSupport(**ticket.model_dump(), job_number=job_number)
        self.db.add(db_ticket)
        self.db.commit()
        self.db.refresh(db_ticket)
        return db_ticket

    
    def get_support_ticket(self, ticket_id: int) -> CustomerSupport:
        ticket = self.db.query(CustomerSupport).filter(CustomerSupport.id == ticket_id).first()
        if not ticket:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Support ticket not found"
            )
        return ticket
    
    def list_support_tickets(self, filters: schemas.SupportListFilter) -> List[CustomerSupport]:
        query = self.db.query(CustomerSupport).options(
            joinedload(CustomerSupport.customer),
            joinedload(CustomerSupport.job_items),
        )
        
        if filters.branch_code:
            query = query.filter(CustomerSupport.branch_code == filters.branch_code)
        
        if filters.job_type:
            query = query.filter(CustomerSupport.job_type == filters.job_type)
        
        if filters.assigned_user_id:
            query = query.filter(CustomerSupport.assigned_user_id == filters.assigned_user_id)
        
        if filters.customer_id:
            query = query.filter(CustomerSupport.customer_id == filters.customer_id)
        
        if filters.date_from:
            query = query.filter(CustomerSupport.date >= filters.date_from)
        
        if filters.date_to:
            query = query.filter(CustomerSupport.date <= filters.date_to)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_support_ticket(self, ticket_id: int, ticket: schemas.CustomerSupportCreate) -> CustomerSupport:
        db_ticket = self.get_support_ticket(ticket_id)
        for key, value in ticket.model_dump().items():
            setattr(db_ticket, key, value)
        self.db.commit()
        self.db.refresh(db_ticket)
        return db_ticket
    
    def delete_support_ticket(self, ticket_id: int):
        db_ticket = self.get_support_ticket(ticket_id)
        self.db.delete(db_ticket)
        self.db.commit()

# CS Job Item Service
class CSJobItemService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_job_item(self, item: schemas.CSJobItemCreate) -> CSJobItem:
        db_item = CSJobItem(**item.model_dump(), date=tz.now())
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item
    
    def get_job_item(self, item_id: int) -> CSJobItem:
        item = self.db.query(CSJobItem).filter(CSJobItem.id == item_id).first()
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Job item not found"
            )
        return item
    
    def list_job_items_by_ticket(self, ticket_id: int) -> List[CSJobItem]:
        return self.db.query(CSJobItem).filter(
            CSJobItem.customer_support_id == ticket_id
        ).all()
    
    def update_job_item(self, item_id: int, item: schemas.CSJobItemCreate) -> CSJobItem:
        db_item = self.get_job_item(item_id)
        for key, value in item.model_dump().items():
            setattr(db_item, key, value)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item
    
    def delete_job_item(self, item_id: int):
        db_item = self.get_job_item(item_id)
        self.db.delete(db_item)
        self.db.commit()

# Customer Call Log Service
class CustomerCallLogService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_call_log(self, log: schemas.CustomerCallLogCreate) -> CustomerCallLog:
        db_log = CustomerCallLog(**log.model_dump(), date=tz.now())
        self.db.add(db_log)
        self.db.commit()
        self.db.refresh(db_log)
        return db_log
    
    def get_call_log(self, log_id: int) -> CustomerCallLog:
        log = self.db.query(CustomerCallLog).filter(CustomerCallLog.id == log_id).first()
        if not log:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Call log not found"
            )
        return log
    
    def list_call_logs_by_ticket(self, ticket_id: int) -> List[CustomerCallLog]:
        return self.db.query(CustomerCallLog).filter(
            CustomerCallLog.customer_support_id == ticket_id
        ).all()
    
    def update_call_log(self, log_id: int, log: schemas.CustomerCallLogCreate) -> CustomerCallLog:
        db_log = self.get_call_log(log_id)
        for key, value in log.model_dump().items():
            setattr(db_log, key, value)
        self.db.commit()
        self.db.refresh(db_log)
        return db_log
    
    def delete_call_log(self, log_id: int):
        db_log = self.get_call_log(log_id)
        self.db.delete(db_log)
        self.db.commit()

# Warranty Claims Service
class WarrantyClaimService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_warranty_claim(self, claim: schemas.WarrantyClaimCreate) -> WarrantyClaims:
        db_claim = WarrantyClaims(**claim.model_dump(), created_date=tz.now())
        self.db.add(db_claim)
        self.db.commit()
        self.db.refresh(db_claim)
        return db_claim
    
    def get_warranty_claim(self, claim_id: int) -> WarrantyClaims:
        claim = self.db.query(WarrantyClaims).filter(WarrantyClaims.id == claim_id).first()
        if not claim:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Warranty claim not found"
            )
        return claim
    
    def list_warranty_claims(self, filters: schemas.SupportListFilter) -> List[WarrantyClaims]:
        query = self.db.query(WarrantyClaims)
        
        if filters.date_from:
            query = query.filter(WarrantyClaims.created_date >= filters.date_from)
        
        if filters.date_to:
            query = query.filter(WarrantyClaims.created_date <= filters.date_to)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_warranty_claim(self, claim_id: int, claim: schemas.WarrantyClaimCreate) -> WarrantyClaims:
        db_claim = self.get_warranty_claim(claim_id)
        for key, value in claim.model_dump().items():
            setattr(db_claim, key, value)
        self.db.commit()
        self.db.refresh(db_claim)
        return db_claim
    
    def delete_warranty_claim(self, claim_id: int):
        db_claim = self.get_warranty_claim(claim_id)
        self.db.delete(db_claim)
        self.db.commit()
