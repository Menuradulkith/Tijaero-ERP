from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/finance", tags=["finance"])

@router.post("/bank-deposits", response_model=schemas.BankDeposit, status_code=status.HTTP_201_CREATED)
def create_bank_deposit(
    deposit: schemas.BankDepositCreate,
    db: Session = Depends(get_db)
):
    deposit_service = service.BankDepositService(db)
    return deposit_service.create_deposit(deposit)

@router.get("/bank-deposits/{deposit_id}", response_model=schemas.BankDeposit)
def get_bank_deposit(deposit_id: int, db: Session = Depends(get_db)):
    deposit_service = service.BankDepositService(db)
    return deposit_service.get_deposit(deposit_id)

@router.get("/bank-deposits", response_model=List[schemas.BankDeposit])
def list_bank_deposits(
    branch_code: Optional[str] = None,
    verified: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    deposit_service = service.BankDepositService(db)
    filters = schemas.PaymentListFilter(
        branch_code=branch_code,
        verified=verified,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return deposit_service.list_deposits(filters)

@router.patch("/bank-deposits/{deposit_id}/verify", response_model=schemas.BankDeposit)
def verify_bank_deposit(deposit_id: int, db: Session = Depends(get_db)):
    deposit_service = service.BankDepositService(db)
    return deposit_service.verify_deposit(deposit_id)

@router.post("/card-payments", response_model=schemas.CardPayment, status_code=status.HTTP_201_CREATED)
def create_card_payment(
    payment: schemas.CardPaymentCreate,
    db: Session = Depends(get_db)
):
    payment_service = service.CardPaymentService(db)
    return payment_service.create_payment(payment)

@router.get("/card-payments/{payment_id}", response_model=schemas.CardPayment)
def get_card_payment(payment_id: int, db: Session = Depends(get_db)):
    payment_service = service.CardPaymentService(db)
    return payment_service.get_payment(payment_id)

@router.get("/card-payments", response_model=List[schemas.CardPayment])
def list_card_payments(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    payment_service = service.CardPaymentService(db)
    filters = schemas.PaymentListFilter(
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)

@router.post("/cheque-payments", response_model=schemas.ChequePayment, status_code=status.HTTP_201_CREATED)
def create_cheque_payment(
    payment: schemas.ChequePaymentCreate,
    db: Session = Depends(get_db)
):
    payment_service = service.ChequePaymentService(db)
    return payment_service.create_payment(payment)

@router.get("/cheque-payments/{payment_id}", response_model=schemas.ChequePayment)
def get_cheque_payment(payment_id: int, db: Session = Depends(get_db)):
    payment_service = service.ChequePaymentService(db)
    return payment_service.get_payment(payment_id)

@router.get("/cheque-payments", response_model=List[schemas.ChequePayment])
def list_cheque_payments(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    payment_service = service.ChequePaymentService(db)
    filters = schemas.PaymentListFilter(
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)

@router.post("/expenses", response_model=schemas.Expense, status_code=status.HTTP_201_CREATED)
def create_expense(
    expense: schemas.ExpenseCreate,
    db: Session = Depends(get_db)
):
    expense_service = service.ExpenseService(db)
    return expense_service.create_expense(expense)

@router.get("/expenses/{expense_id}", response_model=schemas.Expense)
def get_expense(expense_id: int, db: Session = Depends(get_db)):
    expense_service = service.ExpenseService(db)
    return expense_service.get_expense(expense_id)

@router.get("/expenses", response_model=List[schemas.Expense])
def list_expenses(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    expense_service = service.ExpenseService(db)
    filters = schemas.ExpenseListFilter(
        branch_code=branch_code,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return expense_service.list_expenses(filters)

@router.post("/advance-payments", response_model=schemas.CustomerAdvancePayment, status_code=status.HTTP_201_CREATED)
def create_advance_payment(
    advance: schemas.CustomerAdvancePaymentCreate,
    db: Session = Depends(get_db)
):
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.create_advance_payment(advance)
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.create_advance_payment(advance)

@router.get("/advance-payments/{advance_id}", response_model=schemas.CustomerAdvancePayment)
def get_advance_payment(advance_id: int, db: Session = Depends(get_db)):
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.get_advance_payment(advance_id)

@router.get("/customers/{customer_id}/advance-payments", response_model=List[schemas.CustomerAdvancePayment])
def get_customer_advances(customer_id: int, db: Session = Depends(get_db)):
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.get_customer_advances(customer_id)

@router.post("/credit-notes", response_model=schemas.CustomerCreditNote, status_code=status.HTTP_201_CREATED)
def create_credit_note(
    credit_note: schemas.CustomerCreditNoteCreate,
    db: Session = Depends(get_db)
):
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.create_credit_note(credit_note)

@router.get("/credit-notes/{credit_note_id}", response_model=schemas.CustomerCreditNote)
def get_credit_note(credit_note_id: int, db: Session = Depends(get_db)):
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.get_credit_note(credit_note_id)

@router.get("/customers/{customer_id}/credit-notes", response_model=List[schemas.CustomerCreditNote])
def get_customer_credit_notes(customer_id: int, db: Session = Depends(get_db)):
    """Get all credit notes for a customer"""
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.get_customer_credit_notes(customer_id)
