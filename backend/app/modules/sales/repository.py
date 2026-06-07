from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import or_, desc
from typing import List, Optional
from app.modules.sales.models import Invoice, SaleReturn


def _invoice_eager_options():
    """Standard eager loading options to prevent N+1 queries on invoice lists."""
    from app.modules.common.models import Approvals
    return [
        selectinload(Invoice.items),
        joinedload(Invoice.customer),
        joinedload(Invoice.creator),
        joinedload(Invoice.bank_transfer_verifier),
        joinedload(Invoice.approval_record).joinedload(Approvals.approver),
    ]


def _sale_return_eager_options():
    """Standard eager loading options to prevent N+1 queries on sale return lists."""
    return [
        selectinload(SaleReturn.items),
        joinedload(SaleReturn.invoice),
    ]


class SalesRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get all invoices with eager loading for performance"""
        query = db.query(Invoice).options(*_invoice_eager_options())
        if branch_codes:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        return query.order_by(desc(Invoice.created_date), desc(Invoice.id))\
            .offset(skip).limit(limit).all()
    
    def get_all_with_items(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get invoices with items using selectinload for better performance with multiple items"""
        query = db.query(Invoice).options(*_invoice_eager_options())
        if branch_codes:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        return query.order_by(desc(Invoice.created_date), desc(Invoice.id))\
         .offset(skip).limit(limit).all()
    
    def search(self, db: Session, query_str: str, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Search invoices with indexed columns and eager loading"""
        query = db.query(Invoice).options(*_invoice_eager_options()).filter(
            or_(
                Invoice.invoice_no.ilike(f"%{query_str}%"),
                Invoice.branch_code.ilike(f"%{query_str}%")
            )
        )
        if branch_codes:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        return query.order_by(desc(Invoice.created_date), desc(Invoice.id))\
         .offset(skip).limit(limit).all()
    
    def get_by_id(self, db: Session, invoice_id: int):
        """Get single invoice by ID with items and customer eagerly loaded"""
        return db.query(Invoice).options(
            *_invoice_eager_options()
        ).filter(Invoice.id == invoice_id).first()
    
    def get_pending_approval(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get invoices pending approval - server-side filtered with eager loading"""
        query = db.query(Invoice).options(*_invoice_eager_options()).filter(Invoice.approval == False)
        if branch_codes:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        return query.order_by(desc(Invoice.created_date), desc(Invoice.id))\
         .offset(skip).limit(limit).all()
    
    def get_by_customer(self, db: Session, customer_id: int, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get invoices for a specific customer with eager loading"""
        query = db.query(Invoice).options(*_invoice_eager_options()).filter(Invoice.customer_id == customer_id)
        if branch_codes:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        return query.order_by(desc(Invoice.created_date), desc(Invoice.id))\
         .offset(skip).limit(limit).all()
    
    def get_recent_by_customer(self, db: Session, customer_id: int, limit: int = 5, branch_codes: Optional[List[str]] = None):
        """Get most recent invoices for a customer, ordered by date descending"""
        query = db.query(Invoice).options(*_invoice_eager_options()).filter(Invoice.customer_id == customer_id)
        if branch_codes:
            query = query.filter(Invoice.branch_code.in_(branch_codes))
        return query.order_by(Invoice.created_date.desc(), Invoice.id.desc()).limit(limit).all()
    
    def get_returns_by_invoice(self, db: Session, invoice_id: int, skip: int = 0, limit: int = 100):
        """Get sale returns for a specific invoice with eager loading"""
        return db.query(SaleReturn).options(*_sale_return_eager_options()).filter(
            SaleReturn.invoice_id == invoice_id
        ).order_by(desc(SaleReturn.added_date))\
         .offset(skip).limit(limit).all()
    
    def get_all_sale_returns(self, db: Session, skip: int = 0, limit: int = 100, branch_codes: Optional[List[str]] = None):
        """Get all sale returns with eager loading"""
        query = db.query(SaleReturn).options(*_sale_return_eager_options())
        if branch_codes:
            query = query.filter(SaleReturn.branch_code.in_(branch_codes))
        return query.order_by(desc(SaleReturn.added_date))\
         .offset(skip).limit(limit).all()

sales_repository = SalesRepository()
