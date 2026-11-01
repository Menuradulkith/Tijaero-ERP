"""
Cheque register (finance blueprint phase C): received -> deposited -> cleared | bounced.

* A cheque taken on a sale sits in 1040 Cheques in Hand ("received") until its
  bank deposit is confirmed ("deposited", 1040 -> 1020 by the deposit posting).
* A cheque taken on a credit settlement is booked straight to 1020 by the
  settlement, so it starts as "deposited".
* "cleared" is the bank confirming the money; nothing is posted.
* "bounced" puts the debt back on the customer:
      Dr 1110 Trade Debtors / Cr 1040 (not deposited yet) or 1020 (deposited)
  - sale cheque: the invoice becomes owed (credit_amount / balance_due up,
    paid_amount down) and its pending deposit is cancelled;
  - settlement cheque: the settlement transaction is marked rejected (so the
    aging and the balance checks stop counting it) and the balance reopens.
  The customer's available credit is then refreshed.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import timezone as tz

from .posting_rules import posting_ref

CENT = Decimal("0.01")
STATUSES = ("received", "deposited", "cleared", "bounced")


def _d(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(CENT)


def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def mark_deposit_cheques_deposited(db: Session, deposit) -> None:
    """Called when a bank deposit is confirmed: its sale cheques are now in the bank."""
    from .models import ChequePayments

    for chq in db.query(ChequePayments).filter(
        ChequePayments.bank_deposit_id == deposit.id, ChequePayments.status == "received"
    ).all():
        chq.status = "deposited"
        chq.status_date = tz.today()


class ChequeService:
    def __init__(self, db: Session):
        self.db = db

    def _get(self, cheque_id: int, allowed_branches: Optional[List[str]]):
        from .models import ChequePayments

        chq = self.db.query(ChequePayments).filter(ChequePayments.id == cheque_id).with_for_update().first()
        if chq is None:
            raise _bad("Cheque not found", status.HTTP_404_NOT_FOUND)
        if allowed_branches is not None and chq.branch_code not in allowed_branches:
            raise _bad(f"Access denied to branch: {chq.branch_code}", status.HTTP_403_FORBIDDEN)
        return chq

    def mark_cleared(self, cheque_id: int, on: Optional[date], allowed_branches: Optional[List[str]] = None):
        chq = self._get(cheque_id, allowed_branches)
        if chq.status != "deposited":
            raise _bad(
                "Only a deposited cheque can be marked cleared."
                + (" Confirm its bank deposit first." if chq.status == "received" else "")
            )
        chq.status = "cleared"
        chq.status_date = on or tz.today()
        self.db.commit()
        self.db.refresh(chq)
        return chq

    def bounce(self, cheque_id: int, reason: str, on: Optional[date], user_id: int,
               allowed_branches: Optional[List[str]] = None):
        from app.common.enums import DocumentStatus, PaymentStatus
        from app.modules.customers.credit_service import customer_credit_service
        from app.modules.customers.models import CustomerCreditsSettleTransaction
        from app.modules.sales.models import Invoice

        from .gl_posting_service import GLPostingService
        from .models import BankDeposits

        chq = self._get(cheque_id, allowed_branches)
        if chq.status == "bounced":
            raise _bad("This cheque is already marked bounced.")
        if chq.payment_for not in ("Sales Invoice", "Credit Settlement"):
            raise _bad("This cheque is not linked to a sale or settlement; record its reversal with a manual journal.")
        on = on or tz.today()
        if on > tz.today():
            raise _bad("The bounce date can't be in the future.")
        invoice = (
            self.db.query(Invoice).filter(Invoice.invoice_no == chq.invoice_no).with_for_update().first()
            if chq.invoice_no else None
        )
        if invoice is None:
            raise _bad(f"Invoice {chq.invoice_no} for this cheque was not found.")
        if not invoice.customer_id:
            raise _bad("The sale has no customer to charge the bounced cheque to.")
        amount = _d(chq.amount)

        if chq.payment_for == "Sales Invoice":
            deposit = (
                self.db.query(BankDeposits).filter(BankDeposits.id == chq.bank_deposit_id).with_for_update().first()
                if chq.bank_deposit_id else None
            )
            in_bank = chq.status in ("deposited", "cleared") or (deposit is not None and deposit.verified)
            if deposit is not None and not deposit.verified:
                deposit.status = "rejected"
                deposit.returned = True
            credit_account = posting_ref("BANK") if in_bank else posting_ref("CHEQUES_IN_HAND")
            invoice.credit_amount = float(_d(invoice.credit_amount) + amount)
            invoice.paid_amount = float(max(_d(invoice.paid_amount) - amount, Decimal("0")))
            invoice.balance_due = float(_d(invoice.balance_due) + amount)
            if not invoice.due_date:
                invoice.due_date = on
        else:
            txn = (
                self.db.query(CustomerCreditsSettleTransaction)
                .filter(CustomerCreditsSettleTransaction.id == chq.settlement_transaction_id)
                .with_for_update().first()
                if chq.settlement_transaction_id else None
            )
            if txn is None:
                raise _bad("The settlement this cheque paid was not found; record the reversal with a manual journal.")
            if txn.status != "completed":
                raise _bad(f"The settlement payment is {txn.status}; nothing to reverse.")
            txn.status = "rejected"
            credit_account = posting_ref("BANK")
            invoice.paid_amount = float(max(_d(invoice.paid_amount) - amount, Decimal("0")))
            invoice.balance_due = float(_d(invoice.balance_due) + amount)

        invoice.payment_status = PaymentStatus.PARTIAL if _d(invoice.paid_amount) > 0 else PaymentStatus.UNPAID
        if invoice.approval_status == DocumentStatus.COMPLETED:
            invoice.approval_status = DocumentStatus.APPROVED

        result = GLPostingService(self.db).post(
            reference_type="ChequeBounce", reference_id=chq.id, reference_no=chq.cheque_number,
            lines=[
                {"account_code": posting_ref("AR_TRADE"), "debit": amount, "credit": Decimal("0"),
                 "description": f"Bounced cheque {chq.cheque_number} - {invoice.invoice_no}"},
                {"account_code": credit_account, "debit": Decimal("0"), "credit": amount,
                 "description": f"Bounced cheque {chq.cheque_number}: {reason}"[:500]},
            ],
            entry_date=on, description=f"Cheque bounced | {chq.cheque_number} | {invoice.invoice_no} | {reason}"[:1000],
            branch_code=chq.branch_code, user_id=user_id, transaction_type="ChequeBounce",
            je_prefix="JE-CHQB", source_module="finance", record_failure=False,
        )
        if not result.posted:
            self.db.rollback()
            raise _bad(f"The bounce could not be posted: {result.error_message}")
        chq.status = "bounced"
        chq.status_date = on
        chq.bounce_reason = reason
        chq.bounce_journal_entry_id = result.journal_entry.id
        customer_credit_service.refresh_customer_left_credit(self.db, invoice.customer_id)
        self.db.commit()
        self.db.refresh(chq)
        return chq
