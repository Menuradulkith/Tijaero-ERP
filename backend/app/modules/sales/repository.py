from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_
from app.modules.sales.models import Invoice, SaleReturn

class SalesRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100):
        return db.query(Invoice).offset(skip).limit(limit).all()
    
    def get_all_with_items(self, db: Session, skip: int = 0, limit: int = 100):
        """Get invoices with items eagerly loaded to prevent N+1 queries"""
        return db.query(Invoice).options(
            joinedload(Invoice.items)
        ).offset(skip).limit(limit).all()
    
    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100):
        return db.query(Invoice).filter(
            or_(
                Invoice.invoice_no.ilike(f"%{query}%"),
                Invoice.branch_code.ilike(f"%{query}%")
            )
        ).offset(skip).limit(limit).all()
    
    def get_by_id(self, db: Session, invoice_id: int):
        return db.query(Invoice).filter(Invoice.id == invoice_id).first()
    
    def get_pending_approval(self, db: Session, skip: int = 0, limit: int = 100):
        """Get invoices pending approval - server-side filtered"""
        return db.query(Invoice).filter(
            Invoice.approval == False
        ).offset(skip).limit(limit).all()
    
    def get_by_customer(self, db: Session, customer_id: int, skip: int = 0, limit: int = 100):
        """Get invoices for a specific customer"""
        return db.query(Invoice).filter(
            Invoice.customer_id == customer_id
        ).offset(skip).limit(limit).all()
    
    def get_returns_by_invoice(self, db: Session, invoice_id: int, skip: int = 0, limit: int = 100):
        """Get sale returns for a specific invoice"""
        return db.query(SaleReturn).filter(
            SaleReturn.invoice_id == invoice_id
        ).offset(skip).limit(limit).all()

sales_repository = SalesRepository()
