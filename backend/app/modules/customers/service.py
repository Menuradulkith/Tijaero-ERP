from typing import List, Optional
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.modules.customers import repository, schemas
from app.modules.customers.models import Customer

class CustomerService:
    def get_customer(self, db: Session, customer_id: int) -> Customer:
        customer = repository.customer_repository.get_by_id(db, customer_id)
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {customer_id} not found"
            )
        return customer
    
    def get_all_customers(self, db: Session, skip: int = 0, limit: int = 100) -> List[Customer]:
        return repository.customer_repository.get_all(db, skip, limit)
    
    def search_customers(self, db: Session, query: str, skip: int = 0, limit: int = 100) -> List[Customer]:
        return repository.customer_repository.search(db, query, skip, limit)
    
    def create_customer(self, db: Session, customer: schemas.CustomerCreate, user_id: int) -> Customer:
        return repository.customer_repository.create(db, customer, user_id)
    
    def update_customer(self, db: Session, customer_id: int, customer: schemas.CustomerUpdate, user_id: int) -> Customer:
        updated_customer = repository.customer_repository.update(db, customer_id, customer, user_id)
        if not updated_customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {customer_id} not found"
            )
        return updated_customer
    
    def delete_customer(self, db: Session, customer_id: int) -> dict:
        success = repository.customer_repository.delete(db, customer_id)
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {customer_id} not found"
            )
        return {"message": "Customer deleted successfully"}
    
    def get_customer_count(self, db: Session) -> int:
        return repository.customer_repository.count(db)

customer_service = CustomerService()
