from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.modules.sales.models import Invoice

class SalesRepository:
    def get_all(self, db: Session, skip: int = 0, limit: int = 100):
        return db.query(Invoice).offset(skip).limit(limit).all()
    
    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100):
        return db.query(Invoice).filter(
            or_(
                Invoice.invoice_no.ilike(f"%{query}%"),
                Invoice.branch_code.ilike(f"%{query}%")
            )
        ).offset(skip).limit(limit).all()
    
    def get_by_id(self, db: Session, invoice_id: int):
        return db.query(Invoice).filter(Invoice.id == invoice_id).first()

sales_repository = SalesRepository()
