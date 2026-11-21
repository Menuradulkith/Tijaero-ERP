"""High-signal operational alerts delivered as notifications.

These are the *important* notifications the business actually needs to act on:

* **Low stock** -- Item Catalog items (central stock: stock is keyed by item, item-only
  stock included) at or below a reorder threshold per branch, so a branch can restock
  before running out.
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
    """Notify each branch about its items at/below ``threshold`` available units.

    Counted per Item Catalog item and branch (all stock of the item, whichever product
    -- or none -- it is filed under; a row without an item counts under its product).
    One aggregated notification per branch (important, not spammy). Items with
    zero available units are not re-flagged here -- they will already have been
    flagged while running low. Returns ``{"branches": x, "products": y}`` (y = items).
    """
    from sqlalchemy import case, func

    from app.common.enums import StockStatus
    from app.db.session import SessionLocal
    from app.modules.inventory.models import SalesStock
    from app.modules.materials.models import Material
    from app.modules.products.models import Product

    from . import dispatcher as notify

    db = SessionLocal()
    branches = 0
    products = 0
    try:
        unlinked_pid = case((SalesStock.material_id.is_(None), SalesStock.product_id), else_=None)
        rows = (
            db.query(
                SalesStock.branch_code,
                func.coalesce(func.max(Material.name), func.max(Product.name)),
                func.coalesce(func.sum(SalesStock.quantity), 0).label("qty"),
            )
            .outerjoin(Material, Material.id == SalesStock.material_id)
            .outerjoin(Product, Product.id == SalesStock.product_id)
            .filter(
                SalesStock.status == StockStatus.AVAILABLE,
                SalesStock.is_active.is_(True),
            )
            .group_by(SalesStock.branch_code, SalesStock.material_id, unlinked_pid)
            .having(func.coalesce(func.sum(SalesStock.quantity), 0) <= threshold)
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
                title=f"Low Stock: {len(items)} item(s)",
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

    Notifies the invoice's branch only for items that *crossed* the threshold
    on this sale (``before > threshold >= after``), so the alert fires once per
    crossing instead of on every subsequent sale while already low. A sold product
    is counted through the Item Catalog item it sells (all stock of that item).
    """
    from sqlalchemy import func

    from app.common.enums import StockStatus
    from app.db.session import SessionLocal
    from app.modules.inventory.item_stock import stock_key_condition
    from app.modules.inventory.models import SalesStock
    from app.modules.materials.models import Material
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

        # Sold quantity per stock key: the product's item, else the product itself
        by_key: Dict[tuple, int] = {}
        for product_id, sold_qty in sold:
            if not product_id:
                continue
            material_id = db.query(Product.material_id).filter(Product.id == product_id).scalar()
            key = (material_id, None) if material_id else (None, product_id)
            by_key[key] = by_key.get(key, 0) + int(sold_qty or 0)

        flagged: List[Tuple[str, int]] = []
        for (material_id, product_id), sold_qty in by_key.items():
            available = (
                db.query(func.coalesce(func.sum(SalesStock.quantity), 0))
                .filter(
                    stock_key_condition(product_id, material_id),
                    SalesStock.branch_code == branch_code,
                    SalesStock.status == StockStatus.AVAILABLE,
                    SalesStock.is_active.is_(True),
                )
                .scalar()
                or 0
            )
            before = available + sold_qty
            # Fire only on the crossing so we don't re-notify on every later sale.
            if before > threshold >= available:
                if material_id:
                    name = db.query(Material.name).filter(Material.id == material_id).scalar()
                else:
                    name = db.query(Product.name).filter(Product.id == product_id).scalar()
                flagged.append((name or f"Item #{material_id or product_id}", available))

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


def run_material_shortage_digest() -> Dict[str, int]:
    """Notify each branch about MRP items that need to be bought or made.

    One message per branch. Returns ``{"branches": x, "items": y}``.
    """
    from collections import defaultdict

    from app.db.session import SessionLocal
    from app.modules.manufacturing.planning import MrpService

    from . import dispatcher as notify

    db = SessionLocal()
    branches = 0
    items = 0
    try:
        rows = MrpService(db).run(shortages_only=True)
        by_branch: Dict[str, List[str]] = defaultdict(list)
        for row in rows:
            branch = row.get("branch_code")
            if not branch or not row.get("suggested_quantity"):
                continue
            by_branch[branch].append(row.get("material_name") or row.get("product_name") or "Item")

        for branch_code, names in by_branch.items():
            branches += 1
            items += len(names)
            shown = ", ".join(names[:_MAX_NAMED_ITEMS])
            extra = len(names) - _MAX_NAMED_ITEMS
            if extra > 0:
                shown += f", and {extra} more"
            notify.branch(
                branch_code,
                title=f"Material shortages: {len(names)} item(s)",
                message=f"{shown} need to be purchased or produced.",
                notification_type=notify.WARNING,
                category=notify.MANUFACTURING,
                action_url="/manufacturing/mrp",
                extra_data={"digest": "daily", "items": len(names)},
            )
    except Exception:
        logger.exception("Material-shortage digest failed")
    finally:
        db.close()
    return {"branches": branches, "items": items}
