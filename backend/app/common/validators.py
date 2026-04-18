"""
Reusable Pydantic validators for ERP schemas.

Apply with ``@field_validator`` to keep validation declarative and out
of the service layer:

    from pydantic import BaseModel, field_validator
    from app.common.validators import non_negative_money, positive_quantity

    class GRNItemCreate(BaseModel):
        quantity: float
        unit_price: float

        _v_qty   = field_validator("quantity")(positive_quantity)
        _v_price = field_validator("unit_price")(non_negative_money)
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any

from app.core.money import D


# ---- field validators (use with @field_validator) -----------------------


def non_negative_money(value: Any) -> Any:
    """Reject negative monetary amounts."""
    if value is None:
        return value
    if D(value) < 0:
        raise ValueError("Monetary amount cannot be negative.")
    return value


def positive_money(value: Any) -> Any:
    """Reject zero or negative monetary amounts."""
    if value is None:
        return value
    if D(value) <= 0:
        raise ValueError("Monetary amount must be greater than zero.")
    return value


def non_negative_quantity(value: Any) -> Any:
    """Reject negative quantities."""
    if value is None:
        return value
    if D(value) < 0:
        raise ValueError("Quantity cannot be negative.")
    return value


def positive_quantity(value: Any) -> Any:
    """Reject zero or negative quantities."""
    if value is None:
        return value
    if D(value) <= 0:
        raise ValueError("Quantity must be greater than zero.")
    return value


def not_in_future(value: date | None) -> date | None:
    """Reject dates strictly after today."""
    if value is None:
        return value
    if value > date.today():
        raise ValueError("Date cannot be in the future.")
    return value


def trimmed_non_empty(value: Any) -> Any:
    """Strip a string and reject empty results."""
    if value is None:
        return value
    s = str(value).strip()
    if not s:
        raise ValueError("Value cannot be empty.")
    return s


# ---- pure helpers (call directly from service layer) --------------------


def assert_amount_within(
    actual: Any, maximum: Any, *, label: str = "Amount"
) -> Decimal:
    """Raise ValueError if ``actual`` exceeds ``maximum``.  Returns the
    decimal-normalised actual value.  Useful for checks like "advance
    application cannot exceed remaining balance"."""
    a = D(actual)
    m = D(maximum)
    if a > m:
        raise ValueError(f"{label} {a} exceeds allowed maximum {m}.")
    return a
