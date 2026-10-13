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
# Largest money amount accepted on any input (same cap as app.modules.hr.inputs.MAX_MONEY).
# Keeps absurd values (1e30, NaN, Infinity) out of the ledger and the reports.
MAX_MONEY = Decimal("999999999.99")

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


def line_amounts(quantity: Number, price: Number, discount_percent: Number = 0) -> tuple[Decimal, Decimal, Decimal]:
    """Printed amounts of one document line: ``(gross, discount, line_total)``.

    The unit price is rounded to cents before and after the line discount (half-up), then multiplied by the
    quantity, so a document always foots: the sum of the rounded printed line totals equals the subtotal, and the
    result does not depend on how a line is split into per-unit rows (1 row of 7 == 7 rows of 1).
    """
    qty = D(quantity)
    unit_gross = money(price)
    unit_net = money(unit_gross * (Decimal("1") - D(discount_percent) / Decimal("100")))
    gross = money(qty * unit_gross)
    net = money(qty * unit_net)
    return gross, money(gross - net), net


# ---------------------------------------------------------------------------
# Pydantic input types for money fields on create/update schemas.
# Use these ONLY on request (input) models; response models must stay lenient
# so a legacy row never breaks a list endpoint. NaN/Infinity are rejected and
# amounts are capped at MAX_MONEY.
# ---------------------------------------------------------------------------
from typing import Annotated  # noqa: E402

from pydantic import Field  # noqa: E402

MoneyIn = Annotated[Decimal, Field(ge=0, le=MAX_MONEY, allow_inf_nan=False)]
"""A non-negative money input (0 .. MAX_MONEY)."""
PositiveMoneyIn = Annotated[Decimal, Field(gt=0, le=MAX_MONEY, allow_inf_nan=False)]
"""A strictly positive money input (0 < x <= MAX_MONEY)."""
SignedMoneyIn = Annotated[Decimal, Field(ge=-MAX_MONEY, le=MAX_MONEY, allow_inf_nan=False)]
"""A money input that may be negative (adjustments), |x| <= MAX_MONEY."""
PercentIn = Annotated[Decimal, Field(ge=0, le=100, allow_inf_nan=False)]
"""A percentage input 0..100."""
