from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal
from . import models, schemas, repository
from fastapi import HTTPException, status

from app.modules.customers.models import (
    CustomerAdvancePayments,
    CustomerCreditNotes,
    CustomerCreditsSettle,
    CustomerCreditsSettleTransaction
)

class BankDepositService:
    def __init__(self, db: Session):
        self.repo = repository.BankDepositRepository(db)
    
    def create_deposit(self, deposit: schemas.BankDepositCreate) -> models.BankDeposits:
        return self.repo.create(deposit)
    
    def get_deposit(self, deposit_id: int) -> models.BankDeposits:
        deposit = self.repo.get_by_id(deposit_id)
        if not deposit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank deposit with id {deposit_id} not found"
            )
        return deposit
    
    def list_deposits(self, filters: schemas.PaymentListFilter) -> List[models.BankDeposits]:
        return self.repo.get_all(filters)
    
    def verify_deposit(self, deposit_id: int) -> models.BankDeposits:
        deposit = self.repo.verify(deposit_id)
        if not deposit:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank deposit with id {deposit_id} not found"
            )
        return deposit

class CardPaymentService:
    def __init__(self, db: Session):
        self.repo = repository.CardPaymentRepository(db)
    
    def create_payment(self, payment: schemas.CardPaymentCreate) -> models.CardPayments:
        return self.repo.create(payment)
    
    def get_payment(self, payment_id: int) -> models.CardPayments:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Card payment with id {payment_id} not found"
            )
        return payment
    
    def list_payments(self, filters: schemas.PaymentListFilter) -> List[models.CardPayments]:
        return self.repo.get_all(filters)

class ChequePaymentService:
    def __init__(self, db: Session):
        self.repo = repository.ChequePaymentRepository(db)
    
    def create_payment(self, payment: schemas.ChequePaymentCreate) -> models.ChequePayments:
        return self.repo.create(payment)
    
    def get_payment(self, payment_id: int) -> models.ChequePayments:
        payment = self.repo.get_by_id(payment_id)
        if not payment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cheque payment with id {payment_id} not found"
            )
        return payment
    
    def list_payments(self, filters: schemas.PaymentListFilter) -> List[models.ChequePayments]:
        return self.repo.get_all(filters)

class ExpenseService:
    def __init__(self, db: Session):
        self.repo = repository.ExpenseRepository(db)
    
    def create_expense(self, expense: schemas.ExpenseCreate) -> models.Expenses:
        return self.repo.create(expense)
    
    def get_expense(self, expense_id: int) -> models.Expenses:
        expense = self.repo.get_by_id(expense_id)
        if not expense:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Expense with id {expense_id} not found"
            )
        return expense
    
    def list_expenses(self, filters: schemas.ExpenseListFilter) -> List[models.Expenses]:
        return self.repo.get_all(filters)

class CustomerAdvancePaymentService:
    def __init__(self, db: Session):
        self.repo = repository.CustomerAdvancePaymentRepository(db)
    
    def create_advance_payment(self, advance: schemas.CustomerAdvancePaymentCreate) -> CustomerAdvancePayments:
        return self.repo.create(advance)
    
    def get_advance_payment(self, advance_id: int) -> CustomerAdvancePayments:
        advance = self.repo.get_by_id(advance_id)
        if not advance:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Advance payment with id {advance_id} not found"
            )
        return advance
    
    def get_customer_advances(self, customer_id: int) -> List[CustomerAdvancePayments]:
        return self.repo.get_by_customer(customer_id)

class CustomerCreditNoteService:
    def __init__(self, db: Session):
        self.repo = repository.CustomerCreditNoteRepository(db)
    
    def create_credit_note(self, credit_note: schemas.CustomerCreditNoteCreate) -> CustomerCreditNotes:
        return self.repo.create(credit_note)
    
    def get_credit_note(self, credit_note_id: int) -> CustomerCreditNotes:
        credit_note = self.repo.get_by_id(credit_note_id)
        if not credit_note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Credit note with id {credit_note_id} not found"
            )
        return credit_note
    
    def get_customer_credit_notes(self, customer_id: int) -> List[CustomerCreditNotes]:
        return self.repo.get_by_customer(customer_id)
    
    def get_customer_credit_balance(self, customer_id: int) -> float:
        """
        Calculate customer's available credit note balance.
        Total credit issued minus credit already redeemed.
        """
        from sqlalchemy import func
        from app.modules.sales.models import Invoice
        
        db = self.repo.db
        
        # Sum of all credit notes issued to customer
        total_credit_issued = db.query(
            func.coalesce(func.sum(CustomerCreditNotes.amount), 0)
        ).filter(
            CustomerCreditNotes.customer_id == customer_id
        ).scalar() or 0
        
        # Sum of credit notes already redeemed in invoices
        total_credit_redeemed = db.query(
            func.coalesce(func.sum(Invoice.credit_note_amount), 0)
        ).filter(
            Invoice.customer_id == customer_id,
            Invoice.status == True
        ).scalar() or 0
        
        available_balance = float(total_credit_issued) - float(total_credit_redeemed)
        return max(0, available_balance)

