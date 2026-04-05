from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.core import timezone as tz
from app.modules.customers.models import Customer
from app.modules.customers.schemas import CustomerCreate, CustomerUpdate

class CustomerRepository:
    def get_by_id(self, db: Session, customer_id: int) -> Optional[Customer]:
        return db.query(Customer).filter(Customer.id == customer_id).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False) -> List[Customer]:
        query = db.query(Customer)
        if active_only:
            query = query.filter(Customer.active == True)
        return query.offset(skip).limit(limit).all()
    
    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[Customer]:
        search_filter = or_(
            Customer.customer_name.ilike(f"%{query}%"),
            Customer.email.ilike(f"%{query}%"),
            Customer.mobile_contact_number.ilike(f"%{query}%")
        )
        return db.query(Customer).filter(search_filter).offset(skip).limit(limit).all()
    
    def create(self, db: Session, customer: CustomerCreate, created_by: int) -> Customer:
        db_customer = Customer(
            **customer.dict(),
            date_joined=tz.now(),
            created_by=created_by,
            updated_by=created_by
        )
        db.add(db_customer)
        db.commit()
        db.refresh(db_customer)
        return db_customer
    
    def update(self, db: Session, customer_id: int, customer: CustomerUpdate, updated_by: int) -> Optional[Customer]:
        db_customer = self.get_by_id(db, customer_id)
        if not db_customer:
            return None
        
        update_data = customer.dict(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_customer, field, value)
        
        db_customer.updated_by = updated_by
        db.commit()
        db.refresh(db_customer)
        return db_customer
    
    def delete(self, db: Session, customer_id: int) -> bool:
        db_customer = self.get_by_id(db, customer_id)
        if not db_customer:
            return False
        db.delete(db_customer)
        db.commit()
        return True
    
    def count(self, db: Session) -> int:
        return db.query(Customer).count()

customer_repository = CustomerRepository()
