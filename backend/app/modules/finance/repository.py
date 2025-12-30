from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from typing import List, Optional
from datetime import date, datetime
from . import models, schemas

class BankDepositRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, deposit: schemas.BankDepositCreate) -> models.BankDeposits:
        db_deposit = models.BankDeposits(
            **deposit.model_dump(),
            created_date=datetime.now()
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
        deposit = self.get_by_id(deposit_id)
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
            date_time=datetime.now()
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
    
    def create(self, expense: schemas.ExpenseCreate) -> models.Expenses:
        db_expense = models.Expenses(
            **expense.model_dump(),
            created_date=date.today()
        )
        self.db.add(db_expense)
        self.db.commit()
        self.db.refresh(db_expense)
        return db_expense
    
    def get_by_id(self, expense_id: int) -> Optional[models.Expenses]:
        return self.db.query(models.Expenses).filter(
            models.Expenses.id == expense_id
        ).first()
    
    def get_all(self, filters: schemas.ExpenseListFilter) -> List[models.Expenses]:
        query = self.db.query(models.Expenses)
        
        if filters.branch_code:
            query = query.filter(models.Expenses.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(models.Expenses.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.Expenses.created_date <= filters.date_to)
        
        return query.order_by(models.Expenses.created_date.desc()).offset(filters.skip).limit(filters.limit).all()

class CustomerAdvancePaymentRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, advance: schemas.CustomerAdvancePaymentCreate) -> models.CustomerAdvancePayments:
        # Generate advance payment number
        count = self.db.query(func.count(models.CustomerAdvancePayments.id)).scalar()
        advance_no = f"ADV{date.today().strftime('%Y%m%d')}{count + 1:04d}"
        
        db_advance = models.CustomerAdvancePayments(
            **advance.model_dump(),
            advance_payments_no=advance_no,
            created_date=date.today(),
            active=True
        )
        self.db.add(db_advance)
        self.db.commit()
        self.db.refresh(db_advance)
        return db_advance
    
    def get_by_id(self, advance_id: int) -> Optional[models.CustomerAdvancePayments]:
        return self.db.query(models.CustomerAdvancePayments).filter(
            models.CustomerAdvancePayments.id == advance_id
        ).first()
    
    def get_by_customer(self, customer_id: int) -> List[models.CustomerAdvancePayments]:
        return self.db.query(models.CustomerAdvancePayments).filter(
            models.CustomerAdvancePayments.customer_id == customer_id,
            models.CustomerAdvancePayments.active == True
        ).all()

class CustomerCreditNoteRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, credit_note: schemas.CustomerCreditNoteCreate) -> models.CustomerCreditNotes:
        db_credit_note = models.CustomerCreditNotes(
            **credit_note.model_dump(),
            date=datetime.now()
        )
        self.db.add(db_credit_note)
        self.db.commit()
        self.db.refresh(db_credit_note)
        return db_credit_note
    
    def get_by_id(self, credit_note_id: int) -> Optional[models.CustomerCreditNotes]:
        return self.db.query(models.CustomerCreditNotes).filter(
            models.CustomerCreditNotes.id == credit_note_id
        ).first()
    
    def get_by_customer(self, customer_id: int) -> List[models.CustomerCreditNotes]:
        return self.db.query(models.CustomerCreditNotes).filter(
            models.CustomerCreditNotes.customer_id == customer_id
        ).all()
