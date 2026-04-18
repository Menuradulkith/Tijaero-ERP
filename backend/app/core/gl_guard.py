"""
GL posting guards.

Any service that posts to the General Ledger must use these helpers to
guarantee:

1. **Balanced postings** — sum(debits) == sum(credits) for every JE.
2. **Idempotent postings** — a (source_type, source_id) pair posts at most
   once.  Use :func:`assert_not_already_posted` before creating the JE.

These helpers raise :class:`fastapi.HTTPException` with HTTP 400/409 so that
the failure surfaces cleanly to the API layer.
"""

from __future__ import annotations

from typing import Iterable, Mapping, Protocol

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.money import D, MONEY_QUANTUM, amounts_equal


class _LineLike(Protocol):
    debit_amount: object
    credit_amount: object


def assert_balanced(lines: Iterable[_LineLike | Mapping[str, object]]) -> None:
    """Raise HTTP 400 if the journal entry lines do not balance.

    Accepts either ORM/Pydantic objects with ``debit_amount`` /
    ``credit_amount`` attributes, or plain ``dict`` lines using the same
    keys.
    """
    total_debit = D(0)
    total_credit = D(0)
    for line in lines:
        if isinstance(line, Mapping):
            total_debit += D(line.get("debit_amount", 0))
            total_credit += D(line.get("credit_amount", 0))
        else:
            total_debit += D(getattr(line, "debit_amount", 0))
            total_credit += D(getattr(line, "credit_amount", 0))

    if not amounts_equal(total_debit, total_credit):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Journal entry is not balanced: "
                f"debits={total_debit} credits={total_credit} "
                f"(diff={total_debit - total_credit})"
            ),
        )

    if total_debit <= MONEY_QUANTUM and total_credit <= MONEY_QUANTUM:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Journal entry has zero total — refusing to post.",
        )


def assert_not_already_posted(
    db: Session,
    source_type: str,
    source_id: int,
) -> None:
    """Raise HTTP 409 if a journal entry already exists for the given
    source document.

    The check looks at ``journal_entry_lines.reference_type`` /
    ``reference_id`` because that is the canonical link the existing
    accounting model uses.
    """
    # Local import to avoid circular dependency with finance models.
    from app.modules.finance.accounting_models import JournalEntry, JournalEntryLine

    exists = (
        db.query(JournalEntry.id)
        .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
        .filter(
            JournalEntryLine.reference_type == source_type,
            JournalEntryLine.reference_id == source_id,
            JournalEntry.status != "reversed",
        )
        .first()
    )
    if exists is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A journal entry has already been posted for "
                f"{source_type}:{source_id}. Reverse the existing entry "
                f"before re-posting."
            ),
        )
