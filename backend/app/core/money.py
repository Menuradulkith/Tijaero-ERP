"""
Money / Decimal helpers.

All monetary calculations in TijaeroERP MUST use ``Decimal`` (never ``float``)
and pass through these helpers at I/O boundaries to guarantee a consistent
2-decimal precision.

Usage
-----
    from app.core.money import D, money, money_sum, format_money

    total = money_sum(line.unit_price * line.quantity for line in items)
    invoice.grand_total = money(total)
    print(format_money(invoice.grand_total))   # "1,234.56"
"""

from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Iterable, Union

# Standard money precision for the whole ERP (LKR uses 2 decimals).
MONEY_QUANTUM = Decimal("0.01")
ZERO = Decimal("0.00")

Number = Union[int, float, str, Decimal, None]


def D(value: Number) -> Decimal:
    """Convert any numeric / stringy / None value into a ``Decimal``.

    ``None`` becomes ``Decimal("0")``.  Floats are routed through ``str``
    to avoid binary-float artefacts (``Decimal(0.1) == 0.10000000…``).
    """
    if value is None or value == "":
        return Decimal("0")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float):
        return Decimal(str(value))
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f"Cannot convert {value!r} to Decimal")


def money(value: Number) -> Decimal:
    """Quantize a value to standard money precision (2 dp, banker-safe)."""
    return D(value).quantize(MONEY_QUANTUM, rounding=ROUND_HALF_UP)


def money_sum(values: Iterable[Number]) -> Decimal:
    """Sum a sequence of values as ``Decimal`` and quantize the result."""
    total = Decimal("0")
    for v in values:
        total += D(v)
    return money(total)


def is_zero(value: Number, tolerance: Decimal = MONEY_QUANTUM) -> bool:
    """True if value is within ±tolerance of zero."""
    return abs(D(value)) <= tolerance


def amounts_equal(a: Number, b: Number, tolerance: Decimal = MONEY_QUANTUM) -> bool:
    """Compare two monetary amounts with rounding tolerance."""
    return abs(D(a) - D(b)) <= tolerance


def format_money(value: Number, currency: str | None = None) -> str:
    """Render a money value as a human-readable string.

    ``format_money(1234.5)``           -> ``"1,234.50"``
    ``format_money(1234.5, "Rs.")``    -> ``"Rs. 1,234.50"``
    """
    s = f"{money(value):,.2f}"
    return f"{currency} {s}" if currency else s
