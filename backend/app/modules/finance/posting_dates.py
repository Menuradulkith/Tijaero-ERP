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
    from .gl_posting_service import GLPostingService

    gl = GLPostingService(db)
    fiscal_year, fiscal_period = gl._get_fiscal_period(day)
    period_status = gl._period_status(fiscal_year, fiscal_period)
    if period_status is not None and period_status != "open":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The accounting period for {day:%d %b %Y} is {period_status}. "
                "Use a date in an open period, or ask a finance manager to reopen it."
            ),
        )
