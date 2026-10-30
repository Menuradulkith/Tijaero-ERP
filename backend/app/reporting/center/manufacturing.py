"""Manufacturing reports: work in progress, production cost variance, production
summary, BOM cost roll-up and lot traceability.

Figures come from what the production orders stored and posted (material issued,
labour and overhead absorbed, output valued at the order's standard unit cost, the
variance posted on close), so the reports agree with the WIP (1230) and production
variance (5030) accounts.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, time
from decimal import Decimal

from sqlalchemy import func

from app.auth.rbac import Permissions

from .core import Column, Param, ReportDef, ReportResult, RunContext, metric, register, table

D = Decimal
ZERO = D("0")
BRANCH = Param("branch_code", "Branch", "branch")
PRODUCT = Param("product_id", "Product", "product")
DATE_FROM = Param("date_from", "From", "date", required=True, default="month_start")
DATE_TO = Param("date_to", "To", "date", required=True, default="today")
WIP_STATUSES = ("released", "in_progress", "completed")
STATUS_LABELS = {"draft": "Draft", "released": "Released", "in_progress": "In progress", "completed": "Completed",
                 "closed": "Closed", "cancelled": "Cancelled"}


def _m():
    from app.modules.manufacturing import models as m
    from app.modules.products.models import Product

    return m, Product


def _scope(query, column, branch_code, branch_codes):
    if branch_code:
        return query.filter(column == branch_code)
    if branch_codes is not None:
        return query.filter(column.in_(branch_codes))
    return query


def _day_start(d):
    return datetime.combine(d, time.min)


def _day_end(d):
    return datetime.combine(d, time.max)


def _pct(part: Decimal, whole: Decimal) -> Decimal:
    return (part * 100 / whole).quantize(D("0.01")) if whole else ZERO


def _actual(o) -> Decimal:
    return D(str(o.actual_material_cost)) + D(str(o.actual_labor_cost)) + D(str(o.actual_overhead_cost))


def _planned(o) -> Decimal:
    return D(str(o.planned_material_cost)) + D(str(o.planned_labor_cost)) + D(str(o.planned_overhead_cost))


# --------------------------------------------------------------------------- #
# Work in progress
# --------------------------------------------------------------------------- #
def _wip(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger

    m, Product = _m()
    O = m.MfgProductionOrder
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    q = ctx.db.query(O, Product).join(Product, Product.id == O.product_id).filter(O.status.in_(WIP_STATUSES))
    q = _scope(q, O.branch_code, branch_code, branch_codes)
    if p["product_id"]:
        q = q.filter(O.product_id == p["product_id"])
    rows = []
    for o, prod in q.order_by(O.planned_end_date, O.order_no).all():
        output = D(str(o.output_value))
        rows.append({
            "order_no": o.order_no, "branch_code": o.branch_code, "item_code": prod.item_code, "product": prod.name,
            "status": STATUS_LABELS.get(o.status, o.status), "planned_end": o.planned_end_date,
            "planned_qty": o.planned_quantity, "produced_qty": o.produced_quantity,
            "material": D(str(o.actual_material_cost)), "labour": D(str(o.actual_labor_cost)),
            "overhead": D(str(o.actual_overhead_cost)), "output_value": output, "wip": _actual(o) - output,
        })
    wip_total = sum((r["wip"] for r in rows), ZERO)

    gl = (ctx.db.query(func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0))
          .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
          .filter(ChartOfAccounts.account_code == "1230"))
    gl = _scope(gl, GeneralLedger.branch_code, branch_code, branch_codes)
    gl_balance = D(str(gl.scalar() or 0)) if not p["product_id"] else None

    notes = ["WIP = material issued + labour and overhead booked - output received at standard cost, for released, "
             "in-progress and completed orders. Closing an order posts what is left to the production variance account.",
             "A negative WIP means output was received at standard before all of its labour was booked."]
    metrics = [metric("Open orders", len(rows), "int"), metric("WIP value", wip_total, "money"),
               metric("Material in WIP", sum((r["material"] for r in rows), ZERO), "money")]
    if gl_balance is not None:
        metrics.append(metric("GL 1230 balance", gl_balance, "money"))
        if gl_balance != wip_total:
            notes.append(f"The GL Work in Progress balance differs from the orders by {gl_balance - wip_total:,.2f}: "
                         "check Finance > GL posting failures for unposted production entries.")
    return ReportResult(
        metrics=metrics,
        tables=[table("orders", "Work in progress by order", rows, [
            Column("order_no", "Order"), Column("branch_code", "Branch"), Column("item_code", "Item code"),
            Column("product", "Product"), Column("status", "Status"), Column("planned_end", "Due", "date"),
            Column("planned_qty", "Planned", "int", True), Column("produced_qty", "Produced", "int", True),
            Column("material", "Material", "money", True), Column("labour", "Labour", "money", True),
            Column("overhead", "Overhead", "money", True), Column("output_value", "Output (std)", "money", True),
            Column("wip", "WIP", "money", True)])],
        notes=notes,
    )


register(ReportDef(
    "manufacturing.wip", "Work in progress", "Manufacturing",
    "Value of open production orders: material, labour and overhead in less output received, reconciled to GL 1230.",
    Permissions.PRODUCTION_ORDER_VIEW, _wip, (BRANCH, PRODUCT), tags=("wip", "production", "valuation"),
))


# --------------------------------------------------------------------------- #
# Production cost variance
# --------------------------------------------------------------------------- #
def _variance(ctx: RunContext, p: dict) -> ReportResult:
    m, Product = _m()
    O = m.MfgProductionOrder
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    q = (ctx.db.query(O, Product).join(Product, Product.id == O.product_id)
         .filter(O.status == "closed", O.closed_at >= _day_start(p["date_from"]), O.closed_at <= _day_end(p["date_to"])))
    q = _scope(q, O.branch_code, branch_code, branch_codes)
    if p["product_id"]:
        q = q.filter(O.product_id == p["product_id"])
    rows, by_product = [], defaultdict(lambda: defaultdict(lambda: ZERO))
    for o, prod in q.order_by(O.closed_at, O.order_no).all():
        planned_qty = o.planned_quantity or 1
        # Planned cost of what was actually made (good + scrap), so a short order is compared fairly
        done = o.produced_quantity + o.scrapped_quantity
        planned_for_output = (_planned(o) * D(done) / D(planned_qty)).quantize(D("0.01"))
        actual = _actual(o)
        variance = D(str(o.variance_amount or 0))
        rows.append({
            "order_no": o.order_no, "closed": o.closed_at.date() if o.closed_at else None, "branch_code": o.branch_code,
            "item_code": prod.item_code, "product": prod.name, "produced_qty": o.produced_quantity,
            "scrap_qty": o.scrapped_quantity, "standard_unit_cost": D(str(o.standard_unit_cost)),
            "planned_cost": planned_for_output, "material": D(str(o.actual_material_cost)),
            "labour": D(str(o.actual_labor_cost)), "overhead": D(str(o.actual_overhead_cost)), "actual_cost": actual,
            "output_value": D(str(o.output_value)), "variance": variance,
            "variance_pct": _pct(variance, D(str(o.output_value))),
        })
        g = by_product[(prod.item_code, prod.name)]
        g["orders"] += 1
        g["produced_qty"] += o.produced_quantity
        g["scrap_qty"] += o.scrapped_quantity
        g["actual_cost"] += actual
        g["output_value"] += D(str(o.output_value))
        g["variance"] += variance
    summary = [{"item_code": k[0], "product": k[1], "orders": int(v["orders"]), "produced_qty": int(v["produced_qty"]),
                "scrap_qty": int(v["scrap_qty"]), "actual_cost": v["actual_cost"], "output_value": v["output_value"],
                "variance": v["variance"], "variance_pct": _pct(v["variance"], v["output_value"]),
                "actual_unit_cost": (v["actual_cost"] / v["produced_qty"]).quantize(D("0.01")) if v["produced_qty"] else ZERO}
               for k, v in sorted(by_product.items(), key=lambda kv: -abs(kv[1]["variance"]))]
    total_var = sum((r["variance"] for r in rows), ZERO)
    total_out = sum((r["output_value"] for r in rows), ZERO)
    return ReportResult(
        metrics=[metric("Closed orders", len(rows), "int"), metric("Output at standard", total_out, "money"),
                 metric("Actual cost", sum((r["actual_cost"] for r in rows), ZERO), "money"),
                 metric("Variance", total_var, "money"), metric("Variance %", _pct(total_var, total_out), "percent")],
        tables=[
            table("products", "Variance by product", summary, [
                Column("item_code", "Item code"), Column("product", "Product"), Column("orders", "Orders", "int", True),
                Column("produced_qty", "Produced", "int", True), Column("scrap_qty", "Scrap", "int", True),
                Column("actual_unit_cost", "Actual unit cost", "money"), Column("actual_cost", "Actual cost", "money", True),
                Column("output_value", "Output (std)", "money", True), Column("variance", "Variance", "money", True),
                Column("variance_pct", "Variance %", "percent")]),
            table("orders", "Closed orders", rows, [
                Column("order_no", "Order"), Column("closed", "Closed", "date"), Column("branch_code", "Branch"),
                Column("item_code", "Item code"), Column("product", "Product"), Column("produced_qty", "Produced", "int", True),
                Column("scrap_qty", "Scrap", "int", True), Column("standard_unit_cost", "Std unit cost", "money"),
                Column("planned_cost", "Planned cost", "money", True), Column("material", "Material", "money", True),
                Column("labour", "Labour", "money", True), Column("overhead", "Overhead", "money", True),
                Column("actual_cost", "Actual cost", "money", True), Column("output_value", "Output (std)", "money", True),
                Column("variance", "Variance", "money", True), Column("variance_pct", "Variance %", "percent")]),
        ],
        notes=["Variance = actual cost - output at standard cost, posted to account 5030 when an order is closed. "
               "Positive is unfavourable (cost more than standard), negative is favourable.",
               "Planned cost is the order's planned cost scaled to the units actually made (good + scrap)."],
    )


register(ReportDef(
    "manufacturing.variance", "Production cost variance", "Manufacturing",
    "Actual vs standard cost of production orders closed in a period, by order and product.",
    Permissions.PRODUCTION_ORDER_VIEW, _variance, (DATE_FROM, DATE_TO, BRANCH, PRODUCT),
    tags=("variance", "costing", "production"),
))


# --------------------------------------------------------------------------- #
# Production summary
# --------------------------------------------------------------------------- #
def _production_summary(ctx: RunContext, p: dict) -> ReportResult:
    m, Product = _m()
    O, Out, T, OP, WC = m.MfgProductionOrder, m.MfgProductionOutput, m.MfgTimeLog, m.MfgProductionOrderOperation, m.MfgWorkCenter
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    start, end = _day_start(p["date_from"]), _day_end(p["date_to"])

    q = (ctx.db.query(Product.item_code, Product.name, Product.unit_of_measure, func.count(func.distinct(O.id)),
                      func.sum(Out.quantity), func.sum(Out.scrap_quantity), func.sum(Out.total_value))
         .join(O, O.id == Out.order_id).join(Product, Product.id == O.product_id)
         .filter(Out.receipt_date >= start, Out.receipt_date <= end))
    q = _scope(q, O.branch_code, branch_code, branch_codes)
    if p["product_id"]:
        q = q.filter(O.product_id == p["product_id"])
    products = []
    for code, name, uom, orders, good, scrap, value in q.group_by(Product.item_code, Product.name, Product.unit_of_measure).all():
        good, scrap = int(good or 0), int(scrap or 0)
        products.append({"item_code": code, "product": name, "unit": uom, "orders": int(orders), "good_qty": good,
                         "scrap_qty": scrap, "scrap_pct": _pct(D(scrap), D(good + scrap)), "output_value": D(str(value or 0))})
    products.sort(key=lambda r: -r["good_qty"])

    daily_q = (ctx.db.query(func.date(Out.receipt_date), func.sum(Out.quantity), func.sum(Out.scrap_quantity), func.sum(Out.total_value))
               .join(O, O.id == Out.order_id).filter(Out.receipt_date >= start, Out.receipt_date <= end))
    daily_q = _scope(daily_q, O.branch_code, branch_code, branch_codes)
    if p["product_id"]:
        daily_q = daily_q.filter(O.product_id == p["product_id"])
    daily = [{"date": d, "good_qty": int(g or 0), "scrap_qty": int(s or 0), "output_value": D(str(v or 0))}
             for d, g, s, v in daily_q.group_by(func.date(Out.receipt_date)).order_by(func.date(Out.receipt_date)).all()]

    tq = (ctx.db.query(WC.code, WC.name, func.count(T.id), func.sum(T.minutes), func.sum(T.labor_cost),
                       func.sum(T.overhead_cost), func.sum(T.completed_quantity))
          .join(OP, OP.id == T.operation_id).join(WC, WC.id == OP.work_center_id).join(O, O.id == T.order_id)
          .filter(T.created_at >= start, T.created_at <= end))
    tq = _scope(tq, O.branch_code, branch_code, branch_codes)
    if p["product_id"]:
        tq = tq.filter(O.product_id == p["product_id"])
    centers = [{"code": c, "work_center": n, "entries": int(k), "hours": (D(str(mi or 0)) / 60).quantize(D("0.01")),
                "labour": D(str(lab or 0)), "overhead": D(str(ovh or 0)), "qty_done": int(qd or 0)}
               for c, n, k, mi, lab, ovh, qd in tq.group_by(WC.code, WC.name).order_by(WC.code).all()]

    status_q = ctx.db.query(O.status, func.count(O.id)).filter(O.created_at >= start, O.created_at <= end)
    status_q = _scope(status_q, O.branch_code, branch_code, branch_codes)
    if p["product_id"]:
        status_q = status_q.filter(O.product_id == p["product_id"])
    created = dict(status_q.group_by(O.status).all())

    good = sum(r["good_qty"] for r in products)
    scrap = sum(r["scrap_qty"] for r in products)
    return ReportResult(
        metrics=[metric("Good units", good, "int"), metric("Scrap units", scrap, "int"),
                 metric("Scrap rate", _pct(D(scrap), D(good + scrap)), "percent"),
                 metric("Output value", sum((r["output_value"] for r in products), ZERO), "money"),
                 metric("Orders created", sum(created.values()), "int"),
                 metric("Hours booked", sum((c["hours"] for c in centers), ZERO), "number")],
        tables=[
            table("products", "Output by product", products, [
                Column("item_code", "Item code"), Column("product", "Product"), Column("unit", "Unit"),
                Column("orders", "Orders", "int", True), Column("good_qty", "Good", "int", True),
                Column("scrap_qty", "Scrap", "int", True), Column("scrap_pct", "Scrap %", "percent"),
                Column("output_value", "Output value", "money", True)]),
            table("daily", "Output by day", daily, [
                Column("date", "Date", "date"), Column("good_qty", "Good", "int", True),
                Column("scrap_qty", "Scrap", "int", True), Column("output_value", "Output value", "money", True)]),
            table("work_centers", "Time booked by work center", centers, [
                Column("code", "Code"), Column("work_center", "Work center"), Column("entries", "Entries", "int", True),
                Column("hours", "Hours", "number", True), Column("qty_done", "Qty done", "int", True),
                Column("labour", "Labour", "money", True), Column("overhead", "Overhead", "money", True)]),
            table("orders_created", "Orders created by status",
                  [{"status": STATUS_LABELS.get(k, k), "orders": int(v)} for k, v in sorted(created.items())],
                  [Column("status", "Status"), Column("orders", "Orders", "int", True)]),
        ],
        notes=["Output value is the good quantity at each order's standard unit cost."],
    )


register(ReportDef(
    "manufacturing.production_summary", "Production summary", "Manufacturing",
    "Good and scrap output, output value and time booked per work center for a period.",
    Permissions.PRODUCTION_ORDER_VIEW, _production_summary, (DATE_FROM, DATE_TO, BRANCH, PRODUCT),
    tags=("output", "scrap", "production", "work center"),
))


# --------------------------------------------------------------------------- #
# BOM cost roll-up
# --------------------------------------------------------------------------- #
def _bom_cost(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.manufacturing.service import BOMService

    m, Product = _m()
    B = m.MfgBOM
    q = BOMService(ctx.db)._query().join(Product, Product.id == B.product_id)
    if p["status"] != "all":
        q = q.filter(B.status == p["status"])
    if p["product_id"]:
        q = q.filter(B.product_id == p["product_id"])
    svc = BOMService(ctx.db)
    boms, lines = [], []
    for b in q.order_by(Product.name, B.version).all():
        r = svc.rollup(b)
        std = svc._out(b, with_lines=False)["product_cost_price"]
        boms.append({
            "bom_no": b.bom_no, "item_code": b.product.item_code if b.product else "", "product": b.product.name if b.product else "",
            "version": b.version, "status": b.status.capitalize(), "default": b.is_default,
            "output_qty": D(str(b.output_quantity)), "material": r["material_cost"], "labour": r["labor_cost"],
            "overhead": r["overhead_cost"], "total": r["total_cost"], "unit_cost": r["unit_cost"],
            "standard_cost": std, "difference": r["unit_cost"] - std, "difference_pct": _pct(r["unit_cost"] - std, std),
        })
        if p["show_lines"]:
            for it in r["items"]:
                lines.append({"bom_no": b.bom_no, "kind": "Component", "code": it["product_code"], "name": it["product_name"],
                              "quantity": D(str(it["quantity"])), "scrap_pct": D(str(it["scrap_pct"])),
                              "unit_cost": it["unit_cost"], "cost": it["line_cost"]})
            for op in r["operations"]:
                lines.append({"bom_no": b.bom_no, "kind": "Operation", "code": op["work_center_code"], "name": op["name"],
                              "quantity": D(str(op["setup_minutes"])) + D(str(op["run_minutes"])) * D(str(b.output_quantity)),
                              "scrap_pct": None, "unit_cost": None, "cost": op["labor_cost"] + op["overhead_cost"]})
    tables = [table("boms", "BOM cost roll-up", boms, [
        Column("bom_no", "BOM"), Column("item_code", "Item code"), Column("product", "Product"), Column("version", "Version"),
        Column("status", "Status"), Column("default", "Default", "bool"), Column("output_qty", "Output qty", "number"),
        Column("material", "Material", "money"), Column("labour", "Labour", "money"), Column("overhead", "Overhead", "money"),
        Column("total", "Total", "money"), Column("unit_cost", "Rolled-up unit cost", "money"),
        Column("standard_cost", "Standard cost", "money"), Column("difference", "Difference", "money"),
        Column("difference_pct", "Difference %", "percent")], totals=False)]
    if p["show_lines"]:
        tables.append(table("lines", "Cost lines", lines, [
            Column("bom_no", "BOM"), Column("kind", "Line"), Column("code", "Item / work center"), Column("name", "Name"),
            Column("quantity", "Qty / minutes", "number"), Column("scrap_pct", "Scrap %", "percent"),
            Column("unit_cost", "Unit cost", "money"), Column("cost", "Cost", "money")], totals=False))
    off = [b for b in boms if b["difference"] != 0 and b["status"] == "Active"]
    return ReportResult(
        metrics=[metric("BOMs", len(boms), "int"), metric("Active BOMs off standard", len(off), "int")],
        tables=tables,
        notes=["Costs use today's component standard costs (latest active price tier, else the product cost price) and "
               "work-center rates, for the BOM's output quantity. Setup time is spread over that quantity.",
               "Difference = rolled-up unit cost - the product's current standard cost; use Update Product Cost on the BOM to align them."],
    )


register(ReportDef(
    "manufacturing.bom_cost", "BOM cost roll-up", "Manufacturing",
    "Material, labour and overhead cost of each bill of materials against the product's standard cost.",
    Permissions.BOM_VIEW, _bom_cost,
    (PRODUCT,
     Param("status", "BOM status", "select", required=True, default="active",
           options=(("active", "Active"), ("draft", "Draft"), ("archived", "Archived"), ("all", "All"))),
     Param("show_lines", "Show cost lines", "bool", default=False)),
    company_wide=True, tags=("bom", "cost rollup", "standard cost"),
))


# --------------------------------------------------------------------------- #
# Traceability
# --------------------------------------------------------------------------- #
def _traceability(ctx: RunContext, p: dict) -> ReportResult:
    """Backward (what went into it) and forward (where it went) for production orders,
    found by order number or by a finished-goods serial / batch number."""
    from app.modules.customers.models import Customer
    from app.modules.inventory.models import SalesStock
    from app.modules.purchasing.models import GoodReceivedNote, PurchasingOrder, Supplier
    from app.modules.sales.models import Invoice, InvoiceItems

    m, Product = _m()
    O = m.MfgProductionOrder
    order_no, lot = (p["order_no"] or "").strip(), (p["lot"] or "").strip()
    if not order_no and not lot:
        return ReportResult(notes=["Enter a production order number, or a finished serial / batch number, to trace."])
    q = ctx.db.query(O)
    if order_no:
        q = q.filter(func.lower(O.order_no) == order_no.lower())
    if lot:
        ids = [i for (i,) in ctx.db.query(SalesStock.production_order_id).filter(
            SalesStock.production_order_id.isnot(None),
            (func.lower(SalesStock.barcode) == lot.lower()) | (func.lower(SalesStock.batch_no) == lot.lower())).distinct()]
        q = q.filter(O.id.in_(ids or [0]))
    orders = [o for o in q.order_by(O.id).all() if ctx.allowed_branches is None or o.branch_code in ctx.allowed_branches]
    if not orders:
        return ReportResult(notes=["No production order matches (or it belongs to a branch you cannot see)."])
    ids = [o.id for o in orders]
    order_no_of = {o.id: o.order_no for o in orders}

    def _source(row: SalesStock) -> dict:
        grn = ctx.db.query(GoodReceivedNote).filter(GoodReceivedNote.id == row.good_received_note_id).first() if row.good_received_note_id else None
        po = ctx.db.query(PurchasingOrder).filter(PurchasingOrder.id == grn.purchasingorders_id).first() if grn else None
        sup = ctx.db.query(Supplier).filter(Supplier.id == po.first_suppliers_id).first() if po else None
        made = order_no_of.get(row.production_order_id) or (
            ctx.db.query(O.order_no).filter(O.id == row.production_order_id).scalar() if row.production_order_id else None)
        return {"grn_no": grn.good_received_no if grn else None, "po_no": po.purchasing_order_no if po else None,
                "supplier": sup.company_name if sup else None, "made_by_order": made}

    components = []
    for row, prod in (ctx.db.query(SalesStock, Product).join(Product, Product.id == SalesStock.product_id)
                      .filter(SalesStock.consumed_by_production_order_id.in_(ids)).order_by(SalesStock.id).all()):
        components.append({"order_no": order_no_of[row.consumed_by_production_order_id], "item_code": prod.item_code,
                           "component": prod.name, "qty": row.quantity, "serial": row.barcode, "batch_no": row.batch_no,
                           "expiry": row.expiry_date, **_source(row)})

    outputs = []
    for row, prod in (ctx.db.query(SalesStock, Product).join(Product, Product.id == SalesStock.product_id)
                      .filter(SalesStock.production_order_id.in_(ids)).order_by(SalesStock.id).all()):
        if lot and row.barcode != lot and row.batch_no != lot and (row.barcode or "").lower() != lot.lower() \
                and (row.batch_no or "").lower() != lot.lower():
            continue
        inv = (ctx.db.query(Invoice.invoice_no, Invoice.created_date, Customer.customer_name)
               .join(InvoiceItems, InvoiceItems.invoice_id == Invoice.id)
               .outerjoin(Customer, Customer.id == Invoice.customer_id)
               .filter(InvoiceItems.sales_stock_id == row.id).first())
        outputs.append({"order_no": order_no_of[row.production_order_id], "item_code": prod.item_code, "product": prod.name,
                        "qty": row.quantity, "serial": row.barcode, "batch_no": row.batch_no, "branch_code": row.branch_code,
                        "status": (row.status or "").replace("_", " ").capitalize(), "received": row.added_date,
                        "invoice_no": inv[0] if inv else None, "sold_on": inv[1] if inv else None,
                        "customer": inv[2] if inv else None})

    T = m.MfgMaterialTransaction
    moves = [{"order_no": order_no_of[t.order_id], "date": t.transaction_date, "type": t.transaction_type.capitalize(),
              "item_code": t.product.item_code if t.product else "", "component": t.product.name if t.product else "",
              "qty": t.quantity, "value": D(str(t.total_cost))}
             for t in ctx.db.query(T).filter(T.order_id.in_(ids)).order_by(T.transaction_date, T.id).all()]
    return ReportResult(
        metrics=[metric("Orders", len(orders), "int"), metric("Component lots", len(components), "int"),
                 metric("Finished units", sum(r["qty"] for r in outputs), "int"),
                 metric("Sold units", sum(r["qty"] for r in outputs if r["invoice_no"]), "int")],
        tables=[
            table("orders", "Production orders", [{
                "order_no": o.order_no, "branch_code": o.branch_code, "product": o.product.name if o.product else "",
                "status": STATUS_LABELS.get(o.status, o.status), "planned_qty": o.planned_quantity,
                "produced_qty": o.produced_quantity, "scrap_qty": o.scrapped_quantity,
                "started": o.actual_start_at, "finished": o.actual_end_at} for o in orders], [
                Column("order_no", "Order"), Column("branch_code", "Branch"), Column("product", "Product"),
                Column("status", "Status"), Column("planned_qty", "Planned", "int"), Column("produced_qty", "Produced", "int"),
                Column("scrap_qty", "Scrap", "int"), Column("started", "Started", "datetime"),
                Column("finished", "Finished", "datetime")], totals=False),
            table("components", "Backward: components consumed", components, [
                Column("order_no", "Order"), Column("item_code", "Item code"), Column("component", "Component"),
                Column("qty", "Qty", "int", True), Column("serial", "Serial"), Column("batch_no", "Batch"),
                Column("expiry", "Expiry", "date"), Column("grn_no", "GRN"), Column("po_no", "PO"),
                Column("supplier", "Supplier"), Column("made_by_order", "Made by order")]),
            table("outputs", "Forward: finished goods", outputs, [
                Column("order_no", "Order"), Column("item_code", "Item code"), Column("product", "Product"),
                Column("qty", "Qty", "int", True), Column("serial", "Serial"), Column("batch_no", "Batch"),
                Column("received", "Received", "datetime"), Column("branch_code", "Branch"), Column("status", "Status"),
                Column("invoice_no", "Invoice"), Column("sold_on", "Sold on", "date"), Column("customer", "Customer")]),
            table("movements", "Material movements", moves, [
                Column("order_no", "Order"), Column("date", "Date", "datetime"), Column("type", "Type"),
                Column("item_code", "Item code"), Column("component", "Component"), Column("qty", "Qty", "int"),
                Column("value", "Value", "money")], totals=False),
        ],
        notes=["Components are the stock lots issued or backflushed to the order (returned units are not listed). "
               "Where a lot is batch-tracked, the batch shown may have been shared with other orders."],
    )


register(ReportDef(
    "manufacturing.traceability", "Production traceability", "Manufacturing",
    "Backward and forward trace of a production order or finished serial / batch: component lots and suppliers, "
    "finished units and the customers they were sold to.",
    Permissions.PRODUCTION_ORDER_VIEW, _traceability,
    (Param("order_no", "Production order no.", "text", help="e.g. MO-HQ-26000001"),
     Param("lot", "Finished serial / batch no.", "text")),
    tags=("traceability", "lot", "serial", "batch", "recall"),
))
