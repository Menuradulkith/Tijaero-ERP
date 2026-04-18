"""
Accounting-period guard.

ERP standard: no financial transaction may be posted into a closed or
locked accounting period.  Call :func:`assert_period_open` from any
service method that records a financial event (invoice, payment,
expense, GRN GL hook, journal entry, …).
"""

from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session


def get_period_for_date(db: Session, target_date: date):
    """Return the AccountingPeriod row covering ``target_date`` (or None)."""
    from app.modules.finance.accounting_models import AccountingPeriod

    return (
        db.query(AccountingPeriod)
        .filter(
            AccountingPeriod.start_date <= target_date,
            AccountingPeriod.end_date >= target_date,
        )
        .first()
    )


def assert_period_open(
    db: Session,
    target_date: date,
    *,
    document: str = "transaction",
) -> None:
    """Reject the operation if the period covering ``target_date`` is
    closed or locked.

    If no period row exists for the date the check is permissive — the
    organisation may not have configured fiscal periods yet.  This keeps
    the guard safe to add to existing flows without breaking them.
    """
    period = get_period_for_date(db, target_date)
    if period is None:
        return  # No fiscal calendar configured — allow.

    if period.status != "open":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Cannot record {document} on {target_date.isoformat()}: "
                f"accounting period '{period.period_name}' is "
                f"{period.status}."
            ),
        )


def is_period_open(db: Session, target_date: Optional[date]) -> bool:
    """Non-raising variant — useful for UI gating."""
    if target_date is None:
        return True
    period = get_period_for_date(db, target_date)
    return period is None or period.status == "open"
