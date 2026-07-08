from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from typing import List, Optional
from datetime import date, datetime
from app.core import timezone as tz
from app.common.audit import log_audit
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
    
    def create(self, deposit: schemas.BankDepositCreate, created_by: Optional[int] = None) -> models.BankDeposits:
        db_deposit = models.BankDeposits(
            **deposit.model_dump(),
            created_date=tz.now(),
            created_by=created_by,
        )
        self.db.add(db_deposit)
        self.db.flush()
        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="bank_deposit", entity_id=db_deposit.id,
            changes={"deposits_amount": str(db_deposit.deposits_amount), "branch_code": db_deposit.branch_code},
        )
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
        elif filters.branch_codes:
            query = query.filter(models.BankDeposits.branch_code.in_(filters.branch_codes))
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
    
    def create(self, payment: schemas.CardPaymentCreate, created_by: Optional[int] = None) -> models.CardPayments:
        db_payment = models.CardPayments(
            **payment.model_dump(),
            date_time=tz.now(),
            created_by=created_by,
        )
        self.db.add(db_payment)
        self.db.flush()
        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="card_payment", entity_id=db_payment.id,
            changes={"amount": str(db_payment.amount), "card_type": db_payment.card_type},
        )
        self.db.commit()
        self.db.refresh(db_payment)
        return db_payment
    
    def get_by_id(self, payment_id: int) -> Optional[models.CardPayments]:
        return self.db.query(models.CardPayments).filter(
            models.CardPayments.id == payment_id
        ).first()
    
    def get_all(self, filters: schemas.PaymentListFilter) -> List[models.CardPayments]:
        from app.modules.sales.models import Invoice
        query = self.db.query(models.CardPayments).outerjoin(
            Invoice, Invoice.card_payment_id == models.CardPayments.id
        )
        
        if filters.branch_code:
            query = query.filter(Invoice.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(Invoice.branch_code.in_(filters.branch_codes))
        if filters.date_from:
            query = query.filter(models.CardPayments.date_time >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.CardPayments.date_time <= filters.date_to)
        
        return query.order_by(models.CardPayments.date_time.desc()).offset(filters.skip).limit(filters.limit).all()

class ChequePaymentRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, payment: schemas.ChequePaymentCreate, created_by: Optional[int] = None) -> models.ChequePayments:
        db_payment = models.ChequePayments(**payment.model_dump(), created_by=created_by)
        self.db.add(db_payment)
        self.db.flush()
        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="cheque_payment", entity_id=db_payment.id,
            changes={"amount": str(db_payment.amount), "branch_code": db_payment.branch_code},
        )
        self.db.commit()
        self.db.refresh(db_payment)
        return db_payment
    
    def get_by_id(self, payment_id: int) -> Optional[models.ChequePayments]:
        return self.db.query(models.ChequePayments).filter(
            models.ChequePayments.id == payment_id
        ).first()
    
    def get_all(self, filters: schemas.PaymentListFilter) -> List[models.ChequePayments]:
        from app.modules.sales.models import Invoice
        query = self.db.query(models.ChequePayments).outerjoin(
            Invoice, Invoice.cheque_payment_id == models.ChequePayments.id
        )
        
        if filters.branch_code:
            query = query.filter(Invoice.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(Invoice.branch_code.in_(filters.branch_codes))
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
            branch_code = data.get("branch_code") or "HQ"
            data["expenses_no"] = self._generate_expense_no(branch_code)
        if not data.get("expense_date"):
            data["expense_date"] = tz.today()
        db_expense = models.Expenses(
            **data,
            created_date=tz.today(),
            status="pending",
            submitted_by=submitted_by,
            created_by=submitted_by,
        )
        self.db.add(db_expense)
        self.db.flush()
        log_audit(
            self.db, user_id=submitted_by or 0, action="create",
            entity_type="expense", entity_id=db_expense.id,
            changes={"expenses_no": db_expense.expenses_no, "expense_amount": str(db_expense.expense_amount), "branch_code": db_expense.branch_code},
        )
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
        elif filters.branch_codes:
            query = query.filter(models.Expenses.branch_code.in_(filters.branch_codes))
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
        from app.common.pagination import fast_count
        total = fast_count(query)
        items = query.order_by(models.Expenses.created_date.desc()).offset(filters.skip).limit(filters.limit).all()
        return items, total

    def _generate_expense_no(self, branch_code: str = None) -> str:
        """Generate unique expense number: EXP-{BranchCode}-YYYY-XXXXX
        Uses advisory lock to prevent duplicate numbers under concurrency.
        """
        from sqlalchemy import text
        from app.core import timezone as tz
        
        # Extract branch code with default
        branch_code = branch_code or "HQ"
        
        year = tz.year()
        prefix = f"EXP-{branch_code}-{year}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = self.db.query(models.Expenses).filter(
            models.Expenses.expenses_no.like(f"{prefix}-%")
        ).order_by(models.Expenses.expenses_no.desc()).first()
        if last and last.expenses_no.startswith(prefix):
            try:
                return f"{prefix}-{int(last.expenses_no.split('-')[-1]) + 1:05d}"
            except ValueError:
                pass
        return f"{prefix}-00001"

class CustomerAdvancePaymentRepository:
    def __init__(self, db: Session):
        self.db = db
    
    def create(self, advance: schemas.CustomerAdvancePaymentCreate, created_by: Optional[int] = None) -> CustomerAdvancePayments:
        # Advisory lock to prevent duplicate advance numbers under concurrency
        from sqlalchemy import text
        prefix = f"ADV{tz.today().strftime('%Y%m%d')}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        # Derive the next sequence from the HIGHEST existing number for this
        # prefix, not the global row count (which reuses a number after a delete
        # and would collide with an existing advance for the same day).
        last = self.db.query(CustomerAdvancePayments.advance_payments_no).filter(
            CustomerAdvancePayments.advance_payments_no.like(f"{prefix}%")
        ).order_by(CustomerAdvancePayments.advance_payments_no.desc()).first()
        if last and last[0] and last[0].startswith(prefix):
            try:
                seq = int(last[0][len(prefix):]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        advance_no = f"{prefix}{seq:04d}"

        db_advance = CustomerAdvancePayments(
            **advance.model_dump(),
            advance_payments_no=advance_no,
            created_date=tz.today(),
            active=True,
            created_by=created_by,
        )
        self.db.add(db_advance)
        self.db.flush()
        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="customer_advance_payment", entity_id=db_advance.id,
            changes={"advance_payments_no": advance_no, "payment_amount": str(db_advance.payment_amount), "branch_code": db_advance.branch_code},
        )
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
    
    def create(self, credit_note: schemas.CustomerCreditNoteCreate, created_by: Optional[int] = None) -> CustomerCreditNotes:
        db_credit_note = CustomerCreditNotes(
            **credit_note.model_dump(),
            date=tz.now(),
            created_by=created_by,
        )
        self.db.add(db_credit_note)
        self.db.flush()
        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="customer_credit_note", entity_id=db_credit_note.id,
            changes={"amount": str(db_credit_note.amount), "customer_id": db_credit_note.customer_id},
        )
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


class CreditPaymentRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, payment_id: int):
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        return self.db.query(
            models.CreditPayments.id,
            models.CreditPayments.customer_id,
            Customer.customer_name.label("customer_name"),
            Invoice.invoice_no.label("invoice_no"),
            models.CreditPayments.amount,
            models.CreditPayments.credit_terms,
            models.CreditPayments.due_date,
            models.CreditPayments.status,
            models.CreditPayments.created_date,
            models.CreditPayments.created_by,
            models.CreditPayments.updated_by,
            models.CreditPayments.created_at,
            models.CreditPayments.updated_at
        ).outerjoin(
            Customer, Customer.id == models.CreditPayments.customer_id
        ).outerjoin(
            Invoice, Invoice.credit_payment_id == models.CreditPayments.id
        ).filter(
            models.CreditPayments.id == payment_id
        ).first()

    def get_all(self, filters: schemas.PaymentListFilter):
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        query = self.db.query(
            models.CreditPayments.id,
            models.CreditPayments.customer_id,
            Customer.customer_name.label("customer_name"),
            Invoice.invoice_no.label("invoice_no"),
            models.CreditPayments.amount,
            models.CreditPayments.credit_terms,
            models.CreditPayments.due_date,
            models.CreditPayments.status,
            models.CreditPayments.created_date,
            models.CreditPayments.created_by,
            models.CreditPayments.updated_by,
            models.CreditPayments.created_at,
            models.CreditPayments.updated_at
        ).outerjoin(
            Customer, Customer.id == models.CreditPayments.customer_id
        ).outerjoin(
            Invoice, Invoice.credit_payment_id == models.CreditPayments.id
        )

        if filters.branch_code:
            query = query.filter(Invoice.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(Invoice.branch_code.in_(filters.branch_codes))
        
        if filters.date_from:
            query = query.filter(models.CreditPayments.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.CreditPayments.created_date <= filters.date_to)

        return query.order_by(models.CreditPayments.created_date.desc()).offset(filters.skip).limit(filters.limit).all()


class CashPaymentRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, payment_id: int):
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        return self.db.query(
            Invoice.id,
            Invoice.invoice_no,
            Invoice.branch_code,
            Invoice.cash_amount.label("amount"),
            Invoice.customer_id,
            Customer.customer_name.label("customer_name"),
            Invoice.created_date,
            Invoice.created_date_time,
            Invoice.remarks,
            Invoice.created_by,
            Invoice.created_at,
            Invoice.updated_at
        ).outerjoin(
            Customer, Customer.id == Invoice.customer_id
        ).filter(
            Invoice.id == payment_id,
            Invoice.payment_method.ilike("cash")
        ).first()

    def get_all(self, filters: schemas.PaymentListFilter):
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        query = self.db.query(
            Invoice.id,
            Invoice.invoice_no,
            Invoice.branch_code,
            Invoice.cash_amount.label("amount"),
            Invoice.customer_id,
            Customer.customer_name.label("customer_name"),
            Invoice.created_date,
            Invoice.created_date_time,
            Invoice.remarks,
            Invoice.created_by,
            Invoice.created_at,
            Invoice.updated_at
        ).outerjoin(
            Customer, Customer.id == Invoice.customer_id
        ).filter(
            Invoice.payment_method.ilike("cash")
        )

        if filters.branch_code:
            query = query.filter(Invoice.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(Invoice.branch_code.in_(filters.branch_codes))
        
        if filters.date_from:
            query = query.filter(Invoice.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(Invoice.created_date <= filters.date_to)

        return query.order_by(Invoice.created_date_time.desc()).offset(filters.skip).limit(filters.limit).all()

