from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from typing import List, Optional
from datetime import date, datetime
from app.core import timezone as tz
from . import models, schemas

from app.modules.customers.models import (
    CustomerAdvancePayments,
    CustomerCreditNotes,
    CustomerCreditsSettle,
    CustomerCreditsSettleTransaction
)

class BankDepositRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, deposit: schemas.BankDepositCreate) -> models.BankDeposits:
        db_deposit = models.BankDeposits(
            **deposit.model_dump(),
            created_date=tz.now()
        )
        self.db.add(db_deposit)
        self.db.commit()
        self.db.refresh(db_deposit)
        return db_deposit
    
    def get_by_id(self, deposit_id: int) -> Optional[models.BankDeposits]:
        return self.db.query(models.BankDeposits).filter(
            models.BankDeposits.id == deposit_id
        ).first()
    
    def get_all(self, filters: schemas.PaymentListFilter) -> List[models.BankDeposits]:
        query = self.db.query(models.BankDeposits)
        
        if filters.branch_code:
            query = query.filter(models.BankDeposits.branch_code == filters.branch_code)
        if filters.verified is not None:
            query = query.filter(models.BankDeposits.verified == filters.verified)
        if filters.date_from:
            query = query.filter(models.BankDeposits.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.BankDeposits.created_date <= filters.date_to)
        
        return query.order_by(models.BankDeposits.created_date.desc()).offset(filters.skip).limit(filters.limit).all()
    
    def verify(self, deposit_id: int) -> Optional[models.BankDeposits]:
        # SELECT FOR UPDATE to prevent double-verification race condition
        deposit = self.db.query(models.BankDeposits).filter(
            models.BankDeposits.id == deposit_id
        ).with_for_update().first()
        if deposit:
            deposit.verified = True
            self.db.commit()
            self.db.refresh(deposit)
        return deposit

class CardPaymentRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, payment: schemas.CardPaymentCreate) -> models.CardPayments:
        db_payment = models.CardPayments(
            **payment.model_dump(),
            date_time=tz.now()
        )
        self.db.add(db_payment)
        self.db.commit()
        self.db.refresh(db_payment)
        return db_payment
    
    def get_by_id(self, payment_id: int) -> Optional[models.CardPayments]:
        return self.db.query(models.CardPayments).filter(
            models.CardPayments.id == payment_id
        ).first()
    
    def get_all(self, filters: schemas.PaymentListFilter) -> List[models.CardPayments]:
        query = self.db.query(models.CardPayments)
        
        if filters.date_from:
            query = query.filter(models.CardPayments.date_time >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.CardPayments.date_time <= filters.date_to)
        
        return query.order_by(models.CardPayments.date_time.desc()).offset(filters.skip).limit(filters.limit).all()

class ChequePaymentRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, payment: schemas.ChequePaymentCreate) -> models.ChequePayments:
        db_payment = models.ChequePayments(**payment.model_dump())
        self.db.add(db_payment)
        self.db.commit()
        self.db.refresh(db_payment)
        return db_payment
    
    def get_by_id(self, payment_id: int) -> Optional[models.ChequePayments]:
        return self.db.query(models.ChequePayments).filter(
            models.ChequePayments.id == payment_id
        ).first()
    
    def get_all(self, filters: schemas.PaymentListFilter) -> List[models.ChequePayments]:
        query = self.db.query(models.ChequePayments)
        
        if filters.date_from:
            query = query.filter(models.ChequePayments.cheque_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.ChequePayments.cheque_date <= filters.date_to)
        
        return query.order_by(models.ChequePayments.cheque_date.desc()).offset(filters.skip).limit(filters.limit).all()

class ExpenseRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, expense: schemas.ExpenseCreate, submitted_by: int = None) -> models.Expenses:
        data = expense.model_dump(exclude_none=True)
        if not data.get("expenses_no"):
            data["expenses_no"] = self._generate_expense_no()
        if not data.get("expense_date"):
            data["expense_date"] = tz.today()
        db_expense = models.Expenses(
            **data,
            created_date=tz.today(),
            status="pending",
            submitted_by=submitted_by,
        )
        self.db.add(db_expense)
        self.db.commit()
        self.db.refresh(db_expense)
        return db_expense

    def update(self, expense_id: int, data: schemas.ExpenseUpdate) -> Optional[models.Expenses]:
        db_expense = self.get_by_id(expense_id)
        if not db_expense:
            return None
        for key, value in data.model_dump(exclude_none=True).items():
            setattr(db_expense, key, value)
        self.db.commit()
        self.db.refresh(db_expense)
        return db_expense

    def get_by_id(self, expense_id: int) -> Optional[models.Expenses]:
        return self.db.query(models.Expenses).filter(
            models.Expenses.id == expense_id
        ).first()

    def get_all(self, filters: schemas.ExpenseListFilter):
        from sqlalchemy import or_
        query = self.db.query(models.Expenses)
        if filters.branch_code:
            query = query.filter(models.Expenses.branch_code == filters.branch_code)
        if filters.status:
            query = query.filter(models.Expenses.status == filters.status)
        if filters.expense_category:
            query = query.filter(models.Expenses.expense_category == filters.expense_category)
        if filters.payment_status:
            query = query.filter(models.Expenses.payment_status == filters.payment_status)
        if filters.date_from:
            query = query.filter(models.Expenses.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.Expenses.created_date <= filters.date_to)
        if filters.search:
            s = f"%{filters.search}%"
            query = query.filter(or_(
                models.Expenses.expenses_no.ilike(s),
                models.Expenses.vendor_name.ilike(s),
                models.Expenses.description.ilike(s),
                models.Expenses.receipt_number.ilike(s),
            ))
        total = query.count()
        items = query.order_by(models.Expenses.created_date.desc()).offset(filters.skip).limit(filters.limit).all()
        return items, total

    def _generate_expense_no(self) -> str:
        """Generate unique expense number.
        Uses advisory lock to prevent duplicate numbers under concurrency.
        """
        from sqlalchemy import text
        today = tz.today().strftime("%Y%m%d")
        prefix = f"EXP-{today}-"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = self.db.query(models.Expenses).filter(
            models.Expenses.expenses_no.like(f"{prefix}%")
        ).order_by(models.Expenses.expenses_no.desc()).first()
        if last and last.expenses_no.startswith(prefix):
            try:
                return f"{prefix}{int(last.expenses_no.split('-')[-1]) + 1:04d}"
            except ValueError:
                pass
        return f"{prefix}0001"

class CustomerAdvancePaymentRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, advance: schemas.CustomerAdvancePaymentCreate) -> CustomerAdvancePayments:
        # Advisory lock to prevent duplicate advance numbers under concurrency
        from sqlalchemy import text
        prefix = f"ADV{tz.today().strftime('%Y%m%d')}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        count = self.db.query(func.count(CustomerAdvancePayments.id)).scalar()
        advance_no = f"{prefix}{count + 1:04d}"
        
        db_advance = CustomerAdvancePayments(
            **advance.model_dump(),
            advance_payments_no=advance_no,
            created_date=tz.today(),
            active=True
        )
        self.db.add(db_advance)
        self.db.commit()
        self.db.refresh(db_advance)
        return db_advance
    
    def get_by_id(self, advance_id: int) -> Optional[CustomerAdvancePayments]:
        return self.db.query(CustomerAdvancePayments).filter(
            CustomerAdvancePayments.id == advance_id
        ).first()
    
    def get_by_customer(self, customer_id: int) -> List[CustomerAdvancePayments]:
        return self.db.query(CustomerAdvancePayments).filter(
            CustomerAdvancePayments.customer_id == customer_id,
            CustomerAdvancePayments.active == True
        ).all()

class CustomerCreditNoteRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, credit_note: schemas.CustomerCreditNoteCreate) -> CustomerCreditNotes:
        db_credit_note = CustomerCreditNotes(
            **credit_note.model_dump(),
            date=tz.now()
        )
        self.db.add(db_credit_note)
        self.db.commit()
        self.db.refresh(db_credit_note)
        return db_credit_note
    
    def get_by_id(self, credit_note_id: int) -> Optional[CustomerCreditNotes]:
        return self.db.query(CustomerCreditNotes).filter(
            CustomerCreditNotes.id == credit_note_id
        ).first()
    
    def get_by_customer(self, customer_id: int) -> List[CustomerCreditNotes]:
        return self.db.query(CustomerCreditNotes).filter(
            CustomerCreditNotes.customer_id == customer_id
        ).all()
