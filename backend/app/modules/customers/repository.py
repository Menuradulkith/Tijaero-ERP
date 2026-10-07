from typing import List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import or_, func, text, Integer
from app.core import timezone as tz
from app.modules.customers.models import Customer
from app.modules.customers.enums import CustomerType
from app.modules.customers.schemas import CustomerCreate, CustomerUpdate

_ADDRESS_PARTS = ("address_line1", "address_line2", "city", "state", "postal_code")


def _join_address(customer: Customer, prefix: str) -> Optional[str]:
    parts = [getattr(customer, f"{prefix}_{p}", None) for p in _ADDRESS_PARTS]
    return ", ".join(p.strip() for p in parts if p and p.strip()) or None


def sync_legacy_addresses(customer: Customer) -> None:
    """Rebuild the single-line payment_address / delivery_address from the
    structured fields. A blank delivery address means "same as payment"."""
    payment = _join_address(customer, "billing")
    customer.payment_address = payment
    customer.delivery_address = _join_address(customer, "shipping") or payment


def _has_structured_address(data: dict) -> bool:
    return any(k.startswith(("billing_", "shipping_")) for k in data)


class CustomerRepository:
    def get_next_customer_no(self, db: Session) -> str:
        """Next sequential display number for the Customers grid's first
        column (0001, 0002, ...). Advisory lock serializes concurrent
        creates, mirroring the PO-number generation pattern used elsewhere."""
        db.execute(text("SELECT pg_advisory_xact_lock(hashtext('customer_no'))"))
        last_no = db.query(func.max(func.cast(Customer.customer_no, Integer))).scalar() or 0
        return f"{last_no + 1:04d}"


    def get_by_id(self, db: Session, customer_id: int) -> Optional[Customer]:
        return db.query(Customer).filter(Customer.id == customer_id).first()
    
    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False, customer_type: Optional[str] = None) -> List[Customer]:
        query = db.query(Customer)
        if active_only:
            query = query.filter(Customer.active == True)
        if customer_type:
            query = query.filter(Customer.customer_type == customer_type)
        return query.offset(skip).limit(limit).all()

    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100, customer_type: Optional[str] = None) -> List[Customer]:
        search_filter = or_(
            Customer.customer_name.ilike(f"%{query}%"),
            Customer.company_name.ilike(f"%{query}%"),
            Customer.email.ilike(f"%{query}%"),
            Customer.mobile_contact_number.ilike(f"%{query}%")
        )
        q = db.query(Customer).filter(search_filter)
        if customer_type:
            q = q.filter(Customer.customer_type == customer_type)
        return q.offset(skip).limit(limit).all()
    
    def create(self, db: Session, customer: CustomerCreate, created_by: int) -> Customer:
        data = customer.dict()
        data["customer_type"] = CustomerType(data["customer_type"]).value
        db_customer = Customer(
            **data,
            customer_no=self.get_next_customer_no(db),
            date_joined=tz.now(),
            created_by=created_by,
            updated_by=created_by
        )
        if any(data.get(f"{p}_{x}") for p in ("billing", "shipping") for x in _ADDRESS_PARTS):
            sync_legacy_addresses(db_customer)
        db.add(db_customer)
        db.commit()
        db.refresh(db_customer)
        return db_customer
    
    def update(self, db: Session, customer_id: int, customer: CustomerUpdate, updated_by: int) -> Optional[Customer]:
        db_customer = self.get_by_id(db, customer_id)
        if not db_customer:
            return None
        
        update_data = customer.dict(exclude_unset=True)
        if update_data.get("customer_type") is not None:
            update_data["customer_type"] = CustomerType(update_data["customer_type"]).value
        for field, value in update_data.items():
            setattr(db_customer, field, value)
        if _has_structured_address(update_data):
            sync_legacy_addresses(db_customer)
        
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
