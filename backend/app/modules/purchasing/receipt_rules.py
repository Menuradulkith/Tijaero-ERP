"""Pure receipt-quantity rules shared by purchasing and inventory (no DB access)."""

from __future__ import annotations

from decimal import ROUND_CEILING, ROUND_FLOOR, Decimal
from typing import Tuple


def receipt_limits(ordered: int, over_pct=0, under_pct=0) -> Tuple[int, int]:
    """Quantity limits of a PO line given the product's tolerances (percent).

    Returns ``(max_receivable, min_to_close)``:

    * ``max_receivable`` - the most that may be received in total (ordered + over tolerance);
    * ``min_to_close`` - the quantity at which the line counts as fully received
      (ordered - under tolerance), never below 1 for a non-empty line.

    With both tolerances 0 this is exactly ``(ordered, ordered)``.
    """
    over = Decimal(str(over_pct or 0))
    under = Decimal(str(under_pct or 0))
    qty = Decimal(int(ordered))
    max_qty = int((qty * (1 + over / 100)).to_integral_value(rounding=ROUND_FLOOR))
    min_close = int((qty * (1 - under / 100)).to_integral_value(rounding=ROUND_CEILING))
    max_qty = max(max_qty, int(ordered))
    min_close = min(max(min_close, 1 if ordered > 0 else 0), int(ordered))
    return max_qty, min_close
