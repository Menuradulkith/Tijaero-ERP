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
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    payment_service = service.CardPaymentService(db)
    filters = schemas.PaymentListFilter(
        branch_code=branch_code,
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
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    payment_service = service.ChequePaymentService(db)
    filters = schemas.PaymentListFilter(
        branch_code=branch_code,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)

@router.post("/expenses", response_model=schemas.Expense, status_code=status.HTTP_201_CREATED)
def create_expense(expense: schemas.ExpenseCreate, db: Session = Depends(get_db)):
    return service.ExpenseService(db).create_expense(expense)

@router.put("/expenses/{expense_id}", response_model=schemas.Expense)
def update_expense(expense_id: int, data: schemas.ExpenseUpdate, db: Session = Depends(get_db)):
    return service.ExpenseService(db).update_expense(expense_id, data)

@router.get("/expenses/{expense_id}", response_model=schemas.Expense)
def get_expense(expense_id: int, db: Session = Depends(get_db)):
    return service.ExpenseService(db).get_expense(expense_id)

@router.get("/expenses")
def list_expenses(
    branch_code: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    expense_category: Optional[str] = None,
    payment_status: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    return service.ExpenseService(db).list_expenses(schemas.ExpenseListFilter(
        branch_code=branch_code, status=status_filter, expense_category=expense_category,
        payment_status=payment_status, search=search,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip, limit=limit,
    ))

@router.delete("/expenses/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db)):
    service.ExpenseService(db).delete_expense(expense_id)
    return {"message": "Expense deleted successfully"}

@router.post("/expenses/{expense_id}/submit", response_model=schemas.Expense)
def submit_expense(expense_id: int, db: Session = Depends(get_db)):
    return service.ExpenseService(db).submit_expense(expense_id, submitted_by=0)

@router.post("/expenses/{expense_id}/approve", response_model=schemas.Expense)
def approve_expense(expense_id: int, data: schemas.ExpenseApproval = None, db: Session = Depends(get_db)):
    return service.ExpenseService(db).approve_expense(expense_id, approved_by=0, remarks=data.remarks if data else None)

@router.post("/expenses/{expense_id}/reject", response_model=schemas.Expense)
def reject_expense(expense_id: int, data: schemas.ExpenseReject, db: Session = Depends(get_db)):
    return service.ExpenseService(db).reject_expense(expense_id, rejected_by=0, rejection_reason=data.rejection_reason)

@router.post("/expenses/{expense_id}/process-payment", response_model=schemas.Expense)
def process_expense_payment(expense_id: int, data: schemas.ExpensePayment, db: Session = Depends(get_db)):
    return service.ExpenseService(db).process_payment(expense_id, data, processed_by=0)

@router.post("/expenses/{expense_id}/record", response_model=schemas.Expense)
def record_expense(expense_id: int, data: schemas.ExpenseRecord, db: Session = Depends(get_db)):
    return service.ExpenseService(db).record_expense(expense_id, data)

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

@router.get("/advance-payments", response_model=List[schemas.CustomerAdvancePayment])
def list_all_advance_payments(
    branch_code: Optional[str] = None,
    customer_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List all advance payments with optional branch and customer filters"""
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.list_all_advances(branch_code=branch_code, customer_id=customer_id)

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

@router.get("/credit-notes", response_model=List[schemas.CustomerCreditNote])
def list_all_credit_notes(
    customer_id: Optional[int] = None,
    db: Session = Depends(get_db)
):
    """List all credit notes with optional customer filter"""
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.list_all_credit_notes(customer_id=customer_id)

@router.get("/customers/{customer_id}/credit-balance")
def get_customer_credit_balance(customer_id: int, db: Session = Depends(get_db)):
    """Get customer's available credit note balance"""
    credit_note_service = service.CustomerCreditNoteService(db)
    available_balance = credit_note_service.get_customer_credit_balance(customer_id)
    return {"customer_id": customer_id, "available_credit_balance": available_balance}

@router.get("/customers/{customer_id}/credit-balance")
def get_customer_credit_balance(customer_id: int, db: Session = Depends(get_db)):
    """Get customer's available credit note balance"""
    credit_note_service = service.CustomerCreditNoteService(db)
    balance = credit_note_service.get_customer_credit_balance(customer_id)
    return {"customer_id": customer_id, "available_credit_balance": balance}


# =============================================================================
# CASHBOOK ENDPOINTS
# =============================================================================

@router.get("/cashbook", response_model=schemas.CashbookReport)
def get_cashbook(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    entry_type: Optional[str] = None,
    payment_method: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Get cashbook report with all cash movements.
    
    Money IN sources:
    - Invoice receipts (cash, cards, bank transfer, cheque)
    - Customer credit settlements (late payments)
    - Customer advance payments
    
    Money OUT sources:
    - Supplier credit settlement payments
    - Expenses
    - Bank deposits (transfers to bank)
    
    Args:
        branch_code: Filter by branch
        date_from: Start date (YYYY-MM-DD)
        date_to: End date (YYYY-MM-DD)
        entry_type: Filter by entry type (invoice_receipt, customer_credit_settle, 
                    customer_advance, supplier_payment, expense, bank_deposit)
        payment_method: Filter by payment method (cash, card, bank, cheque, etc.)
    """
    cashbook_service = service.CashbookService(db)
    
    filters = schemas.CashbookFilter(
        branch_code=branch_code,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        entry_type=entry_type,
        payment_method=payment_method
    )
    
    return cashbook_service.get_cashbook_report(filters)


@router.get("/cashbook/summary", response_model=schemas.CashbookSummary)
def get_cashbook_summary(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Get cashbook summary statistics only (without full entry list)"""
    cashbook_service = service.CashbookService(db)
    
    filters = schemas.CashbookFilter(
        branch_code=branch_code,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None
    )
    
    report = cashbook_service.get_cashbook_report(filters)
    return report.summary
