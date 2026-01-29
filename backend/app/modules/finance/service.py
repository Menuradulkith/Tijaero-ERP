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
    CustomerCreditsSettleTransaction,
    Customer
)
from app.modules.sales.models import Invoice
from app.modules.purchasing.models import (
    SupplierCreditsSettle,
    SupplierCreditsSettleTransaction,
    SupplierPayment,
    SupplierAdvancePayment,
    Supplier
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
        self.db = db
    
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
    
    def list_all_advances(
        self, 
        branch_code: Optional[str] = None, 
        customer_id: Optional[int] = None
    ) -> List[CustomerAdvancePayments]:
        """List all advance payments with optional filters"""
        query = self.db.query(CustomerAdvancePayments)
        if branch_code:
            query = query.filter(CustomerAdvancePayments.branch_code == branch_code)
        if customer_id:
            query = query.filter(CustomerAdvancePayments.customer_id == customer_id)
        return query.order_by(CustomerAdvancePayments.created_date.desc()).all()

class CustomerCreditNoteService:
    def __init__(self, db: Session):
        self.repo = repository.CustomerCreditNoteRepository(db)
        self.db = db
    
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
    
    def list_all_credit_notes(self, customer_id: Optional[int] = None) -> List[CustomerCreditNotes]:
        """List all credit notes with optional customer filter"""
        query = self.db.query(CustomerCreditNotes)
        if customer_id:
            query = query.filter(CustomerCreditNotes.customer_id == customer_id)
        return query.order_by(CustomerCreditNotes.date.desc()).all()
    
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


class CashbookService:
    """
    Cashbook service that aggregates all cash movements from various sources:
    
    Money IN:
    - Invoice receipts (cash, cards, bank transfer, cheque - NOT credit_amount)
    - Customer credit settlements (late payments)
    - Customer advance payments
    
    Money OUT:
    - Supplier credit settlement payments
    - Expenses
    - Bank deposits (transfers out)
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_cashbook_report(
        self,
        filters: schemas.CashbookFilter
    ) -> schemas.CashbookReport:
        """Generate complete cashbook report with entries and summary"""
        entries: List[schemas.CashbookEntry] = []
        
        # Collect entries from all sources
        entries.extend(self._get_invoice_receipts(filters))
        entries.extend(self._get_customer_credit_settlements(filters))
        entries.extend(self._get_customer_advances(filters))
        entries.extend(self._get_supplier_credit_settlements(filters))  # Credit supplier payments
        entries.extend(self._get_supplier_direct_payments(filters))     # Direct/Non-credit supplier payments
        entries.extend(self._get_supplier_advance_payments(filters))    # Supplier advances
        entries.extend(self._get_expenses(filters))
        entries.extend(self._get_bank_deposits(filters))
        
        # Sort by transaction date (oldest first for running balance calculation)
        entries.sort(key=lambda x: x.transaction_date, reverse=False)
        
        # Calculate running balance for each entry
        running_balance = Decimal("0")  # Opening balance
        for entry in entries:
            running_balance = running_balance + entry.money_in - entry.money_out
            entry.running_balance = running_balance
        
        # Reverse for display (newest first)
        entries.reverse()
        
        # Calculate summary
        summary = self._calculate_summary(entries)
        
        return schemas.CashbookReport(
            entries=entries,
            summary=summary,
            date_from=filters.date_from,
            date_to=filters.date_to,
            branch_code=filters.branch_code,
            entry_count=len(entries)
        )
    
    def _get_invoice_receipts(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get invoice receipts - Money IN
        Uses: cash_amount, card_visa_amount, card_mastercard_amount, 
              card_amex_amount, bank_transfer_amount, cheque_amount
        Does NOT include credit_amount (that's receivable, not cash)
        """
        entries = []
        
        query = self.db.query(Invoice).join(
            Customer, Invoice.customer_id == Customer.id
        )
        
        if filters.branch_code:
            query = query.filter(Invoice.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(Invoice.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(Invoice.created_date <= filters.date_to)
        
        invoices = query.all()
        
        for inv in invoices:
            customer_name = self.db.query(Customer.customer_name).filter(
                Customer.id == inv.customer_id
            ).scalar() or f"Customer #{inv.customer_id}"
            
            # Create separate entries for each payment method with non-zero amounts
            payment_methods = [
                ("cash_amount", inv.cash_amount, "Cash"),
                ("card_visa_amount", inv.card_visa_amount, "Visa Card"),
                ("card_mastercard_amount", inv.card_mastercard_amount, "Mastercard"),
                ("card_amex_amount", inv.card_amex_amount, "Amex Card"),
                ("bank_transfer_amount", inv.bank_transfer_amount, "Bank Transfer"),
                ("cheque_amount", inv.cheque_amount, "Cheque"),
            ]
            
            for field, amount, method_label in payment_methods:
                if amount and amount > 0:
                    # Apply payment method filter if specified
                    if filters.payment_method and filters.payment_method.lower() not in method_label.lower():
                        continue
                    
                    entries.append(schemas.CashbookEntry(
                        id=inv.id,
                        entry_type="invoice_receipt",
                        transaction_date=inv.created_date_time or datetime.combine(inv.created_date, datetime.min.time()),
                        reference_no=inv.invoice_no,
                        description=f"Invoice {inv.invoice_no} - {method_label}",
                        party_name=customer_name,
                        payment_method=method_label,
                        money_in=Decimal(str(amount)),
                        money_out=Decimal("0"),
                        branch_code=inv.branch_code,
                        source_table="invoices",
                        source_id=inv.id
                    ))
        
        return entries
    
    def _get_customer_credit_settlements(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get customer credit settlement transactions - Money IN
        These are late payments from customers settling their credit
        """
        entries = []
        
        query = self.db.query(CustomerCreditsSettleTransaction).join(
            CustomerCreditsSettle,
            CustomerCreditsSettleTransaction.customer_credit_settle_id == CustomerCreditsSettle.id
        )
        
        if filters.branch_code:
            query = query.filter(CustomerCreditsSettle.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(CustomerCreditsSettleTransaction.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(CustomerCreditsSettleTransaction.created_date <= filters.date_to)
        if filters.payment_method:
            query = query.filter(CustomerCreditsSettleTransaction.payment_method.ilike(f"%{filters.payment_method}%"))
        
        transactions = query.all()
        
        for txn in transactions:
            # Get customer name through credit settle
            credit_settle = self.db.query(CustomerCreditsSettle).filter(
                CustomerCreditsSettle.id == txn.customer_credit_settle_id
            ).first()
            
            customer_name = "Unknown Customer"
            if credit_settle:
                customer_name = self.db.query(Customer.customer_name).filter(
                    Customer.id == credit_settle.customer_id
                ).scalar() or f"Customer #{credit_settle.customer_id}"
            
            entries.append(schemas.CashbookEntry(
                id=txn.id,
                entry_type="customer_credit_settle",
                transaction_date=datetime.combine(txn.created_date, datetime.min.time()) if isinstance(txn.created_date, date) else txn.created_date,
                reference_no=f"CCS-{txn.customer_credit_settle_id}-INV-{txn.invoice_id}",
                description=f"Credit Settlement for Invoice #{txn.invoice_id}",
                party_name=customer_name,
                payment_method=txn.payment_method,
                money_in=Decimal(str(txn.payment_amount)),
                money_out=Decimal("0"),
                branch_code=credit_settle.branch_code if credit_settle else None,
                source_table="customer_credits_settle_transaction",
                source_id=txn.id
            ))
        
        return entries
    
    def _get_customer_advances(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get customer advance payments - Money IN
        Payments received before invoicing
        """
        entries = []
        
        query = self.db.query(CustomerAdvancePayments)
        
        if filters.branch_code:
            query = query.filter(CustomerAdvancePayments.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(CustomerAdvancePayments.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(CustomerAdvancePayments.created_date <= filters.date_to)
        if filters.payment_method:
            query = query.filter(CustomerAdvancePayments.payment_method.ilike(f"%{filters.payment_method}%"))
        
        # Only active advances
        query = query.filter(CustomerAdvancePayments.active == True)
        
        advances = query.all()
        
        for adv in advances:
            customer_name = self.db.query(Customer.customer_name).filter(
                Customer.id == adv.customer_id
            ).scalar() or f"Customer #{adv.customer_id}"
            
            entries.append(schemas.CashbookEntry(
                id=adv.id,
                entry_type="customer_advance",
                transaction_date=datetime.combine(adv.created_date, datetime.min.time()),
                reference_no=adv.advance_payments_no,
                description=f"Advance Payment {adv.advance_payments_no}",
                party_name=customer_name,
                payment_method=adv.payment_method,
                money_in=Decimal(str(adv.payment_amount)),
                money_out=Decimal("0"),
                branch_code=adv.branch_code,
                source_table="customer_advance_payments",
                source_id=adv.id
            ))
        
        return entries
    
    def _get_supplier_credit_settlements(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get supplier credit settlement transactions - Money OUT
        Payments made to suppliers for credit purchases (pay later)
        """
        entries = []
        
        query = self.db.query(SupplierCreditsSettleTransaction).join(
            SupplierCreditsSettle,
            SupplierCreditsSettleTransaction.supplier_credit_settle_id == SupplierCreditsSettle.id
        )
        
        if filters.branch_code:
            query = query.filter(SupplierCreditsSettle.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(SupplierCreditsSettleTransaction.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(SupplierCreditsSettleTransaction.created_date <= filters.date_to)
        if filters.payment_method:
            query = query.filter(SupplierCreditsSettleTransaction.payment_method.ilike(f"%{filters.payment_method}%"))
        
        transactions = query.all()
        
        for txn in transactions:
            # Get supplier name through credit settle
            credit_settle = self.db.query(SupplierCreditsSettle).filter(
                SupplierCreditsSettle.id == txn.supplier_credit_settle_id
            ).first()
            
            supplier_name = "Unknown Supplier"
            if credit_settle:
                supplier_name = self.db.query(Supplier.company_name).filter(
                    Supplier.id == credit_settle.suppliers_id
                ).scalar() or f"Supplier #{credit_settle.suppliers_id}"
            
            entries.append(schemas.CashbookEntry(
                id=txn.id,
                entry_type="supplier_payment",
                transaction_date=txn.created_date if isinstance(txn.created_date, datetime) else datetime.combine(txn.created_date, datetime.min.time()),
                reference_no=f"SCS-{txn.supplier_credit_settle_id}-GRN-{txn.good_received_id}",
                description=f"Supplier Payment for GRN #{txn.good_received_id}",
                party_name=supplier_name,
                payment_method=txn.payment_method,
                money_in=Decimal("0"),
                money_out=Decimal(str(txn.payment_amount)),
                branch_code=credit_settle.branch_code if credit_settle else None,
                source_table="supplier_credits_settle_transaction",
                source_id=txn.id
            ))
        
        return entries
    
    def _get_supplier_direct_payments(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get direct supplier payments - Money OUT
        Immediate payments to suppliers (non-credit, cash on delivery)
        """
        entries = []
        
        query = self.db.query(SupplierPayment)
        
        if filters.branch_code:
            query = query.filter(SupplierPayment.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(SupplierPayment.payment_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(SupplierPayment.payment_date <= filters.date_to)
        if filters.payment_method:
            query = query.filter(SupplierPayment.payment_method.ilike(f"%{filters.payment_method}%"))
        
        # Only verified/completed payments (exclude pending approvals)
        query = query.filter(SupplierPayment.status.in_(["completed", "verified"]))
        
        payments = query.all()
        
        for payment in payments:
            supplier_name = self.db.query(Supplier.company_name).filter(
                Supplier.id == payment.supplier_id
            ).scalar() or f"Supplier #{payment.supplier_id}"
            
            # Build description with PO reference if available
            description = f"Direct Payment {payment.payment_no}"
            if payment.purchasing_order_id:
                description += f" - PO #{payment.purchasing_order_id}"
            if payment.payment_for:
                description += f" ({payment.payment_for})"
            
            entries.append(schemas.CashbookEntry(
                id=payment.id,
                entry_type="supplier_payment",
                transaction_date=datetime.combine(payment.payment_date, datetime.min.time()) if isinstance(payment.payment_date, date) else payment.payment_date,
                reference_no=payment.payment_no,
                description=description,
                party_name=supplier_name,
                payment_method=payment.payment_method,
                money_in=Decimal("0"),
                money_out=Decimal(str(payment.payment_amount)),
                branch_code=payment.branch_code,
                source_table="supplier_payments",
                source_id=payment.id
            ))
        
        return entries
    
    def _get_supplier_advance_payments(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get supplier advance payments - Money OUT
        Payments made to suppliers before receiving goods/services
        """
        entries = []
        
        query = self.db.query(SupplierAdvancePayment)
        
        if filters.branch_code:
            query = query.filter(SupplierAdvancePayment.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(SupplierAdvancePayment.payment_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(SupplierAdvancePayment.payment_date <= filters.date_to)
        if filters.payment_method:
            query = query.filter(SupplierAdvancePayment.payment_method.ilike(f"%{filters.payment_method}%"))
        
        advances = query.all()
        
        for adv in advances:
            supplier_name = self.db.query(Supplier.company_name).filter(
                Supplier.id == adv.supplier_id
            ).scalar() or f"Supplier #{adv.supplier_id}"
            
            entries.append(schemas.CashbookEntry(
                id=adv.id,
                entry_type="supplier_payment",
                transaction_date=datetime.combine(adv.payment_date, datetime.min.time()) if isinstance(adv.payment_date, date) else adv.payment_date,
                reference_no=adv.advance_no,
                description=f"Supplier Advance Payment {adv.advance_no}",
                party_name=supplier_name,
                payment_method=adv.payment_method,
                money_in=Decimal("0"),
                money_out=Decimal(str(adv.original_amount)),
                branch_code=adv.branch_code,
                source_table="supplier_advance_payment",
                source_id=adv.id
            ))
        
        return entries
    
    def _get_expenses(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get expenses - Money OUT
        All operating costs
        """
        entries = []
        
        query = self.db.query(models.Expenses)
        
        if filters.branch_code:
            query = query.filter(models.Expenses.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(models.Expenses.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.Expenses.created_date <= filters.date_to)
        if filters.payment_method:
            query = query.filter(models.Expenses.expenses_method.ilike(f"%{filters.payment_method}%"))
        
        expenses = query.all()
        
        for exp in expenses:
            entries.append(schemas.CashbookEntry(
                id=exp.id,
                entry_type="expense",
                transaction_date=datetime.combine(exp.created_date, datetime.min.time()),
                reference_no=exp.expenses_no,
                description=exp.remarks or f"Expense {exp.expenses_no}",
                party_name=None,
                payment_method=exp.expenses_method,
                money_in=Decimal("0"),
                money_out=Decimal(str(exp.expense_amount)),
                branch_code=exp.branch_code,
                source_table="expenses",
                source_id=exp.id
            ))
        
        return entries
    
    def _get_bank_deposits(self, filters: schemas.CashbookFilter) -> List[schemas.CashbookEntry]:
        """
        Get bank deposits - Money OUT (treated as transfer out from cash)
        Cash moved from shop to bank
        """
        entries = []
        
        query = self.db.query(models.BankDeposits)
        
        if filters.branch_code:
            query = query.filter(models.BankDeposits.branch_code == filters.branch_code)
        if filters.date_from:
            query = query.filter(models.BankDeposits.created_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.BankDeposits.created_date <= filters.date_to)
        
        deposits = query.all()
        
        for dep in deposits:
            reference = dep.invoice_no or f"DEP-{dep.id}"
            bank_info = f" to {dep.bank_name}" if dep.bank_name else ""
            
            entries.append(schemas.CashbookEntry(
                id=dep.id,
                entry_type="bank_deposit",
                transaction_date=dep.created_date if isinstance(dep.created_date, datetime) else datetime.combine(dep.created_date, datetime.min.time()),
                reference_no=reference,
                description=f"Bank Deposit{bank_info}",
                party_name=dep.bank_name,
                payment_method="Bank Deposit",
                money_in=Decimal("0"),
                money_out=Decimal(str(dep.deposits_amount)),
                branch_code=dep.branch_code,
                source_table="bank_deposits",
                source_id=dep.id
            ))
        
        return entries
    
    def _calculate_summary(self, entries: List[schemas.CashbookEntry]) -> schemas.CashbookSummary:
        """Calculate summary statistics from entries"""
        summary = schemas.CashbookSummary()
        
        for entry in entries:
            summary.total_money_in += entry.money_in
            summary.total_money_out += entry.money_out
            
            # Breakdown by type - amounts and counts
            if entry.entry_type == "invoice_receipt":
                summary.invoice_receipts += entry.money_in
                summary.invoice_receipts_count += 1
            elif entry.entry_type == "customer_credit_settle":
                summary.customer_credit_settlements += entry.money_in
                summary.customer_credit_settlements_count += 1
            elif entry.entry_type == "customer_advance":
                summary.customer_advances += entry.money_in
                summary.customer_advances_count += 1
            elif entry.entry_type == "supplier_payment":
                summary.supplier_payments += entry.money_out
                summary.supplier_payments_count += 1
            elif entry.entry_type == "expense":
                summary.expenses += entry.money_out
                summary.expenses_count += 1
            elif entry.entry_type == "bank_deposit":
                summary.bank_deposits += entry.money_out
                summary.bank_deposits_count += 1
        
        summary.net_movement = summary.total_money_in - summary.total_money_out
        summary.closing_balance = summary.opening_balance + summary.net_movement
        
        return summary

