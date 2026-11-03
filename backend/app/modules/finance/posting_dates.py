"""One date rule for every document that posts to the ledger.

A document dated in the future, or inside a closed accounting period, used to
be saved anyway; its journal then failed quietly (period closed) or landed in a
year with no periods (2030, 2999). Check the date up front instead, so the user
gets a plain message and nothing half-saved.

Post-dated cheques are not documents of this kind: their cheque date may be in
the future; the receipt/payment that holds them still uses this rule.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core import timezone as tz


def check_posting_date(db: Session, value: Optional[date | datetime], label: str = "Date") -> None:
    """Raise 400 if ``value`` is in the future or in a closed accounting period."""
    if value is None:
        return
    day = value.date() if isinstance(value, datetime) else value
    if day > tz.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{label} can't be in the future ({day:%d %b %Y}).",
        )
    # Every period covering the day (fiscal years may overlap): one closed or
    # locked period is enough to refuse, so an overlapping open one can't be
    # used to post around a close.
    for period in covering_periods(db, day):
        if period.status != "open":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"The accounting period for {day:%d %b %Y} is {period.status}. "
                    "Use a date in an open period, or ask a finance manager to reopen it."
                ),
            )


def covering_periods(db: Session, day: date) -> list:
    """Accounting periods whose range covers ``day``, oldest first (deterministic)."""
    from .accounting_models import AccountingPeriod

    return (
        db.query(AccountingPeriod)
        .filter(AccountingPeriod.start_date <= day, AccountingPeriod.end_date >= day)
        .order_by(AccountingPeriod.start_date, AccountingPeriod.id)
        .all()
    )


def require_open_period(db: Session, day: date, label: str = "Date"):
    """Like check_posting_date's period part, but a period must exist for the day.

    Used where a person posts straight to the ledger (manual / opening / recurring
    journals and their reversals): those must land in a set-up fiscal year, not
    in a year with no periods (1990, 2099). Returns the period to post into."""
    periods = covering_periods(db, day)
    if not periods:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"No accounting period covers {label.lower()} {day:%d %b %Y}. "
                "Generate the fiscal year's periods first, or use a date in an open period."
            ),
        )
    for period in periods:
        if period.status != "open":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"The accounting period for {day:%d %b %Y} is {period.status}. "
                    "Use a date in an open period, or ask a finance manager to reopen it."
                ),
            )
    return periods[0]
