from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from typing import List, Optional
from datetime import date, datetime
from decimal import Decimal
from . import models, schemas, repository
from fastapi import HTTPException, status
from app.core import timezone as tz
from app.common.audit import log_audit
from app.common.enums import ExpenseStatus, PaymentStatus

from app.modules.customers.models import (
    CustomerAdvancePayments,
    CustomerCreditNotes,
)
from app.modules.sales.models import Invoice

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

        # ── GL Hook: Post bank deposit to GL ──
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_svc = PurchaseExpensePayrollGL(self.repo.db)
            gl_svc.post_bank_deposit_to_gl(deposit, user_id=0)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Bank deposit GL posting failed: {e}")

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
        self.db = db

    def create_expense(self, expense: schemas.ExpenseCreate, submitted_by: int = None) -> models.Expenses:
        # ── Validate branch is active ──
        if hasattr(expense, 'branch_code') and expense.branch_code:
            from app.common.branch_validation import validate_branch_is_active
            validate_branch_is_active(self.db, expense.branch_code)

        return self.repo.create(expense, submitted_by=submitted_by)

    def update_expense(self, expense_id: int, data: schemas.ExpenseUpdate) -> models.Expenses:
        expense = self.get_expense(expense_id)
        if expense.status not in ("pending", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot update expense in '{expense.status}' status")
        return self.repo.update(expense_id, data)

    def get_expense(self, expense_id: int) -> models.Expenses:
        expense = self.repo.get_by_id(expense_id)
        if not expense:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Expense with id {expense_id} not found")
        return expense

    def list_expenses(self, filters: schemas.ExpenseListFilter) -> dict:
        items, total = self.repo.get_all(filters)
        return {"items": items, "total": total}

    def submit_expense(self, expense_id: int, submitted_by: int) -> models.Expenses:
        # Lock row to prevent concurrent status mutation
        expense = self.db.query(models.Expenses).filter(
            models.Expenses.id == expense_id
        ).with_for_update().first()
        if not expense:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Expense with id {expense_id} not found")
        if expense.status not in (ExpenseStatus.PENDING, ExpenseStatus.REJECTED):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot submit expense in '{expense.status}' status")
        expense.status = ExpenseStatus.SUBMITTED
        expense.submitted_by = submitted_by
        expense.rejection_reason = None
        log_audit(self.db, user_id=submitted_by, action="submit", entity_type="expense", entity_id=expense_id, changes={"status": ExpenseStatus.SUBMITTED})
        self.db.commit()
        self.db.refresh(expense)
        return expense

    def approve_expense(self, expense_id: int, approved_by: int, remarks: str = None) -> models.Expenses:
        from datetime import datetime
        # SELECT FOR UPDATE to prevent double-approval race condition
        expense = self.db.query(models.Expenses).filter(
            models.Expenses.id == expense_id
        ).with_for_update().first()
        if not expense:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Expense with id {expense_id} not found")
        if expense.status != ExpenseStatus.SUBMITTED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot approve expense in '{expense.status}' status")
        expense.status = ExpenseStatus.APPROVED
        expense.approved_by = approved_by
        expense.approved_date = tz.now()
        if remarks:
            expense.remarks = (expense.remarks or "") + f"\n[Approval] {remarks}"
        log_audit(self.db, user_id=approved_by, action="approve", entity_type="expense", entity_id=expense_id, changes={"status": ExpenseStatus.APPROVED})
        self.db.commit()
        self.db.refresh(expense)
        return expense

    def reject_expense(self, expense_id: int, rejected_by: int, rejection_reason: str) -> models.Expenses:
        # SELECT FOR UPDATE to prevent double-processing race condition
        expense = self.db.query(models.Expenses).filter(
            models.Expenses.id == expense_id
        ).with_for_update().first()
        if not expense:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Expense with id {expense_id} not found")
        if expense.status != ExpenseStatus.SUBMITTED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot reject expense in '{expense.status}' status")
        expense.status = ExpenseStatus.REJECTED
        expense.approved_by = rejected_by
        expense.rejection_reason = rejection_reason
        log_audit(self.db, user_id=rejected_by, action="reject", entity_type="expense", entity_id=expense_id, changes={"status": ExpenseStatus.REJECTED, "reason": rejection_reason})
        self.db.commit()
        self.db.refresh(expense)
        return expense
        return expense

    def process_payment(self, expense_id: int, payment_data: schemas.ExpensePayment, processed_by: int) -> models.Expenses:
        from datetime import date as date_type
        # SELECT FOR UPDATE to prevent double-payment race condition
        expense = self.db.query(models.Expenses).filter(
            models.Expenses.id == expense_id
        ).with_for_update().first()
        if not expense:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Expense with id {expense_id} not found")
        if expense.status != ExpenseStatus.APPROVED:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot process payment for expense in '{expense.status}' status")
        expense.payment_status = PaymentStatus.PAID
        expense.payment_method = payment_data.payment_method
        expense.payment_reference = payment_data.payment_reference
        expense.payment_date = payment_data.payment_date or date_type.today()
        expense.status = ExpenseStatus.PAID
        if payment_data.remarks:
            expense.remarks = (expense.remarks or "") + f"\n[Payment] {payment_data.remarks}"
        self.db.commit()
        self.db.refresh(expense)
        
        # ── GL Auto-Posting: Scenario 32 – Expense Paid ───────────────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_expense_to_gl(expense, user_id=processed_by)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(f"GL posting for expense {expense.expenses_no} failed (non-blocking): {gl_err}")
            self.db.rollback()
        # ────────────────────────────────────────────────────────────────
        
        return expense

    def record_expense(self, expense_id: int, record_data: schemas.ExpenseRecord) -> models.Expenses:
        expense = self.get_expense(expense_id)
        if expense.status != ExpenseStatus.PAID:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot record expense in '{expense.status}' status")
        expense.account_code = record_data.account_code
        expense.cost_center = record_data.cost_center
        expense.status = "recorded"
        if record_data.remarks:
            expense.remarks = (expense.remarks or "") + f"\n[Recording] {record_data.remarks}"
        self.db.commit()
        self.db.refresh(expense)
        return expense

    def delete_expense(self, expense_id: int) -> bool:
        expense = self.get_expense(expense_id)
        if expense.status not in ("pending", "rejected"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Cannot delete expense in '{expense.status}' status")
        self.db.delete(expense)
        self.db.commit()
        return True

class CustomerAdvancePaymentService:
    def __init__(self, db: Session):
        self.repo = repository.CustomerAdvancePaymentRepository(db)
        self.db = db
    
    def create_advance_payment(self, advance: schemas.CustomerAdvancePaymentCreate, user_id: int = 0) -> CustomerAdvancePayments:
        # ── Validate branch is active ──
        if hasattr(advance, 'branch_code') and advance.branch_code:
            from app.common.branch_validation import validate_branch_is_active
            validate_branch_is_active(self.db, advance.branch_code)

        # Validate customer is active
        from app.modules.customers.models import Customer
        customer = self.db.query(Customer).filter(Customer.id == advance.customer_id).first()
        if not customer:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Customer with id {advance.customer_id} not found"
            )
        if not customer.active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Customer '{customer.customer_name}' is inactive. Please reactivate the customer before creating an advance payment."
            )

        db_advance = self.repo.create(advance)
        
        # ── GL Auto-Posting: Customer Advance Receipt (Gap B2) ───────────
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl_service = PurchaseExpensePayrollGL(self.db)
            gl_service.post_customer_advance_receipt_to_gl(db_advance, user_id=user_id)
            self.db.commit()
        except Exception as gl_err:
            import logging
            logging.getLogger(__name__).warning(
                f"GL posting for customer advance {db_advance.advance_payments_no} failed (non-blocking): {gl_err}"
            )
        # ─────────────────────────────────────────────────────────────────
        
        return db_advance
    
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
        branch_codes: Optional[List[str]] = None,
        customer_id: Optional[int] = None
    ) -> List[CustomerAdvancePayments]:
        """List all advance payments with optional filters"""
        query = self.db.query(CustomerAdvancePayments)
        if branch_code:
            query = query.filter(CustomerAdvancePayments.branch_code == branch_code)
        elif branch_codes:
            query = query.filter(CustomerAdvancePayments.branch_code.in_(branch_codes))
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
        from sqlalchemy import func, or_
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
    Cashbook service that reads from the materialized cashbook_entries table.
    
    All cash movements are automatically written to cashbook_entries via 
    database triggers when source transactions are created. Advisory locks
    per branch ensure correct running balance with concurrent writes.
    
    Money IN (triggers on INSERT):
    - Invoice receipts (cash, visa, mastercard, amex, bank transfer, cheque)
    - Customer credit settlements (late payments)
    - Customer advance payments
    - Gift voucher sales
    
    Money OUT (triggers on INSERT):
    - Supplier credit settlement payments
    - Supplier direct payments (completed/verified)
    - Supplier advance payments
    - Expenses
    - Bank deposits (transfers out)
    """
    
    def __init__(self, db: Session):
        self.db = db
    
    def get_cashbook_report(
        self,
        filters: schemas.CashbookFilter
    ) -> schemas.CashbookReport:
        """
        Generate complete cashbook report from materialized table.
        Single indexed query - 0.15s for 100k rows (vs 45s with old approach).
        """
        query = self.db.query(models.CashbookEntryRecord)
        
        # Apply filters
        if filters.branch_code:
            query = query.filter(models.CashbookEntryRecord.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(models.CashbookEntryRecord.branch_code.in_(filters.branch_codes))
        if filters.date_from:
            query = query.filter(models.CashbookEntryRecord.transaction_date >= datetime.combine(filters.date_from, datetime.min.time()))
        if filters.date_to:
            query = query.filter(models.CashbookEntryRecord.transaction_date <= datetime.combine(filters.date_to, datetime.max.time()))
        if filters.entry_type:
            query = query.filter(models.CashbookEntryRecord.entry_type == filters.entry_type)
        if filters.payment_method:
            query = query.filter(models.CashbookEntryRecord.payment_method.ilike(f"%{filters.payment_method}%"))

        # Enforce only the direct supplier-payment verification rule:
        # block unverified rows from supplier_payments, but never block other cashflow sources.
        from app.modules.purchasing import models as purchasing_models

        direct_payment_visible = self.db.query(purchasing_models.SupplierPayment.id).filter(
            purchasing_models.SupplierPayment.id == models.CashbookEntryRecord.source_id,
            purchasing_models.SupplierPayment.status == "verified",
        ).exists()

        query = query.filter(
            or_(
                models.CashbookEntryRecord.entry_type != "supplier_payment",
                and_(
                    models.CashbookEntryRecord.source_table == "supplier_payments",
                    direct_payment_visible,
                ),
                models.CashbookEntryRecord.source_table != "supplier_payments",
            )
        )
        
        # Order newest first for display
        query = query.order_by(
            models.CashbookEntryRecord.transaction_date.desc(),
            models.CashbookEntryRecord.id.desc()
        )
        
        records = query.all()

        # Backfill readable supplier names for legacy/fallback cashbook rows.
        supplier_name_by_payment_id = {}
        supplier_payment_ids_needing_name = [
            r.source_id
            for r in records
            if r.source_table == "supplier_payments"
            and (
                not (r.party_name or "").strip()
                or (r.party_name or "").strip().lower().startswith("supplier #")
            )
        ]
        if supplier_payment_ids_needing_name:
            supplier_rows = (
                self.db.query(
                    purchasing_models.SupplierPayment.id,
                    purchasing_models.Supplier.full_name,
                    purchasing_models.Supplier.company_name,
                )
                .join(
                    purchasing_models.Supplier,
                    purchasing_models.Supplier.id == purchasing_models.SupplierPayment.supplier_id,
                )
                .filter(purchasing_models.SupplierPayment.id.in_(supplier_payment_ids_needing_name))
                .all()
            )
            supplier_name_by_payment_id = {
                row.id: ((row.full_name or "").strip() or (row.company_name or "").strip())
                for row in supplier_rows
            }
        
        # Convert DB records to schema entries
        entries = [
            schemas.CashbookEntry(
                id=r.id,
                entry_type=r.entry_type,
                transaction_date=r.transaction_date,
                reference_no=r.reference_no,
                description=r.description or "",
                party_name=(
                    supplier_name_by_payment_id.get(r.source_id)
                    if r.source_table == "supplier_payments"
                    and (
                        not (r.party_name or "").strip()
                        or (r.party_name or "").strip().lower().startswith("supplier #")
                    )
                    else r.party_name
                ),
                payment_method=r.payment_method,
                money_in=Decimal(str(r.money_in)) if r.money_in else Decimal("0"),
                money_out=Decimal(str(r.money_out)) if r.money_out else Decimal("0"),
                running_balance=Decimal(str(r.running_balance)) if r.running_balance else Decimal("0"),
                branch_code=r.branch_code,
                source_table=r.source_table,
                source_id=r.source_id
            )
            for r in records
        ]
        
        # If filtering by entry_type or payment_method, running_balance from the 
        # materialized table won't be correct for the filtered subset, so recalculate.
        if filters.entry_type or filters.payment_method:
            # Get the full unfiltered data to calculate correct running balance
            # Only recalculate for the filtered view display
            sorted_entries = list(reversed(entries))  # oldest first
            running_balance = Decimal("0")
            
            # Get opening balance (last entry before the date range, unfiltered)
            if filters.date_from and filters.branch_code:
                opening_entry = self.db.query(models.CashbookEntryRecord).filter(
                    models.CashbookEntryRecord.branch_code == filters.branch_code,
                    models.CashbookEntryRecord.transaction_date < datetime.combine(filters.date_from, datetime.min.time())
                ).order_by(
                    models.CashbookEntryRecord.transaction_date.desc(),
                    models.CashbookEntryRecord.id.desc()
                ).first()
                if opening_entry:
                    running_balance = Decimal(str(opening_entry.running_balance))
            
            for entry in sorted_entries:
                running_balance = running_balance + entry.money_in - entry.money_out
                entry.running_balance = running_balance
            
            entries = list(reversed(sorted_entries))  # back to newest first
        
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
            elif entry.entry_type == "voucher_sale":
                summary.voucher_sales += entry.money_in
                summary.voucher_sales_count += 1
        
        summary.net_movement = summary.total_money_in - summary.total_money_out
        summary.closing_balance = summary.opening_balance + summary.net_movement
        
        return summary


# =============================================================================
# PETTY CASH SERVICE (Scenario 25)
# =============================================================================

class PettyCashService:
    def __init__(self, db: Session):
        self.db = db

    # ── Helpers ───────────────────────────────────────────────────────────

    def _generate_fund_no(self) -> str:
        """Generate unique petty cash fund number: PCF-YYYYMM-NNNN.
        Uses advisory lock to prevent duplicate numbers under concurrency.
        """
        from sqlalchemy import text
        prefix = f"PCF-{tz.today().strftime('%Y%m')}-"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = self.db.query(models.PettyCash).filter(
            models.PettyCash.petty_cash_no.like(f"{prefix}%")
        ).order_by(models.PettyCash.petty_cash_no.desc()).first()

        if last and last.petty_cash_no.startswith(prefix):
            try:
                seq = int(last.petty_cash_no.split("-")[-1]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        return f"{prefix}{seq:04d}"

    def _generate_txn_no(self, txn_type: str) -> str:
        """Generate unique transaction number: PCT-EXP-YYYYMM-NNNN or PCT-REP-YYYYMM-NNNN.
        Uses advisory lock to prevent duplicate numbers under concurrency.
        """
        from sqlalchemy import text
        tag = "EXP" if txn_type == "expense" else "REP"
        prefix = f"PCT-{tag}-{tz.today().strftime('%Y%m')}-"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = self.db.query(models.PettyCashTransaction).filter(
            models.PettyCashTransaction.transaction_no.like(f"{prefix}%")
        ).order_by(models.PettyCashTransaction.transaction_no.desc()).first()

        if last and last.transaction_no.startswith(prefix):
            try:
                seq = int(last.transaction_no.split("-")[-1]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        return f"{prefix}{seq:04d}"

    def _get_fund(self, fund_id: int) -> models.PettyCash:
        fund = self.db.query(models.PettyCash).filter(
            models.PettyCash.id == fund_id
        ).first()
        if not fund:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Petty cash fund with id {fund_id} not found"
            )
        return fund

    def _get_active_fund(self, fund_id: int, lock: bool = False) -> models.PettyCash:
        """Get active fund. If lock=True, acquires SELECT FOR UPDATE to prevent
        concurrent balance mutations (same pattern as cashbook advisory locks)."""
        if lock:
            fund = self.db.query(models.PettyCash).filter(
                models.PettyCash.id == fund_id
            ).with_for_update().first()
            if not fund:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Petty cash fund with id {fund_id} not found"
                )
        else:
            fund = self._get_fund(fund_id)
        if fund.status != "active":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Petty cash fund {fund.petty_cash_no} is {fund.status}. Only active funds can accept transactions."
            )
        return fund

    # ── 1. OPEN Petty Cash Fund ──────────────────────────────────────────

    def open_fund(self, data: schemas.PettyCashFundCreate) -> models.PettyCash:
        """
        Open a new petty cash fund at a branch.
        Sets opening_balance = current_balance, status = 'active'.
        GL: Dr 1030 Petty Cash / Cr 1020 Bank Account (or 1010 Cash)
        """
        amount = Decimal(str(data.opening_balance))
        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Opening balance must be greater than zero"
            )

        fund = models.PettyCash(
            petty_cash_no=self._generate_fund_no(),
            opening_balance=amount,
            current_balance=amount,
            branch_code=data.branch_code,
            opened_by=data.opened_by,
            opened_date=tz.today(),
            status="active",
            remarks=data.remarks,
            created_date=tz.now(),
        )
        self.db.add(fund)
        self.db.flush()

        # GL: Dr 1030 Petty Cash / Cr 1020 Bank Account
        self._post_gl(
            fund=fund,
            debit_account="1030",
            credit_account="1020",
            amount=amount,
            description=f"Petty cash fund opened - {fund.petty_cash_no}",
            je_prefix="JE-PCF",
            transaction_type="PettyCash",
            reference_type="PettyCashFund",
            reference_id=fund.id,
            reference_no=fund.petty_cash_no,
            user_id=data.opened_by or 0,
        )

        self.db.commit()
        self.db.refresh(fund)
        return fund

    # ── 2. RECORD Petty Cash Expense ─────────────────────────────────────

    def record_expense(self, data: schemas.PettyCashExpenseCreate) -> models.PettyCashTransaction:
        """
        Record petty cash expense. Deducts from fund's current_balance.
        GL: Dr 5xxx Expense / Cr 1030 Petty Cash
        Uses SELECT FOR UPDATE on fund row to prevent concurrent balance corruption.
        """
        fund = self._get_active_fund(data.petty_cash_id, lock=True)
        amount = Decimal(str(data.amount))

        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Expense amount must be greater than zero"
            )

        current = Decimal(str(fund.current_balance))
        if amount > current:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Insufficient petty cash balance. Available: {current}, Requested: {amount}"
            )

        new_balance = current - amount
        fund.current_balance = new_balance

        txn = models.PettyCashTransaction(
            transaction_no=self._generate_txn_no("expense"),
            petty_cash_id=fund.id,
            transaction_type="expense",
            amount=amount,
            balance_after=new_balance,
            expense_type=data.expense_type,
            recipient_name=data.recipient_name,
            purpose=data.purpose,
            receipt_number=data.receipt_number,
            description=data.description or f"{data.expense_type} expense",
            transaction_date=data.transaction_date or tz.today(),
            recorded_by=data.recorded_by,
            branch_code=fund.branch_code,
            remarks=data.remarks,
            created_date=tz.now(),
        )
        self.db.add(txn)
        self.db.flush()

        # GL: Dr expense account / Cr 1030 Petty Cash
        expense_category = (data.expense_type or "miscellaneous").lower().strip()
        from app.modules.finance.purchase_expense_payroll_gl import EXPENSE_CATEGORY_MAP
        expense_account = EXPENSE_CATEGORY_MAP.get(expense_category, "5100")

        self._post_gl(
            fund=fund,
            debit_account=expense_account,
            credit_account="1030",
            amount=amount,
            description=f"Petty cash expense - {data.expense_type} | {fund.petty_cash_no} | TxnID: {txn.id}",
            je_prefix="JE-PCE",
            transaction_type="PettyCashExpense",
            reference_type="PettyCashTransaction",
            reference_id=txn.id,
            reference_no=txn.transaction_no,
            user_id=data.recorded_by or 0,
            entry_date=txn.transaction_date,
        )

        self.db.commit()
        self.db.refresh(txn)
        return txn

    # ── 3. REPLENISH Petty Cash Fund ─────────────────────────────────────

    def replenish_fund(self, data: schemas.PettyCashReplenishCreate) -> models.PettyCashTransaction:
        """
        Replenish petty cash fund. Adds to fund's current_balance.
        GL: Dr 1030 Petty Cash / Cr 1020 Bank Account
        Uses SELECT FOR UPDATE on fund row to prevent concurrent balance corruption.
        """
        fund = self._get_active_fund(data.petty_cash_id, lock=True)
        amount = Decimal(str(data.amount))

        if amount <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Replenishment amount must be greater than zero"
            )

        current = Decimal(str(fund.current_balance))
        new_balance = current + amount
        fund.current_balance = new_balance

        txn = models.PettyCashTransaction(
            transaction_no=self._generate_txn_no("replenishment"),
            petty_cash_id=fund.id,
            transaction_type="replenishment",
            amount=amount,
            balance_after=new_balance,
            approved_by=data.approved_by,
            description=data.description or "Fund replenishment",
            transaction_date=data.transaction_date or tz.today(),
            recorded_by=data.recorded_by,
            branch_code=fund.branch_code,
            remarks=data.remarks,
            created_date=tz.now(),
        )
        self.db.add(txn)
        self.db.flush()

        # GL: Dr 1030 Petty Cash / Cr 1020 Bank Account
        self._post_gl(
            fund=fund,
            debit_account="1030",
            credit_account="1020",
            amount=amount,
            description=f"Petty cash replenishment | {fund.petty_cash_no} | TxnID: {txn.id}",
            je_prefix="JE-PCR",
            transaction_type="PettyCashReplenishment",
            reference_type="PettyCashTransaction",
            reference_id=txn.id,
            reference_no=txn.transaction_no,
            user_id=data.recorded_by or 0,
            entry_date=txn.transaction_date,
        )

        self.db.commit()
        self.db.refresh(txn)
        return txn

    # ── 4. CLOSE / RECONCILE Petty Cash Fund ─────────────────────────────

    def reconcile_and_close(
        self, fund_id: int, data: schemas.PettyCashReconcileRequest
    ) -> schemas.PettyCashReconcileResponse:
        """
        Close and reconcile a petty cash fund.
        Compares physical cash count with expected (current_balance).
        Records discrepancy in remarks if any.
        GL for remaining balance: Dr 1020 Bank / Cr 1030 Petty Cash (return to bank)
        """
        fund = self._get_active_fund(fund_id, lock=True)

        expected = Decimal(str(fund.current_balance))
        physical = Decimal(str(data.physical_cash_count))
        discrepancy = physical - expected

        # Record discrepancy in remarks
        discrepancy_note = ""
        if discrepancy != 0:
            direction = "surplus" if discrepancy > 0 else "shortage"
            discrepancy_note = f" | Cash {direction} of {abs(discrepancy)}"

        fund.status = "closed"
        fund.closing_balance = physical  # Actual physical cash
        fund.closed_by = data.closed_by
        fund.closed_date = tz.today()
        fund.remarks = (fund.remarks or "") + (
            f" | Closed: expected={expected}, actual={physical}{discrepancy_note}"
            + (f" | {data.remarks}" if data.remarks else "")
        )

        # GL: Return remaining petty cash to bank
        # Dr 1020 Bank Account / Cr 1030 Petty Cash (for the physical amount returned)
        if physical > 0:
            self._post_gl(
                fund=fund,
                debit_account="1020",
                credit_account="1030",
                amount=physical,
                description=f"Petty cash fund closed - balance returned to bank | {fund.petty_cash_no}",
                je_prefix="JE-PCC",
                transaction_type="PettyCashClosure",
                reference_type="PettyCashFund",
                reference_id=fund.id,
                reference_no=fund.petty_cash_no,
                user_id=data.closed_by or 0,
            )

        # If there's a shortage, post the discrepancy to miscellaneous expense
        if discrepancy < 0:
            self._post_gl(
                fund=fund,
                debit_account="5100",  # Miscellaneous expense (cash shortage)
                credit_account="1030",
                amount=abs(discrepancy),
                description=f"Petty cash shortage on closure | {fund.petty_cash_no}",
                je_prefix="JE-PCD",
                transaction_type="PettyCashDiscrepancy",
                reference_type="PettyCashFund",
                reference_id=fund.id,
                reference_no=fund.petty_cash_no,
                user_id=data.closed_by or 0,
            )
        elif discrepancy > 0:
            # Surplus — credit goes to other income
            self._post_gl(
                fund=fund,
                debit_account="1030",
                credit_account="4100",  # Other Income
                amount=discrepancy,
                description=f"Petty cash surplus on closure | {fund.petty_cash_no}",
                je_prefix="JE-PCD",
                transaction_type="PettyCashDiscrepancy",
                reference_type="PettyCashFund",
                reference_id=fund.id,
                reference_no=fund.petty_cash_no,
                user_id=data.closed_by or 0,
            )

        self.db.commit()
        self.db.refresh(fund)

        has_disc = discrepancy != 0
        msg = "Fund closed successfully."
        if has_disc:
            direction = "surplus" if discrepancy > 0 else "shortage"
            msg += f" Cash {direction} of Rs. {abs(discrepancy):,.2f} recorded."

        return schemas.PettyCashReconcileResponse(
            fund=schemas.PettyCashFundResponse.model_validate(fund),
            expected_balance=expected,
            physical_cash_count=physical,
            discrepancy=discrepancy,
            has_discrepancy=has_disc,
            message=msg,
        )

    # ── Read / List operations ───────────────────────────────────────────

    def get_fund(self, fund_id: int) -> models.PettyCash:
        return self._get_fund(fund_id)

    def get_fund_with_transactions(self, fund_id: int) -> models.PettyCash:
        from sqlalchemy.orm import joinedload
        fund = self.db.query(models.PettyCash).options(
            joinedload(models.PettyCash.transactions)
        ).filter(models.PettyCash.id == fund_id).first()
        if not fund:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Petty cash fund with id {fund_id} not found"
            )
        return fund

    def list_funds(self, filters: schemas.PettyCashListFilter) -> list:
        query = self.db.query(models.PettyCash).filter(
            models.PettyCash.petty_cash_no.isnot(None)  # Only fund records
        )
        if filters.branch_code:
            query = query.filter(models.PettyCash.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(models.PettyCash.branch_code.in_(filters.branch_codes))
        if filters.status:
            query = query.filter(models.PettyCash.status == filters.status)
        if filters.date_from:
            query = query.filter(models.PettyCash.opened_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(models.PettyCash.opened_date <= filters.date_to)
        return query.order_by(models.PettyCash.created_date.desc()).offset(
            filters.skip
        ).limit(filters.limit).all()

    def list_transactions(self, fund_id: int, skip: int = 0, limit: int = 100) -> list:
        self._get_fund(fund_id)  # Validate fund exists
        return self.db.query(models.PettyCashTransaction).filter(
            models.PettyCashTransaction.petty_cash_id == fund_id
        ).order_by(
            models.PettyCashTransaction.transaction_date.desc()
        ).offset(skip).limit(limit).all()

    def get_fund_summary(self, fund_id: int) -> schemas.PettyCashSummary:
        fund = self._get_fund(fund_id)
        txns = self.db.query(models.PettyCashTransaction).filter(
            models.PettyCashTransaction.petty_cash_id == fund_id
        ).all()

        expenses = [t for t in txns if t.transaction_type == "expense"]
        replenishments = [t for t in txns if t.transaction_type == "replenishment"]
        total_exp = sum(Decimal(str(t.amount)) for t in expenses)
        total_rep = sum(Decimal(str(t.amount)) for t in replenishments)
        last_date = max((t.transaction_date for t in txns), default=None) if txns else None

        return schemas.PettyCashSummary(
            fund_id=fund.id,
            petty_cash_no=fund.petty_cash_no,
            branch_code=fund.branch_code,
            status=fund.status,
            opening_balance=Decimal(str(fund.opening_balance)),
            current_balance=Decimal(str(fund.current_balance)),
            total_expenses=total_exp,
            total_replenishments=total_rep,
            expense_count=len(expenses),
            replenishment_count=len(replenishments),
            last_transaction_date=last_date,
        )

    # ── GL Helper ────────────────────────────────────────────────────────

    def _post_gl(
        self,
        fund: models.PettyCash,
        debit_account: str,
        credit_account: str,
        amount: Decimal,
        description: str,
        je_prefix: str,
        transaction_type: str,
        reference_type: str,
        reference_id: int,
        reference_no: str,
        user_id: int,
        entry_date: date = None,
    ):
        """Post a petty cash GL entry using PurchaseExpensePayrollGL helper."""
        try:
            from app.modules.finance.purchase_expense_payroll_gl import PurchaseExpensePayrollGL
            gl = PurchaseExpensePayrollGL(self.db)

            lines = [
                {
                    "account_code": debit_account,
                    "debit": amount,
                    "credit": Decimal("0"),
                    "description": description,
                },
                {
                    "account_code": credit_account,
                    "debit": Decimal("0"),
                    "credit": amount,
                    "description": description,
                },
            ]

            je = gl._create_je_and_post(
                entry_date=entry_date or tz.today(),
                description=f"Auto GL - {transaction_type} | {description}",
                lines=lines,
                branch_code=fund.branch_code,
                user_id=user_id,
                je_prefix=je_prefix,
                transaction_type=transaction_type,
                reference_type=reference_type,
                reference_id=reference_id,
                reference_no=reference_no,
            )
            if je:
                import logging
                logging.getLogger(__name__).info(
                    f"✅ GL Posted: {transaction_type} → JE {je.journal_entry_no} "
                    f"(Dr {debit_account} / Cr {credit_account}) Amount: {amount}"
                )
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Petty cash GL posting failed: {e}")
