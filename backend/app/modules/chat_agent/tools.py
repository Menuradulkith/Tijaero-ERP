"""
Chat Agent — tool registry.

Every tool wraps an EXISTING service call — no business logic is duplicated
here. Each tool declares the same (resource, action) permission tuple used by
the corresponding REST endpoint, and the registry is filtered by the caller's
permissions BEFORE the model ever sees the tool list.

Branch scoping: every branch-aware tool resolves the caller's allowed branch
codes (``User.branches``). Superusers see everything; restricted users are
force-filtered to their branches and get a ToolError if they ask for another
branch explicitly.

Write tools are two-phase: ``validate()`` runs when the model calls the tool
(producing a preview + pending action), ``execute()`` only runs after the
user clicks Approve in the UI — where the permission is re-checked.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Callable, Dict, List, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.auth.dependencies import get_user_branch_codes, validate_branch_access
from app.auth.models import User
from app.auth.rbac import Permissions, user_has_permission
from app.core import timezone as tz

logger = logging.getLogger(__name__)


class ToolError(Exception):
    """Raised by tool handlers; message is relayed to the LLM (never a 500)."""


# ─── serialization helpers ─────────────────────────────────────────────────

def json_ready(obj: Any) -> Any:
    """Recursively convert Decimals/dates/models into JSON-safe values."""
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {str(k): json_ready(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [json_ready(v) for v in obj]
    if hasattr(obj, "value") and isinstance(getattr(obj, "value"), str):  # Enum
        return obj.value
    return str(obj)


def _fmt_money(v: Any) -> str:
    try:
        return f"Rs. {float(v or 0):,.2f}"
    except (TypeError, ValueError):
        return str(v)


# ─── branch scoping helpers ────────────────────────────────────────────────

def _allowed_branches(user: User) -> Optional[List[str]]:
    """None = unrestricted (superuser). Otherwise explicit allow-list."""
    codes = get_user_branch_codes(user)
    return None if not codes and user.is_superuser else codes


def _resolve_branch_filter(
    user: User, requested: Optional[str]
) -> Tuple[Optional[str], Optional[List[str]]]:
    """
    Returns (single_branch, branch_list) to apply. Raises ToolError when the
    user explicitly asks for a branch they cannot access.
    """
    allowed = _allowed_branches(user)
    if requested:
        if allowed is not None and requested not in allowed:
            raise ToolError(
                f"You don't have access to branch '{requested}'. "
                f"Your branches: {', '.join(allowed) or 'none'}."
            )
        return requested, None
    return None, allowed


def _check_entity_branch(user: User, branch_code: Optional[str], entity: str) -> None:
    if branch_code and not validate_branch_access(user, branch_code):
        raise ToolError(f"This {entity} belongs to branch '{branch_code}', which you cannot access.")


# ─── READ tool handlers (wrap existing services) ───────────────────────────

def _t_purchasing_statistics(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing import service as psvc

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    effective = [branch] if branch else allowed
    return json_ready(psvc.get_purchasing_statistics(db, effective))


def _t_list_purchase_orders(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing import service as psvc, schemas as pschemas
    from app.modules.purchasing.models import PurchasingOrderItems, Supplier

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    filters = pschemas.PurchaseOrderListFilter(
        status=args.get("status"),
        supplier_id=args.get("supplier_id"),
        branch_code=branch,
        branch_codes=allowed,
        date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
        date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
        skip=0,
        limit=limit,
    )
    orders = psvc.PurchasingOrderService(db).list_orders(filters)

    ids = [o.id for o in orders]
    totals: Dict[int, float] = {}
    if ids:
        rows = (
            db.query(
                PurchasingOrderItems.purchasingorders_id,
                func.coalesce(func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price), 0),
            )
            .filter(PurchasingOrderItems.purchasingorders_id.in_(ids))
            .group_by(PurchasingOrderItems.purchasingorders_id)
            .all()
        )
        totals = {r[0]: float(r[1]) for r in rows}
    sup_ids = {o.first_suppliers_id for o in orders if o.first_suppliers_id}
    sup_map: Dict[int, str] = {}
    if sup_ids:
        sup_map = dict(
            db.query(Supplier.id, Supplier.full_name).filter(Supplier.id.in_(sup_ids)).all()
        )
    return [
        {
            "id": o.id,
            "po_no": o.purchasing_order_no,
            "date": json_ready(o.purchasing_order_date),
            "supplier_id": o.first_suppliers_id,
            "supplier": sup_map.get(o.first_suppliers_id),
            "branch_code": o.branch_code,
            "payment_method": o.payment_method,
            "status": o.status,
            "total_amount": totals.get(o.id, 0.0),
        }
        for o in orders
    ]


def _t_get_purchase_order(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing import service as psvc
    from app.modules.purchasing.models import Supplier
    from app.modules.products.models import Product

    order = psvc.PurchasingOrderService(db).get_order(int(args["order_id"]))
    _check_entity_branch(user, order.branch_code, "purchase order")

    supplier = db.query(Supplier.full_name).filter(Supplier.id == order.first_suppliers_id).scalar()
    items = []
    total = Decimal("0")
    for it in order.items:
        line = Decimal(str(it.unit_price)) * it.quantity
        total += line
        pname = db.query(Product.name).filter(Product.id == it.product_id).scalar()
        items.append(
            {
                "product_id": it.product_id,
                "product": pname,
                "quantity": it.quantity,
                "unit_price": float(it.unit_price),
                "line_total": float(line),
            }
        )
    return {
        "id": order.id,
        "po_no": order.purchasing_order_no,
        "date": json_ready(order.purchasing_order_date),
        "supplier": supplier,
        "branch_code": order.branch_code,
        "payment_method": order.payment_method,
        "status": order.status,
        "remarks": order.remarks,
        "total_amount": float(total),
        "items": items,
    }


def _t_list_suppliers(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing import service as psvc, schemas as pschemas

    limit = min(int(args.get("limit") or 20), 25)
    filters = pschemas.SupplierListFilter(
        active=args.get("active"),
        search=args.get("search"),
        skip=0,
        limit=limit,
    )
    suppliers = psvc.SupplierService(db).list_suppliers(filters)
    return [
        {
            "id": s.id,
            "full_name": s.full_name,
            "company_name": s.company_name,
            "mobile": s.mobile_contact_number,
            "email": s.email,
            "credit_days": s.credit_days,
            "max_credit_limit": s.max_credit_limit,
            "active": s.active,
        }
        for s in suppliers
    ]


def _t_supplier_credit_status(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing.credit_service import supplier_credit_service

    data = supplier_credit_service.get_supplier_credit_status(db, int(args["supplier_id"]))
    compact = {
        k: data.get(k)
        for k in (
            "supplier_id", "supplier_name", "company_name", "credit_days",
            "max_credit_limit", "left_credit_amount", "outstanding_payable",
            "pending_credits", "total_exposure", "available_credit",
            "overdue_count", "total_overdue_amount",
        )
    }
    compact["unpaid_grns_top5"] = data.get("unpaid_grns", [])[:5]
    return json_ready(compact)


def _t_supplier_payment_status(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing.credit_service import supplier_credit_service

    data = supplier_credit_service.get_supplier_payment_status(db, int(args["supplier_id"]))
    docs = [
        {
            k: d.get(k)
            for k in (
                "po_no", "invoice_no", "payment_type", "status", "total_amount",
                "paid_amount", "remaining_amount", "due_date", "days_overdue",
                "is_overdue", "branch_code",
            )
        }
        for d in data.get("all_purchase_orders", [])[:12]
    ]
    return json_ready(
        {
            "supplier_id": data.get("supplier_id"),
            "supplier_name": data.get("supplier_name"),
            "credit_outstanding": data.get("credit_outstanding"),
            "non_credit_outstanding": data.get("non_credit_outstanding"),
            "total_outstanding": data.get("total_outstanding"),
            "overdue_count": data.get("overdue_count"),
            "total_overdue_amount": data.get("total_overdue_amount"),
            "outstanding_documents_top12": docs,
        }
    )


def _t_list_grns(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing import service as psvc, schemas as pschemas

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    filters = pschemas.GoodReceivedNoteListFilter(
        branch_code=branch,
        branch_codes=allowed,
        date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
        date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
        skip=0,
        limit=limit,
    )
    grns = psvc.GoodReceivedNoteService(db).list_grns(filters)
    return [
        {
            "id": g.id,
            "grn_no": g.good_received_no,
            "date": json_ready(g.good_received_date),
            "supplier_invoice_no": g.supplier_invoice_no,
            "branch_code": g.branch_code,
            "po_id": g.purchasingorders_id,
        }
        for g in grns
    ]


def _t_outstanding_grns(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing.invoice_service import PurchaseInvoiceService

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    items = PurchaseInvoiceService(db).get_all_outstanding_grns(
        supplier_id=args.get("supplier_id"), branch_code=branch
    )
    if allowed is not None:
        items = [i for i in items if i.branch_code in allowed]
    return [json_ready(i.model_dump()) for i in items[:25]]


def _t_list_purchase_invoices(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing.invoice_service import PurchaseInvoiceService
    from app.modules.purchasing.invoice_schemas import PurchaseInvoiceListFilter

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    filters = PurchaseInvoiceListFilter(
        supplier_id=args.get("supplier_id"),
        branch_code=branch,
        status=args.get("status"),
        payment_status=args.get("payment_status"),
        overdue_only=bool(args.get("overdue_only") or False),
        skip=0,
        limit=limit if allowed is None else 100,
    )
    invoices = PurchaseInvoiceService(db).list_invoices(filters)
    if allowed is not None:
        invoices = [i for i in invoices if i.branch_code in allowed]
    return [
        {
            "id": i.id,
            "invoice_no": i.invoice_no,
            "supplier": i.supplier_name,
            "date": json_ready(i.supplier_invoice_date),
            "due_date": json_ready(i.due_date),
            "branch_code": i.branch_code,
            "payment_type": i.payment_type,
            "total_amount": json_ready(i.total_amount),
            "paid_amount": json_ready(i.paid_amount),
            "balance_due": json_ready(i.balance_due),
            "status": i.status,
            "days_overdue": i.days_overdue,
        }
        for i in invoices[:limit]
    ]


def _t_payables_aging(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing.credit_service import supplier_credit_service

    data = supplier_credit_service.get_aging_report(db, args.get("supplier_id"))
    return json_ready(data)


def _t_list_supplier_payments(db: Session, user: User, args: Dict) -> Any:
    from app.modules.purchasing.models import SupplierPayment, Supplier

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    q = db.query(SupplierPayment)
    if args.get("supplier_id"):
        q = q.filter(SupplierPayment.supplier_id == int(args["supplier_id"]))
    if args.get("status"):
        q = q.filter(SupplierPayment.status == args["status"])
    if branch:
        q = q.filter(SupplierPayment.branch_code == branch)
    elif allowed is not None:
        q = q.filter(SupplierPayment.branch_code.in_(allowed))
    payments = q.order_by(SupplierPayment.id.desc()).limit(limit).all()
    sup_ids = {p.supplier_id for p in payments}
    sup_map = dict(
        db.query(Supplier.id, Supplier.full_name).filter(Supplier.id.in_(sup_ids)).all()
    ) if sup_ids else {}
    return [
        {
            "id": p.id,
            "payment_no": p.payment_no,
            "supplier": sup_map.get(p.supplier_id),
            "date": json_ready(p.payment_date),
            "method": p.payment_method,
            "amount": json_ready(p.payment_amount),
            "status": p.status,
            "branch_code": p.branch_code,
            "reference": p.invoice_reference,
        }
        for p in payments
    ]


def _t_stock_summary(db: Session, user: User, args: Dict) -> Any:
    from app.modules.inventory.models import SalesStock
    from app.modules.products.models import Product
    from app.common.enums import StockStatus

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    q = (
        db.query(
            SalesStock.product_id,
            SalesStock.branch_code,
            SalesStock.status,
            func.count(SalesStock.id),
        )
        .filter(SalesStock.status != StockStatus.RETURNED_NON_RESTOCKABLE)
    )
    if branch:
        q = q.filter(SalesStock.branch_code == branch)
    elif allowed is not None:
        q = q.filter(SalesStock.branch_code.in_(allowed))
    if args.get("product_id"):
        q = q.filter(SalesStock.product_id == int(args["product_id"]))
    elif args.get("product_search"):
        pids = [
            r[0]
            for r in db.query(Product.id)
            .filter(Product.name.ilike(f"%{args['product_search']}%"))
            .limit(20)
            .all()
        ]
        if not pids:
            return {"message": f"No products match '{args['product_search']}'."}
        q = q.filter(SalesStock.product_id.in_(pids))

    rows = q.group_by(SalesStock.product_id, SalesStock.branch_code, SalesStock.status).all()
    if not rows:
        return {"message": "No stock rows found for the given filters."}

    agg: Dict[Tuple[int, str], Dict[str, Any]] = {}
    for product_id, branch_code, status_val, cnt in rows:
        key = (product_id, branch_code)
        entry = agg.setdefault(key, {"product_id": product_id, "branch_code": branch_code, "by_status": {}, "total": 0})
        sval = status_val.value if hasattr(status_val, "value") else str(status_val)
        entry["by_status"][sval] = entry["by_status"].get(sval, 0) + cnt
        entry["total"] += cnt

    pids = {k[0] for k in agg}
    pmap = dict(db.query(Product.id, Product.name).filter(Product.id.in_(pids)).all())
    result = []
    for (pid, bc), entry in sorted(agg.items(), key=lambda kv: -kv[1]["by_status"].get("available", 0)):
        result.append(
            {
                "product_id": pid,
                "product": pmap.get(pid, f"Product {pid}"),
                "branch_code": bc,
                "available": entry["by_status"].get("available", 0),
                "sold": entry["by_status"].get("sold", 0),
                "reserved": entry["by_status"].get("reserved", 0),
                "damaged": entry["by_status"].get("damaged", 0),
                "by_status": entry["by_status"],
                "total_units": entry["total"],
            }
        )
    return result[:30]


def _t_list_stock_items(db: Session, user: User, args: Dict) -> Any:
    from app.modules.inventory.service import SalesStockService

    svc = SalesStockService(db)
    if args.get("barcode"):
        item = svc.get_by_barcode(args["barcode"])
        if not item:
            return {"message": f"No stock item with barcode '{args['barcode']}'."}
        _check_entity_branch(user, item.get("branch_code"), "stock item")
        return json_ready(item)

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    items = svc.get_all(
        branch_code=branch,
        branch_codes=allowed if branch is None else None,
        product_id=args.get("product_id"),
        status=args.get("status"),
    )
    return [
        {
            k: json_ready(i.get(k))
            for k in (
                "id", "barcode", "product_name", "item_code", "branch_code",
                "status", "grn_no", "location_name", "selling_price", "added_date",
            )
        }
        for i in items[:limit]
    ]


def _t_stock_tracking(db: Session, user: User, args: Dict) -> Any:
    from app.modules.inventory.service import SalesStockService
    from app.modules.inventory.models import SalesStock

    item = db.query(SalesStock).filter(SalesStock.barcode == args["barcode"]).first()
    if not item:
        raise ToolError(f"No stock item with barcode '{args['barcode']}'.")
    _check_entity_branch(user, item.branch_code, "stock item")
    events = SalesStockService(db).get_tracking(item.id)
    return json_ready(events[:30])


# ─── WRITE tools: validate (propose) + execute ─────────────────────────────

def _v_create_supplier(db: Session, user: User, args: Dict) -> Dict:
    if not args.get("full_name") or not args.get("mobile_contact_number"):
        raise ToolError("full_name and mobile_contact_number are required.")
    return {
        "action": "Create supplier",
        "full_name": args["full_name"],
        "company_name": args.get("company_name"),
        "mobile": args["mobile_contact_number"],
        "credit_days": int(args.get("credit_days") or 0),
        "max_credit_limit": _fmt_money(args.get("max_credit_limit") or 0),
    }


def _x_create_supplier(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.purchasing import service as psvc, schemas as pschemas

    payload = pschemas.SupplierCreate(
        title=args.get("title") or "Mr",
        full_name=args["full_name"],
        company_name=args.get("company_name"),
        postal_address=args.get("postal_address") or "N/A",
        permenent_address=args.get("permenent_address") or args.get("postal_address") or "N/A",
        gender=args.get("gender") or "other",
        civil_status=args.get("civil_status") or "unknown",
        no_of_kids=str(args.get("no_of_kids") or "0"),
        email=args.get("email"),
        mobile_contact_number=args["mobile_contact_number"],
        credit_days=int(args.get("credit_days") or 0),
        max_credit_limit=int(args.get("max_credit_limit") or 0),
        active=True,
    )
    supplier = psvc.SupplierService(db).create_supplier(payload)
    return {
        "supplier_id": supplier.id,
        "full_name": supplier.full_name,
        "summary": f"Supplier '{supplier.full_name}' created with ID {supplier.id}.",
    }


def _v_create_purchase_order(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.purchasing.models import Supplier
    from app.modules.products.models import Product
    from app.modules.purchasing.credit_service import supplier_credit_service

    branch = args.get("branch_code")
    if not branch:
        raise ToolError("branch_code is required.")
    if not validate_branch_access(user, branch):
        raise ToolError(f"You don't have access to branch '{branch}'.")

    supplier = db.query(Supplier).filter(Supplier.id == int(args["supplier_id"])).first()
    if not supplier:
        raise ToolError(f"Supplier {args['supplier_id']} not found.")
    if not supplier.active:
        raise ToolError(f"Supplier '{supplier.full_name}' is inactive.")

    items = args.get("items") or []
    if not items:
        raise ToolError("At least one item is required.")

    preview_items, total = [], Decimal("0")
    for it in items:
        product = db.query(Product).filter(Product.id == int(it["product_id"])).first()
        if not product:
            raise ToolError(f"Product {it['product_id']} not found.")
        qty = int(it["quantity"])
        price = Decimal(str(it["unit_price"]))
        if qty <= 0 or price < 0:
            raise ToolError("Quantities must be > 0 and prices >= 0.")
        total += price * qty
        preview_items.append(
            {"product": product.name, "quantity": qty, "unit_price": float(price), "line_total": float(price * qty)}
        )

    warnings = []
    payment_method = (args.get("payment_method") or "cash").lower()
    if payment_method == "credit":
        check = supplier_credit_service.check_po_credit(
            db, supplier.id, total, payment_method="Credit"
        )
        cc = check.get("credit_check", {})
        if cc.get("will_exceed_limit"):
            warnings.append(cc.get("message") or "PO exceeds available supplier credit — it will require approval.")
        elif cc.get("has_overdue"):
            warnings.append(cc.get("message") or "Supplier has overdue payments.")

    return {
        "action": "Create purchase order",
        "supplier": supplier.full_name,
        "branch_code": branch,
        "payment_method": payment_method,
        "total_amount": _fmt_money(total),
        "items": preview_items,
        "warnings": warnings,
    }


def _x_create_purchase_order(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.purchasing import service as psvc, schemas as pschemas

    today = tz.today()
    order = pschemas.PurchasingOrderCreate(
        branch_code=args["branch_code"],
        payment_method=(args.get("payment_method") or "cash").lower(),
        purchasing_order_date=date.fromisoformat(args["order_date"]) if args.get("order_date") else today,
        good_received_note_date=date.fromisoformat(args["expected_date"]) if args.get("expected_date") else today,
        remarks=args.get("remarks"),
        credit_date=int(args["credit_days"]) if args.get("credit_days") else None,
        first_suppliers_id=int(args["supplier_id"]),
        items=[
            pschemas.PurchasingOrderItemCreate(
                product_id=int(it["product_id"]),
                quantity=int(it["quantity"]),
                unit_price=Decimal(str(it["unit_price"])),
                warrenty_month=str(it.get("warranty_months") or "0"),
                remark=it.get("remark"),
            )
            for it in (args.get("items") or [])
        ],
    )
    created = psvc.PurchasingOrderService(db).create_order(order, created_by=user.id)

    try:
        from app.modules.notifications import dispatcher as notify

        notify.branch(
            created.branch_code,
            title="Purchase Order Created",
            message=f"PO {created.purchasing_order_no} was created via AI assistant.",
            notification_type=notify.INFO,
            category=notify.PURCHASING,
            action_url="/purchasing/orders",
            exclude_user_id=user.id,
        )
    except Exception:  # pragma: no cover — notification failure must not fail the PO
        logger.warning("Notification dispatch failed for PO %s", created.id, exc_info=True)

    return {
        "po_id": created.id,
        "po_no": created.purchasing_order_no,
        "status": str(created.status),
        "summary": f"Purchase order {created.purchasing_order_no} created (status: {created.status}).",
    }


def _v_approve_purchase_order(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.purchasing.models import PurchasingOrder, Supplier

    order = db.query(PurchasingOrder).filter(PurchasingOrder.id == int(args["order_id"])).first()
    if not order:
        raise ToolError(f"Purchase order {args['order_id']} not found.")
    _check_entity_branch(user, order.branch_code, "purchase order")
    if str(order.status) not in ("pending", "pending_approval", "PurchaseOrderStatus.PENDING", "PurchaseOrderStatus.PENDING_APPROVAL"):
        raise ToolError(f"PO {order.purchasing_order_no} is '{order.status}' — only pending orders can be approved/rejected.")
    supplier = db.query(Supplier.full_name).filter(Supplier.id == order.first_suppliers_id).scalar()
    decision = "Approve" if args.get("approve", True) else "Reject"
    return {
        "action": f"{decision} purchase order",
        "po_no": order.purchasing_order_no,
        "supplier": supplier,
        "branch_code": order.branch_code,
        "current_status": str(order.status),
        "remarks": args.get("remarks"),
    }


def _x_approve_purchase_order(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.purchasing import service as psvc

    order = psvc.PurchasingOrderService(db).approve_order(
        int(args["order_id"]),
        approve=bool(args.get("approve", True)),
        remarks=args.get("remarks"),
        user_id=user.id,
    )
    verb = "approved" if bool(args.get("approve", True)) else "rejected"
    return {
        "po_id": order.id,
        "po_no": order.purchasing_order_no,
        "status": str(order.status),
        "summary": f"Purchase order {order.purchasing_order_no} {verb}.",
    }


_ALLOWED_STATUS_TRANSITIONS = {"available", "damaged", "reserved"}


def _v_update_stock_status(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.inventory.models import SalesStock
    from app.modules.products.models import Product

    new_status = (args.get("new_status") or "").lower()
    if new_status not in _ALLOWED_STATUS_TRANSITIONS:
        raise ToolError(f"new_status must be one of: {sorted(_ALLOWED_STATUS_TRANSITIONS)}.")
    item = db.query(SalesStock).filter(SalesStock.barcode == args["barcode"]).first()
    if not item:
        raise ToolError(f"No stock item with barcode '{args['barcode']}'.")
    _check_entity_branch(user, item.branch_code, "stock item")
    current = item.status.value if hasattr(item.status, "value") else str(item.status)
    if current not in _ALLOWED_STATUS_TRANSITIONS:
        raise ToolError(
            f"Item is currently '{current}' — the assistant may only change items that are "
            f"available/reserved/damaged. Sold or transferred units must be handled via their own flows."
        )
    pname = db.query(Product.name).filter(Product.id == item.product_id).scalar()
    return {
        "action": "Update stock item status",
        "barcode": item.barcode,
        "product": pname,
        "branch_code": item.branch_code,
        "current_status": current,
        "new_status": new_status,
    }


def _x_update_stock_status(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.inventory.service import SalesStockService
    from app.modules.inventory.models import SalesStock

    item = db.query(SalesStock).filter(SalesStock.barcode == args["barcode"]).first()
    if not item:
        raise ToolError(f"No stock item with barcode '{args['barcode']}'.")
    updated = SalesStockService(db).update_status(
        item.id, (args["new_status"] or "").lower(), user_id=user.id
    )
    status_val = updated.status.value if hasattr(updated.status, "value") else str(updated.status)
    return {
        "stock_id": updated.id,
        "barcode": updated.barcode,
        "status": status_val,
        "summary": f"Stock item {updated.barcode} is now '{status_val}'.",
    }


# ─── company assets: read ──────────────────────────────────────────────────

def _t_list_company_assets(db: Session, user: User, args: Dict) -> Any:
    from app.modules.inventory.service import CompanyAssetService

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    items = CompanyAssetService(db).get_all(
        branch_code=branch,
        branch_codes=allowed if branch is None else None,
        product_id=args.get("product_id"),
        status=args.get("status"),
        source=args.get("source"),
    )
    if args.get("barcode"):
        items = [i for i in items if i.get("barcode") == args["barcode"]]
    elif args.get("search"):
        term = str(args["search"]).lower()
        items = [
            i
            for i in items
            if term in (i.get("item") or "").lower()
            or term in (i.get("product_name") or "").lower()
            or term in (i.get("inventory_no") or "").lower()
        ]
    if not items:
        return {"message": "No company assets match the given filters."}
    return [
        {
            k: json_ready(i.get(k))
            for k in (
                "id", "inventory_no", "item", "product_name", "barcode",
                "branch_code", "status", "source", "warranty_month",
                "asigned_to", "grn_no", "cost_price", "added_date",
            )
        }
        for i in items[:limit]
    ]


# ─── company assets: write ─────────────────────────────────────────────────

_ALLOWED_ASSET_STATUSES = {"available", "in_use", "retired", "disposed"}


def _find_company_asset(db: Session, args: Dict):
    from app.modules.inventory.models import CompanyAssets

    q = db.query(CompanyAssets)
    if args.get("asset_id"):
        item = q.filter(CompanyAssets.id == int(args["asset_id"])).first()
    elif args.get("barcode"):
        item = q.filter(CompanyAssets.barcode == args["barcode"]).first()
    elif args.get("inventory_no"):
        item = q.filter(CompanyAssets.inventory_no == args["inventory_no"]).first()
    else:
        raise ToolError("Provide asset_id, barcode or inventory_no to identify the asset.")
    if not item:
        raise ToolError("No company asset matches the given identifier.")
    return item


def _v_update_company_asset_status(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.products.models import Product

    new_status = (args.get("new_status") or "").lower()
    if new_status not in _ALLOWED_ASSET_STATUSES:
        raise ToolError(f"new_status must be one of: {sorted(_ALLOWED_ASSET_STATUSES)}.")
    item = _find_company_asset(db, args)
    _check_entity_branch(user, item.branch_code, "company asset")
    current = item.status.value if hasattr(item.status, "value") else str(item.status)
    pname = (
        db.query(Product.name).filter(Product.id == item.product_id).scalar()
        if item.product_id
        else None
    )
    return {
        "action": "Update company asset status",
        "inventory_no": item.inventory_no,
        "item": pname or item.item,
        "barcode": item.barcode,
        "branch_code": item.branch_code,
        "current_status": current,
        "new_status": new_status,
    }


def _x_update_company_asset_status(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.inventory.service import CompanyAssetService

    item = _find_company_asset(db, args)
    _check_entity_branch(user, item.branch_code, "company asset")
    updated = CompanyAssetService(db).update_status(
        item.id, (args["new_status"] or "").lower(), user_id=user.id
    )
    status_val = updated.status.value if hasattr(updated.status, "value") else str(updated.status)
    return {
        "asset_id": updated.id,
        "inventory_no": updated.inventory_no,
        "status": status_val,
        "summary": f"Company asset {updated.inventory_no} is now '{status_val}'.",
    }


# ─── branches: read ────────────────────────────────────────────────────────

def _t_list_branches(db: Session, user: User, args: Dict) -> Any:
    from app.modules.branches import service as bsvc

    active_only = bool(args.get("active_only") or False)
    limit = min(int(args.get("limit") or 50), 100)
    branches = bsvc.branch_service.get_all_branches(
        db, skip=0, limit=limit, active_only=active_only
    )
    search = (args.get("search") or "").lower()
    result = [
        {
            "id": b.id,
            "branch_code": b.branch_code,
            "branch_name": b.branch_name,
            "address": b.address,
            "email": b.email,
            "contact_number": b.contact_number,
            "active": b.active,
        }
        for b in branches
        if not search
        or search in (b.branch_name or "").lower()
        or search in (b.branch_code or "").lower()
    ]
    if not result:
        return {"message": "No branches found."}
    return result


# ─── branches: write ───────────────────────────────────────────────────────

def _v_create_branch(db: Session, user: User, args: Dict) -> Dict:
    from app.auth.models import Branch

    name = (args.get("branch_name") or "").strip()
    code = (args.get("branch_code") or "").strip()
    if not name or not code:
        raise ToolError("branch_name and branch_code are required.")
    if db.query(Branch).filter(Branch.branch_code == code).first():
        raise ToolError(f"Branch code '{code}' already exists.")
    if db.query(Branch).filter(Branch.branch_name == name).first():
        raise ToolError(f"Branch name '{name}' already exists.")
    return {
        "action": "Create branch",
        "branch_name": name,
        "branch_code": code,
        "address": args.get("address"),
        "email": args.get("email"),
        "contact_number": args.get("contact_number"),
        "active": bool(args.get("active", True)),
    }


def _x_create_branch(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.branches import schemas as bschemas, service as bsvc

    payload = bschemas.BranchCreate(
        branch_name=args["branch_name"].strip(),
        branch_code=args["branch_code"].strip(),
        address=args.get("address") or None,
        email=(args.get("email") or None),
        contact_number=args.get("contact_number") or None,
        active=bool(args.get("active", True)),
    )
    branch = bsvc.branch_service.create_branch(db, payload)
    return {
        "branch_id": branch.id,
        "branch_code": branch.branch_code,
        "summary": f"Branch '{branch.branch_name}' ({branch.branch_code}) created with ID {branch.id}.",
    }


# ─── users: read ───────────────────────────────────────────────────────────

def _t_list_users(db: Session, user: User, args: Dict) -> Any:
    from app.auth.models import User as UserModel

    limit = min(int(args.get("limit") or 20), 25)
    q = db.query(UserModel)
    search = args.get("search")
    if search:
        like = f"%{search}%"
        q = q.filter(
            or_(
                UserModel.username.ilike(like),
                UserModel.first_name.ilike(like),
                UserModel.last_name.ilike(like),
                UserModel.email.ilike(like),
                UserModel.employee_id.ilike(like),
            )
        )
    if args.get("active") is not None:
        q = q.filter(UserModel.is_active == bool(args["active"]))
    users = q.order_by(UserModel.username).limit(limit).all()
    if not users:
        return {"message": "No users match the given filters."}
    return [
        {
            "id": u.id,
            "username": u.username,
            "name": f"{u.first_name} {u.last_name}".strip(),
            "email": u.email,
            "employee_id": u.employee_id,
            "occupation": u.occupation,
            "is_active": u.is_active,
            "is_superuser": u.is_superuser,
            "branches": [b.branch_code for b in u.branches],
            "groups": [g.name for g in u.groups],
            "last_login": json_ready(u.last_login),
        }
        for u in users
    ]


def _t_get_user(db: Session, user: User, args: Dict) -> Any:
    from app.auth.models import User as UserModel

    u = db.query(UserModel).filter(UserModel.id == int(args["user_id"])).first()
    if not u:
        raise ToolError(f"User {args['user_id']} not found.")
    return {
        "id": u.id,
        "username": u.username,
        "name": f"{u.first_name} {u.last_name}".strip(),
        "email": u.email,
        "employee_id": u.employee_id,
        "gender": u.gender,
        "occupation": u.occupation,
        "is_active": u.is_active,
        "is_staff": u.is_staff,
        "is_superuser": u.is_superuser,
        "blocked": u.blocked,
        "verify": u.verify,
        "date_joined": json_ready(u.date_joined),
        "last_login": json_ready(u.last_login),
        "branches": [{"code": b.branch_code, "name": b.branch_name} for b in u.branches],
        "groups": [g.name for g in u.groups],
    }


# ─── sales: read ────────────────────────────────────────────────────────────

def _t_sales_statistics(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales import service as sales_svc

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    effective = [branch] if branch else allowed
    stats = sales_svc.sales_service.get_sales_statistics(db, effective)
    keys = (
        "total_orders", "current_month_orders", "last_month_orders",
        "total_revenue", "current_month_revenue", "last_month_revenue",
        "today_revenue", "today_orders", "avg_order_value",
        "pending_approval", "approved", "sale_returns_count",
        "payment_breakdown", "top_customers",
    )
    return json_ready({k: stats.get(k) for k in keys})


def _t_list_sales_orders(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales import service as sales_svc
    from app.modules.customers.models import Customer

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    page = max(int(args.get("page") or 1), 1)
    page_size = min(int(args.get("limit") or 20), 25)
    result = sales_svc.sales_service.get_paginated_invoices(
        db,
        page=page,
        page_size=page_size,
        search=args.get("search"),
        branch_code=branch,
        status=args.get("status"),
        user_branches=allowed,
    )
    items = result.get("items", [])
    cust_ids = {getattr(i, "customer_id", None) for i in items}
    cust_ids.discard(None)
    cust_map = (
        dict(db.query(Customer.id, Customer.customer_name).filter(Customer.id.in_(cust_ids)).all())
        if cust_ids
        else {}
    )
    rows = [
        {
            "id": i.id,
            "invoice_no": i.invoice_no,
            "date": json_ready(getattr(i, "created_date", None)),
            "customer": cust_map.get(getattr(i, "customer_id", None)),
            "branch_code": i.branch_code,
            "payment_method": i.payment_method,
            "grand_total": json_ready(getattr(i, "grand_total", None)),
            "paid_amount": json_ready(getattr(i, "paid_amount", None)),
            "balance_due": json_ready(getattr(i, "balance_due", None)),
            "payment_status": getattr(i, "payment_status", None),
            "approval_status": getattr(i, "approval_status", None),
        }
        for i in items
    ]
    if not rows:
        return {"message": "No sales orders match the given filters."}
    return {"total": result.get("total"), "page": result.get("page"), "orders": rows}


def _t_get_sales_order(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales import service as sales_svc
    from app.modules.sales.models import Invoice
    from app.modules.customers.models import Customer
    from app.modules.products.models import Product

    if args.get("sales_order_id"):
        inv = sales_svc.sales_service.get_invoice(db, int(args["sales_order_id"]))
    elif args.get("invoice_no"):
        inv = db.query(Invoice).filter(Invoice.invoice_no == args["invoice_no"]).first()
        if not inv:
            raise ToolError(f"No sales order with invoice no '{args['invoice_no']}'.")
    else:
        raise ToolError("Provide sales_order_id or invoice_no.")
    _check_entity_branch(user, inv.branch_code, "sales order")

    customer = db.query(Customer.customer_name).filter(Customer.id == inv.customer_id).scalar()
    items = []
    for it in inv.items:
        pname = db.query(Product.name).filter(Product.id == it.product_id).scalar()
        items.append(
            {
                "product": pname,
                "quantity": it.quantity,
                "unit_price": json_ready(it.selling_price),
                "line_total": json_ready(getattr(it, "line_total", None)),
            }
        )
    return {
        "id": inv.id,
        "invoice_no": inv.invoice_no,
        "date": json_ready(inv.created_date),
        "customer": customer,
        "branch_code": inv.branch_code,
        "payment_method": inv.payment_method,
        "approval_status": inv.approval_status,
        "payment_status": getattr(inv, "payment_status", None),
        "subtotal": json_ready(getattr(inv, "subtotal", None)),
        "tax_amount": json_ready(getattr(inv, "tax_amount", None)),
        "grand_total": json_ready(getattr(inv, "grand_total", None)),
        "paid_amount": json_ready(getattr(inv, "paid_amount", None)),
        "balance_due": json_ready(getattr(inv, "balance_due", None)),
        "remarks": inv.remarks,
        "items": items,
    }


def _t_list_sale_returns(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales import service as sales_svc

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    effective = [branch] if branch else allowed
    returns = sales_svc.sales_service.get_all_sale_returns(db, 0, limit, effective)
    if not returns:
        return {"message": "No sale returns match the given filters."}
    return [
        {
            "id": r.id,
            "sale_return_no": r.sale_return_no,
            "invoice_no": getattr(r, "invoice_no", None),
            "invoice_id": r.invoice_id,
            "branch_code": r.branch_code,
            "status": r.status,
            "payment_method": r.payment_method,
            "return_reason": r.return_reason,
            "total_refund": json_ready(getattr(r, "total_refund", None)),
            "refund_status": getattr(r, "refund_status", None),
            "date": json_ready(getattr(r, "added_date", None)),
        }
        for r in returns
    ]


def _t_list_customers(db: Session, user: User, args: Dict) -> Any:
    from app.modules.customers.service import customer_service

    limit = min(int(args.get("limit") or 20), 25)
    if args.get("search"):
        customers = customer_service.search_customers(db, args["search"], 0, limit)
    else:
        customers = customer_service.get_all_customers(
            db, 0, limit, bool(args.get("active_only") or False)
        )
    if not customers:
        return {"message": "No customers match the given filters."}
    return [
        {
            "id": c.id,
            "customer_name": c.customer_name,
            "company_name": c.company_name,
            "mobile": c.mobile_contact_number,
            "email": c.email,
            "credit_days": c.credit_days,
            "max_credit_limit": json_ready(c.max_credit_limit),
            "left_credit_amount": json_ready(getattr(c, "left_credit_amount", None)),
            "is_customer_agent": c.is_customer_agent,
            "active": c.active,
        }
        for c in customers
    ]


def _t_get_customer_debt(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales.debtors_service import DebtorsService

    details = DebtorsService.get_customer_debt_details(db, int(args["customer_id"]))
    if not details:
        raise ToolError(f"Customer {args['customer_id']} not found.")
    details["invoices"] = details.get("invoices", [])[:15]
    details.pop("followup_history", None)
    return json_ready(details)


def _t_list_debtors(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales.debtors_service import DebtorsService

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    report = DebtorsService.get_debtors_list(
        db,
        status_filter=args.get("status") or "all",
        skip=0,
        limit=limit,
        branch_code=branch,
    )
    debtors = report.get("debtors", [])
    if allowed is not None and not branch:
        # get_debtors_list only filters by a single branch; nothing to post-filter
        pass
    return json_ready(
        {
            "total_debtors": report.get("total_debtors"),
            "total_outstanding": report.get("total_outstanding"),
            "total_overdue": report.get("total_overdue"),
            "critical_count": report.get("critical_count"),
            "overdue_count": report.get("overdue_count"),
            "debtors": [
                {
                    k: d.get(k)
                    for k in (
                        "customer_id", "customer_name", "company_name",
                        "outstanding_balance", "credit_limit", "credit_days",
                        "days_overdue", "status",
                    )
                }
                for d in debtors[:limit]
            ],
        }
    )


def _t_list_quotations(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales.quotation_service import sales_quote_service
    from app.modules.customers.models import Customer

    limit = min(int(args.get("limit") or 20), 25)
    quotes = sales_quote_service.get_all_quotes(
        db, skip=0, limit=limit, quote_type=args.get("quote_type")
    )
    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    if branch:
        quotes = [q for q in quotes if q.branch_code == branch]
    elif allowed is not None:
        quotes = [q for q in quotes if q.branch_code in allowed]
    if not quotes:
        return {"message": "No quotations match the given filters."}
    cust_ids = {q.customer_id for q in quotes}
    cust_map = (
        dict(db.query(Customer.id, Customer.customer_name).filter(Customer.id.in_(cust_ids)).all())
        if cust_ids
        else {}
    )
    return [
        {
            "id": q.id,
            "quote_no": q.quote_no,
            "quote_type": json_ready(getattr(q, "quote_type", None)),
            "customer": cust_map.get(q.customer_id),
            "branch_code": q.branch_code,
            "status": json_ready(getattr(q, "status", None)),
            "total_amount": json_ready(getattr(q, "total_amount", None)),
            "valid_until": json_ready(getattr(q, "valid_until", None)),
            "date": json_ready(getattr(q, "created_date", None)),
        }
        for q in quotes[:limit]
    ]


def _t_get_quotation(db: Session, user: User, args: Dict) -> Any:
    from app.modules.sales.quotation_service import sales_quote_service
    from app.modules.customers.models import Customer
    from app.modules.products.models import Product

    quote = sales_quote_service.get_quote_by_id(db, int(args["quote_id"]))
    if not quote:
        raise ToolError(f"Quotation {args['quote_id']} not found.")
    _check_entity_branch(user, quote.branch_code, "quotation")
    customer = db.query(Customer.customer_name).filter(Customer.id == quote.customer_id).scalar()
    items = []
    for it in getattr(quote, "items", []) or []:
        pname = db.query(Product.name).filter(Product.id == it.product_id).scalar()
        items.append(
            {
                "product": pname,
                "quantity": it.quantity,
                "unit_price": json_ready(it.selling_price),
            }
        )
    return {
        "id": quote.id,
        "quote_no": quote.quote_no,
        "quote_type": json_ready(getattr(quote, "quote_type", None)),
        "customer": customer,
        "branch_code": quote.branch_code,
        "status": json_ready(getattr(quote, "status", None)),
        "total_amount": json_ready(getattr(quote, "total_amount", None)),
        "valid_until": json_ready(getattr(quote, "valid_until", None)),
        "remarks": getattr(quote, "remarks", None),
        "items": items,
    }


# ─── sales: write (validate + execute) ──────────────────────────────────────

def _v_create_customer(db: Session, user: User, args: Dict) -> Dict:
    if not args.get("customer_name") or not args.get("mobile_contact_number"):
        raise ToolError("customer_name and mobile_contact_number are required.")
    return {
        "action": "Create customer",
        "customer_name": args["customer_name"],
        "company_name": args.get("company_name"),
        "mobile": args["mobile_contact_number"],
        "email": args.get("email"),
        "credit_days": int(args.get("credit_days") or 0),
        "max_credit_limit": _fmt_money(args.get("max_credit_limit") or 0),
        "is_customer_agent": bool(args.get("is_customer_agent") or False),
    }


def _x_create_customer(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.customers import service as csvc, schemas as cschemas

    payload = cschemas.CustomerCreate(
        customer_name=args["customer_name"],
        title=args.get("title") or "Mr",
        email=args.get("email"),
        mobile_contact_number=args["mobile_contact_number"],
        home_contact_number=args.get("home_contact_number"),
        company_name=args.get("company_name"),
        occupation=args.get("occupation"),
        gender=args.get("gender") or "other",
        civil_status=args.get("civil_status") or "unknown",
        no_of_kids=str(args.get("no_of_kids") or "0"),
        payment_address=args.get("payment_address"),
        delivery_address=args.get("delivery_address"),
        credit_days=int(args.get("credit_days") or 0),
        max_credit_limit=int(args.get("max_credit_limit") or 0),
        active=True,
        is_customer_agent=bool(args.get("is_customer_agent") or False),
        commission_rate=args.get("commission_rate"),
    )
    customer = csvc.customer_service.create_customer(db, payload, user.id)
    return {
        "customer_id": customer.id,
        "customer_name": customer.customer_name,
        "summary": f"Customer '{customer.customer_name}' created with ID {customer.id}.",
    }


def _v_create_quotation(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.customers.models import Customer
    from app.modules.products.models import Product

    branch = args.get("branch_code")
    if not branch:
        raise ToolError("branch_code is required.")
    if not validate_branch_access(user, branch):
        raise ToolError(f"You don't have access to branch '{branch}'.")
    if not args.get("valid_until"):
        raise ToolError("valid_until (ISO date YYYY-MM-DD) is required.")

    customer = db.query(Customer).filter(Customer.id == int(args["customer_id"])).first()
    if not customer:
        raise ToolError(f"Customer {args['customer_id']} not found.")
    if not customer.active:
        raise ToolError(f"Customer '{customer.customer_name}' is inactive.")

    items = args.get("items") or []
    if not items:
        raise ToolError("At least one item is required.")
    preview_items, total = [], Decimal("0")
    for it in items:
        product = db.query(Product).filter(Product.id == int(it["product_id"])).first()
        if not product:
            raise ToolError(f"Product {it['product_id']} not found.")
        qty = int(it["quantity"])
        price = Decimal(str(it["selling_price"]))
        if qty <= 0 or price < 0:
            raise ToolError("Quantities must be > 0 and prices >= 0.")
        total += price * qty
        preview_items.append(
            {"product": product.name, "quantity": qty, "unit_price": float(price), "line_total": float(price * qty)}
        )
    return {
        "action": "Create quotation",
        "quote_type": (args.get("quote_type") or "quotation"),
        "customer": customer.customer_name,
        "branch_code": branch,
        "valid_until": args["valid_until"],
        "estimated_total": _fmt_money(total),
        "items": preview_items,
    }


def _x_create_quotation(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales.quotation_service import sales_quote_service
    from app.modules.sales import quotation_schemas as qschemas

    quote_type = qschemas.QuoteTypeEnum(
        (args.get("quote_type") or "quotation").lower()
    )
    payload = qschemas.SalesQuoteCreate(
        quote_type=quote_type,
        branch_code=args["branch_code"],
        customer_id=int(args["customer_id"]),
        sale_rep_id=user.id,
        valid_until=date.fromisoformat(args["valid_until"]),
        remarks=args.get("remarks"),
        items=[
            qschemas.SalesQuoteItemCreate(
                product_id=int(it["product_id"]),
                quantity=int(it["quantity"]),
                selling_price=float(it["selling_price"]),
                minimum_selling_price=float(it.get("minimum_selling_price") or 0),
                warrenty_month=str(it.get("warranty_months") or "0"),
            )
            for it in (args.get("items") or [])
        ],
    )
    quote = sales_quote_service.create_quote(db, payload, created_by=user.id)
    return {
        "quote_id": quote.id,
        "quote_no": quote.quote_no,
        "summary": f"Quotation {quote.quote_no} created (status: {getattr(quote, 'status', 'draft')}).",
    }


def _v_record_customer_payment(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales.models import Invoice
    from app.modules.sales.debtors_service import DebtorsService
    from app.modules.customers.models import Customer

    invoice = db.query(Invoice).filter(Invoice.id == int(args["invoice_id"])).first()
    if not invoice:
        raise ToolError(f"Invoice {args['invoice_id']} not found.")
    _check_entity_branch(user, invoice.branch_code, "invoice")
    if invoice.customer_id != int(args["customer_id"]):
        raise ToolError("The invoice does not belong to the given customer.")
    amount = Decimal(str(args["amount"]))
    if amount <= 0:
        raise ToolError("amount must be greater than zero.")
    outstanding = DebtorsService.get_outstanding_balance(db, invoice.id)
    if amount > outstanding:
        raise ToolError(
            f"Payment (Rs. {amount:,.2f}) exceeds the outstanding balance (Rs. {outstanding:,.2f})."
        )
    customer = db.query(Customer.customer_name).filter(Customer.id == invoice.customer_id).scalar()
    return {
        "action": "Record customer payment",
        "invoice_no": invoice.invoice_no,
        "customer": customer,
        "branch_code": invoice.branch_code,
        "payment_method": args.get("payment_method") or "cash",
        "amount": _fmt_money(amount),
        "outstanding_before": _fmt_money(outstanding),
        "outstanding_after": _fmt_money(outstanding - amount),
    }


def _x_record_customer_payment(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales.models import Invoice
    from app.modules.sales.debtors_service import DebtorsService

    invoice = db.query(Invoice).filter(Invoice.id == int(args["invoice_id"])).first()
    if not invoice:
        raise ToolError(f"Invoice {args['invoice_id']} not found.")
    _check_entity_branch(user, invoice.branch_code, "invoice")
    payment_date = (
        date.fromisoformat(args["payment_date"]) if args.get("payment_date") else tz.today()
    )
    result = DebtorsService.record_payment(
        db=db,
        customer_id=int(args["customer_id"]),
        invoice_id=int(args["invoice_id"]),
        amount=Decimal(str(args["amount"])),
        payment_date=payment_date,
        payment_method=(args.get("payment_method") or "cash"),
        branch_code=invoice.branch_code,
        reference_no=args.get("reference_no"),
        notes=args.get("notes"),
        created_by=user.id,
    )
    return {
        "payment_id": result.get("id"),
        "invoice_no": invoice.invoice_no,
        "amount": json_ready(result.get("amount")),
        "summary": f"Payment of {_fmt_money(result.get('amount'))} recorded against {invoice.invoice_no}.",
    }


def _resolve_pending_invoice(db: Session, args: Dict):
    from app.modules.sales.models import Invoice

    if args.get("sales_order_id"):
        inv = db.query(Invoice).filter(Invoice.id == int(args["sales_order_id"])).first()
    elif args.get("invoice_no"):
        inv = db.query(Invoice).filter(Invoice.invoice_no == args["invoice_no"]).first()
    else:
        raise ToolError("Provide sales_order_id or invoice_no.")
    if not inv:
        raise ToolError("Sales order not found.")
    return inv


def _v_approve_sales_order(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.customers.models import Customer

    inv = _resolve_pending_invoice(db, args)
    _check_entity_branch(user, inv.branch_code, "sales order")
    if str(inv.approval_status) not in ("pending_approval", "PENDING_APPROVAL", "DocumentStatus.PENDING_APPROVAL"):
        raise ToolError(
            f"Sales order {inv.invoice_no} is '{inv.approval_status}' — only pending-approval "
            f"credit orders can be approved/rejected."
        )
    customer = db.query(Customer.customer_name).filter(Customer.id == inv.customer_id).scalar()
    decision = "Approve" if args.get("approve", True) else "Reject"
    return {
        "action": f"{decision} sales order",
        "invoice_no": inv.invoice_no,
        "customer": customer,
        "branch_code": inv.branch_code,
        "grand_total": _fmt_money(getattr(inv, "grand_total", 0)),
        "current_status": str(inv.approval_status),
        "remarks": args.get("remarks"),
    }


def _x_approve_sales_order(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales import service as sales_svc

    inv = _resolve_pending_invoice(db, args)
    _check_entity_branch(user, inv.branch_code, "sales order")
    approve = bool(args.get("approve", True))
    if approve:
        updated = sales_svc.sales_service.approve_invoice(db, inv.id, user.id)
        return {
            "invoice_id": updated.id,
            "invoice_no": updated.invoice_no,
            "status": str(updated.approval_status),
            "summary": f"Sales order {updated.invoice_no} approved.",
        }
    # Reject = cancel the credit order and mark the approval record rejected.
    approval_id = inv.approval_id
    sales_svc.sales_service.cancel_invoice(db, inv.id, user.id)
    if approval_id:
        from app.modules.common.models import Approvals

        rec = db.query(Approvals).filter(Approvals.id == approval_id).first()
        if rec and str(rec.status) == "pending":
            rec.status = "rejected"
            rec.status_changed_by = user.id
            rec.remark = args.get("remarks") or f"Rejected by user {user.id}"
            db.commit()
    return {
        "invoice_id": inv.id,
        "invoice_no": inv.invoice_no,
        "status": "rejected",
        "summary": f"Sales order {inv.invoice_no} rejected and cancelled.",
    }


def _resolve_pending_return(db: Session, args: Dict):
    from app.modules.sales.models import SaleReturn

    if args.get("return_id"):
        ret = db.query(SaleReturn).filter(SaleReturn.id == int(args["return_id"])).first()
    elif args.get("sale_return_no"):
        ret = db.query(SaleReturn).filter(SaleReturn.sale_return_no == args["sale_return_no"]).first()
    else:
        raise ToolError("Provide return_id or sale_return_no.")
    if not ret:
        raise ToolError("Sale return not found.")
    return ret


def _v_approve_sale_return(db: Session, user: User, args: Dict) -> Dict:
    ret = _resolve_pending_return(db, args)
    _check_entity_branch(user, ret.branch_code, "sale return")
    if str(ret.status) not in ("pending", "PENDING", "DocumentStatus.PENDING"):
        raise ToolError(
            f"Sale return {ret.sale_return_no} is '{ret.status}' — only pending returns can be approved/rejected."
        )
    decision = "Approve" if args.get("approve", True) else "Reject"
    return {
        "action": f"{decision} sale return",
        "sale_return_no": ret.sale_return_no,
        "invoice_id": ret.invoice_id,
        "branch_code": ret.branch_code,
        "total_refund": _fmt_money(getattr(ret, "total_refund", 0)),
        "current_status": str(ret.status),
        "remarks": args.get("remarks"),
    }


def _x_approve_sale_return(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales import service as sales_svc

    ret = _resolve_pending_return(db, args)
    _check_entity_branch(user, ret.branch_code, "sale return")
    approve = bool(args.get("approve", True))
    if approve:
        updated = sales_svc.sales_service.approve_sale_return(db, ret.id, user.id)
        verb = "approved"
    else:
        updated = sales_svc.sales_service.reject_sale_return(
            db, ret.id, user.id, reason=args.get("remarks")
        )
        verb = "rejected"
    return {
        "return_id": updated.id,
        "sale_return_no": updated.sale_return_no,
        "status": str(updated.status),
        "summary": f"Sale return {updated.sale_return_no} {verb}.",
    }


def _v_return_invoice(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales.models import Invoice

    if args.get("sales_order_id"):
        inv = db.query(Invoice).filter(Invoice.id == int(args["sales_order_id"])).first()
    elif args.get("invoice_no"):
        inv = db.query(Invoice).filter(Invoice.invoice_no == args["invoice_no"]).first()
    else:
        raise ToolError("Provide sales_order_id or invoice_no.")
    if not inv:
        raise ToolError("Invoice not found.")
    _check_entity_branch(user, inv.branch_code, "invoice")
    if str(inv.approval_status) not in ("completed", "approved", "COMPLETED", "APPROVED",
                                        "DocumentStatus.COMPLETED", "DocumentStatus.APPROVED"):
        raise ToolError(
            f"Invoice {inv.invoice_no} is '{inv.approval_status}' — only completed/approved "
            f"invoices can be returned. Pending orders should be cancelled instead."
        )
    return {
        "action": "Return full invoice",
        "invoice_no": inv.invoice_no,
        "branch_code": inv.branch_code,
        "payment_method": args.get("payment_method") or "credit_note",
        "return_reason": args.get("return_reason") or "customer_changed_mind",
        "grand_total": _fmt_money(getattr(inv, "grand_total", 0)),
        "note": "Creates a full sale return for every not-yet-returned unit; it still needs approval to process the refund.",
    }


def _x_return_invoice(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.sales import service as sales_svc
    from app.modules.sales.models import Invoice

    if args.get("sales_order_id"):
        inv = db.query(Invoice).filter(Invoice.id == int(args["sales_order_id"])).first()
    elif args.get("invoice_no"):
        inv = db.query(Invoice).filter(Invoice.invoice_no == args["invoice_no"]).first()
    else:
        raise ToolError("Provide sales_order_id or invoice_no.")
    if not inv:
        raise ToolError("Invoice not found.")
    _check_entity_branch(user, inv.branch_code, "invoice")
    sale_return = sales_svc.sales_service.create_full_invoice_return(
        db,
        invoice_id=inv.id,
        payment_method=(args.get("payment_method") or "credit_note"),
        return_reason=args.get("return_reason") or "customer_changed_mind",
        remark=args.get("remark"),
        user_id=user.id,
    )
    return {
        "return_id": sale_return.id,
        "sale_return_no": sale_return.sale_return_no,
        "total_refund": json_ready(getattr(sale_return, "total_refund", None)),
        "summary": (
            f"Full return {sale_return.sale_return_no} created for {inv.invoice_no} "
            f"(pending approval)."
        ),
    }


# ─── finance: read ──────────────────────────────────────────────────────────

def _t_finance_dashboard_stats(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import AccountingDashboardService

    return json_ready(AccountingDashboardService(db).get_stats().model_dump())


def _t_get_cashbook_summary(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc, schemas as fschemas

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    filters = fschemas.CashbookFilter(
        branch_code=branch,
        branch_codes=allowed,
        date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
        date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
    )
    report = fsvc.CashbookService(db).get_cashbook_report(filters)
    return json_ready(report.summary.model_dump())


def _t_list_expenses(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc, schemas as fschemas

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    result = fsvc.ExpenseService(db).list_expenses(
        fschemas.ExpenseListFilter(
            branch_code=branch,
            branch_codes=allowed,
            status=args.get("status"),
            expense_category=args.get("expense_category"),
            payment_status=args.get("payment_status"),
            search=args.get("search"),
            date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
            date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
            skip=0,
            limit=limit,
        )
    )
    items = result.get("items", [])
    if not items:
        return {"message": "No expenses match the given filters.", "total": result.get("total", 0)}
    return {
        "total": result.get("total"),
        "expenses": [
            {
                "id": e.id,
                "expenses_no": e.expenses_no,
                "expense_category": e.expense_category,
                "vendor_name": e.vendor_name,
                "amount": json_ready(e.expense_amount),
                "expense_date": json_ready(e.expense_date),
                "branch_code": e.branch_code,
                "status": e.status,
                "payment_status": e.payment_status,
                "description": e.description,
            }
            for e in items
        ],
    }


def _t_get_expense(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc

    exp = fsvc.ExpenseService(db).get_expense(int(args["expense_id"]))
    _check_entity_branch(user, exp.branch_code, "expense")
    return json_ready(
        {
            "id": exp.id,
            "expenses_no": exp.expenses_no,
            "expense_type": exp.expense_type,
            "expense_category": exp.expense_category,
            "expenses_method": exp.expenses_method,
            "amount": exp.expense_amount,
            "expense_date": exp.expense_date,
            "vendor_name": exp.vendor_name,
            "description": exp.description,
            "receipt_number": exp.receipt_number,
            "branch_code": exp.branch_code,
            "status": exp.status,
            "payment_status": exp.payment_status,
            "payment_method": exp.payment_method,
            "payment_date": exp.payment_date,
            "account_code": exp.account_code,
            "approved_by": exp.approved_by,
            "rejection_reason": exp.rejection_reason,
        }
    )


def _t_list_bank_deposits(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc, schemas as fschemas

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    limit = min(int(args.get("limit") or 20), 25)
    deposits = fsvc.BankDepositService(db).list_deposits(
        fschemas.PaymentListFilter(
            branch_code=branch,
            branch_codes=allowed,
            verified=args.get("verified"),
            date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
            date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
            skip=0,
            limit=limit,
        )
    )
    if not deposits:
        return {"message": "No bank deposits match the given filters."}
    return [
        {
            "id": d.id,
            "amount": json_ready(d.deposits_amount),
            "bank_name": d.bank_name,
            "branch_code": d.branch_code,
            "verified": bool(d.verified),
            "status": getattr(d, "status", None),
            "created_date": json_ready(d.created_date),
            "remarks": d.remarks,
        }
        for d in deposits
    ]


def _t_list_journal_entries(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import JournalEntryService
    from app.modules.finance import accounting_schemas as aschemas

    limit = min(int(args.get("limit") or 20), 25)
    items, total = JournalEntryService(db).list_journal_entries(
        aschemas.JournalEntryListFilter(
            status=args.get("status"),
            entry_type=args.get("entry_type"),
            branch_code=args.get("branch_code"),
            fiscal_year=args.get("fiscal_year"),
            fiscal_period=args.get("fiscal_period"),
            date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
            date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
            search=args.get("search"),
            skip=0,
            limit=limit,
        )
    )
    if not items:
        return {"message": "No journal entries match the given filters.", "total": total}
    return {
        "total": total,
        "journal_entries": [
            {
                "id": je.id,
                "journal_entry_no": je.journal_entry_no,
                "entry_date": json_ready(je.entry_date),
                "entry_type": je.entry_type,
                "description": je.description,
                "total_debit": json_ready(je.total_debit),
                "status": je.status,
                "branch_code": je.branch_code,
            }
            for je in items
        ],
    }


def _t_get_journal_entry(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import JournalEntryService
    from app.modules.finance.accounting_models import ChartOfAccounts

    je = JournalEntryService(db).get_journal_entry(int(args["je_id"]))
    lines = []
    for ln in (je.lines or []):
        acc = (
            db.query(ChartOfAccounts.account_code, ChartOfAccounts.account_name)
            .filter(ChartOfAccounts.id == ln.account_id)
            .first()
        )
        lines.append(
            {
                "account_code": acc[0] if acc else None,
                "account_name": acc[1] if acc else None,
                "debit": json_ready(ln.debit_amount),
                "credit": json_ready(ln.credit_amount),
                "description": ln.description,
            }
        )
    return json_ready(
        {
            "id": je.id,
            "journal_entry_no": je.journal_entry_no,
            "entry_date": je.entry_date,
            "posting_date": je.posting_date,
            "entry_type": je.entry_type,
            "description": je.description,
            "total_debit": je.total_debit,
            "total_credit": je.total_credit,
            "status": je.status,
            "fiscal_year": je.fiscal_year,
            "fiscal_period": je.fiscal_period,
            "branch_code": je.branch_code,
            "lines": lines,
        }
    )


def _t_list_chart_of_accounts(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import ChartOfAccountsService
    from app.modules.finance import accounting_schemas as aschemas

    accounts = ChartOfAccountsService(db).list_accounts(
        aschemas.COAListFilter(
            account_type=args.get("account_type"),
            account_category=args.get("account_category"),
            is_active=args.get("is_active"),
            search=args.get("search"),
            parent_account_id=args.get("parent_account_id"),
        )
    )
    limit = min(int(args.get("limit") or 50), 100)
    if not accounts:
        return {"message": "No accounts match the given filters."}
    return [
        {
            "id": a.id,
            "account_code": a.account_code,
            "account_name": a.account_name,
            "account_type": a.account_type,
            "account_category": a.account_category,
            "normal_balance": a.normal_balance,
            "is_active": bool(a.is_active),
            "current_balance": json_ready(getattr(a, "current_balance", None)),
        }
        for a in accounts[:limit]
    ]


def _t_get_trial_balance(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import GeneralLedgerService

    fiscal_year = int(args.get("fiscal_year") or tz.today().year)
    resp = GeneralLedgerService(db).get_trial_balance(
        fiscal_year=fiscal_year,
        fiscal_period=int(args["fiscal_period"]) if args.get("fiscal_period") else None,
        as_of_date=date.fromisoformat(args["as_of_date"]) if args.get("as_of_date") else None,
    )
    return json_ready(resp.model_dump())


def _t_get_income_statement(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import GeneralLedgerService

    fiscal_year = int(args.get("fiscal_year") or tz.today().year)
    resp = GeneralLedgerService(db).get_income_statement(
        fiscal_year=fiscal_year,
        fiscal_period=int(args["fiscal_period"]) if args.get("fiscal_period") else None,
        date_from=date.fromisoformat(args["date_from"]) if args.get("date_from") else None,
        date_to=date.fromisoformat(args["date_to"]) if args.get("date_to") else None,
    )
    return json_ready(resp.model_dump())


def _t_get_balance_sheet(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance.accounting_service import GeneralLedgerService

    fiscal_year = int(args.get("fiscal_year") or tz.today().year)
    resp = GeneralLedgerService(db).get_balance_sheet(
        fiscal_year=fiscal_year,
        as_of_date=date.fromisoformat(args["as_of_date"]) if args.get("as_of_date") else None,
    )
    return json_ready(resp.model_dump())


def _t_list_credit_notes(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc

    notes = fsvc.CustomerCreditNoteService(db).list_all_credit_notes(
        customer_id=int(args["customer_id"]) if args.get("customer_id") else None
    )
    limit = min(int(args.get("limit") or 20), 25)
    if not notes:
        return {"message": "No credit notes found."}
    return [
        {
            "id": n.id,
            "customer_id": n.customer_id,
            "amount": json_ready(n.amount),
            "remark": n.remark,
            "invoice_no": n.invoice_no,
            "date": json_ready(getattr(n, "date", None) or getattr(n, "created_date", None)),
        }
        for n in notes[:limit]
    ]


def _t_get_customer_credit_balance(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc

    customer_id = int(args["customer_id"])
    balance = fsvc.CustomerCreditNoteService(db).get_customer_credit_balance(customer_id)
    return {
        "customer_id": customer_id,
        "available_credit_balance": json_ready(balance),
    }


def _t_list_customer_advances(db: Session, user: User, args: Dict) -> Any:
    from app.modules.finance import service as fsvc

    branch, allowed = _resolve_branch_filter(user, args.get("branch_code"))
    advances = fsvc.CustomerAdvancePaymentService(db).list_all_advances(
        branch_code=branch,
        branch_codes=allowed,
        customer_id=int(args["customer_id"]) if args.get("customer_id") else None,
    )
    limit = min(int(args.get("limit") or 20), 25)
    if not advances:
        return {"message": "No advance payments match the given filters."}
    return [
        {
            "id": a.id,
            "advance_payments_no": a.advance_payments_no,
            "customer_id": a.customer_id,
            "payment_amount": json_ready(a.payment_amount),
            "applied_amount": json_ready(getattr(a, "applied_amount", None)),
            "payment_method": a.payment_method,
            "branch_code": a.branch_code,
            "created_date": json_ready(a.created_date),
            "active": bool(a.active),
        }
        for a in advances[:limit]
    ]


# ─── finance: write (validate + execute) ────────────────────────────────────

def _v_create_expense(db: Session, user: User, args: Dict) -> Dict:
    for f in ("expense_category", "expenses_method", "expense_amount", "branch_code"):
        if not args.get(f):
            raise ToolError(f"{f} is required.")
    branch = args["branch_code"]
    if not validate_branch_access(user, branch):
        raise ToolError(f"You don't have access to branch '{branch}'.")
    return {
        "action": "Create expense",
        "expense_category": args["expense_category"],
        "expenses_method": args["expenses_method"],
        "amount": _fmt_money(args["expense_amount"]),
        "branch_code": branch,
        "vendor_name": args.get("vendor_name"),
        "expense_date": args.get("expense_date"),
        "description": args.get("description"),
    }


def _x_create_expense(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc, schemas as fschemas

    payload = fschemas.ExpenseCreate(
        expense_type=args.get("expense_type") or "operational",
        expense_category=args["expense_category"],
        expenses_method=args["expenses_method"],
        expense_amount=Decimal(str(args["expense_amount"])),
        branch_code=args["branch_code"],
        expense_date=date.fromisoformat(args["expense_date"]) if args.get("expense_date") else None,
        vendor_name=args.get("vendor_name"),
        description=args.get("description"),
        receipt_number=args.get("receipt_number"),
        remarks=args.get("remarks"),
        account_code=args.get("account_code"),
    )
    exp = fsvc.ExpenseService(db).create_expense(payload, submitted_by=user.id)
    return {
        "expense_id": exp.id,
        "expenses_no": exp.expenses_no,
        "summary": (
            f"Expense {exp.expenses_no} created for {_fmt_money(exp.expense_amount)} "
            f"(status: {exp.status})."
        ),
    }


def _v_submit_expense(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc

    exp = fsvc.ExpenseService(db).get_expense(int(args["expense_id"]))
    _check_entity_branch(user, exp.branch_code, "expense")
    return {
        "action": "Submit expense for approval",
        "expenses_no": exp.expenses_no,
        "amount": _fmt_money(exp.expense_amount),
        "current_status": exp.status,
    }


def _x_submit_expense(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc

    exp = fsvc.ExpenseService(db).submit_expense(int(args["expense_id"]), submitted_by=user.id)
    return {
        "expense_id": exp.id,
        "status": exp.status,
        "summary": f"Expense {exp.expenses_no} submitted for approval.",
    }


def _v_approve_expense(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc

    exp = fsvc.ExpenseService(db).get_expense(int(args["expense_id"]))
    _check_entity_branch(user, exp.branch_code, "expense")
    approve = bool(args.get("approve", True))
    reason = args.get("rejection_reason") or args.get("remarks")
    if not approve and not reason:
        raise ToolError("A rejection_reason is required to reject an expense.")
    return {
        "action": "Approve expense" if approve else "Reject expense",
        "expenses_no": exp.expenses_no,
        "amount": _fmt_money(exp.expense_amount),
        "current_status": exp.status,
        "reason": reason,
    }


def _x_approve_expense(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc

    svc = fsvc.ExpenseService(db)
    eid = int(args["expense_id"])
    approve = bool(args.get("approve", True))
    if approve:
        exp = svc.approve_expense(eid, approved_by=user.id, remarks=args.get("remarks"))
    else:
        reason = args.get("rejection_reason") or args.get("remarks") or "Rejected"
        exp = svc.reject_expense(eid, rejected_by=user.id, rejection_reason=reason)
    return {
        "expense_id": exp.id,
        "status": exp.status,
        "summary": f"Expense {exp.expenses_no} {'approved' if approve else 'rejected'}.",
    }


def _v_create_bank_deposit(db: Session, user: User, args: Dict) -> Dict:
    if not args.get("deposits_amount") or not args.get("branch_code"):
        raise ToolError("deposits_amount and branch_code are required.")
    branch = args["branch_code"]
    if not validate_branch_access(user, branch):
        raise ToolError(f"You don't have access to branch '{branch}'.")
    return {
        "action": "Create bank deposit",
        "amount": _fmt_money(args["deposits_amount"]),
        "branch_code": branch,
        "bank_name": args.get("bank_name"),
        "remarks": args.get("remarks"),
    }


def _x_create_bank_deposit(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc, schemas as fschemas

    payload = fschemas.BankDepositCreate(
        deposits_amount=Decimal(str(args["deposits_amount"])),
        branch_code=args["branch_code"],
        bank_name=args.get("bank_name"),
        remarks=args.get("remarks"),
        payment_for=args.get("payment_for"),
        invoice_no=args.get("invoice_no"),
        user_id=user.id,
    )
    dep = fsvc.BankDepositService(db).create_deposit(payload, created_by=user.id)
    return {
        "deposit_id": dep.id,
        "summary": (
            f"Bank deposit of {_fmt_money(dep.deposits_amount)} created for branch "
            f"{dep.branch_code} (status: {getattr(dep, 'status', 'pending')})."
        ),
    }


def _v_verify_bank_deposit(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc

    dep = fsvc.BankDepositService(db).get_deposit(int(args["deposit_id"]))
    _check_entity_branch(user, dep.branch_code, "bank deposit")
    return {
        "action": "Verify bank deposit",
        "deposit_id": dep.id,
        "amount": _fmt_money(dep.deposits_amount),
        "branch_code": dep.branch_code,
        "current_verified": bool(dep.verified),
    }


def _x_verify_bank_deposit(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance import service as fsvc

    dep = fsvc.BankDepositService(db).verify_deposit(int(args["deposit_id"]), user_id=user.id)
    return {
        "deposit_id": dep.id,
        "verified": bool(dep.verified),
        "summary": f"Bank deposit #{dep.id} verified.",
    }


def _v_create_journal_entry(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance.accounting_models import ChartOfAccounts

    lines = args.get("lines") or []
    if len(lines) < 2:
        raise ToolError("A journal entry needs at least 2 lines (debits and credits).")
    if not args.get("description"):
        raise ToolError("description is required.")
    if not args.get("entry_date"):
        raise ToolError("entry_date (YYYY-MM-DD) is required.")
    total_debit = sum(Decimal(str(ln.get("debit_amount") or 0)) for ln in lines)
    total_credit = sum(Decimal(str(ln.get("credit_amount") or 0)) for ln in lines)
    if total_debit != total_credit:
        raise ToolError(
            f"Journal entry is unbalanced: debits {total_debit} != credits {total_credit}."
        )
    if total_debit == 0:
        raise ToolError("Journal entry total cannot be zero.")
    branch = args.get("branch_code")
    if branch and not validate_branch_access(user, branch):
        raise ToolError(f"You don't have access to branch '{branch}'.")
    ids = [int(ln["account_id"]) for ln in lines if ln.get("account_id")]
    name_map = dict(
        db.query(ChartOfAccounts.id, ChartOfAccounts.account_name)
        .filter(ChartOfAccounts.id.in_(ids))
        .all()
    ) if ids else {}
    return {
        "action": "Create journal entry",
        "entry_date": args["entry_date"],
        "description": args["description"],
        "branch_code": branch,
        "total_debit": _fmt_money(total_debit),
        "total_credit": _fmt_money(total_credit),
        "lines": [
            {
                "account": name_map.get(int(ln["account_id"]), ln.get("account_id")),
                "debit": _fmt_money(ln.get("debit_amount") or 0),
                "credit": _fmt_money(ln.get("credit_amount") or 0),
            }
            for ln in lines
        ],
    }


def _x_create_journal_entry(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance.accounting_service import JournalEntryService
    from app.modules.finance import accounting_schemas as aschemas

    lines = []
    for i, ln in enumerate(args["lines"], start=1):
        lines.append(
            aschemas.JournalEntryLineCreate(
                line_number=int(ln.get("line_number") or i),
                account_id=int(ln["account_id"]),
                debit_amount=Decimal(str(ln.get("debit_amount") or 0)),
                credit_amount=Decimal(str(ln.get("credit_amount") or 0)),
                description=ln.get("description"),
            )
        )
    payload = aschemas.JournalEntryCreate(
        entry_date=date.fromisoformat(args["entry_date"]),
        posting_date=date.fromisoformat(args["posting_date"]) if args.get("posting_date") else None,
        entry_type=args.get("entry_type") or "Manual",
        description=args["description"],
        branch_code=args.get("branch_code"),
        lines=lines,
    )
    je = JournalEntryService(db).create_journal_entry(payload, created_by=user.id)
    return {
        "journal_entry_id": je.id,
        "journal_entry_no": je.journal_entry_no,
        "status": je.status,
        "summary": (
            f"Journal entry {je.journal_entry_no} created "
            f"({_fmt_money(je.total_debit)}, status: {je.status})."
        ),
    }


def _v_post_journal_entry(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance.accounting_service import JournalEntryService

    je = JournalEntryService(db).get_journal_entry(int(args["je_id"]))
    _check_entity_branch(user, je.branch_code, "journal entry")
    return {
        "action": "Post journal entry to the general ledger",
        "journal_entry_no": je.journal_entry_no,
        "amount": _fmt_money(je.total_debit),
        "current_status": je.status,
    }


def _x_post_journal_entry(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance.accounting_service import JournalEntryService

    je = JournalEntryService(db).post_journal_entry(int(args["je_id"]), posted_by=user.id)
    return {
        "journal_entry_id": je.id,
        "status": je.status,
        "summary": f"Journal entry {je.journal_entry_no} posted to the general ledger.",
    }


def _v_approve_journal_entry(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance.accounting_service import JournalEntryService

    je = JournalEntryService(db).get_journal_entry(int(args["je_id"]))
    _check_entity_branch(user, je.branch_code, "journal entry")
    approve = bool(args.get("approve", True))
    reason = args.get("reason") or args.get("remarks")
    if not approve and not reason:
        raise ToolError("A reason is required to reject a journal entry.")
    return {
        "action": "Approve journal entry" if approve else "Reject journal entry",
        "journal_entry_no": je.journal_entry_no,
        "amount": _fmt_money(je.total_debit),
        "current_status": je.status,
        "reason": reason,
    }


def _x_approve_journal_entry(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.finance.accounting_service import JournalEntryService

    svc = JournalEntryService(db)
    jid = int(args["je_id"])
    approve = bool(args.get("approve", True))
    if approve:
        je = svc.approve_journal_entry(jid, approved_by=user.id, remarks=args.get("remarks"))
    else:
        reason = args.get("reason") or args.get("remarks") or "Rejected"
        je = svc.reject_journal_entry(jid, rejected_by=user.id, reason=reason)
    return {
        "journal_entry_id": je.id,
        "status": je.status,
        "summary": f"Journal entry {je.journal_entry_no} {'approved' if approve else 'rejected'}.",
    }


# ─── registry ──────────────────────────────────────────────────────────────

# ── approvals: unified read + resolve (all modules) ──

def _split_approval_for(
    approval_for: Optional[str],
) -> Tuple[Optional[str], Optional[int], Optional[str]]:
    """Parse an ``approval_for`` value (format ``type:id:reference_no``)."""
    if not approval_for:
        return None, None, None
    parts = approval_for.split(":")
    a_type = parts[0] or None
    ref_id: Optional[int] = None
    if len(parts) >= 2:
        try:
            ref_id = int(parts[1])
        except (ValueError, TypeError):
            ref_id = None
    ref_no = parts[2] if len(parts) >= 3 else None
    return a_type, ref_id, ref_no


# Specific "<module>_approval:approve" perms that let a user act on approvals.
_APPROVAL_APPROVE_PERMS: List[Tuple[str, str]] = [
    Permissions.SO_APPROVAL_APPROVE,
    Permissions.SALES_RETURN_APPROVAL_APPROVE,
    Permissions.PO_APPROVAL_APPROVE,
    Permissions.PURCHASE_RETURN_APPROVAL_APPROVE,
    Permissions.ITN_APPROVAL_APPROVE,
    Permissions.PAYMENT_APPROVAL_APPROVE,
    Permissions.EXPENSE_APPROVAL_APPROVE,
    Permissions.LEAVE_APPROVAL_APPROVE,
    Permissions.REIMBURSEMENT_APPROVAL_APPROVE,
    Permissions.PAYROLL_APPROVAL_APPROVE,
    Permissions.COMMISSION_PAYMENT_APPROVAL_APPROVE,
    Permissions.COMMISSION_APPROVAL_APPROVE,
]


def _has_common_update(user: User) -> bool:
    return user_has_permission(
        user, Permissions.COMMON_UPDATE[0], Permissions.COMMON_UPDATE[1]
    )


def _approval_perm_check(specific: Tuple[str, str]) -> Callable[[User], bool]:
    """Permission predicate for one approval type: the specific approve
    permission OR the broad ``common:update`` (mirrors the REST dashboard)."""

    def _check(user: User) -> bool:
        return user_has_permission(
            user, specific[0], specific[1]
        ) or _has_common_update(user)

    return _check


def _can_use_general_approvals(user: User) -> bool:
    """Expose the cross-module approval tools when the user can act on at least
    one approval type — i.e. ``common:update`` or any specific approve right."""
    if _has_common_update(user):
        return True
    return any(user_has_permission(user, p[0], p[1]) for p in _APPROVAL_APPROVE_PERMS)


def _t_list_pending_approvals(db: Session, user: User, args: Dict) -> Any:
    from app.modules.common.approval_service import (
        ApprovalType,
        approval_service as _approval_svc,
    )

    limit = min(int(args.get("limit") or 20), 25)
    type_filter = None
    raw_type = args.get("approval_type")
    if raw_type:
        try:
            type_filter = ApprovalType(raw_type)
        except ValueError:
            valid = ", ".join(t.value for t in ApprovalType)
            raise ToolError(
                f"Unknown approval_type '{raw_type}'. Valid types: {valid}."
            )
    rows = _approval_svc.get_pending_approvals(db, type_filter, None, 0, limit)
    out = []
    for a in rows:
        a_type, ref_id, ref_no = _split_approval_for(a.approval_for)
        out.append(
            {
                "approval_id": a.id,
                "type": a_type,
                "reference_id": ref_id,
                "reference_no": ref_no,
                "status": a.status,
                "remark": a.remark,
                "next_approval_group": a.next_approval_group,
                "can_resolve": _approval_svc.can_user_resolve(user, a.approval_for),
            }
        )
    return {"count": len(out), "pending_approvals": out}


def _v_resolve_approval(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.common.approval_service import approval_service as _approval_svc
    from app.modules.common.models import Approvals

    approval_id = args.get("approval_id")
    if not approval_id:
        raise ToolError("approval_id is required.")
    approve = bool(args.get("approve", True))
    remarks = args.get("remarks")
    if not approve and not remarks:
        raise ToolError("A reason (remarks) is required to reject an approval.")

    approval = db.query(Approvals).filter(Approvals.id == int(approval_id)).first()
    if not approval:
        raise ToolError(f"Approval #{approval_id} not found.")
    if approval.status != "pending":
        raise ToolError(
            f"Approval #{approval_id} is not pending (current status: {approval.status})."
        )
    if not _approval_svc.can_user_resolve(user, approval.approval_for):
        req = _approval_svc.required_permission_for(approval.approval_for)
        raise ToolError(
            f"You don't have permission to resolve this approval. "
            f"Requires {req[0]}:{req[1]} or common:update."
        )

    a_type, ref_id, ref_no = _split_approval_for(approval.approval_for)
    action = "approve" if approve else "reject"
    return {
        "approval_id": approval.id,
        "type": a_type,
        "reference_id": ref_id,
        "reference_no": ref_no,
        "action": action,
        "remarks": remarks,
        "summary": (
            f"{action.capitalize()} {a_type or 'record'} approval "
            f"{ref_no or ('#' + str(ref_id))} (approval #{approval.id})."
        ),
    }


def _x_resolve_approval(db: Session, user: User, args: Dict) -> Dict:
    from app.modules.common.approval_service import approval_service as _approval_svc

    approval_id = int(args["approval_id"])
    approve = bool(args.get("approve", True))
    remarks = args.get("remarks")
    approval = _approval_svc.resolve_decision(db, approval_id, user, approve, remarks)
    a_type, ref_id, ref_no = _split_approval_for(approval.approval_for)
    return {
        "approval_id": approval.id,
        "type": a_type,
        "reference_no": ref_no,
        "status": approval.status,
        "summary": (
            f"Approval #{approval.id} ({a_type or 'record'} "
            f"{ref_no or ref_id}) {'approved' if approve else 'rejected'}."
        ),
    }


@dataclass
class ToolSpec:
    name: str
    description: str
    parameters: Dict[str, Any]
    permission: Tuple[str, str]
    handler: Callable[[Session, User, Dict], Any]
    is_write: bool = False
    execute: Optional[Callable[[Session, User, Dict], Dict]] = field(default=None)
    permission_check: Optional[Callable[[User], bool]] = field(default=None)


def _params(props: Dict[str, Any], required: Optional[List[str]] = None) -> Dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or []}


_BRANCH_PROP = {"type": "string", "description": "Branch code to filter by (e.g. 'COL'). Omit to use all branches you can access."}
_LIMIT_PROP = {"type": "integer", "description": "Max rows (default 20, cap 25)."}

TOOLS: List[ToolSpec] = [
    # ── purchasing: read ──
    ToolSpec(
        name="get_purchasing_statistics",
        description="Purchasing dashboard KPIs: PO counts by status, totals, recent orders. Use for 'how is purchasing doing' questions.",
        parameters=_params({"branch_code": _BRANCH_PROP}),
        permission=Permissions.PURCHASING_DASHBOARD_VIEW,
        handler=_t_purchasing_statistics,
    ),
    ToolSpec(
        name="list_purchase_orders",
        description="List purchase orders with filters. Statuses: draft, pending, pending_approval, approved, partially_completed, completed, rejected, cancelled.",
        parameters=_params(
            {
                "status": {"type": "string"},
                "supplier_id": {"type": "integer"},
                "branch_code": _BRANCH_PROP,
                "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.PURCHASE_ORDER_VIEW,
        handler=_t_list_purchase_orders,
    ),
    ToolSpec(
        name="get_purchase_order",
        description="Full details of one purchase order including line items.",
        parameters=_params({"order_id": {"type": "integer"}}, ["order_id"]),
        permission=Permissions.PURCHASE_ORDER_VIEW,
        handler=_t_get_purchase_order,
    ),
    ToolSpec(
        name="list_suppliers",
        description="Search suppliers by name/company. Returns contact + credit terms.",
        parameters=_params(
            {
                "search": {"type": "string", "description": "Name or company substring"},
                "active": {"type": "boolean"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.SUPPLIER_VIEW,
        handler=_t_list_suppliers,
    ),
    ToolSpec(
        name="get_supplier_credit_status",
        description="Supplier credit position: limit, exposure, available credit, overdue count, top unpaid GRNs.",
        parameters=_params({"supplier_id": {"type": "integer"}}, ["supplier_id"]),
        permission=Permissions.SUPPLIER_VIEW,
        handler=_t_supplier_credit_status,
    ),
    ToolSpec(
        name="get_supplier_payment_status",
        description="Everything we owe one supplier: outstanding credit + non-credit documents with due dates and overdue flags. Use for 'what do we owe X'.",
        parameters=_params({"supplier_id": {"type": "integer"}}, ["supplier_id"]),
        permission=Permissions.SUPPLIER_VIEW,
        handler=_t_supplier_payment_status,
    ),
    ToolSpec(
        name="list_grns",
        description="List Good Received Notes (goods receipts).",
        parameters=_params(
            {
                "branch_code": _BRANCH_PROP,
                "date_from": {"type": "string"},
                "date_to": {"type": "string"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.GRN_VIEW,
        handler=_t_list_grns,
    ),
    ToolSpec(
        name="get_outstanding_grns",
        description="GRNs received but not yet invoiced by the supplier (unvouchered receipts).",
        parameters=_params({"supplier_id": {"type": "integer"}, "branch_code": _BRANCH_PROP}),
        permission=Permissions.PURCHASE_ORDER_VIEW,
        handler=_t_outstanding_grns,
    ),
    ToolSpec(
        name="list_purchase_invoices",
        description="List supplier purchase invoices. payment_status: unpaid, partial, paid. Set overdue_only=true for overdue bills.",
        parameters=_params(
            {
                "supplier_id": {"type": "integer"},
                "status": {"type": "string"},
                "payment_status": {"type": "string"},
                "branch_code": _BRANCH_PROP,
                "overdue_only": {"type": "boolean"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.PURCHASE_ORDER_VIEW,
        handler=_t_list_purchase_invoices,
    ),
    ToolSpec(
        name="get_payables_aging",
        description="Accounts-payable aging report (current / 30 / 60 / 90+ buckets), optionally for one supplier.",
        parameters=_params({"supplier_id": {"type": "integer"}}),
        permission=Permissions.SUPPLIER_PAYMENT_VIEW,
        handler=_t_payables_aging,
    ),
    ToolSpec(
        name="list_supplier_payments",
        description="List supplier payments. status: pending, verified, cancelled.",
        parameters=_params(
            {
                "supplier_id": {"type": "integer"},
                "status": {"type": "string"},
                "branch_code": _BRANCH_PROP,
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.SUPPLIER_PAYMENT_VIEW,
        handler=_t_list_supplier_payments,
    ),
    # ── sales stock: read ──
    ToolSpec(
        name="get_stock_summary",
        description="Stock LEVELS per product per branch (units counted by status: available/sold/reserved/damaged). Inventory is unit-serialized — 'stock level' means count of available units. Use product_search to find by name.",
        parameters=_params(
            {
                "product_id": {"type": "integer"},
                "product_search": {"type": "string", "description": "Product name substring"},
                "branch_code": _BRANCH_PROP,
            }
        ),
        permission=Permissions.SALES_STOCK_VIEW,
        handler=_t_stock_summary,
    ),
    ToolSpec(
        name="list_stock_items",
        description="List individual serialized stock units (barcodes), or look one up by exact barcode.",
        parameters=_params(
            {
                "barcode": {"type": "string", "description": "Exact barcode lookup"},
                "product_id": {"type": "integer"},
                "status": {"type": "string", "description": "available, sold, reserved, damaged, transferred…"},
                "branch_code": _BRANCH_PROP,
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.SALES_STOCK_VIEW,
        handler=_t_list_stock_items,
    ),
    ToolSpec(
        name="get_stock_tracking",
        description="Full movement history of one stock unit by barcode: GRN receipt → transfers → sale → returns.",
        parameters=_params({"barcode": {"type": "string"}}, ["barcode"]),
        permission=Permissions.SALES_STOCK_VIEW,
        handler=_t_stock_tracking,
    ),
    # ── writes (two-phase confirm) ──
    ToolSpec(
        name="create_supplier",
        description="Create a new supplier. WRITE ACTION — queues a confirmation the user must approve in the UI. Gather full_name and mobile_contact_number at minimum.",
        parameters=_params(
            {
                "full_name": {"type": "string"},
                "company_name": {"type": "string"},
                "mobile_contact_number": {"type": "string"},
                "email": {"type": "string"},
                "postal_address": {"type": "string"},
                "credit_days": {"type": "integer"},
                "max_credit_limit": {"type": "number"},
            },
            ["full_name", "mobile_contact_number"],
        ),
        permission=Permissions.SUPPLIER_CREATE,
        handler=_v_create_supplier,
        is_write=True,
        execute=_x_create_supplier,
    ),
    ToolSpec(
        name="create_purchase_order",
        description="Create a purchase order. WRITE ACTION — queues a confirmation the user must approve in the UI. Requires supplier_id, branch_code and items. payment_method: cash, credit, cheque or bank_transfer.",
        parameters=_params(
            {
                "supplier_id": {"type": "integer"},
                "branch_code": {"type": "string"},
                "payment_method": {"type": "string"},
                "order_date": {"type": "string", "description": "ISO date, default today"},
                "expected_date": {"type": "string", "description": "Expected goods receipt date, default today"},
                "credit_days": {"type": "integer"},
                "remarks": {"type": "string"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "product_id": {"type": "integer"},
                            "quantity": {"type": "integer"},
                            "unit_price": {"type": "number"},
                            "warranty_months": {"type": "integer"},
                        },
                        "required": ["product_id", "quantity", "unit_price"],
                    },
                },
            },
            ["supplier_id", "branch_code", "payment_method", "items"],
        ),
        permission=Permissions.PURCHASE_ORDER_CREATE,
        handler=_v_create_purchase_order,
        is_write=True,
        execute=_x_create_purchase_order,
    ),
    ToolSpec(
        name="approve_purchase_order",
        description="Approve or reject a pending purchase order. WRITE ACTION — queues a confirmation the user must approve in the UI.",
        parameters=_params(
            {
                "order_id": {"type": "integer"},
                "approve": {"type": "boolean", "description": "true to approve, false to reject"},
                "remarks": {"type": "string"},
            },
            ["order_id"],
        ),
        permission=Permissions.PO_APPROVAL_APPROVE,
        handler=_v_approve_purchase_order,
        is_write=True,
        execute=_x_approve_purchase_order,
        permission_check=_approval_perm_check(Permissions.PO_APPROVAL_APPROVE),
    ),
    ToolSpec(
        name="update_stock_status",
        description="Change a stock unit's status between available/reserved/damaged (e.g. mark a unit damaged). WRITE ACTION — queues a confirmation the user must approve in the UI.",
        parameters=_params(
            {
                "barcode": {"type": "string"},
                "new_status": {"type": "string", "enum": ["available", "reserved", "damaged"]},
            },
            ["barcode", "new_status"],
        ),
        permission=Permissions.SALES_STOCK_UPDATE,
        handler=_v_update_stock_status,
        is_write=True,
        execute=_x_update_stock_status,
    ),
    # ── company assets: read ──
    ToolSpec(
        name="list_company_assets",
        description=(
            "List company-owned assets (fixed assets / equipment tracked in company_assets). "
            "Filter by branch, product_id, status (available, in_use, retired, disposed, returned) "
            "or source (grn, sale_return). Use search to match by item/product/inventory number, "
            "or barcode for an exact unit."
        ),
        parameters=_params(
            {
                "search": {"type": "string", "description": "Item name / product / inventory-no substring"},
                "barcode": {"type": "string", "description": "Exact barcode lookup"},
                "product_id": {"type": "integer"},
                "status": {"type": "string", "description": "available, in_use, retired, disposed, returned"},
                "source": {"type": "string", "description": "grn or sale_return"},
                "branch_code": _BRANCH_PROP,
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.COMPANY_ASSET_VIEW,
        handler=_t_list_company_assets,
    ),
    # ── company assets: write ──
    ToolSpec(
        name="update_company_asset_status",
        description=(
            "Change a company asset's status (available, in_use, retired, disposed). Identify the "
            "asset by asset_id, barcode or inventory_no. WRITE ACTION — queues a confirmation the "
            "user must approve in the UI."
        ),
        parameters=_params(
            {
                "asset_id": {"type": "integer"},
                "barcode": {"type": "string"},
                "inventory_no": {"type": "string"},
                "new_status": {"type": "string", "enum": ["available", "in_use", "retired", "disposed"]},
            },
            ["new_status"],
        ),
        permission=Permissions.COMPANY_ASSET_UPDATE,
        handler=_v_update_company_asset_status,
        is_write=True,
        execute=_x_update_company_asset_status,
    ),
    # ── branches: read ──
    ToolSpec(
        name="list_branches",
        description="List company branches (locations) with code, name, address and contact. Set active_only=true to hide inactive branches. Use search to match by name or code.",
        parameters=_params(
            {
                "search": {"type": "string", "description": "Branch name or code substring"},
                "active_only": {"type": "boolean"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.BRANCH_VIEW,
        handler=_t_list_branches,
    ),
    # ── branches: write ──
    ToolSpec(
        name="create_branch",
        description="Create a new branch. WRITE ACTION — queues a confirmation the user must approve in the UI. Requires branch_name and a unique branch_code.",
        parameters=_params(
            {
                "branch_name": {"type": "string"},
                "branch_code": {"type": "string", "description": "Unique short code, e.g. 'COL'"},
                "address": {"type": "string"},
                "email": {"type": "string"},
                "contact_number": {"type": "string"},
                "active": {"type": "boolean"},
            },
            ["branch_name", "branch_code"],
        ),
        permission=Permissions.BRANCH_CREATE,
        handler=_v_create_branch,
        is_write=True,
        execute=_x_create_branch,
    ),
    # ── users: read ──
    ToolSpec(
        name="list_users",
        description="List system users (accounts). Search by username, name, email or employee ID. Shows each user's branches, groups and active status.",
        parameters=_params(
            {
                "search": {"type": "string", "description": "username / name / email / employee-id substring"},
                "active": {"type": "boolean"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.USER_VIEW,
        handler=_t_list_users,
    ),
    ToolSpec(
        name="get_user",
        description="Full details of one user account by ID: profile, branches, groups, active/blocked flags and last login.",
        parameters=_params({"user_id": {"type": "integer"}}, ["user_id"]),
        permission=Permissions.USER_VIEW,
        handler=_t_get_user,
    ),
    # ── sales: read ──
    ToolSpec(
        name="get_sales_statistics",
        description="Sales dashboard KPIs: order counts, revenue (total/this month/last month/today), average order value, pending approvals, sale-returns count and payment-method breakdown. Use for 'how are sales doing' questions.",
        parameters=_params({"branch_code": _BRANCH_PROP}),
        permission=Permissions.SALES_ORDER_VIEW,
        handler=_t_sales_statistics,
    ),
    ToolSpec(
        name="list_sales_orders",
        description="List sales orders / invoices with filters. status: pending, approved, completed, cancelled. search matches the invoice number.",
        parameters=_params(
            {
                "search": {"type": "string", "description": "Invoice number substring"},
                "status": {"type": "string", "description": "pending, approved, completed, cancelled"},
                "branch_code": _BRANCH_PROP,
                "page": {"type": "integer", "description": "Page number (default 1)"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.SALES_ORDER_VIEW,
        handler=_t_list_sales_orders,
    ),
    ToolSpec(
        name="get_sales_order",
        description="Full details of one sales order / invoice (line items, totals, payment + approval status). Look up by sales_order_id or invoice_no.",
        parameters=_params(
            {
                "sales_order_id": {"type": "integer"},
                "invoice_no": {"type": "string"},
            }
        ),
        permission=Permissions.SALES_ORDER_VIEW,
        handler=_t_get_sales_order,
    ),
    ToolSpec(
        name="list_sale_returns",
        description="List sale returns (customer returns) with their status, refund amount and linked invoice.",
        parameters=_params({"branch_code": _BRANCH_PROP, "limit": _LIMIT_PROP}),
        permission=Permissions.SALES_RETURN_VIEW,
        handler=_t_list_sale_returns,
    ),
    ToolSpec(
        name="list_customers",
        description="Search/list customers. Returns contact info and credit terms. Use search to match by name/company/phone.",
        parameters=_params(
            {
                "search": {"type": "string", "description": "Name / company / phone substring"},
                "active_only": {"type": "boolean"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.CUSTOMER_VIEW,
        handler=_t_list_customers,
    ),
    ToolSpec(
        name="get_customer_debt",
        description="A customer's outstanding debt: total outstanding, credit limit/days and a breakdown of unpaid/partial invoices with days overdue. Use for 'what does customer X owe'.",
        parameters=_params({"customer_id": {"type": "integer"}}, ["customer_id"]),
        permission=Permissions.SALES_ORDER_VIEW,
        handler=_t_get_customer_debt,
    ),
    ToolSpec(
        name="list_debtors",
        description="List debtors (customers with outstanding balances) with totals and aging status. status: all, current, overdue, critical.",
        parameters=_params(
            {
                "status": {"type": "string", "description": "all, current, overdue, critical"},
                "branch_code": _BRANCH_PROP,
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.SALES_ORDER_VIEW,
        handler=_t_list_debtors,
    ),
    ToolSpec(
        name="list_quotations",
        description="List quotations / proforma invoices. quote_type: quotation or proforma.",
        parameters=_params(
            {
                "quote_type": {"type": "string", "description": "quotation or proforma"},
                "branch_code": _BRANCH_PROP,
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.QUOTATION_VIEW,
        handler=_t_list_quotations,
    ),
    ToolSpec(
        name="get_quotation",
        description="Full details of one quotation / proforma including line items.",
        parameters=_params({"quote_id": {"type": "integer"}}, ["quote_id"]),
        permission=Permissions.QUOTATION_VIEW,
        handler=_t_get_quotation,
    ),
    # ── sales: write (two-phase confirm) ──
    ToolSpec(
        name="create_customer",
        description="Create a new customer. WRITE ACTION — queues a confirmation the user must approve in the UI. Gather customer_name and mobile_contact_number at minimum.",
        parameters=_params(
            {
                "customer_name": {"type": "string"},
                "company_name": {"type": "string"},
                "mobile_contact_number": {"type": "string"},
                "email": {"type": "string"},
                "title": {"type": "string", "description": "Mr/Ms/Mrs (default Mr)"},
                "occupation": {"type": "string"},
                "payment_address": {"type": "string"},
                "delivery_address": {"type": "string"},
                "credit_days": {"type": "integer"},
                "max_credit_limit": {"type": "number"},
                "is_customer_agent": {"type": "boolean"},
                "commission_rate": {"type": "number", "description": "Default commission % if the customer is an agent"},
            },
            ["customer_name", "mobile_contact_number"],
        ),
        permission=Permissions.CUSTOMER_CREATE,
        handler=_v_create_customer,
        is_write=True,
        execute=_x_create_customer,
    ),
    ToolSpec(
        name="create_quotation",
        description="Create a quotation or proforma invoice. WRITE ACTION — queues a confirmation the user must approve in the UI. Requires branch_code, customer_id, valid_until and items. Look up product IDs and the customer first.",
        parameters=_params(
            {
                "quote_type": {"type": "string", "enum": ["quotation", "proforma"]},
                "branch_code": {"type": "string"},
                "customer_id": {"type": "integer"},
                "valid_until": {"type": "string", "description": "ISO date YYYY-MM-DD the quote is valid until"},
                "remarks": {"type": "string"},
                "items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "product_id": {"type": "integer"},
                            "quantity": {"type": "integer"},
                            "selling_price": {"type": "number"},
                            "minimum_selling_price": {"type": "number"},
                            "warranty_months": {"type": "integer"},
                        },
                        "required": ["product_id", "quantity", "selling_price"],
                    },
                },
            },
            ["branch_code", "customer_id", "valid_until", "items"],
        ),
        permission=Permissions.QUOTATION_CREATE,
        handler=_v_create_quotation,
        is_write=True,
        execute=_x_create_quotation,
    ),
    ToolSpec(
        name="record_customer_payment",
        description="Record a customer payment against an outstanding invoice. WRITE ACTION — queues a confirmation the user must approve in the UI. The amount cannot exceed the invoice's outstanding balance.",
        parameters=_params(
            {
                "customer_id": {"type": "integer"},
                "invoice_id": {"type": "integer"},
                "amount": {"type": "number"},
                "payment_method": {"type": "string", "description": "cash, cheque, card, bank_transfer (default cash)"},
                "payment_date": {"type": "string", "description": "ISO date, default today"},
                "reference_no": {"type": "string"},
                "notes": {"type": "string"},
            },
            ["customer_id", "invoice_id", "amount"],
        ),
        permission=Permissions.SALES_ORDER_UPDATE,
        handler=_v_record_customer_payment,
        is_write=True,
        execute=_x_record_customer_payment,
    ),
    ToolSpec(
        name="approve_sales_order",
        description="Approve or reject a pending credit sales order. WRITE ACTION — queues a confirmation the user must approve in the UI. Rejecting cancels the order and restores stock. Identify by sales_order_id or invoice_no.",
        parameters=_params(
            {
                "sales_order_id": {"type": "integer"},
                "invoice_no": {"type": "string"},
                "approve": {"type": "boolean", "description": "true to approve, false to reject"},
                "remarks": {"type": "string"},
            }
        ),
        permission=Permissions.SO_APPROVAL_APPROVE,
        handler=_v_approve_sales_order,
        is_write=True,
        execute=_x_approve_sales_order,
        permission_check=_approval_perm_check(Permissions.SO_APPROVAL_APPROVE),
    ),
    ToolSpec(
        name="approve_sale_return",
        description="Approve or reject a pending sale return. WRITE ACTION — queues a confirmation the user must approve in the UI. Identify by return_id or sale_return_no.",
        parameters=_params(
            {
                "return_id": {"type": "integer"},
                "sale_return_no": {"type": "string"},
                "approve": {"type": "boolean", "description": "true to approve, false to reject"},
                "remarks": {"type": "string"},
            }
        ),
        permission=Permissions.SALES_RETURN_APPROVAL_APPROVE,
        handler=_v_approve_sale_return,
        is_write=True,
        execute=_x_approve_sale_return,
        permission_check=_approval_perm_check(Permissions.SALES_RETURN_APPROVAL_APPROVE),
    ),
    ToolSpec(
        name="return_invoice",
        description="Create a full sale return for every not-yet-returned unit on a completed invoice (one-click 'Return Invoice'). WRITE ACTION — queues a confirmation the user must approve in the UI; the return still needs approval to process the refund. Identify by sales_order_id or invoice_no.",
        parameters=_params(
            {
                "sales_order_id": {"type": "integer"},
                "invoice_no": {"type": "string"},
                "payment_method": {"type": "string", "description": "Refund method: cash, bank_transfer, credit_note or cheque (default credit_note)"},
                "return_reason": {"type": "string", "description": "defective, wrong_item, customer_changed_mind, damaged, other"},
                "remark": {"type": "string"},
            }
        ),
        permission=Permissions.SALES_RETURN_CREATE,
        handler=_v_return_invoice,
        is_write=True,
        execute=_x_return_invoice,
    ),
    # ── finance: read ──
    ToolSpec(
        name="get_finance_dashboard_stats",
        description="Accounting/finance dashboard KPIs: account counts, journal entry counts (draft/posted), GL totals, open/closed periods, current fiscal year & period. Use for 'how do the books look' or finance overview questions.",
        parameters=_params({}),
        permission=Permissions.FINANCE_DASHBOARD_VIEW,
        handler=_t_finance_dashboard_stats,
    ),
    ToolSpec(
        name="get_cashbook_summary",
        description="Cashbook summary: total money in/out, net movement, opening/closing balance, and breakdown by source (invoice receipts, credit settlements, advances, supplier payments, expenses, bank deposits). Use for 'cash position' / 'how much cash came in' questions.",
        parameters=_params(
            {
                "branch_code": _BRANCH_PROP,
                "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD"},
            }
        ),
        permission=Permissions.CASHBOOK_VIEW,
        handler=_t_get_cashbook_summary,
    ),
    ToolSpec(
        name="list_expenses",
        description="List expenses with filters. Statuses: pending, submitted, approved, rejected, paid, recorded. payment_status: unpaid, paid. Returns amount, category, vendor, status.",
        parameters=_params(
            {
                "branch_code": _BRANCH_PROP,
                "status": {"type": "string"},
                "expense_category": {"type": "string"},
                "payment_status": {"type": "string"},
                "search": {"type": "string"},
                "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.EXPENSE_VIEW,
        handler=_t_list_expenses,
    ),
    ToolSpec(
        name="get_expense",
        description="Full details of one expense including approval and payment status.",
        parameters=_params({"expense_id": {"type": "integer"}}, ["expense_id"]),
        permission=Permissions.EXPENSE_VIEW,
        handler=_t_get_expense,
    ),
    ToolSpec(
        name="list_bank_deposits",
        description="List bank deposits (cash transferred from shop to bank) with filters. Shows amount, bank, verified flag and status.",
        parameters=_params(
            {
                "branch_code": _BRANCH_PROP,
                "verified": {"type": "boolean"},
                "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.BANK_DEPOSIT_VIEW,
        handler=_t_list_bank_deposits,
    ),
    ToolSpec(
        name="list_journal_entries",
        description="List accounting journal entries with filters. Statuses: draft, submitted, approved, posted, reversed. entry_type: Manual, Auto, Adjustment, Closing.",
        parameters=_params(
            {
                "status": {"type": "string"},
                "entry_type": {"type": "string"},
                "branch_code": {"type": "string"},
                "fiscal_year": {"type": "integer"},
                "fiscal_period": {"type": "integer"},
                "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "search": {"type": "string"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.JOURNAL_ENTRY_VIEW,
        handler=_t_list_journal_entries,
    ),
    ToolSpec(
        name="get_journal_entry",
        description="Full details of one journal entry including its debit/credit lines with account names.",
        parameters=_params({"je_id": {"type": "integer"}}, ["je_id"]),
        permission=Permissions.JOURNAL_ENTRY_VIEW,
        handler=_t_get_journal_entry,
    ),
    ToolSpec(
        name="list_chart_of_accounts",
        description="List chart-of-accounts entries. Filter by account_type (Asset, Liability, Equity, Revenue, Expense), category, active flag, or search. Use this to find the account_id needed to build a journal entry.",
        parameters=_params(
            {
                "account_type": {"type": "string"},
                "account_category": {"type": "string"},
                "is_active": {"type": "boolean"},
                "search": {"type": "string", "description": "Account code or name substring"},
                "parent_account_id": {"type": "integer"},
                "limit": {"type": "integer", "description": "Max rows (default 50, cap 100)."},
            }
        ),
        permission=Permissions.CHART_OF_ACCOUNTS_VIEW,
        handler=_t_list_chart_of_accounts,
    ),
    ToolSpec(
        name="get_trial_balance",
        description="Trial balance report (per-account debit/credit totals) for a fiscal year, optionally a period or as-of date. Defaults to the current fiscal year.",
        parameters=_params(
            {
                "fiscal_year": {"type": "integer", "description": "Defaults to current year."},
                "fiscal_period": {"type": "integer", "description": "Optional month/period (1-12)."},
                "as_of_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
            }
        ),
        permission=Permissions.GENERAL_LEDGER_VIEW,
        handler=_t_get_trial_balance,
    ),
    ToolSpec(
        name="get_income_statement",
        description="Income Statement (Profit & Loss): revenue, expenses and net profit for a fiscal year/period or date range. Defaults to the current fiscal year.",
        parameters=_params(
            {
                "fiscal_year": {"type": "integer", "description": "Defaults to current year."},
                "fiscal_period": {"type": "integer"},
                "date_from": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "date_to": {"type": "string", "description": "ISO date YYYY-MM-DD"},
            }
        ),
        permission=Permissions.REPORTING_FINANCE_VIEW,
        handler=_t_get_income_statement,
    ),
    ToolSpec(
        name="get_balance_sheet",
        description="Balance Sheet (assets, liabilities and equity) as of a date within a fiscal year. Defaults to the current fiscal year.",
        parameters=_params(
            {
                "fiscal_year": {"type": "integer", "description": "Defaults to current year."},
                "as_of_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
            }
        ),
        permission=Permissions.REPORTING_FINANCE_VIEW,
        handler=_t_get_balance_sheet,
    ),
    ToolSpec(
        name="list_credit_notes",
        description="List customer credit notes (money the business owes back to customers). Optionally filter by customer_id.",
        parameters=_params(
            {
                "customer_id": {"type": "integer"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.CREDIT_NOTE_VIEW,
        handler=_t_list_credit_notes,
    ),
    ToolSpec(
        name="get_customer_credit_balance",
        description="Available credit-note balance a specific customer can still redeem.",
        parameters=_params({"customer_id": {"type": "integer"}}, ["customer_id"]),
        permission=Permissions.CREDIT_NOTE_VIEW,
        handler=_t_get_customer_credit_balance,
    ),
    ToolSpec(
        name="list_customer_advance_payments",
        description="List customer advance payments (prepayments received before invoicing), with applied vs remaining amounts. Optionally filter by customer_id.",
        parameters=_params(
            {
                "branch_code": _BRANCH_PROP,
                "customer_id": {"type": "integer"},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.CUSTOMER_ADVANCE_VIEW,
        handler=_t_list_customer_advances,
    ),
    # ── finance: write ──
    ToolSpec(
        name="create_expense",
        description="Record a new expense. WRITE ACTION — queues a confirmation the user must approve in the UI. The expense is created in 'pending' status and still needs to be submitted and approved.",
        parameters=_params(
            {
                "expense_category": {"type": "string", "description": "e.g. rent, utilities, salaries, miscellaneous"},
                "expenses_method": {"type": "string", "description": "Payment method: cash, bank_transfer, cheque, card"},
                "expense_amount": {"type": "number"},
                "branch_code": {"type": "string"},
                "expense_type": {"type": "string", "description": "operational (default) or capital"},
                "expense_date": {"type": "string", "description": "ISO date YYYY-MM-DD (defaults to today)"},
                "vendor_name": {"type": "string"},
                "description": {"type": "string"},
                "receipt_number": {"type": "string"},
                "account_code": {"type": "string"},
                "remarks": {"type": "string"},
            },
            ["expense_category", "expenses_method", "expense_amount", "branch_code"],
        ),
        permission=Permissions.EXPENSE_CREATE,
        handler=_v_create_expense,
        is_write=True,
        execute=_x_create_expense,
    ),
    ToolSpec(
        name="submit_expense",
        description="Submit a pending expense for approval (moves it from pending/rejected to submitted). WRITE ACTION — queues a confirmation the user must approve in the UI.",
        parameters=_params({"expense_id": {"type": "integer"}}, ["expense_id"]),
        permission=Permissions.EXPENSE_UPDATE,
        handler=_v_submit_expense,
        is_write=True,
        execute=_x_submit_expense,
    ),
    ToolSpec(
        name="approve_expense",
        description="Approve or reject a SUBMITTED expense. WRITE ACTION — queues a confirmation the user must approve in the UI. Rejecting requires a rejection_reason.",
        parameters=_params(
            {
                "expense_id": {"type": "integer"},
                "approve": {"type": "boolean", "description": "true to approve, false to reject"},
                "rejection_reason": {"type": "string", "description": "Required when rejecting."},
                "remarks": {"type": "string"},
            },
            ["expense_id"],
        ),
        permission=Permissions.EXPENSE_APPROVAL_APPROVE,
        handler=_v_approve_expense,
        is_write=True,
        execute=_x_approve_expense,
    ),
    ToolSpec(
        name="create_bank_deposit",
        description="Record a bank deposit (cash moved from the shop to the bank). WRITE ACTION — queues a confirmation the user must approve in the UI. Created in 'pending' status until verified.",
        parameters=_params(
            {
                "deposits_amount": {"type": "number"},
                "branch_code": {"type": "string"},
                "bank_name": {"type": "string"},
                "payment_for": {"type": "string"},
                "invoice_no": {"type": "string"},
                "remarks": {"type": "string"},
            },
            ["deposits_amount", "branch_code"],
        ),
        permission=Permissions.BANK_DEPOSIT_CREATE,
        handler=_v_create_bank_deposit,
        is_write=True,
        execute=_x_create_bank_deposit,
    ),
    ToolSpec(
        name="verify_bank_deposit",
        description="Verify (confirm) a pending bank deposit. WRITE ACTION — queues a confirmation the user must approve in the UI.",
        parameters=_params({"deposit_id": {"type": "integer"}}, ["deposit_id"]),
        permission=Permissions.BANK_TRANSFER_VERIFY_APPROVE,
        handler=_v_verify_bank_deposit,
        is_write=True,
        execute=_x_verify_bank_deposit,
    ),
    ToolSpec(
        name="create_journal_entry",
        description="Create a manual accounting journal entry (draft). WRITE ACTION — queues a confirmation the user must approve in the UI. Provide at least 2 balanced lines (total debits must equal total credits). Use list_chart_of_accounts to find account_id values.",
        parameters=_params(
            {
                "entry_date": {"type": "string", "description": "ISO date YYYY-MM-DD"},
                "description": {"type": "string"},
                "branch_code": {"type": "string"},
                "entry_type": {"type": "string", "description": "Manual (default), Adjustment, Closing"},
                "posting_date": {"type": "string", "description": "ISO date YYYY-MM-DD (defaults to entry_date)"},
                "lines": {
                    "type": "array",
                    "description": "At least 2 lines; total debit must equal total credit.",
                    "items": {
                        "type": "object",
                        "properties": {
                            "account_id": {"type": "integer"},
                            "debit_amount": {"type": "number", "description": "0 if this is a credit line"},
                            "credit_amount": {"type": "number", "description": "0 if this is a debit line"},
                            "description": {"type": "string"},
                        },
                        "required": ["account_id"],
                    },
                },
            },
            ["entry_date", "description", "lines"],
        ),
        permission=Permissions.JOURNAL_ENTRY_CREATE,
        handler=_v_create_journal_entry,
        is_write=True,
        execute=_x_create_journal_entry,
    ),
    ToolSpec(
        name="post_journal_entry",
        description="Post an approved journal entry to the general ledger (makes it final and updates account balances). WRITE ACTION — queues a confirmation the user must approve in the UI.",
        parameters=_params({"je_id": {"type": "integer"}}, ["je_id"]),
        permission=Permissions.JOURNAL_ENTRY_UPDATE,
        handler=_v_post_journal_entry,
        is_write=True,
        execute=_x_post_journal_entry,
    ),
    ToolSpec(
        name="approve_journal_entry",
        description="Approve or reject a SUBMITTED manual journal entry. WRITE ACTION — queues a confirmation the user must approve in the UI. Rejecting (sends it back to draft) requires a reason.",
        parameters=_params(
            {
                "je_id": {"type": "integer"},
                "approve": {"type": "boolean", "description": "true to approve, false to reject"},
                "reason": {"type": "string", "description": "Required when rejecting."},
                "remarks": {"type": "string"},
            },
            ["je_id"],
        ),
        permission=Permissions.PAYMENT_APPROVAL_APPROVE,
        handler=_v_approve_journal_entry,
        is_write=True,
        execute=_x_approve_journal_entry,
    ),
    # ── approvals: unified read + resolve (all modules) ──
    ToolSpec(
        name="list_pending_approvals",
        description="List pending approvals across ALL modules (sales orders, sale/purchase returns, purchase orders, item transfers, reimbursements, leave, expenses, payments, payroll, commissions...). Use for 'what needs approval'. Optionally filter by approval type. Each row includes approval_id and can_resolve (whether YOU may approve/reject it).",
        parameters=_params(
            {
                "approval_type": {"type": "string", "description": "Optional filter: sales_order, sale_return, purchase_order, purchase_return, item_transfer, reimbursement, leave, expense, payment_voucher, journal_entry, bank_deposit, payroll_batch, commission_payment, sales_quote."},
                "limit": _LIMIT_PROP,
            }
        ),
        permission=Permissions.COMMON_VIEW,
        handler=_t_list_pending_approvals,
    ),
    ToolSpec(
        name="resolve_approval",
        description="Approve or reject ANY pending approval by its approval_id (works for every module via the centralized approval system). WRITE ACTION — queues a confirmation the user must approve in the UI. Rejecting requires a reason (remarks). Get approval_id from list_pending_approvals. Permission is enforced per approval type (the specific approve permission OR common:update), exactly like the dashboard.",
        parameters=_params(
            {
                "approval_id": {"type": "integer"},
                "approve": {"type": "boolean", "description": "true to approve, false to reject"},
                "remarks": {"type": "string", "description": "Required when rejecting."},
            },
            ["approval_id"],
        ),
        permission=Permissions.COMMON_UPDATE,
        handler=_v_resolve_approval,
        is_write=True,
        execute=_x_resolve_approval,
        permission_check=_can_use_general_approvals,
    ),
]

TOOLS_BY_NAME: Dict[str, ToolSpec] = {t.name: t for t in TOOLS}


def user_can_use_tool(user: User, spec: ToolSpec) -> bool:
    """A tool is usable when its custom ``permission_check`` passes; otherwise
    when the user holds the tool's nominal ``permission`` tuple. Approval tools
    set ``permission_check`` so a user with ``common:update`` (the broad
    approver right) can act on every approval type, exactly like the dashboard."""
    if spec.permission_check is not None:
        return spec.permission_check(user)
    return user_has_permission(user, *spec.permission)


def get_allowed_tools(user: User) -> List[ToolSpec]:
    """Only tools the user is allowed to call — the model never sees tools it
    cannot use."""
    return [t for t in TOOLS if user_can_use_tool(user, t)]


def openai_tool_defs(specs: List[ToolSpec]) -> List[Dict[str, Any]]:
    return [
        {
            "type": "function",
            "function": {
                "name": s.name,
                "description": s.description,
                "parameters": s.parameters,
            },
        }
        for s in specs
    ]
