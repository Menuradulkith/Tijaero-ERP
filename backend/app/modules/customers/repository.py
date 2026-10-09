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
    
    @staticmethod
    def _like(term: Optional[str]) -> Optional[str]:
        """Literal contains-pattern: % _ and \\ in the text are escaped."""
        t = (term or "").strip()
        if not t:
            return None
        return "%" + t.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"

    def _filtered(self, db: Session, *, active=None, customer_type=None, agent=None, q=None):
        query = db.query(Customer)
        if active is not None:
            query = query.filter(Customer.active.is_(active))
        if customer_type:
            query = query.filter(Customer.customer_type == customer_type)
        if agent is not None:
            query = query.filter(Customer.is_customer_agent.is_(agent))
        pat = self._like(q)
        if pat:
            query = query.filter(or_(
                Customer.customer_name.ilike(pat, escape="\\"),
                Customer.company_name.ilike(pat, escape="\\"),
                Customer.email.ilike(pat, escape="\\"),
                Customer.mobile_contact_number.ilike(pat, escape="\\"),
                Customer.customer_no.ilike(pat, escape="\\"),
            ))
        return query

    def get_all(self, db: Session, skip: int = 0, limit: int = 100, active_only: bool = False, customer_type: Optional[str] = None) -> List[Customer]:
        query = self._filtered(db, active=True if active_only else None, customer_type=customer_type)
        # Stable order: without one a skip/limit window can repeat or miss rows.
        return query.order_by(func.lower(Customer.customer_name), Customer.id).offset(skip).limit(limit).all()

    def search(self, db: Session, query: str, skip: int = 0, limit: int = 100, customer_type: Optional[str] = None) -> List[Customer]:
        q = self._filtered(db, customer_type=customer_type, q=query)
        return q.order_by(func.lower(Customer.customer_name), Customer.id).offset(skip).limit(limit).all()

    SORTS = {
        "customer_no": (Customer.customer_no, False),
        "customer_name": (Customer.customer_name, True),
        "customer_type": (Customer.customer_type, False),
        "email": (Customer.email, True),
        "mobile_contact_number": (Customer.mobile_contact_number, False),
        "company_name": (Customer.company_name, True),
        "credit_days": (Customer.credit_days, False),
        "max_credit_limit": (Customer.max_credit_limit, False),
        "active": (Customer.active, False),
    }

    def get_page(self, db: Session, *, page: int, size: int, q=None, active=None, customer_type=None,
                 agent=None, sort_by=None, order="asc"):
        query = self._filtered(db, active=active, customer_type=customer_type, agent=agent, q=q)
        total = query.with_entities(func.count(Customer.id)).scalar() or 0
        col, text_sort = self.SORTS.get(sort_by or "customer_name") or self.SORTS["customer_name"]
        expr = func.lower(col) if text_sort else col
        expr = expr.desc() if order == "desc" else expr.asc()
        rows = query.order_by(expr, Customer.id).offset(page * size).limit(size).all()
        return rows, total

    def create(self, db: Session, customer: CustomerCreate, created_by: int) -> Customer:
        data = customer.model_dump()
        data["customer_type"] = CustomerType(data["customer_type"]).value
        db_customer = Customer(
            **data,
            initial_credit_amount=data["max_credit_limit"],
            left_credit_amount=data["max_credit_limit"],
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
        
        update_data = customer.model_dump(exclude_unset=True, exclude={"expected_version"})
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
