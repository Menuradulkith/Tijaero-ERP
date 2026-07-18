"""
Central GL Posting Gateway
==========================

A single, authoritative path for turning a set of balanced debit/credit lines
into a posted Journal Entry + General Ledger rows.

Why this exists
---------------
Previously each integration (sales, purchasing, expense, payroll) built its own
``_create_je_and_post`` with subtly different behaviour:

* Missing COA accounts were *silently skipped*, so an invoice could commit with
  zero GL entries and no alert -> the subledger and GL drift apart.
* Idempotency was checked with ``description LIKE '%Invoice ID: 12%'`` which also
  matches invoice 120, 125, 1234 ... -> a real posting could be wrongly skipped.
* Sub-cent rounding differences were "fixed" by nudging the **last real line**,
  silently distorting an unrelated account.

``GLPostingService`` centralises and corrects all of that:

* Idempotency keyed on the exact ``reference_type`` + ``reference_id`` integer
  columns (plus an optional ``marker`` to distinguish Revenue / COGS / Discount
  postings that share the same source document).
* A **missing account is a failure**, not a silent skip.
* Rounding differences (<= tolerance) post to a dedicated ``5900 Rounding
  Difference`` account as an explicit extra line.
* Closed / locked periods are refused.
* Any failure is written durably to ``gl_posting_failures`` (via an independent
  DB session so the record survives a rollback of the caller's transaction) and
  can be retried once the underlying problem is fixed.

On *success* the JE + GL rows are added to the caller's own session, preserving
atomicity with the source document.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core import timezone as tz

from .accounting_models import (
    AccountingPeriod,
    ChartOfAccounts,
    GeneralLedger,
    GLPostingFailure,
    JournalEntry,
    JournalEntryLine,
)

logger = logging.getLogger(__name__)

ROUNDING_ACCOUNT_CODE = "5900"
ROUNDING_TOLERANCE = Decimal("0.05")


# ─── Result object ───────────────────────────────────────────────────────────
@dataclass
class PostResult:
    """Outcome of a GLPostingService.post() call."""

    status: str  # posted | skipped_duplicate | skipped_empty | failed
    journal_entry: Optional[JournalEntry] = None
    error_code: Optional[str] = None  # missing_account | imbalance | period_closed | exception
    error_message: Optional[str] = None
    failure_id: Optional[int] = None

    @property
    def posted(self) -> bool:
        return self.status == "posted"

    @property
    def failed(self) -> bool:
        return self.status == "failed"


class GLPostingService:
    def __init__(self, db: Session):
        self.db = db
        self._account_cache: Dict[str, int] = {}

    # ─── Helpers ──────────────────────────────────────────────────────────
    def _get_account_id(self, account_code: str) -> Optional[int]:
        if account_code in self._account_cache:
            return self._account_cache[account_code]
        account = (
            self.db.query(ChartOfAccounts)
            .filter(
                ChartOfAccounts.account_code == account_code,
                ChartOfAccounts.is_active == True,  # noqa: E712
            )
            .first()
        )
        if account:
            self._account_cache[account_code] = account.id
            return account.id
        return None

    def _get_fiscal_period(self, entry_date: date) -> tuple:
        period = (
            self.db.query(AccountingPeriod)
            .filter(
                AccountingPeriod.start_date <= entry_date,
                AccountingPeriod.end_date >= entry_date,
            )
            .first()
        )
        if period:
            return period.fiscal_year, period.period_number
        return entry_date.year, entry_date.month

    def _period_status(self, fiscal_year: int, fiscal_period: int) -> Optional[str]:
        period = (
            self.db.query(AccountingPeriod)
            .filter(
                AccountingPeriod.fiscal_year == fiscal_year,
                AccountingPeriod.period_number == fiscal_period,
            )
            .first()
        )
        return period.status if period else None

    def _generate_je_number(self, prefix: str = "JE-AUTO") -> str:
        """Generate a unique JE number, serialised per prefix via advisory lock."""
        today = tz.today()
        full_prefix = f"{prefix}-{today.strftime('%Y%m')}-"
        self.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"),
            {"prefix": full_prefix},
        )
        last = (
            self.db.query(JournalEntry)
            .filter(JournalEntry.journal_entry_no.like(f"{full_prefix}%"))
            .order_by(JournalEntry.journal_entry_no.desc())
            .first()
        )
        if last and last.journal_entry_no.startswith(full_prefix):
            try:
                seq = int(last.journal_entry_no.split("-")[-1]) + 1
            except (ValueError, IndexError):
                seq = 1
        else:
            seq = 1
        return f"{full_prefix}{seq:04d}"

    # ─── Idempotency ──────────────────────────────────────────────────────
    def already_posted(
        self,
        reference_type: str,
        reference_id: int,
        marker: Optional[str] = None,
    ) -> Optional[JournalEntry]:
        """
        Return an existing Auto JE for this exact source document, or None.

        Keyed on the integer ``reference_id`` (no more substring collisions) and
        ``reference_type`` recorded on the JE lines. ``marker`` distinguishes
        multiple postings for one document (e.g. Revenue vs COGS vs Discount).
        """
        q = (
            self.db.query(JournalEntry)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .filter(
                JournalEntryLine.reference_type == reference_type,
                JournalEntryLine.reference_id == reference_id,
                JournalEntry.entry_type == "Auto",
            )
        )
        if marker:
            q = q.filter(JournalEntry.description.ilike(f"%{marker}%"))
        return q.first()

    # ─── Failure recording (independent session) ──────────────────────────
    def _record_failure(
        self,
        *,
        reference_type: str,
        reference_id: int,
        reference_no: Optional[str],
        source_module: str,
        transaction_type: Optional[str],
        posting_marker: Optional[str],
        entry_date: Optional[date],
        branch_code: Optional[str],
        description: Optional[str],
        lines: List[Dict[str, Any]],
        error_code: str,
        error_message: str,
        user_id: Optional[int],
    ) -> Optional[int]:
        """
        Persist a posting failure in its *own* session/transaction so it survives
        even if the caller's transaction later rolls back.
        """
        from app.db.session import SessionLocal

        payload = json.dumps(
            [
                {
                    "account_code": ln.get("account_code"),
                    "debit": str(ln.get("debit", 0)),
                    "credit": str(ln.get("credit", 0)),
                    "description": ln.get("description", ""),
                }
                for ln in lines
            ]
        )
        s = SessionLocal()
        try:
            existing = (
                s.query(GLPostingFailure)
                .filter(
                    GLPostingFailure.reference_type == reference_type,
                    GLPostingFailure.reference_id == reference_id,
                    GLPostingFailure.status == "pending",
                )
            )
            if posting_marker:
                existing = existing.filter(GLPostingFailure.posting_marker == posting_marker)
            existing = existing.first()

            if existing:
                existing.attempts = (existing.attempts or 1) + 1
                existing.error_code = error_code
                existing.error_message = error_message
                existing.last_attempt_at = tz.now()
                existing.payload = payload
                s.commit()
                return existing.id

            failure = GLPostingFailure(
                reference_type=reference_type,
                reference_id=reference_id,
                reference_no=reference_no,
                source_module=source_module,
                transaction_type=transaction_type,
                posting_marker=posting_marker,
                entry_date=entry_date,
                branch_code=branch_code,
                description=description,
                payload=payload,
                error_code=error_code,
                error_message=error_message,
                status="pending",
                attempts=1,
                last_attempt_at=tz.now(),
                created_by=user_id,
            )
            s.add(failure)
            s.commit()
            return failure.id
        except Exception:  # pragma: no cover - best-effort logging path
            s.rollback()
            logger.exception(
                "Failed to record GL posting failure for %s#%s",
                reference_type,
                reference_id,
            )
            return None
        finally:
            s.close()

    def record_post_commit_failure(
        self,
        *,
        reference_type: str,
        reference_id: int,
        error_message: str,
        reference_no: Optional[str] = None,
        source_module: str = "finance",
        transaction_type: Optional[str] = None,
        marker: Optional[str] = None,
        entry_date: Optional[date] = None,
        branch_code: Optional[str] = None,
        description: Optional[str] = None,
        lines: Optional[List[Dict[str, Any]]] = None,
        user_id: Optional[int] = None,
    ) -> Optional[int]:
        """Durably record a GL posting failure whose journal entry was built and
        flushed by :meth:`post` but whose *outer commit* then failed.

        :meth:`post` records the failures it detects itself (missing account,
        imbalance, in-flush exception) and never raises, so a failure of the
        caller's subsequent ``commit()`` — which leaves the source document
        persisted with no journal entry — is the one gap it cannot see. Calling
        this from a GL-hook ``except`` branch turns that otherwise-silent ledger
        drift into a visible, retryable ``gl_posting_failures`` row. Uses an
        independent session, so it survives the caller's rollback.
        """
        return self._record_failure(
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            source_module=source_module,
            transaction_type=transaction_type,
            posting_marker=marker,
            entry_date=entry_date,
            branch_code=branch_code,
            description=description,
            lines=lines or [],
            error_code="commit_failed",
            error_message=error_message,
            user_id=user_id,
        )

    # ─── Main entry point ─────────────────────────────────────────────────
    def post(
        self,
        *,
        reference_type: str,
        reference_id: int,
        lines: List[Dict[str, Any]],
        entry_date: date,
        description: str,
        branch_code: Optional[str],
        user_id: int,
        transaction_type: str = "Manual",
        reference_no: Optional[str] = None,
        je_prefix: str = "JE-AUTO",
        source_module: str = "finance",
        marker: Optional[str] = None,
        idempotent: bool = True,
        record_failure: bool = True,
    ) -> PostResult:
        """
        Post a set of ``{account_code, debit, credit, description}`` lines.

        Returns a :class:`PostResult`. On success the JE + GL rows are added to
        ``self.db`` (the caller commits). On failure a row may be written to
        ``gl_posting_failures`` (independent session) and a non-posted result is
        returned — the caller decides whether to continue.
        """
        try:
            # 1. Idempotency on the exact integer reference.
            if idempotent:
                # Serialise concurrent posts of the *same* source document before
                # the check-then-act. Without this lock two transactions can both
                # pass `already_posted` (under READ COMMITTED neither sees the
                # other's uncommitted JE) and double-post, because `idx_gl_reference`
                # is a plain index, not a unique constraint. The xact-scoped advisory
                # lock auto-releases on COMMIT/ROLLBACK, so the loser only proceeds
                # once the winner's JE is durable (-> skipped_duplicate) or gone.
                lock_key = f"glpost:{reference_type}:{reference_id}:{marker or ''}"
                self.db.execute(
                    text("SELECT pg_advisory_xact_lock(hashtext(:k))"),
                    {"k": lock_key},
                )
                existing = self.already_posted(reference_type, reference_id, marker)
                if existing:
                    return PostResult(status="skipped_duplicate", journal_entry=existing)

            # 2. Resolve every referenced account up-front. A missing account is
            #    a real configuration error -> failure, never a silent skip.
            missing: List[str] = []
            resolved: List[Dict[str, Any]] = []
            for line in lines:
                debit = Decimal(str(line.get("debit", 0) or 0))
                credit = Decimal(str(line.get("credit", 0) or 0))
                code = line["account_code"]
                account_id = self._get_account_id(code)
                if account_id is None:
                    # Only treat as missing if the line actually carries an amount.
                    if debit != 0 or credit != 0:
                        missing.append(code)
                    continue
                if debit == 0 and credit == 0:
                    continue
                resolved.append(
                    {
                        "account_id": account_id,
                        "account_code": code,
                        "debit": debit,
                        "credit": credit,
                        "description": line.get("description", ""),
                    }
                )

            if missing:
                msg = f"COA account(s) not found: {sorted(set(missing))}"
                logger.error("GL post failed (%s#%s): %s", reference_type, reference_id, msg)
                fid = (
                    self._record_failure(
                        reference_type=reference_type,
                        reference_id=reference_id,
                        reference_no=reference_no,
                        source_module=source_module,
                        transaction_type=transaction_type,
                        posting_marker=marker,
                        entry_date=entry_date,
                        branch_code=branch_code,
                        description=description,
                        lines=lines,
                        error_code="missing_account",
                        error_message=msg,
                        user_id=user_id,
                    )
                    if record_failure
                    else None
                )
                return PostResult(
                    status="failed",
                    error_code="missing_account",
                    error_message=msg,
                    failure_id=fid,
                )

            # 3. Nothing meaningful to post (e.g. zero discount) -> legit skip.
            if len(resolved) < 2:
                return PostResult(status="skipped_empty")

            # 4. Balance check + rounding to the dedicated account.
            total_debit = sum(l["debit"] for l in resolved)
            total_credit = sum(l["credit"] for l in resolved)
            diff = total_debit - total_credit
            if diff != 0:
                if abs(diff) <= ROUNDING_TOLERANCE:
                    rounding_id = self._get_account_id(ROUNDING_ACCOUNT_CODE)
                    if rounding_id is None:
                        msg = (
                            f"Imbalance {diff} within tolerance but rounding account "
                            f"{ROUNDING_ACCOUNT_CODE} is missing"
                        )
                        fid = (
                            self._record_failure(
                                reference_type=reference_type,
                                reference_id=reference_id,
                                reference_no=reference_no,
                                source_module=source_module,
                                transaction_type=transaction_type,
                                posting_marker=marker,
                                entry_date=entry_date,
                                branch_code=branch_code,
                                description=description,
                                lines=lines,
                                error_code="imbalance",
                                error_message=msg,
                                user_id=user_id,
                            )
                            if record_failure
                            else None
                        )
                        return PostResult(
                            status="failed",
                            error_code="imbalance",
                            error_message=msg,
                            failure_id=fid,
                        )
                    # diff > 0 => debits exceed credits => credit the rounding acct.
                    resolved.append(
                        {
                            "account_id": rounding_id,
                            "account_code": ROUNDING_ACCOUNT_CODE,
                            "debit": abs(diff) if diff < 0 else Decimal("0"),
                            "credit": diff if diff > 0 else Decimal("0"),
                            "description": "Rounding difference",
                        }
                    )
                    total_debit = sum(l["debit"] for l in resolved)
                    total_credit = sum(l["credit"] for l in resolved)
                else:
                    msg = f"Debits ({total_debit}) != credits ({total_credit}); diff={diff}"
                    logger.error("GL post failed (%s#%s): %s", reference_type, reference_id, msg)
                    fid = (
                        self._record_failure(
                            reference_type=reference_type,
                            reference_id=reference_id,
                            reference_no=reference_no,
                            source_module=source_module,
                            transaction_type=transaction_type,
                            posting_marker=marker,
                            entry_date=entry_date,
                            branch_code=branch_code,
                            description=description,
                            lines=lines,
                            error_code="imbalance",
                            error_message=msg,
                            user_id=user_id,
                        )
                        if record_failure
                        else None
                    )
                    return PostResult(
                        status="failed",
                        error_code="imbalance",
                        error_message=msg,
                        failure_id=fid,
                    )

            # 5. Period must be open.
            fiscal_year, fiscal_period = self._get_fiscal_period(entry_date)
            pstatus = self._period_status(fiscal_year, fiscal_period)
            if pstatus is not None and pstatus != "open":
                msg = f"Accounting period {fiscal_year}-{fiscal_period:02d} is '{pstatus}'"
                logger.warning("GL post blocked (%s#%s): %s", reference_type, reference_id, msg)
                fid = (
                    self._record_failure(
                        reference_type=reference_type,
                        reference_id=reference_id,
                        reference_no=reference_no,
                        source_module=source_module,
                        transaction_type=transaction_type,
                        posting_marker=marker,
                        entry_date=entry_date,
                        branch_code=branch_code,
                        description=description,
                        lines=lines,
                        error_code="period_closed",
                        error_message=msg,
                        user_id=user_id,
                    )
                    if record_failure
                    else None
                )
                return PostResult(
                    status="failed",
                    error_code="period_closed",
                    error_message=msg,
                    failure_id=fid,
                )

            # 6. Create the JE header, lines and GL rows in the caller's session.
            je = JournalEntry(
                journal_entry_no=self._generate_je_number(je_prefix),
                entry_date=entry_date,
                posting_date=entry_date,
                entry_type="Auto",
                description=description,
                total_debit=total_debit,
                total_credit=total_credit,
                status="posted",
                fiscal_year=fiscal_year,
                fiscal_period=fiscal_period,
                branch_code=branch_code,
                created_by=user_id,
                posted_by=user_id,
                posted_at=tz.now(),
            )
            self.db.add(je)
            self.db.flush()

            for i, line in enumerate(resolved, 1):
                self.db.add(
                    JournalEntryLine(
                        journal_entry_id=je.id,
                        line_number=i,
                        account_id=line["account_id"],
                        debit_amount=line["debit"],
                        credit_amount=line["credit"],
                        description=line["description"],
                        reference_type=reference_type,
                        reference_id=reference_id,
                        reference_no=reference_no,
                    )
                )
                self.db.add(
                    GeneralLedger(
                        transaction_date=entry_date,
                        posting_date=entry_date,
                        account_id=line["account_id"],
                        debit_amount=line["debit"],
                        credit_amount=line["credit"],
                        transaction_type=transaction_type,
                        reference_type=reference_type,
                        reference_id=reference_id,
                        reference_no=reference_no,
                        journal_entry_id=je.id,
                        description=line["description"],
                        branch_code=branch_code,
                        fiscal_year=fiscal_year,
                        fiscal_period=fiscal_period,
                        created_by=user_id,
                    )
                )

            # Flush the lines + GL rows now. The application session runs with
            # autoflush=False, so without this the just-posted lines stay pending
            # and the reference/marker idempotency guards (already_posted /
            # _check_already_posted) could NOT see a prior posting made earlier in
            # the same transaction — allowing a duplicate. Flushing (not
            # committing) makes the entry queryable while preserving atomicity
            # with the source document: a later rollback still discards it.
            self.db.flush()

            return PostResult(status="posted", journal_entry=je)

        except Exception as exc:  # noqa: BLE001 - we deliberately capture & record
            logger.exception(
                "Unexpected error posting GL for %s#%s", reference_type, reference_id
            )
            fid = (
                self._record_failure(
                    reference_type=reference_type,
                    reference_id=reference_id,
                    reference_no=reference_no,
                    source_module=source_module,
                    transaction_type=transaction_type,
                    posting_marker=marker,
                    entry_date=entry_date,
                    branch_code=branch_code,
                    description=description,
                    lines=lines,
                    error_code="exception",
                    error_message=str(exc),
                    user_id=user_id,
                )
                if record_failure
                else None
            )
            return PostResult(
                status="failed",
                error_code="exception",
                error_message=str(exc),
                failure_id=fid,
            )

    # ─── Retry ────────────────────────────────────────────────────────────
    def retry_failure(self, failure_id: int, user_id: int) -> PostResult:
        """
        Re-attempt a previously-failed posting using its stored payload.
        On success the failure row is marked resolved and the JE is committed.
        """
        failure = (
            self.db.query(GLPostingFailure)
            .filter(GLPostingFailure.id == failure_id)
            .first()
        )
        if failure is None:
            return PostResult(
                status="failed",
                error_code="not_found",
                error_message=f"Posting failure {failure_id} not found",
            )
        if failure.status != "pending":
            return PostResult(
                status="failed",
                error_code="not_pending",
                error_message=f"Failure {failure_id} is already '{failure.status}'",
            )

        try:
            stored_lines = json.loads(failure.payload or "[]")
        except (TypeError, ValueError):
            stored_lines = []
        lines = [
            {
                "account_code": ln.get("account_code"),
                "debit": Decimal(str(ln.get("debit", 0) or 0)),
                "credit": Decimal(str(ln.get("credit", 0) or 0)),
                "description": ln.get("description", ""),
            }
            for ln in stored_lines
        ]

        result = self.post(
            reference_type=failure.reference_type,
            reference_id=failure.reference_id,
            reference_no=failure.reference_no,
            lines=lines,
            entry_date=failure.entry_date or tz.today(),
            description=failure.description or f"Retry of {failure.reference_type}#{failure.reference_id}",
            branch_code=failure.branch_code,
            user_id=user_id,
            transaction_type=failure.transaction_type or "Manual",
            source_module=failure.source_module,
            marker=failure.posting_marker,
            idempotent=True,
            record_failure=False,
        )

        if result.status in ("posted", "skipped_duplicate"):
            failure.status = "resolved"
            failure.resolved_at = tz.now()
            failure.resolved_by = user_id
            if result.journal_entry is not None:
                failure.resolved_je_id = result.journal_entry.id
            self.db.commit()
        else:
            failure.attempts = (failure.attempts or 1) + 1
            failure.error_code = result.error_code or failure.error_code
            failure.error_message = result.error_message or failure.error_message
            failure.last_attempt_at = tz.now()
            self.db.commit()

        return result


def get_gl_posting_service(db: Session) -> GLPostingService:
    """Factory helper for dependency injection."""
    return GLPostingService(db)


def record_gl_commit_failure(db, *, reference_type: str, reference_id: int, error, **kwargs) -> None:
    """Best-effort durable record of a GL hook whose *outer commit* failed.

    Shared by every module that follows the "commit source, then post GL,
    then commit GL" hook pattern. ``GLPostingService.post`` records the
    problems it detects itself and never raises, so the one gap is a failure
    of the caller's subsequent ``commit()`` — which leaves the source document
    saved with no journal entry and nothing to flag it. Call this from the
    hook's ``except`` branch (after rollback) to turn that otherwise-silent
    ledger drift into a visible, retryable ``gl_posting_failures`` row.

    Never raises: recording the drift must not mask the business operation
    that already succeeded. ``kwargs`` are forwarded to
    :meth:`GLPostingService.record_post_commit_failure` (reference_no,
    transaction_type, marker, entry_date, branch_code, description, user_id).
    """
    try:
        GLPostingService(db).record_post_commit_failure(
            reference_type=reference_type,
            reference_id=reference_id,
            error_message=str(error),
            **kwargs,
        )
    except Exception:  # pragma: no cover - best-effort logging path
        logger.exception(
            "Failed to record GL commit-failure for %s#%s", reference_type, reference_id
        )
