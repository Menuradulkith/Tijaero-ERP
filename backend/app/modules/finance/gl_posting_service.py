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
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Dict, List, Optional

from sqlalchemy import Integer, cast, func, or_, text
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
CENT = Decimal("0.01")

# Header (parent) accounts are summary nodes and must not receive postings.
# Every hook posts to leaf accounts (4190 Miscellaneous Income, 5190
# Miscellaneous Expense, ...); add a code here only as a temporary exemption.
LEGACY_POSTABLE_HEADER_CODES: frozenset = frozenset()


def _quantize(value: Any) -> Decimal:
    """Money to 2dp, ROUND_HALF_UP - the precision the JE/GL columns store."""
    return Decimal(str(value or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def _marker_variants(marker: str) -> List[str]:
    """``marker`` plus its camel-case-split spelling (``SaleReturn`` ->
    ``Sale Return``) so JEs written before the marker was stamped into the
    description are still recognised."""
    variants = [marker]
    split = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", marker)
    if split != marker:
        variants.append(split)
    return variants


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# ─── Result object ───────────────────────────────────────────────────────────
@dataclass
class PostResult:
    """Outcome of a GLPostingService.post() call."""

    status: str  # posted | skipped_duplicate | skipped_empty | failed
    journal_entry: Optional[JournalEntry] = None
    # missing_account | header_account | imbalance | period_closed | exception
    # | not_regenerable | regeneration_failed | empty_payload (retry only)
    error_code: Optional[str] = None
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
        self._header_cache: Dict[int, bool] = {}

    # ─── Helpers ──────────────────────────────────────────────────────────
    def _is_header_account(self, account_id: int, account_code: str) -> bool:
        """An account with active child accounts is a non-postable header."""
        if account_id in self._header_cache:
            return self._header_cache[account_id]
        self._header_cache[account_id] = is_header = self._compute_is_header(account_id, account_code)
        return is_header

    def _compute_is_header(self, account_id: int, account_code: str) -> bool:
        has_child = self.db.query(
            self.db.query(ChartOfAccounts.id)
            .filter(
                ChartOfAccounts.parent_account_id == account_id,
                ChartOfAccounts.is_active == True,  # noqa: E712
            )
            .exists()
        ).scalar()
        if not has_child:
            return False
        if account_code in LEGACY_POSTABLE_HEADER_CODES:
            logger.warning(
                "GL posting to header account %s tolerated (legacy posting target; "
                "re-point the hook at a leaf account)", account_code
            )
            return False
        return True

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
        # Max of the *numeric* suffix: ordering the string DESC puts "...-10000"
        # below "...-9999", so past 9999/month the same number was re-issued.
        suffix = func.substr(JournalEntry.journal_entry_no, len(full_prefix) + 1)
        max_seq = (
            self.db.query(func.max(cast(suffix, Integer)))
            .filter(
                JournalEntry.journal_entry_no.like(f"{_escape_like(full_prefix)}%", escape="\\"),
                suffix.op("~")("^[0-9]{1,9}$"),
            )
            .scalar()
        )
        seq = (max_seq or 0) + 1
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
        multiple postings for one document (e.g. Revenue vs COGS vs Discount);
        :meth:`post` stamps it into the JE description, so the match never
        depends on how a caller happened to word its description. Reversed JEs
        are ignored so a source document can be re-posted after a reversal.
        """
        q = (
            self.db.query(JournalEntry)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .filter(
                JournalEntryLine.reference_type == reference_type,
                JournalEntryLine.reference_id == reference_id,
                JournalEntry.entry_type == "Auto",
                JournalEntry.status != "reversed",
                or_(JournalEntry.is_reversed.is_(None), JournalEntry.is_reversed == False),  # noqa: E712
            )
        )
        if marker:
            q = q.filter(
                or_(
                    *[
                        JournalEntry.description.ilike(f"%{_escape_like(v)}%", escape="\\")
                        for v in _marker_variants(marker)
                    ]
                )
            )
        return q.order_by(JournalEntry.id).first()

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
            # Exact marker match (NULL == NULL): an unmarked failure must not be
            # merged into e.g. the pending "Cancel" row of the same document.
            if posting_marker:
                existing = existing.filter(GLPostingFailure.posting_marker == posting_marker)
            else:
                existing = existing.filter(GLPostingFailure.posting_marker.is_(None))
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
        # Keep the marker literally in the description: already_posted() matches
        # on it, and a caller whose free-text description does not contain its
        # own marker (e.g. "Sale Return" vs "SaleReturn") would otherwise never
        # be found by the locked re-check -> double posting.
        if marker and marker.lower() not in (description or "").lower():
            description = f"{description} | {marker}" if description else marker

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
            headers: List[str] = []
            resolved: List[Dict[str, Any]] = []
            for line in lines:
                # Quantize to the stored precision BEFORE balancing, so the
                # balance check sees exactly what the Numeric(.., 2) columns keep.
                debit = _quantize(line.get("debit", 0))
                credit = _quantize(line.get("credit", 0))
                code = line["account_code"]
                account_id = self._get_account_id(code)
                if account_id is None:
                    # Only treat as missing if the line actually carries an amount.
                    if debit != 0 or credit != 0:
                        missing.append(code)
                    continue
                if debit == 0 and credit == 0:
                    continue
                if self._is_header_account(account_id, code):
                    headers.append(code)
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

            if headers:
                msg = f"Cannot post to header (parent) account(s): {sorted(set(headers))}"
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
                        error_code="header_account",
                        error_message=msg,
                        user_id=user_id,
                    )
                    if record_failure
                    else None
                )
                return PostResult(
                    status="failed",
                    error_code="header_account",
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
            record_cashbook_from_gl(
                self.db, reference_type=reference_type, reference_id=reference_id,
                reference_no=reference_no, entry_date=entry_date, branch_code=branch_code,
                description=description, lines=resolved,
            )

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
        Re-attempt a previously-failed posting.

        * When the source type has a regenerator, the source document is
          reloaded and its posting hook re-run (lines rebuilt from the source).
        * Otherwise a failure recorded by :meth:`post` replays the lines it
          stored.
        * A ``commit_failed`` failure (the JE was built but the caller's commit
          failed) has NO lines -> the source document is reloaded and the same
          module posting hook is re-run via :mod:`gl_regenerators`, so the lines
          are rebuilt from the source. Without a registered regenerator the
          retry fails with ``not_regenerable`` (never a silent skip).

        On success the failure row is marked resolved (with ``resolved_je_id``)
        and the JE is committed. ``skipped_empty`` is never reported as success.
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
        if not isinstance(stored_lines, list):
            stored_lines = []
        lines = [
            {
                "account_code": ln.get("account_code"),
                "debit": Decimal(str(ln.get("debit", 0) or 0)),
                "credit": Decimal(str(ln.get("credit", 0) or 0)),
                "description": ln.get("description", ""),
            }
            for ln in stored_lines
            if isinstance(ln, dict) and ln.get("account_code")
        ]

        # The source document is the authority: whenever it can be reloaded,
        # rebuild the lines from it (a stored payload can be stale, imbalanced or
        # belong to a document that no longer exists). Replay only otherwise.
        from app.modules.finance.gl_regenerators import get_regenerator

        if (
            not lines
            or failure.error_code == "commit_failed"
            or get_regenerator(failure.reference_type, failure.posting_marker) is not None
        ):
            return self._retry_by_regeneration(failure, user_id)

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
        if result.status == "skipped_empty":
            # The stored lines net to nothing postable: rebuild from the source
            # if possible, otherwise this is a failure, not a success.
            self.db.rollback()
            return self._retry_by_regeneration(failure, user_id)

        if result.status in ("posted", "skipped_duplicate"):
            self._mark_resolved(failure, user_id, result.journal_entry)
            self.db.commit()
        else:
            self.db.rollback()
            self._mark_attempt(failure, result.error_code, result.error_message)
        return result

    def _mark_resolved(self, failure: GLPostingFailure, user_id: int, je: Optional[JournalEntry]) -> None:
        failure.status = "resolved"
        failure.resolved_at = tz.now()
        failure.resolved_by = user_id
        if je is not None:
            failure.resolved_je_id = je.id

    def _mark_attempt(self, failure: GLPostingFailure, error_code: Optional[str], error_message: Optional[str]) -> None:
        """Record a failed retry attempt (own commit; caller already rolled back)."""
        try:
            self.db.refresh(failure)
        except Exception:  # pragma: no cover - row vanished
            return
        failure.attempts = (failure.attempts or 1) + 1
        failure.error_code = error_code or failure.error_code
        failure.error_message = error_message or failure.error_message
        failure.last_attempt_at = tz.now()
        self.db.commit()

    def _retry_by_regeneration(self, failure: GLPostingFailure, user_id: int) -> PostResult:
        """Rebuild the posting from its source document via the module hook."""
        from .gl_regenerators import RegenerationError, get_regenerator

        reference_type = failure.reference_type
        reference_id = failure.reference_id
        regen = get_regenerator(reference_type, failure.posting_marker)
        if regen is None:
            msg = (
                f"No stored lines and no regenerator for {reference_type}"
                f"{' (' + failure.posting_marker + ')' if failure.posting_marker else ''}"
                f"#{reference_id}; post it manually or ignore the failure"
            )
            self._mark_attempt(failure, "not_regenerable", msg)
            return PostResult(status="failed", error_code="not_regenerable", error_message=msg)

        try:
            returned = regen.regenerate(self.db, reference_id, user_id)
            self.db.commit()
        except RegenerationError as exc:
            self.db.rollback()
            self._mark_attempt(failure, exc.code, str(exc))
            return PostResult(status="failed", error_code=exc.code, error_message=str(exc))
        except Exception as exc:  # noqa: BLE001 - surfaced on the failure row
            logger.exception("GL regeneration failed for %s#%s", reference_type, reference_id)
            self.db.rollback()
            self._mark_attempt(failure, "regeneration_failed", str(exc))
            return PostResult(status="failed", error_code="regeneration_failed", error_message=str(exc))

        je = regen.verify(self.db, reference_id, returned)
        if je is None:
            msg = (
                f"Re-ran the {reference_type} posting hook but no posted journal entry exists for "
                f"{reference_type}#{reference_id} (see newer posting failures for the cause)"
            )
            # The hook's own post() may have recorded the concrete cause
            # (missing_account, period_closed, ...) onto this same pending row
            # via the independent session - keep that rather than masking it.
            self.db.refresh(failure)
            code = failure.error_code if failure.error_code not in (None, "commit_failed") else "regeneration_failed"
            if code != "regeneration_failed":
                msg = failure.error_message or msg
            self._mark_attempt(failure, code, msg)
            return PostResult(status="failed", error_code=code, error_message=msg)

        self.db.refresh(failure)
        self._mark_resolved(failure, user_id, je)
        self.db.commit()
        return PostResult(status="posted", journal_entry=je)


# ─── Cashbook from the GL ───────────────────────────────────────────────────
# The cashbook (cashbook_entries) is written ONLY from GL postings: one row per
# journal entry that moves cash (1010), bank (1020) or cheques in hand (1040).
# It records money when the ledger does (an invoice on approval, an expense on
# payment), never when a document is merely created, so the day-end
# cashbook <-> GL check reconciles by construction and the cashbook never
# shows pending, cancelled or rejected documents.
CASHBOOK_ACCOUNT_CODES = {"1010": "Cash", "1020": "Bank Transfer", "1040": "Cheque"}

# reference_type -> (entry_type shown/filtered on the cashbook page,
#                    source_table, SQL returning the party name for :id)
_CUSTOMER_OF_INVOICE = (
    "SELECT COALESCE(c.customer_name, 'Walk-in Customer') FROM invoices i "
    "LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = :id"
)
_SUPPLIER_OF_GRN = (
    "SELECT s.company_name FROM good_received_note g "
    "JOIN purchasing_orders po ON po.id = g.purchasingorders_id "
    "JOIN supplier s ON s.id = po.first_suppliers_id WHERE g.id = :id"
)
_VOUCHER_CUSTOMER = "SELECT customer_name FROM customer_gift_voucher WHERE id = :id"
_ADVANCE_SUPPLIER = (
    "SELECT s.company_name FROM supplier_advance_payment p JOIN supplier s ON s.id = p.supplier_id "
    "WHERE p.id = :id"
)
CASHBOOK_SOURCES: Dict[str, tuple] = {
    "Invoice": ("invoice_receipt", "invoices", _CUSTOMER_OF_INVOICE),
    "CustomerCreditSettlement": (
        "customer_credit_settle", "customer_credits_settle",
        "SELECT c.customer_name FROM customer_credits_settle x "
        "JOIN customers c ON c.id = x.customer_id WHERE x.id = :id",
    ),
    "GiftVoucherSale": ("voucher_sale", "customer_gift_voucher", _VOUCHER_CUSTOMER),
    "GiftVoucherRefund": ("voucher_refund", "customer_gift_voucher", _VOUCHER_CUSTOMER),
    "CustomerAdvance": (
        "customer_advance", "customer_advance_payments",
        "SELECT c.customer_name FROM customer_advance_payments a "
        "JOIN customers c ON c.id = a.customer_id WHERE a.id = :id",
    ),
    "SaleReturn": (
        "sale_return_refund", "sale_return",
        "SELECT COALESCE(c.customer_name, 'Walk-in Customer') FROM sale_return r "
        "JOIN invoices i ON i.id = r.invoice_id LEFT JOIN customers c ON c.id = i.customer_id "
        "WHERE r.id = :id",
    ),
    "BankDeposit": ("bank_deposit", "bank_deposits", None),
    "Expense": ("expense", "expenses", "SELECT vendor_name FROM expenses WHERE id = :id"),
    "SupplierPayment": (
        "supplier_payment", "supplier_payments",
        "SELECT s.company_name FROM supplier_payments p JOIN supplier s ON s.id = p.supplier_id WHERE p.id = :id",
    ),
    "SupplierAdvance": ("supplier_payment", "supplier_advance_payment", _ADVANCE_SUPPLIER),
    "SupplierAdvanceReturn": ("supplier_advance_return", "supplier_advance_payment", _ADVANCE_SUPPLIER),
    "CreditSettle": (
        "supplier_payment", "supplier_credits_settle",
        "SELECT s.company_name FROM supplier_credits_settle x JOIN supplier s ON s.id = x.suppliers_id "
        "WHERE x.id = :id",
    ),
    "GRN": ("grn_payment", "good_received_note", _SUPPLIER_OF_GRN),
    "PurchaseReturn": (
        "purchase_return", "purchasing_returns",  # legacy label (table: purchasing_return)
        "SELECT s.company_name FROM purchasing_return r JOIN good_received_note g ON g.id = r.goodreceivednote_id "
        "JOIN purchasing_orders po ON po.id = g.purchasingorders_id "
        "JOIN supplier s ON s.id = po.first_suppliers_id WHERE r.id = :id",
    ),
    "LandedCost": (
        "landed_cost", "landed_cost_vouchers",
        "SELECT s.company_name FROM landed_cost_vouchers v JOIN supplier s ON s.id = v.supplier_id WHERE v.id = :id",
    ),
    "PayrollBatch": ("payroll", "payroll_batches", None),
    "StatutoryPayment": ("statutory_payment", "payroll_batches", None),
    "Reimbursement": (
        "reimbursement", "reimbursements",
        "SELECT e.name_with_initials FROM reimbursements r JOIN employees e ON e.employee_id = r.employee_id "
        "WHERE r.id = :id",
    ),
    "CommissionPayment": ("commission_payment", "commission_payments", None),
    "PettyCashFund": ("petty_cash", "petty_cash_funds", None),
    "PettyCashTransaction": ("petty_cash", "petty_cash_transactions", None),
    "JE": ("journal_entry", "journal_entries", None),
}


def _snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


def cashbook_source(reference_type: str) -> tuple:
    """(entry_type, source_table, party_sql) for a GL reference type."""
    return CASHBOOK_SOURCES.get(
        reference_type, (f"gl_{_snake(reference_type)}"[:50], f"gl:{reference_type}"[:100], None)
    )


def _cashbook_method(account_code: Optional[str], description: Optional[str]) -> Optional[str]:
    method = CASHBOOK_ACCOUNT_CODES.get(account_code or "")
    if method == "Bank Transfer" and "card" in (description or "").lower():
        return "Card"
    return method


def record_cashbook_from_gl(
    db: Session,
    *,
    reference_type: str,
    reference_id: Optional[int],
    reference_no: Optional[str],
    entry_date: date,
    branch_code: Optional[str],
    description: Optional[str],
    lines: List[Dict[str, Any]],
) -> None:
    """Write the cashbook row for one GL posting.

    ``lines`` are ``{account_code, debit, credit, description?}``. The row holds
    the posting's net cash/bank movement; postings that move no cash write
    nothing. A bank deposit (cash/cheques -> bank, net zero) is recorded as the
    money leaving the till, which the day-end identity adds back. Runs in a
    savepoint and never raises: the GL posting stands even if the cashbook
    insert fails (logged; day-end flags the gap)."""
    net = Decimal("0")
    till_out = Decimal("0")
    by_method: Dict[str, Decimal] = {}
    for ln in lines:
        method = _cashbook_method(ln.get("account_code"), ln.get("description"))
        if method is None:
            continue
        amount = _quantize(ln.get("debit", 0)) - _quantize(ln.get("credit", 0))
        net += amount
        if method in ("Cash", "Cheque") and amount < 0:
            till_out -= amount
        by_method[method] = by_method.get(method, Decimal("0")) + abs(amount)
    entry_type, source_table, party_sql = cashbook_source(reference_type)
    if entry_type == "bank_deposit":
        money_in, money_out, method = Decimal("0"), till_out, "Bank Deposit"
    elif net == 0:
        return
    else:
        money_in = net if net > 0 else Decimal("0")
        money_out = -net if net < 0 else Decimal("0")
        method = max(by_method, key=by_method.get)
    if money_in == 0 and money_out == 0:
        return
    from datetime import datetime as _dt

    savepoint = db.begin_nested()
    try:
        party = None
        if party_sql and reference_id:
            party = db.execute(text(party_sql), {"id": reference_id}).scalar()
        db.execute(
            text(
                "SELECT fn_insert_cashbook_entry(:entry_type, :transaction_date, :source_table, "
                ":source_id, :reference_no, :description, :party_name, :payment_method, "
                ":money_in, :money_out, :branch_code)"
            ),
            {
                "entry_type": entry_type,
                "transaction_date": _dt.combine(entry_date, _dt.min.time()),
                "source_table": source_table,
                "source_id": reference_id or 0,
                "reference_no": (reference_no or f"{reference_type}#{reference_id}")[:200],
                "description": description,
                "party_name": str(party)[:200] if party else None,
                "payment_method": method,
                "money_in": money_in,
                "money_out": money_out,
                "branch_code": branch_code,
            },
        )
        savepoint.commit()
    except Exception:  # noqa: BLE001 - the GL posting must not fail for this
        savepoint.rollback()
        logger.exception("Cashbook entry from GL failed for %s#%s", reference_type, reference_id)

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
