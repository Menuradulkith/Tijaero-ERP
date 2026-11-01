"""
Customer write-offs (finance blueprint phase C, IFS WriteOffCode / WriteOffCodeLimit).

Writing off takes part (or all) of a credit invoice's open balance off the
customer's account when it will not be collected (bad debt, a small leftover
difference, a settled dispute):

    Dr 5185 Bad Debts & Write-offs   (CUSTOMER_WRITE_OFF posting type)
    Cr 1110 Trade Debtors

and lowers the invoice's balance_due exactly like a settlement does (status
PAID + approval COMPLETED at zero), then refreshes the customer's available
credit. Aging subtracts posted write-offs too (credit_service). Each user may
only write off up to their group's limit; superusers have none.
"""
from __future__ import annotations

from decimal import Decimal
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import timezone as tz

from . import accounting_schemas as schemas
from .accounting_models import CustomerWriteOff, WriteOffLimit
from .posting_rules import posting_ref

CENT = Decimal("0.01")

# Reason codes: shown to users, stored on the write-off.
WRITE_OFF_REASONS: Dict[str, str] = {
    "bad_debt": "Bad debt (customer will not pay)",
    "small_balance": "Small leftover balance",
    "dispute": "Settled dispute / goodwill",
    "other": "Other",
}


def _d(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(CENT)


def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def posted_write_off_total(db: Session, invoice_id: int) -> Decimal:
    return _d(
        db.query(func.coalesce(func.sum(CustomerWriteOff.amount), 0))
        .filter(CustomerWriteOff.invoice_id == invoice_id, CustomerWriteOff.status == "posted")
        .scalar()
    )


class WriteOffService:
    def __init__(self, db: Session):
        self.db = db

    # ─── Limits ───────────────────────────────────────────────────────────
    def user_limit(self, user) -> Optional[Decimal]:
        """None = no limit (superuser); otherwise the highest group limit (0 = none allowed)."""
        if getattr(user, "is_superuser", False):
            return None
        group_ids = [g.id for g in (user.groups or [])]
        if not group_ids:
            return Decimal("0")
        top = self.db.query(func.max(WriteOffLimit.max_amount)).filter(WriteOffLimit.group_id.in_(group_ids)).scalar()
        return _d(top)

    def list_limits(self) -> List[schemas.WriteOffLimitResponse]:
        from app.auth.models import Group

        limits = {l.group_id: l for l in self.db.query(WriteOffLimit).all()}
        return [
            schemas.WriteOffLimitResponse(group_id=g.id, group_name=g.name,
                                          max_amount=_d(limits[g.id].max_amount) if g.id in limits else Decimal("0"))
            for g in self.db.query(Group).order_by(Group.name).all()
        ]

    def set_limit(self, group_id: int, max_amount: Decimal, user_id: int) -> List[schemas.WriteOffLimitResponse]:
        from app.auth.models import Group

        if self.db.query(Group.id).filter(Group.id == group_id).first() is None:
            raise _bad("Group not found", status.HTTP_404_NOT_FOUND)
        row = self.db.query(WriteOffLimit).filter(WriteOffLimit.group_id == group_id).first()
        if row is None:
            row = WriteOffLimit(group_id=group_id, created_by=user_id)
            self.db.add(row)
        row.max_amount = _d(max_amount)
        row.updated_by = user_id
        self.db.commit()
        return self.list_limits()

    # ─── Write off ────────────────────────────────────────────────────────
    def _next_no(self) -> str:
        from sqlalchemy import text

        prefix = f"WO-{tz.today().year}-"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": prefix})
        last = (
            self.db.query(CustomerWriteOff.write_off_no)
            .filter(CustomerWriteOff.write_off_no.like(f"{prefix}%"))
            .order_by(func.length(CustomerWriteOff.write_off_no).desc(), CustomerWriteOff.write_off_no.desc())
            .first()
        )
        seq = int(last[0].rsplit("-", 1)[-1]) + 1 if last else 1
        return f"{prefix}{seq:05d}"

    def _apply_to_invoice(self, invoice, delta: Decimal) -> None:
        """Lower (delta > 0) or raise (delta < 0) the open balance, with the same
        status rules as a credit settlement."""
        from app.common.enums import DocumentStatus, PaymentStatus

        balance = _d(invoice.balance_due) - delta
        if balance <= 0:
            invoice.balance_due = 0
            invoice.payment_status = PaymentStatus.PAID
            invoice.approval_status = DocumentStatus.COMPLETED
        else:
            invoice.balance_due = float(balance)
            invoice.payment_status = PaymentStatus.PARTIAL if _d(invoice.paid_amount) > 0 or balance < _d(invoice.credit_amount) else PaymentStatus.UNPAID
            if delta < 0 and invoice.approval_status == DocumentStatus.COMPLETED:
                invoice.approval_status = DocumentStatus.APPROVED

    @staticmethod
    def _check_branch(invoice, allowed_branches: Optional[List[str]]) -> None:
        if allowed_branches is not None and invoice.branch_code not in allowed_branches:
            raise _bad(f"Access denied to branch: {invoice.branch_code}", status.HTTP_403_FORBIDDEN)

    def write_off(self, data: schemas.WriteOffCreate, user, allowed_branches: Optional[List[str]] = None) -> CustomerWriteOff:
        from app.modules.customers.credit_service import customer_credit_service
        from app.modules.customers.models import CustomerCreditsSettleTransaction
        from app.modules.sales.models import Invoice

        from .gl_posting_service import GLPostingService

        if data.reason not in WRITE_OFF_REASONS:
            raise _bad(f"Reason must be one of: {', '.join(WRITE_OFF_REASONS)}.")
        amount = _d(data.amount)
        if amount <= 0:
            raise _bad("The amount must be more than zero.")
        limit = self.user_limit(user)
        if limit is not None and amount > limit:
            raise _bad(
                f"You can write off at most {limit} at a time"
                + ("" if limit > 0 else " (your user group has no write-off limit set)")
                + ". Ask a finance manager.",
                status.HTTP_403_FORBIDDEN,
            )
        invoice = self.db.query(Invoice).filter(Invoice.id == data.invoice_id).with_for_update().first()
        if invoice is None:
            raise _bad("Invoice not found", status.HTTP_404_NOT_FOUND)
        self._check_branch(invoice, allowed_branches)
        if _d(invoice.credit_amount) <= 0 or not invoice.status:
            raise _bad("Only open credit invoices can be written off.")
        if invoice.approval_status not in ("approved", "completed"):
            raise _bad(f"Invoice is {invoice.approval_status}; only approved credit invoices can be written off.")
        pending = _d(
            self.db.query(func.coalesce(func.sum(CustomerCreditsSettleTransaction.payment_amount), 0))
            .filter(CustomerCreditsSettleTransaction.invoice_id == invoice.id,
                    CustomerCreditsSettleTransaction.status == "pending_verification")
            .scalar()
        )
        open_balance = _d(invoice.balance_due) - pending
        if amount > open_balance:
            raise _bad(
                f"Only {open_balance} is still open on {invoice.invoice_no}"
                + (f" ({pending} is waiting for bank-transfer verification)" if pending else "") + "."
            )
        on = data.write_off_date or tz.today()
        if on > tz.today() or on < invoice.created_date:
            raise _bad("The write-off date must be between the invoice date and today.")

        wo = CustomerWriteOff(
            write_off_no=self._next_no(), invoice_id=invoice.id, customer_id=invoice.customer_id,
            branch_code=invoice.branch_code, write_off_date=on, amount=amount, reason=data.reason,
            notes=data.notes, status="posted", created_by=user.id,
        )
        self.db.add(wo)
        self.db.flush()
        label = WRITE_OFF_REASONS[data.reason]
        result = GLPostingService(self.db).post(
            reference_type="CustomerWriteOff", reference_id=wo.id, reference_no=wo.write_off_no,
            lines=[
                {"account_code": posting_ref("CUSTOMER_WRITE_OFF"), "debit": amount, "credit": Decimal("0"),
                 "description": f"Written off: {label} - {invoice.invoice_no}"},
                {"account_code": posting_ref("AR_TRADE"), "debit": Decimal("0"), "credit": amount,
                 "description": f"Written off - {invoice.invoice_no}"},
            ],
            entry_date=on, description=f"Customer write-off {wo.write_off_no} | {invoice.invoice_no} | {label}",
            branch_code=invoice.branch_code, user_id=user.id, transaction_type="WriteOff",
            je_prefix="JE-WOFF", source_module="finance", record_failure=False,
        )
        if not result.posted:
            self.db.rollback()
            raise _bad(f"The write-off could not be posted: {result.error_message}")
        wo.journal_entry_id = result.journal_entry.id
        self._apply_to_invoice(invoice, amount)
        customer_credit_service.refresh_customer_left_credit(self.db, invoice.customer_id)
        self.db.commit()
        self.db.refresh(wo)
        return wo

    def reverse(self, write_off_id: int, user, reason: str, allowed_branches: Optional[List[str]] = None) -> CustomerWriteOff:
        """Undo a write-off: reverse its journal entry and reopen the balance."""
        from app.modules.customers.credit_service import customer_credit_service
        from app.modules.sales.models import Invoice

        from .accounting_service import JournalEntryService

        wo = self.db.query(CustomerWriteOff).filter(CustomerWriteOff.id == write_off_id).with_for_update().first()
        if wo is None:
            raise _bad("Write-off not found", status.HTTP_404_NOT_FOUND)
        if wo.status != "posted":
            raise _bad("This write-off is already reversed.")
        invoice = self.db.query(Invoice).filter(Invoice.id == wo.invoice_id).with_for_update().first()
        self._check_branch(invoice, allowed_branches)
        if wo.journal_entry_id:
            JournalEntryService(self.db).reverse_journal_entry(
                wo.journal_entry_id, reversed_by=user.id, reason=reason or f"Write-off {wo.write_off_no} reversed",
                commit=False,
            )
        wo.status = "reversed"
        wo.reversed_at = tz.now()
        wo.reversed_by = user.id
        self._apply_to_invoice(invoice, -_d(wo.amount))
        customer_credit_service.refresh_customer_left_credit(self.db, invoice.customer_id)
        self.db.commit()
        self.db.refresh(wo)
        return wo

    def list_write_offs(self, *, customer_id: Optional[int] = None, invoice_id: Optional[int] = None,
                        branch_codes: Optional[List[str]] = None, limit: int = 200) -> List[schemas.WriteOffResponse]:
        from app.modules.customers.models import Customer
        from app.modules.sales.models import Invoice

        q = (
            self.db.query(CustomerWriteOff, Invoice.invoice_no, Customer.customer_name)
            .join(Invoice, Invoice.id == CustomerWriteOff.invoice_id)
            .join(Customer, Customer.id == CustomerWriteOff.customer_id)
        )
        if customer_id:
            q = q.filter(CustomerWriteOff.customer_id == customer_id)
        if invoice_id:
            q = q.filter(CustomerWriteOff.invoice_id == invoice_id)
        if branch_codes is not None:
            q = q.filter(CustomerWriteOff.branch_code.in_(branch_codes))
        rows = q.order_by(CustomerWriteOff.id.desc()).limit(limit).all()
        return [self.response(w, inv_no, cust) for w, inv_no, cust in rows]

    def response(self, w: CustomerWriteOff, invoice_no: Optional[str] = None,
                 customer_name: Optional[str] = None) -> schemas.WriteOffResponse:
        return schemas.WriteOffResponse(
            id=w.id, write_off_no=w.write_off_no, invoice_id=w.invoice_id, invoice_no=invoice_no,
            customer_id=w.customer_id, customer_name=customer_name, branch_code=w.branch_code,
            write_off_date=w.write_off_date, amount=w.amount, reason=w.reason,
            reason_label=WRITE_OFF_REASONS.get(w.reason, w.reason), notes=w.notes, status=w.status,
            journal_entry_id=w.journal_entry_id,
        )
