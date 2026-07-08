from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime
from app.db.session import get_db
from app.auth.dependencies import (
    get_current_user,
    get_current_active_user,
    get_user_branch_filter,
    validate_branch_access,
)
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.utils.csv_export import build_csv_response
from . import schemas, service, models


def _enforce_branch_scope(
    branch_code: Optional[str],
    user_branches: Optional[List[str]],
) -> Optional[str]:
    """
    Enforce branch scoping on a single-branch filter.
    If user_branches is None (superuser) → pass through the optional branch_code.
    If user_branches is set → restrict to that list; if branch_code was requested but
    not in the list, raise 403.  If no branch_code requested, we return None so the
    service returns data for ALL of the user's branches (see _scoped_branch_codes).
    """
    if user_branches is None:
        return branch_code  # superuser – no restriction
    if branch_code:
        if branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}",
            )
        return branch_code
    return None  # no specific branch requested; _scoped_branch_codes will enforce


def _scoped_branch_codes(
    user_branches: Optional[List[str]],
) -> Optional[List[str]]:
    """Return branch list suitable for service .in_() filtering."""
    return user_branches  # None for superusers, list for regular users


router = APIRouter(prefix="/finance", tags=["finance"])

# =============================================================================
# BANK DEPOSITS
# =============================================================================

@router.post("/bank-deposits", response_model=schemas.BankDeposit, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.BANK_DEPOSIT_CREATE))])
def create_bank_deposit(
    deposit: schemas.BankDepositCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not validate_branch_access(current_user, deposit.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {deposit.branch_code}")
    deposit_service = service.BankDepositService(db)
    return deposit_service.create_deposit(deposit, created_by=current_user.id)

@router.get("/bank-deposits/{deposit_id}", response_model=schemas.BankDeposit, dependencies=[Depends(require_permission(*Permissions.BANK_DEPOSIT_VIEW))])
def get_bank_deposit(
    deposit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    deposit_service = service.BankDepositService(db)
    deposit = deposit_service.get_deposit(deposit_id)
    if not validate_branch_access(current_user, deposit.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {deposit.branch_code}")
    return deposit

@router.get("/bank-deposits", response_model=List[schemas.BankDeposit], dependencies=[Depends(require_permission(*Permissions.BANK_DEPOSIT_VIEW))])
def list_bank_deposits(
    branch_code: Optional[str] = None,
    verified: Optional[bool] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    deposit_service = service.BankDepositService(db)
    filters = schemas.PaymentListFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        verified=verified,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return deposit_service.list_deposits(filters)

@router.patch("/bank-deposits/{deposit_id}/verify", response_model=schemas.BankDeposit, dependencies=[Depends(require_permission(*Permissions.BANK_TRANSFER_VERIFY_APPROVE))])
def verify_bank_deposit(
    deposit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    deposit_service = service.BankDepositService(db)
    existing = deposit_service.get_deposit(deposit_id)
    if not validate_branch_access(current_user, existing.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {existing.branch_code}")
    return deposit_service.verify_deposit(deposit_id, user_id=current_user.id)

# =============================================================================
# CARD PAYMENTS
# =============================================================================

@router.post("/card-payments", response_model=schemas.CardPayment, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CARD_PAYMENT_CREATE))])
def create_card_payment(
    payment: schemas.CardPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not validate_branch_access(current_user, payment.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {payment.branch_code}")
    payment_service = service.CardPaymentService(db)
    return payment_service.create_payment(payment, created_by=current_user.id)

@router.get("/card-payments/{payment_id}", response_model=schemas.CardPayment, dependencies=[Depends(require_permission(*Permissions.CARD_PAYMENT_VIEW))])
def get_card_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    payment_service = service.CardPaymentService(db)
    return payment_service.get_payment(payment_id)

@router.get("/card-payments", response_model=List[schemas.CardPayment], dependencies=[Depends(require_permission(*Permissions.CARD_PAYMENT_VIEW))])
def list_card_payments(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    payment_service = service.CardPaymentService(db)
    filters = schemas.PaymentListFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)

# =============================================================================
# CHEQUE PAYMENTS
# =============================================================================

@router.post("/cheque-payments", response_model=schemas.ChequePayment, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CHEQUE_PAYMENT_CREATE))])
def create_cheque_payment(
    payment: schemas.ChequePaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if not validate_branch_access(current_user, payment.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {payment.branch_code}")
    payment_service = service.ChequePaymentService(db)
    return payment_service.create_payment(payment, created_by=current_user.id)

@router.get("/cheque-payments/{payment_id}", response_model=schemas.ChequePayment, dependencies=[Depends(require_permission(*Permissions.CHEQUE_PAYMENT_VIEW))])
def get_cheque_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    payment_service = service.ChequePaymentService(db)
    payment = payment_service.get_payment(payment_id)
    if not validate_branch_access(current_user, payment.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {payment.branch_code}")
    return payment

@router.get("/cheque-payments", response_model=List[schemas.ChequePayment], dependencies=[Depends(require_permission(*Permissions.CHEQUE_PAYMENT_VIEW))])
def list_cheque_payments(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    payment_service = service.ChequePaymentService(db)
    filters = schemas.PaymentListFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)

# =============================================================================
# CREDIT PAYMENTS
# =============================================================================

@router.get("/credit-payments/{payment_id}", response_model=schemas.CreditPaymentResponse, dependencies=[Depends(require_permission(*Permissions.CREDIT_PAYMENT_VIEW))])
def get_credit_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    payment_service = service.CreditPaymentService(db)
    return payment_service.get_payment(payment_id)

@router.get("/credit-payments", response_model=List[schemas.CreditPaymentResponse], dependencies=[Depends(require_permission(*Permissions.CREDIT_PAYMENT_VIEW))])
def list_credit_payments(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    payment_service = service.CreditPaymentService(db)
    filters = schemas.PaymentListFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)


# =============================================================================
# CASH PAYMENTS
# =============================================================================

@router.get("/cash-payments/{payment_id}", response_model=schemas.CashPaymentResponse, dependencies=[Depends(require_permission(*Permissions.CASH_PAYMENT_VIEW))])
def get_cash_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    payment_service = service.CashPaymentService(db)
    payment = payment_service.get_payment(payment_id)
    if not validate_branch_access(current_user, payment.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {payment.branch_code}")
    return payment

@router.get("/cash-payments", response_model=List[schemas.CashPaymentResponse], dependencies=[Depends(require_permission(*Permissions.CASH_PAYMENT_VIEW))])
def list_cash_payments(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    payment_service = service.CashPaymentService(db)
    filters = schemas.PaymentListFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return payment_service.list_payments(filters)


# =============================================================================
# EXPENSES
# =============================================================================

@router.post("/expenses", response_model=schemas.Expense, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.EXPENSE_CREATE))])
def create_expense(
    expense: schemas.ExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if expense.branch_code and not validate_branch_access(current_user, expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {expense.branch_code}")
    return service.ExpenseService(db).create_expense(expense, submitted_by=current_user.id)

@router.put("/expenses/{expense_id}", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_UPDATE))])
def update_expense(
    expense_id: int,
    data: schemas.ExpenseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return service.ExpenseService(db).update_expense(expense_id, data)

@router.get("/expenses/{expense_id}", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_VIEW))])
def get_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    expense = service.ExpenseService(db).get_expense(expense_id)
    if not validate_branch_access(current_user, expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {expense.branch_code}")
    return expense

@router.get("/expenses", dependencies=[Depends(require_permission(*Permissions.EXPENSE_VIEW))])
def list_expenses(
    branch_code: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    expense_category: Optional[str] = None,
    payment_status: Optional[str] = None,
    search: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    return service.ExpenseService(db).list_expenses(schemas.ExpenseListFilter(
        branch_code=scoped_branch, branch_codes=_scoped_branch_codes(user_branches),
        status=status_filter, expense_category=expense_category,
        payment_status=payment_status, search=search,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip, limit=limit,
    ))

@router.delete("/expenses/{expense_id}", dependencies=[Depends(require_permission(*Permissions.EXPENSE_DELETE))])
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = service.ExpenseService(db)
    _expense = svc.get_expense(expense_id)
    if not validate_branch_access(current_user, _expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {_expense.branch_code}")
    svc.delete_expense(expense_id)
    return {"message": "Expense deleted successfully"}

@router.post("/expenses/{expense_id}/submit", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_UPDATE))])
def submit_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = service.ExpenseService(db)
    _expense = svc.get_expense(expense_id)
    if not validate_branch_access(current_user, _expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {_expense.branch_code}")
    return svc.submit_expense(expense_id, submitted_by=current_user.id)

@router.post("/expenses/{expense_id}/approve", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_APPROVAL_APPROVE))])
def approve_expense(
    expense_id: int,
    data: schemas.ExpenseApproval = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = service.ExpenseService(db)
    _expense = svc.get_expense(expense_id)
    if not validate_branch_access(current_user, _expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {_expense.branch_code}")
    return svc.approve_expense(expense_id, approved_by=current_user.id, remarks=data.remarks if data else None)

@router.post("/expenses/{expense_id}/reject", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_APPROVAL_APPROVE))])
def reject_expense(
    expense_id: int,
    data: schemas.ExpenseReject,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = service.ExpenseService(db)
    _expense = svc.get_expense(expense_id)
    if not validate_branch_access(current_user, _expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {_expense.branch_code}")
    return svc.reject_expense(expense_id, rejected_by=current_user.id, rejection_reason=data.rejection_reason)

@router.post("/expenses/{expense_id}/process-payment", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_UPDATE))])
def process_expense_payment(
    expense_id: int,
    data: schemas.ExpensePayment,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = service.ExpenseService(db)
    _expense = svc.get_expense(expense_id)
    if not validate_branch_access(current_user, _expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {_expense.branch_code}")
    return svc.process_payment(expense_id, data, processed_by=current_user.id)

@router.post("/expenses/{expense_id}/record", response_model=schemas.Expense, dependencies=[Depends(require_permission(*Permissions.EXPENSE_UPDATE))])
def record_expense(
    expense_id: int,
    data: schemas.ExpenseRecord,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = service.ExpenseService(db)
    _expense = svc.get_expense(expense_id)
    if not validate_branch_access(current_user, _expense.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {_expense.branch_code}")
    return svc.record_expense(expense_id, data)

# =============================================================================
# ADVANCE PAYMENTS
# =============================================================================

@router.post("/advance-payments", response_model=schemas.CustomerAdvancePayment, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CUSTOMER_ADVANCE_CREATE))])
def create_advance_payment(
    advance: schemas.CustomerAdvancePaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    if advance.branch_code and not validate_branch_access(current_user, advance.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {advance.branch_code}")
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.create_advance_payment(advance, user_id=current_user.id)

@router.get("/advance-payments/{advance_id}", response_model=schemas.CustomerAdvancePayment, dependencies=[Depends(require_permission(*Permissions.CUSTOMER_ADVANCE_VIEW))])
def get_advance_payment(
    advance_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    advance_service = service.CustomerAdvancePaymentService(db)
    advance = advance_service.get_advance_payment(advance_id)
    if not validate_branch_access(current_user, advance.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {advance.branch_code}")
    return advance

@router.get("/customers/{customer_id}/advance-payments", response_model=List[schemas.CustomerAdvancePayment], dependencies=[Depends(require_permission(*Permissions.CUSTOMER_ADVANCE_VIEW))])
def get_customer_advances(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.get_customer_advances(customer_id)

@router.get("/advance-payments", response_model=List[schemas.CustomerAdvancePayment], dependencies=[Depends(require_permission(*Permissions.CUSTOMER_ADVANCE_VIEW))])
def list_all_advance_payments(
    branch_code: Optional[str] = None,
    customer_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """List all advance payments with optional branch and customer filters"""
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    advance_service = service.CustomerAdvancePaymentService(db)
    return advance_service.list_all_advances(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        customer_id=customer_id,
    )

# =============================================================================
# CREDIT NOTES
# =============================================================================

@router.post("/credit-notes", response_model=schemas.CustomerCreditNote, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CREDIT_NOTE_CREATE))])
def create_credit_note(
    credit_note: schemas.CustomerCreditNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.create_credit_note(credit_note, user_id=current_user.id)

@router.get("/credit-notes/{credit_note_id}", response_model=schemas.CustomerCreditNote, dependencies=[Depends(require_permission(*Permissions.CREDIT_NOTE_VIEW))])
def get_credit_note(
    credit_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.get_credit_note(credit_note_id)

@router.get("/customers/{customer_id}/credit-notes", response_model=List[schemas.CustomerCreditNote], dependencies=[Depends(require_permission(*Permissions.CREDIT_NOTE_VIEW))])
def get_customer_credit_notes(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get all credit notes for a customer"""
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.get_customer_credit_notes(customer_id)

@router.get("/credit-notes", response_model=List[schemas.CustomerCreditNote], dependencies=[Depends(require_permission(*Permissions.CREDIT_NOTE_VIEW))])
def list_all_credit_notes(
    customer_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all credit notes with optional customer filter"""
    credit_note_service = service.CustomerCreditNoteService(db)
    return credit_note_service.list_all_credit_notes(customer_id=customer_id)

@router.get("/customers/{customer_id}/credit-balance", dependencies=[Depends(require_permission(*Permissions.CREDIT_NOTE_VIEW))])
def get_customer_credit_balance(
    customer_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get customer's available credit note balance"""
    credit_note_service = service.CustomerCreditNoteService(db)
    available_balance = credit_note_service.get_customer_credit_balance(customer_id)
    return {"customer_id": customer_id, "available_credit_balance": available_balance}


# =============================================================================
# CASHBOOK ENDPOINTS
# =============================================================================

@router.get("/cashbook", response_model=schemas.CashbookReport, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def get_cashbook(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    entry_type: Optional[str] = None,
    payment_method: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
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
    """
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    cashbook_service = service.CashbookService(db)
    
    filters = schemas.CashbookFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        entry_type=entry_type,
        payment_method=payment_method
    )
    
    return cashbook_service.get_cashbook_report(filters)


@router.get("/cashbook/summary", response_model=schemas.CashbookSummary, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def get_cashbook_summary(
    branch_code: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Get cashbook summary statistics only (without full entry list)"""
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    cashbook_service = service.CashbookService(db)
    
    filters = schemas.CashbookFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None
    )
    
    report = cashbook_service.get_cashbook_report(filters)
    return report.summary


# =============================================================================
# PETTY CASH ENDPOINTS (Scenario 25)
# =============================================================================

@router.post("/petty-cash/funds", response_model=schemas.PettyCashFundResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_CREATE))])
def open_petty_cash_fund(
    data: schemas.PettyCashFundCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Step 1: Open a new petty cash fund at a branch"""
    if data.branch_code and not validate_branch_access(current_user, data.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {data.branch_code}")
    return service.PettyCashService(db).open_fund(data, user_id=current_user.id)


@router.get("/petty-cash/funds", response_model=List[schemas.PettyCashFundResponse], dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def list_petty_cash_funds(
    branch_code: Optional[str] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """List all petty cash funds with filters"""
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    filters = schemas.PettyCashListFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        status=status_filter,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit,
    )
    return service.PettyCashService(db).list_funds(filters)


@router.get("/petty-cash/funds/{fund_id}", response_model=schemas.PettyCashFundResponse, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def get_petty_cash_fund(
    fund_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a petty cash fund by ID"""
    fund = service.PettyCashService(db).get_fund(fund_id)
    if not validate_branch_access(current_user, fund.branch_code):
        raise HTTPException(status_code=403, detail=f"Access denied to branch: {fund.branch_code}")
    return fund


@router.get("/petty-cash/funds/{fund_id}/details", response_model=schemas.PettyCashFundWithTransactions, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def get_petty_cash_fund_details(
    fund_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get a petty cash fund with all its transactions"""
    return service.PettyCashService(db).get_fund_with_transactions(fund_id)


@router.get("/petty-cash/funds/{fund_id}/summary", response_model=schemas.PettyCashSummary, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def get_petty_cash_fund_summary(
    fund_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Get summary statistics for a petty cash fund"""
    return service.PettyCashService(db).get_fund_summary(fund_id)


@router.post("/petty-cash/expenses", response_model=schemas.PettyCashTransactionResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_CREATE))])
def record_petty_cash_expense(
    data: schemas.PettyCashExpenseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Step 2: Record a petty cash expense (deducts from fund)"""
    return service.PettyCashService(db).record_expense(data, user_id=current_user.id)


@router.post("/petty-cash/replenishments", response_model=schemas.PettyCashTransactionResponse, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_CREATE))])
def replenish_petty_cash(
    data: schemas.PettyCashReplenishCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Step 3: Replenish a petty cash fund (adds to fund)"""
    return service.PettyCashService(db).replenish_fund(data, user_id=current_user.id)


@router.post("/petty-cash/funds/{fund_id}/reconcile", response_model=schemas.PettyCashReconcileResponse, dependencies=[Depends(require_permission(*Permissions.CASHBOOK_UPDATE))])
def reconcile_petty_cash(
    fund_id: int,
    data: schemas.PettyCashReconcileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Step 4: Close and reconcile a petty cash fund"""
    return service.PettyCashService(db).reconcile_and_close(fund_id, data, user_id=current_user.id)


@router.get("/petty-cash/funds/{fund_id}/transactions", response_model=List[schemas.PettyCashTransactionResponse], dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def list_petty_cash_transactions(
    fund_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all transactions for a petty cash fund"""
    return service.PettyCashService(db).list_transactions(fund_id, skip, limit)


# =============================================================================
# CSV EXPORT ENDPOINTS
# =============================================================================

@router.get("/cashbook/export-csv", summary="Export Cashbook to CSV", dependencies=[Depends(require_permission(*Permissions.CASHBOOK_VIEW))])
def export_cashbook_csv(
    branch_code: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export cashbook entries to CSV."""
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    cashbook_svc = service.CashbookService(db)
    filters = schemas.CashbookFilter(
        branch_code=scoped_branch,
        branch_codes=_scoped_branch_codes(user_branches),
        date_from=date_from,
        date_to=date_to,
    )
    report = cashbook_svc.get_cashbook_report(filters)
    return build_csv_response(
        filename="cashbook",
        headers=["Date", "Type", "Reference", "Description", "Party", "Payment Method", "Money In", "Money Out", "Balance", "Branch"],
        rows=[
            [e.transaction_date, e.entry_type, e.reference_no, e.description, e.party_name, e.payment_method, e.money_in, e.money_out, e.running_balance, e.branch_code]
            for e in report.entries
        ],
    )


@router.get("/expenses/export-csv", summary="Export Expenses to CSV", dependencies=[Depends(require_permission(*Permissions.EXPENSE_VIEW))])
def export_expenses_csv(
    branch_code: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export expenses to CSV."""
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    scoped_codes = _scoped_branch_codes(user_branches)
    query = db.query(models.Expenses)
    if scoped_branch:
        query = query.filter(models.Expenses.branch_code == scoped_branch)
    elif scoped_codes:
        query = query.filter(models.Expenses.branch_code.in_(scoped_codes))
    if date_from:
        query = query.filter(models.Expenses.created_date >= date_from)
    if date_to:
        query = query.filter(models.Expenses.created_date <= date_to)
    query = query.order_by(models.Expenses.created_date.desc())
    rows = query.limit(100000).all()
    return build_csv_response(
        filename="expenses",
        headers=["Expense No", "Category", "Amount", "Method", "Status", "Date", "Remarks", "Branch"],
        rows=[
            [r.expenses_no, r.category, r.expense_amount, r.expenses_method, r.status, r.created_date, r.remarks, r.branch_code]
            for r in rows
        ],
    )


@router.get("/bank-deposits/export-csv", summary="Export Bank Deposits to CSV", dependencies=[Depends(require_permission(*Permissions.BANK_DEPOSIT_VIEW))])
def export_bank_deposits_csv(
    branch_code: Optional[str] = None,
    db: Session = Depends(get_db),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    """Export bank deposits to CSV."""
    scoped_branch = _enforce_branch_scope(branch_code, user_branches)
    scoped_codes = _scoped_branch_codes(user_branches)
    query = db.query(models.BankDeposits)
    if scoped_branch:
        query = query.filter(models.BankDeposits.branch_code == scoped_branch)
    elif scoped_codes:
        query = query.filter(models.BankDeposits.branch_code.in_(scoped_codes))
    query = query.order_by(models.BankDeposits.deposits_date.desc())
    rows = query.limit(100000).all()
    return build_csv_response(
        filename="bank_deposits",
        headers=["Deposit No", "Date", "Amount", "Bank", "Reference", "Verified", "Branch"],
        rows=[
            [r.deposits_no, r.deposits_date, r.deposits_amount, r.bank_name, r.reference_no, r.is_verified, r.branch_code]
            for r in rows
        ],
    )
