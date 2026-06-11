"""
Day-End Reconciliation & GL Posting-Failure services.

* :class:`ReconciliationService` answers one question for a date/branch — *do
  the books balance?* — by combining a trial-balance check, a cashbook ↔ GL
  cash/bank reconciliation, and a posting-health check (no pending failures,
  no unposted journal entries).

* :class:`GLPostingFailureService` lists the transactional-outbox rows written
  when an automatic GL posting could not complete, and retries them through the
  central :class:`GLPostingService`.
"""

from datetime import date, datetime, time
from decimal import Decimal
from typing import List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import accounting_schemas as schemas
from .accounting_models import (
    ChartOfAccounts,
    GeneralLedger,
    GLPostingFailure,
    JournalEntry,
)
from .gl_posting_service import GLPostingService
from .models import CashbookEntryRecord

CASH_ACCOUNT_CODE = "1010"
BANK_ACCOUNT_CODE = "1020"
TOLERANCE = Decimal("0.01")


class ReconciliationService:
    def __init__(self, db: Session):
        self.db = db

    def day_end(
        self, reconciliation_date: date, branch_code: Optional[str] = None
    ) -> schemas.DayEndReconciliationResponse:
        discrepancies: List[str] = []
        warnings: List[str] = []

        # 1. Trial balance for the day -------------------------------------------------
        gl_q = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
        ).filter(GeneralLedger.posting_date == reconciliation_date)
        if branch_code:
            gl_q = gl_q.filter(GeneralLedger.branch_code == branch_code)
        gl_debit, gl_credit = gl_q.first()
        gl_total_debit = Decimal(str(gl_debit or 0))
        gl_total_credit = Decimal(str(gl_credit or 0))
        trial_balanced = abs(gl_total_debit - gl_total_credit) <= TOLERANCE
        if not trial_balanced:
            discrepancies.append(
                f"Trial balance is off by {abs(gl_total_debit - gl_total_credit)} "
                f"(debit {gl_total_debit} vs credit {gl_total_credit})."
            )

        # 2. Cash / bank reconciliation ------------------------------------------------
        gl_cash_movement = self._gl_account_movement(CASH_ACCOUNT_CODE, reconciliation_date, branch_code)
        gl_bank_movement = self._gl_account_movement(BANK_ACCOUNT_CODE, reconciliation_date, branch_code)
        gl_cash_bank_net = gl_cash_movement + gl_bank_movement

        cb_in, cb_out, cb_deposits = self._cashbook_movement(reconciliation_date, branch_code)
        cashbook_net = cb_in - cb_out

        # Identity holds whether or not bank deposits are posted as 1010↔1020 transfers.
        expected = cashbook_net + cb_deposits
        cash_difference = gl_cash_bank_net - expected
        cash_reconciled = abs(cash_difference) <= TOLERANCE
        if not cash_reconciled:
            discrepancies.append(
                f"Cash/bank movement does not reconcile with the cashbook: "
                f"GL net {gl_cash_bank_net} vs expected {expected} "
                f"(difference {cash_difference}). This usually means a transaction "
                f"posted to the cashbook did not post to the GL."
            )

        # 3. Posting health ------------------------------------------------------------
        pf_q = self.db.query(func.count(GLPostingFailure.id)).filter(
            GLPostingFailure.status == "pending"
        )
        if branch_code:
            pf_q = pf_q.filter(GLPostingFailure.branch_code == branch_code)
        posting_failures_pending = int(pf_q.scalar() or 0)
        if posting_failures_pending:
            discrepancies.append(
                f"{posting_failures_pending} automatic GL posting(s) failed and are "
                f"pending retry."
            )

        je_base = self.db.query(func.count(JournalEntry.id)).filter(
            JournalEntry.entry_date == reconciliation_date
        )
        if branch_code:
            je_base = je_base.filter(JournalEntry.branch_code == branch_code)
        unposted_je_count = int(
            je_base.filter(
                JournalEntry.status.notin_(["posted", "reversed"])
            ).scalar()
            or 0
        )
        submitted_je_count = int(
            je_base.filter(JournalEntry.status == "submitted").scalar() or 0
        )
        if unposted_je_count:
            warnings.append(
                f"{unposted_je_count} journal entry(ies) dated today are not yet posted."
            )

        is_balanced = (
            trial_balanced
            and cash_reconciled
            and posting_failures_pending == 0
            and unposted_je_count == 0
        )

        return schemas.DayEndReconciliationResponse(
            reconciliation_date=reconciliation_date,
            branch_code=branch_code,
            gl_total_debit=gl_total_debit,
            gl_total_credit=gl_total_credit,
            trial_balanced=trial_balanced,
            gl_cash_movement=gl_cash_movement,
            gl_bank_movement=gl_bank_movement,
            gl_cash_bank_net=gl_cash_bank_net,
            cashbook_money_in=cb_in,
            cashbook_money_out=cb_out,
            cashbook_net=cashbook_net,
            cashbook_bank_deposits=cb_deposits,
            cash_reconciled=cash_reconciled,
            cash_difference=cash_difference,
            posting_failures_pending=posting_failures_pending,
            unposted_je_count=unposted_je_count,
            submitted_je_count=submitted_je_count,
            is_balanced=is_balanced,
            discrepancies=discrepancies,
            warnings=warnings,
        )

    # ─── Helpers ──────────────────────────────────────────────────────────
    def _gl_account_movement(
        self, account_code: str, on_date: date, branch_code: Optional[str]
    ) -> Decimal:
        """Net (debit - credit) movement on a single account for the day."""
        q = (
            self.db.query(
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0)
                - func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
            )
            .join(ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id)
            .filter(
                ChartOfAccounts.account_code == account_code,
                GeneralLedger.posting_date == on_date,
            )
        )
        if branch_code:
            q = q.filter(GeneralLedger.branch_code == branch_code)
        return Decimal(str(q.scalar() or 0))

    def _cashbook_movement(
        self, on_date: date, branch_code: Optional[str]
    ) -> Tuple[Decimal, Decimal, Decimal]:
        """Return (money_in, money_out, bank_deposit_out) for the day."""
        start = datetime.combine(on_date, time.min)
        end = datetime.combine(on_date, time.max)

        q = self.db.query(
            func.coalesce(func.sum(CashbookEntryRecord.money_in), 0),
            func.coalesce(func.sum(CashbookEntryRecord.money_out), 0),
        ).filter(
            CashbookEntryRecord.transaction_date >= start,
            CashbookEntryRecord.transaction_date <= end,
        )
        if branch_code:
            q = q.filter(CashbookEntryRecord.branch_code == branch_code)
        money_in, money_out = q.first()

        dep_q = self.db.query(
            func.coalesce(func.sum(CashbookEntryRecord.money_out), 0)
        ).filter(
            CashbookEntryRecord.transaction_date >= start,
            CashbookEntryRecord.transaction_date <= end,
            CashbookEntryRecord.entry_type == "bank_deposit",
        )
        if branch_code:
            dep_q = dep_q.filter(CashbookEntryRecord.branch_code == branch_code)
        deposits = dep_q.scalar() or 0

        return (
            Decimal(str(money_in or 0)),
            Decimal(str(money_out or 0)),
            Decimal(str(deposits or 0)),
        )


class GLPostingFailureService:
    def __init__(self, db: Session):
        self.db = db

    def list_failures(
        self,
        status: Optional[str] = None,
        source_module: Optional[str] = None,
        branch_code: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ) -> schemas.GLPostingFailureListResponse:
        q = self.db.query(GLPostingFailure)
        if status:
            q = q.filter(GLPostingFailure.status == status)
        if source_module:
            q = q.filter(GLPostingFailure.source_module == source_module)
        if branch_code:
            q = q.filter(GLPostingFailure.branch_code == branch_code)

        total = q.count()
        pending_count = (
            self.db.query(func.count(GLPostingFailure.id))
            .filter(GLPostingFailure.status == "pending")
            .scalar()
            or 0
        )
        rows = (
            q.order_by(GLPostingFailure.last_attempt_at.desc(), GLPostingFailure.id.desc())
            .offset(skip)
            .limit(limit)
            .all()
        )
        items = [schemas.GLPostingFailureResponse.model_validate(r) for r in rows]
        return schemas.GLPostingFailureListResponse(
            items=items, total=total, pending_count=int(pending_count)
        )

    def retry(self, failure_id: int, user_id: int) -> schemas.RetryPostingFailureResponse:
        result = GLPostingService(self.db).retry_failure(failure_id, user_id)
        je_no = (
            result.journal_entry.journal_entry_no
            if result.journal_entry is not None
            else None
        )
        status = "resolved" if result.status in ("posted", "skipped_duplicate") else "failed"
        return schemas.RetryPostingFailureResponse(
            failure_id=failure_id,
            status=status,
            journal_entry_no=je_no,
            error_code=result.error_code,
            error_message=result.error_message,
        )

    def ignore(self, failure_id: int, user_id: int) -> schemas.GLPostingFailureResponse:
        from app.core import timezone as tz

        failure = (
            self.db.query(GLPostingFailure)
            .filter(GLPostingFailure.id == failure_id)
            .first()
        )
        if failure is None:
            from fastapi import HTTPException, status as http_status

            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail=f"Posting failure {failure_id} not found",
            )
        failure.status = "ignored"
        failure.resolved_at = tz.now()
        failure.resolved_by = user_id
        self.db.commit()
        self.db.refresh(failure)
        return schemas.GLPostingFailureResponse.model_validate(failure)
