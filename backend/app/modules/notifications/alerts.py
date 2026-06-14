"""High-signal operational alerts delivered as notifications.

These are the *important* notifications the business actually needs to act on:

* **Low stock** -- products at or below a reorder threshold, so a branch can
  restock before running out.
* **Outstanding payments** -- unpaid customer invoices (receivables) that need
  to be collected.

Every function runs in its own short-lived session and never raises (the same
contract as :mod:`app.modules.notifications.dispatcher`). Delivery is always
**branch-scoped** -- a branch's users only ever see their own branch's alerts,
and each alert is aggregated into a single message per branch so the inbox
stays high-signal instead of one row per item.

There is no scheduler in the project, so the digests are exposed as admin
endpoints (``POST /notifications/alerts/...``) and can be wired to a cron later.
:func:`check_low_stock_after_invoice` is the real-time hook fired right after a
sale is recorded.
"""

from __future__ import annotations

import logging
from typing import Dict, List, Tuple

logger = logging.getLogger(__name__)

# There is no per-product reorder level in the schema, so a single configurable
# threshold is used for the whole system.
DEFAULT_LOW_STOCK_THRESHOLD = 5

# Cap the number of product names inlined into a digest message before we
# collapse the rest into an "and N more" suffix.
_MAX_NAMED_ITEMS = 5

# Landing pages for the notification click-through.
_LOW_STOCK_URL = "/product-catalogs"
_OUTSTANDING_URL = "/finance/customer-payments"


def _format_items(items: List[Tuple[str, int]]) -> str:
    """Render ``[(name, qty), ...]`` as ``"A (1), B (2), and 3 more"``."""
    named = ", ".join(f"{name} ({qty})" for name, qty in items[:_MAX_NAMED_ITEMS])
    extra = len(items) - _MAX_NAMED_ITEMS
    if extra > 0:
        named += f", and {extra} more"
    return named


def run_low_stock_digest(
    threshold: int = DEFAULT_LOW_STOCK_THRESHOLD,
) -> Dict[str, int]:
    """Notify each branch about its products at/below ``threshold`` available units.

    One aggregated notification per branch (important, not spammy). Products with
    zero available units are not re-flagged here -- they will already have been
    flagged while running low. Returns ``{"branches": x, "products": y}``.
    """
    from sqlalchemy import func

    from app.common.enums import StockStatus
    from app.db.session import SessionLocal
    from app.modules.inventory.models import SalesStock
    from app.modules.products.models import Product

    from . import dispatcher as notify

    db = SessionLocal()
    branches = 0
    products = 0
    try:
        rows = (
            db.query(
                SalesStock.branch_code,
                Product.name,
                func.count(SalesStock.id).label("qty"),
            )
            .join(Product, Product.id == SalesStock.product_id)
            .filter(
                SalesStock.status == StockStatus.AVAILABLE,
                SalesStock.is_active.is_(True),
            )
            .group_by(SalesStock.branch_code, Product.id, Product.name)
            .having(func.count(SalesStock.id) <= threshold)
            .all()
        )

        by_branch: Dict[str, List[Tuple[str, int]]] = {}
        for branch_code, name, qty in rows:
            if not branch_code:
                continue
            by_branch.setdefault(branch_code, []).append((name, int(qty)))

        for branch_code, items in by_branch.items():
            items.sort(key=lambda it: it[1])  # lowest stock first
            branches += 1
            products += len(items)
            notify.branch(
                branch_code,
                title=f"Low Stock: {len(items)} product(s)",
                message=(
                    f"{_format_items(items)} at or below {threshold} units. "
                    "Reorder soon."
                ),
                notification_type=notify.WARNING,
                category=notify.INVENTORY,
                action_url=_LOW_STOCK_URL,
                extra_data={
                    "threshold": threshold,
                    "products": [{"name": n, "available": q} for n, q in items],
                },
            )
    except Exception:  # pragma: no cover - defensive, must never bubble up
        logger.exception("Low-stock digest failed")
    finally:
        db.close()
    return {"branches": branches, "products": products}


def check_low_stock_after_invoice(
    invoice_id: int, threshold: int = DEFAULT_LOW_STOCK_THRESHOLD
) -> None:
    """Real-time low-stock check fired right after an invoice is recorded.

    Notifies the invoice's branch only for products that *crossed* the threshold
    on this sale (``before > threshold >= after``), so the alert fires once per
    crossing instead of on every subsequent sale while already low.
    """
    from sqlalchemy import func

    from app.common.enums import StockStatus
    from app.db.session import SessionLocal
    from app.modules.inventory.models import SalesStock
    from app.modules.products.models import Product
    from app.modules.sales.models import Invoice, InvoiceItems

    from . import dispatcher as notify

    db = SessionLocal()
    try:
        invoice = db.get(Invoice, invoice_id)
        if invoice is None:
            return
        branch_code = invoice.branch_code

        sold = (
            db.query(
                InvoiceItems.product_id,
                func.coalesce(func.sum(InvoiceItems.quantity), 0),
            )
            .filter(InvoiceItems.invoice_id == invoice_id)
            .group_by(InvoiceItems.product_id)
            .all()
        )

        flagged: List[Tuple[str, int]] = []
        for product_id, sold_qty in sold:
            if not product_id:
                continue
            available = (
                db.query(func.count(SalesStock.id))
                .filter(
                    SalesStock.product_id == product_id,
                    SalesStock.branch_code == branch_code,
                    SalesStock.status == StockStatus.AVAILABLE,
                    SalesStock.is_active.is_(True),
                )
                .scalar()
                or 0
            )
            before = available + int(sold_qty or 0)
            # Fire only on the crossing so we don't re-notify on every later sale.
            if before > threshold >= available:
                name = (
                    db.query(Product.name)
                    .filter(Product.id == product_id)
                    .scalar()
                    or f"Product #{product_id}"
                )
                flagged.append((name, available))

        if flagged:
            flagged.sort(key=lambda it: it[1])
            notify.branch(
                branch_code,
                title="Low Stock Alert",
                message=(
                    f"{_format_items(flagged)} now at or below {threshold} "
                    "units after a sale. Reorder soon."
                ),
                notification_type=notify.WARNING,
                category=notify.INVENTORY,
                action_url=_LOW_STOCK_URL,
                extra_data={
                    "threshold": threshold,
                    "invoice_id": invoice_id,
                    "products": [{"name": n, "available": q} for n, q in flagged],
                },
            )
    except Exception:  # pragma: no cover - defensive, must never bubble up
        logger.exception(
            "Low-stock post-invoice check failed (invoice_id=%s)", invoice_id
        )
    finally:
        db.close()


def run_outstanding_payments_digest() -> Dict[str, object]:
    """Notify each branch about its unpaid customer invoices (receivables).

    One aggregated notification per branch carrying the invoice count and total
    outstanding amount. Returns
    ``{"branches": x, "invoices": y, "total_outstanding": z}``.
    """
    from decimal import Decimal

    from sqlalchemy import func

    from app.db.session import SessionLocal
    from app.modules.sales.models import Invoice

    from . import dispatcher as notify

    db = SessionLocal()
    branches = 0
    invoices = 0
    total_outstanding = Decimal("0")
    try:
        rows = (
            db.query(
                Invoice.branch_code,
                func.count(Invoice.id).label("cnt"),
                func.coalesce(func.sum(Invoice.balance_due), 0).label("total"),
            )
            .filter(Invoice.balance_due > 0)
            .group_by(Invoice.branch_code)
            .all()
        )

        for branch_code, cnt, total in rows:
            if not branch_code:
                continue
            amount = Decimal(str(total or 0))
            branches += 1
            invoices += int(cnt)
            total_outstanding += amount
            notify.branch(
                branch_code,
                title=f"Outstanding Payments: {int(cnt)} invoice(s)",
                message=(
                    f"Rs. {amount:,.2f} outstanding across {int(cnt)} "
                    "invoice(s). Follow up on collections."
                ),
                notification_type=notify.WARNING,
                category=notify.FINANCE,
                action_url=_OUTSTANDING_URL,
                extra_data={
                    "invoice_count": int(cnt),
                    "total_outstanding": float(amount),
                },
            )
    except Exception:  # pragma: no cover - defensive, must never bubble up
        logger.exception("Outstanding-payments digest failed")
    finally:
        db.close()
    return {
        "branches": branches,
        "invoices": invoices,
        "total_outstanding": float(total_outstanding),
    }
