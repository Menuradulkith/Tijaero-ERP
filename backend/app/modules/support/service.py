from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime
from sqlalchemy import text
from app.auth.dependencies import validate_branch_access
from app.core import timezone as tz
from . import schemas
from .models import CustomerSupport, CSJobItem, CustomerCallLog, WarrantyClaims


def _branch_codes(user) -> Optional[List[str]]:
    """The caller's branches for list filters (None = all branches)."""
    if user is None or getattr(user, "is_superuser", False):
        return None
    return [b.branch_code for b in user.branches]


def _in_scope(user, branch_code: Optional[str]) -> bool:
    if user is None or getattr(user, "is_superuser", False):
        return True
    return branch_code is not None and validate_branch_access(user, branch_code)


# Customer Support Service
class CustomerSupportService:
    def __init__(self, db: Session, user=None):
        self.db = db
        self.user = user

    def _get_next_ticket_number(self, branch_code: str = None) -> str:
        """Generate next Support Ticket number: TKT-BranchCode-YYXXXXXX with advisory lock"""
        year_yy = str(tz.year())[-2:]

        # Extract branch code with default
        branch_code = branch_code or "HQ"

        prefix = f"TKT-{branch_code}-{year_yy}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            self.db.query(CustomerSupport)
            .filter(CustomerSupport.job_number.like(f"{prefix}%"))
            .order_by(CustomerSupport.id.desc())
            .first()
        )
        if last:
            try:
                last_part = last.job_number.split("-")[-1]
                last_seq = int(last_part[2:])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}{next_seq:06d}"

    def _check_branch(self, branch_code: str) -> None:
        """A ticket's branch must exist and be one of the caller's branches."""
        from app.auth.models import Branch

        if not self.db.query(Branch.id).filter(Branch.branch_code == branch_code).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Branch {branch_code} not found")
        if not _in_scope(self.user, branch_code):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")

    def _check_refs(self, ticket: schemas.CustomerSupportCreate) -> None:
        """Name the field when an id points at nothing, and keep a ticket's invoice in its branch."""
        from app.auth.models import User
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        def bad(detail: str):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

        if not self.db.query(User.id).filter(User.id == ticket.assigned_user_id, User.is_active.is_(True)).first():
            bad(f"Assigned user {ticket.assigned_user_id} not found or inactive")
        if ticket.customer_id is not None and not self.db.query(Customer.id).filter(Customer.id == ticket.customer_id).first():
            bad(f"Customer {ticket.customer_id} not found")
        if ticket.invoice_id is not None:
            invoice = (
                self.db.query(Invoice.invoice_no, Invoice.branch_code, Invoice.customer_id)
                .filter(Invoice.id == ticket.invoice_id)
                .first()
            )
            if not invoice or not _in_scope(self.user, invoice.branch_code):
                bad(f"Invoice {ticket.invoice_id} not found")
            if invoice.branch_code != ticket.branch_code:
                bad(f"Invoice {invoice.invoice_no} belongs to branch {invoice.branch_code}, not {ticket.branch_code}")
            if ticket.customer_id is not None and invoice.customer_id != ticket.customer_id:
                bad(f"Invoice {invoice.invoice_no} belongs to another customer")

    def create_support_ticket(self, ticket: schemas.CustomerSupportCreate) -> CustomerSupport:
        self._check_branch(ticket.branch_code)
        self._check_refs(ticket)
        # Generate job number
        job_number = self._get_next_ticket_number(ticket.branch_code)
        # Create ticket with auto-generated job number
        db_ticket = CustomerSupport(**ticket.model_dump(exclude={"job_number"}), job_number=job_number)
        self.db.add(db_ticket)
        self.db.commit()
        self.db.refresh(db_ticket)
        return db_ticket


    def get_support_ticket(self, ticket_id: int) -> CustomerSupport:
        ticket = self.db.query(CustomerSupport).filter(CustomerSupport.id == ticket_id).first()
        # Another branch's ticket is "not found" so its existence is not revealed.
        if not ticket or not _in_scope(self.user, ticket.branch_code):
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
        if filters.branch_codes is not None:
            query = query.filter(CustomerSupport.branch_code.in_(filters.branch_codes))

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

        return query.order_by(CustomerSupport.id.desc()).offset(filters.skip).limit(filters.limit).all()

    def update_support_ticket(self, ticket_id: int, ticket: schemas.CustomerSupportCreate) -> CustomerSupport:
        db_ticket = self.get_support_ticket(ticket_id)
        if ticket.branch_code != db_ticket.branch_code:
            self._check_branch(ticket.branch_code)
        self._check_refs(ticket)
        for key, value in ticket.model_dump(exclude={"job_number"}).items():
            setattr(db_ticket, key, value)
        self.db.commit()
        self.db.refresh(db_ticket)
        return db_ticket

    def delete_support_ticket(self, ticket_id: int):
        db_ticket = self.get_support_ticket(ticket_id)
        # Without this the ORM would null the children's ticket id (job items: NOT NULL error,
        # call logs: silently orphaned).
        has_items = self.db.query(CSJobItem.id).filter(CSJobItem.customer_support_id == ticket_id).first()
        has_logs = self.db.query(CustomerCallLog.id).filter(CustomerCallLog.customer_support_id == ticket_id).first()
        if has_items or has_logs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This ticket has job items or call logs. Delete those first.",
            )
        self.db.delete(db_ticket)
        self.db.commit()

# CS Job Item Service
class CSJobItemService:
    def __init__(self, db: Session, user=None):
        self.db = db
        self.user = user

    def _ticket(self, ticket_id: int) -> CustomerSupport:
        return CustomerSupportService(self.db, self.user).get_support_ticket(ticket_id)

    def _check_refs(self, item: schemas.CSJobItemCreate) -> None:
        from app.modules.products.models import Product

        if not self.db.query(Product.id).filter(Product.id == item.product_id).first():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Product {item.product_id} not found")
        if item.warrent_claim_id is not None:
            try:
                WarrantyClaimService(self.db, self.user).get_warranty_claim(item.warrent_claim_id)
            except HTTPException:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Warranty claim {item.warrent_claim_id} not found",
                )

    def create_job_item(self, item: schemas.CSJobItemCreate) -> CSJobItem:
        self._ticket(item.customer_support_id)
        self._check_refs(item)
        db_item = CSJobItem(**item.model_dump(), date=tz.now())
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item

    def get_job_item(self, item_id: int) -> CSJobItem:
        item = self.db.query(CSJobItem).filter(CSJobItem.id == item_id).first()
        ticket = item.customer_support if item else None
        if not item or not _in_scope(self.user, ticket.branch_code if ticket else None):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Job item not found"
            )
        return item

    def list_job_items_by_ticket(self, ticket_id: int) -> List[CSJobItem]:
        self._ticket(ticket_id)
        return self.db.query(CSJobItem).filter(
            CSJobItem.customer_support_id == ticket_id
        ).all()

    def update_job_item(self, item_id: int, item: schemas.CSJobItemCreate) -> CSJobItem:
        db_item = self.get_job_item(item_id)
        if item.customer_support_id != db_item.customer_support_id:
            self._ticket(item.customer_support_id)
        self._check_refs(item)
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
    def __init__(self, db: Session, user=None):
        self.db = db
        self.user = user

    def _ticket(self, ticket_id: int) -> CustomerSupport:
        return CustomerSupportService(self.db, self.user).get_support_ticket(ticket_id)

    def create_call_log(self, log: schemas.CustomerCallLogCreate) -> CustomerCallLog:
        self._ticket(log.customer_support_id)
        db_log = CustomerCallLog(**log.model_dump(), date=tz.now())
        self.db.add(db_log)
        self.db.commit()
        self.db.refresh(db_log)
        return db_log

    def get_call_log(self, log_id: int) -> CustomerCallLog:
        log = self.db.query(CustomerCallLog).filter(CustomerCallLog.id == log_id).first()
        ticket = log.customer_support if log else None
        if not log or not _in_scope(self.user, ticket.branch_code if ticket else None):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Call log not found"
            )
        return log

    def list_call_logs_by_ticket(self, ticket_id: int) -> List[CustomerCallLog]:
        self._ticket(ticket_id)
        return self.db.query(CustomerCallLog).filter(
            CustomerCallLog.customer_support_id == ticket_id
        ).all()

    def update_call_log(self, log_id: int, log: schemas.CustomerCallLogCreate) -> CustomerCallLog:
        db_log = self.get_call_log(log_id)
        if log.customer_support_id != db_log.customer_support_id:
            self._ticket(log.customer_support_id)
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
    """A claim has no branch of its own; it belongs to the branch of its sales order."""

    def __init__(self, db: Session, user=None):
        self.db = db
        self.user = user

    def _check_order(self, order_id: int) -> None:
        from app.modules.sales.models import Invoice

        order = self.db.query(Invoice.branch_code).filter(Invoice.id == order_id).first()
        if not order or not _in_scope(self.user, order.branch_code):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Sales order {order_id} not found")

    def _check_barcode_on_order(self, order_id: int, code: str) -> None:
        """The claimed unit must have been sold on the order: its serial, the stock unit's
        serial or batch, or the product's item code for untracked goods."""
        from sqlalchemy import or_
        from app.modules.inventory.models import SalesStock
        from app.modules.products.models import Product
        from app.modules.sales.models import InvoiceItems

        found = (
            self.db.query(InvoiceItems.id)
            .outerjoin(SalesStock, SalesStock.id == InvoiceItems.sales_stock_id)
            .join(Product, Product.id == InvoiceItems.product_id)
            .filter(
                InvoiceItems.invoice_id == order_id,
                or_(
                    InvoiceItems.barcode == code,
                    SalesStock.barcode == code,
                    SalesStock.batch_no == code,
                    Product.item_code == code,
                ),
            )
            .first()
        )
        if not found:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcode {code} was not sold on sales order {order_id}",
            )

    def create_warranty_claim(self, claim: schemas.WarrantyClaimCreate) -> WarrantyClaims:
        self._check_order(claim.order_id)
        self._check_barcode_on_order(claim.order_id, claim.product_barcode_old_code)
        db_claim = WarrantyClaims(**claim.model_dump(), created_date=tz.now())
        self.db.add(db_claim)
        self.db.commit()
        self.db.refresh(db_claim)
        return db_claim

    def get_warranty_claim(self, claim_id: int) -> WarrantyClaims:
        claim = self.db.query(WarrantyClaims).filter(WarrantyClaims.id == claim_id).first()
        order = claim.order if claim else None
        if not claim or not _in_scope(self.user, order.branch_code if order else None):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Warranty claim not found"
            )
        return claim

    def list_warranty_claims(self, filters: schemas.SupportListFilter) -> List[WarrantyClaims]:
        query = self.db.query(WarrantyClaims)
        if filters.branch_codes is not None:
            from app.modules.sales.models import Invoice

            query = query.join(Invoice, Invoice.id == WarrantyClaims.order_id).filter(
                Invoice.branch_code.in_(filters.branch_codes)
            )

        if filters.date_from:
            query = query.filter(WarrantyClaims.created_date >= filters.date_from)

        if filters.date_to:
            query = query.filter(WarrantyClaims.created_date <= filters.date_to)

        return query.order_by(WarrantyClaims.id.desc()).offset(filters.skip).limit(filters.limit).all()

    def update_warranty_claim(self, claim_id: int, claim: schemas.WarrantyClaimCreate) -> WarrantyClaims:
        db_claim = self.get_warranty_claim(claim_id)
        if claim.order_id != db_claim.order_id:
            self._check_order(claim.order_id)
        if (claim.order_id, claim.product_barcode_old_code) != (db_claim.order_id, db_claim.product_barcode_old_code):
            self._check_barcode_on_order(claim.order_id, claim.product_barcode_old_code)
        for key, value in claim.model_dump().items():
            setattr(db_claim, key, value)
        self.db.commit()
        self.db.refresh(db_claim)
        return db_claim

    def delete_warranty_claim(self, claim_id: int):
        db_claim = self.get_warranty_claim(claim_id)
        if self.db.query(CSJobItem.id).filter(CSJobItem.warrent_claim_id == claim_id).first():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This warranty claim is linked to job items. Unlink or delete those first.",
            )
        self.db.delete(db_claim)
        self.db.commit()
