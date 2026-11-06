"""Document registers and the reports that were missing from the Report Center.

Sales and purchase registers list the documents behind the summary reports, on the same
basis: an invoice counts as a sale only when it is approved or completed (see
`app.modules.sales.sales_metrics`); cancelled purchase documents are left out. The
finance and HR reports here wrap the services their own screens use, so the figures
agree with those screens.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date
from decimal import Decimal

from sqlalchemy import func, literal, or_

from app.auth.rbac import Permissions

from .core import Column, Param, ReportDef, ReportResult, RunContext, metric, register, table

ZERO = Decimal("0")

DATE_FROM = Param("date_from", "From", "date", required=True, default="month_start")
DATE_TO = Param("date_to", "To", "date", required=True, default="today")
BRANCH = Param("branch_code", "Branch", "branch")
CUSTOMER = Param("customer_id", "Customer", "customer")
SUPPLIER = Param("supplier_id", "Supplier", "supplier")
YEAR = Param("year", "Year", "year", required=True, default="current_year")


def _branch_filter(ctx: RunContext, column, branch_code):
    code, codes = ctx.branch_scope(branch_code)
    if code:
        return column == code
    if codes is not None:
        return column.in_(codes)
    return literal(True)


def _d(value) -> Decimal:
    return Decimal(str(value or 0))


def _customer_name():
    from app.modules.customers.models import Customer

    return func.coalesce(func.nullif(Customer.customer_name, ""), Customer.company_name)


# ═══════════════════════════════ Sales ═══════════════════════════════
PAYMENT_STATUS = Param(
    "payment_status", "Payment", "select", default="all",
    options=(("all", "All"), ("unpaid", "Unpaid"), ("partial", "Part paid"), ("paid", "Paid")),
)


def _invoice_register(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.customers.models import Customer
    from app.modules.sales.models import Invoice
    from app.modules.sales.sales_metrics import counted_invoice_filters

    q = (
        ctx.db.query(Invoice, Customer.customer_no, _customer_name().label("customer"))
        .join(Customer, Customer.id == Invoice.customer_id)
        .filter(
            Invoice.created_date.between(p["date_from"], p["date_to"]),
            *counted_invoice_filters(),
            _branch_filter(ctx, Invoice.branch_code, p["branch_code"]),
        )
    )
    if p["customer_id"]:
        q = q.filter(Invoice.customer_id == p["customer_id"])
    if p["payment_status"] and p["payment_status"] != "all":
        q = q.filter(Invoice.payment_status == p["payment_status"])
    rows = []
    for inv, customer_no, customer in q.order_by(Invoice.created_date, Invoice.invoice_no).all():
        rows.append({
            "invoice_no": inv.invoice_no, "date": inv.created_date, "due_date": inv.due_date,
            "branch": inv.branch_code, "customer_no": customer_no, "customer": customer,
            "payment_method": inv.payment_method,
            # subtotal is the revenue the GL posts (after discounts, before tax).
            "net_amount": _d(inv.subtotal), "tax": _d(inv.tax_amount), "total": _d(inv.grand_total),
            "paid": _d(inv.paid_amount), "balance": _d(inv.balance_due), "status": inv.payment_status,
        })
    return ReportResult(
        metrics=[
            metric("Invoices", len(rows), "int"),
            metric("Net sales", sum((r["net_amount"] for r in rows), ZERO), "money"),
            metric("Tax", sum((r["tax"] for r in rows), ZERO), "money"),
            metric("Outstanding", sum((r["balance"] for r in rows), ZERO), "money"),
        ],
        tables=[table("invoices", "Sales invoices", rows, [
            Column("invoice_no", "Invoice"), Column("date", "Date", "date"), Column("due_date", "Due", "date"),
            Column("branch", "Branch"), Column("customer_no", "Customer no"), Column("customer", "Customer"),
            Column("payment_method", "Method"), Column("net_amount", "Net", "money", True),
            Column("tax", "Tax", "money", True), Column("total", "Total", "money", True),
            Column("paid", "Paid", "money", True), Column("balance", "Balance", "money", True),
            Column("status", "Payment"),
        ])],
        notes=["Approved and completed invoices only. Net is the revenue posted to the ledger: after discounts, before tax."],
    )


def _sales_by_customer(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.customers.models import Customer
    from app.modules.sales.models import Invoice, SaleReturn
    from app.modules.sales.sales_metrics import counted_invoice_filters, gl_return_revenue, gl_revenue_expr

    branch = _branch_filter(ctx, Invoice.branch_code, p["branch_code"])
    sales = (
        ctx.db.query(
            Invoice.customer_id, func.count(Invoice.id), func.coalesce(func.sum(gl_revenue_expr()), 0),
            func.coalesce(func.sum(Invoice.balance_due), 0),
        )
        .filter(Invoice.created_date.between(p["date_from"], p["date_to"]), *counted_invoice_filters(), branch)
        .group_by(Invoice.customer_id)
        .all()
    )
    # Returns on the sales report's basis: processed in the period, on the return's branch.
    returns_q = (
        ctx.db.query(SaleReturn, Invoice.customer_id)
        .join(Invoice, Invoice.id == SaleReturn.invoice_id)
        .filter(
            SaleReturn.status == "processed",
            SaleReturn.added_date.between(p["date_from"], p["date_to"]),
            _branch_filter(ctx, SaleReturn.branch_code, p["branch_code"]),
        )
    )
    returned: dict[int, Decimal] = {}
    for sr, customer_id in returns_q.all():
        returned[customer_id] = returned.get(customer_id, ZERO) + gl_return_revenue(sr)

    ids = {c for c, *_ in sales} | set(returned)
    names = {
        c.id: (c.customer_no, c.customer_name or c.company_name)
        for c in ctx.db.query(Customer).filter(Customer.id.in_(ids)).all()
    } if ids else {}
    by_customer = {c: (n, _d(v), _d(b)) for c, n, v, b in sales}
    rows = []
    for cid in ids:
        count, value, balance = by_customer.get(cid, (0, ZERO, ZERO))
        ret = returned.get(cid, ZERO)
        no, name = names.get(cid, (None, None))
        rows.append({"customer_no": no, "customer": name, "invoices": count, "sales": value,
                     "returns": ret, "net_sales": value - ret, "outstanding": balance})
    rows.sort(key=lambda r: r["net_sales"], reverse=True)
    total = sum((r["net_sales"] for r in rows), ZERO)
    for r in rows:
        r["share"] = (r["net_sales"] / total * 100) if total else ZERO
    return ReportResult(
        metrics=[metric("Customers", len(rows), "int"), metric("Net sales", total, "money")],
        tables=[table("customers", "Sales by customer", rows, [
            Column("customer_no", "Customer no"), Column("customer", "Customer"),
            Column("invoices", "Invoices", "int", True), Column("sales", "Sales", "money", True),
            Column("returns", "Returns", "money", True), Column("net_sales", "Net sales", "money", True),
            Column("share", "Share", "percent"), Column("outstanding", "Outstanding on these invoices", "money", True),
        ])],
        notes=["Sales and returns on the same basis as the Sales summary, so the net totals agree."],
    )


RETURN_STATUS = Param(
    "status", "Status", "select", default="processed",
    options=(("processed", "Processed"), ("open", "Pending or approved"), ("all", "All")),
)


def _sales_returns(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.customers.models import Customer
    from app.modules.sales.models import Invoice, SaleReturn

    q = (
        ctx.db.query(SaleReturn, Invoice.invoice_no, _customer_name().label("customer"))
        .join(Invoice, Invoice.id == SaleReturn.invoice_id)
        .join(Customer, Customer.id == Invoice.customer_id)
        .filter(
            SaleReturn.added_date.between(p["date_from"], p["date_to"]),
            _branch_filter(ctx, SaleReturn.branch_code, p["branch_code"]),
        )
    )
    if p["status"] == "processed":
        q = q.filter(SaleReturn.status == "processed")
    elif p["status"] == "open":
        q = q.filter(SaleReturn.status.in_(("pending", "approved")))
    if p["customer_id"]:
        q = q.filter(Invoice.customer_id == p["customer_id"])
    rows = [{
        "return_no": sr.sale_return_no, "date": sr.added_date, "branch": sr.branch_code,
        "invoice_no": invoice_no, "customer": customer, "reason": sr.return_reason,
        "status": sr.status, "subtotal": _d(sr.subtotal), "tax_refund": _d(sr.tax_refund),
        "total_refund": _d(sr.total_refund), "refund_status": sr.refund_status,
    } for sr, invoice_no, customer in q.order_by(SaleReturn.added_date, SaleReturn.id).all()]
    return ReportResult(
        metrics=[metric("Returns", len(rows), "int"),
                 metric("Total refund", sum((r["total_refund"] for r in rows), ZERO), "money")],
        tables=[table("returns", "Sales returns", rows, [
            Column("return_no", "Return"), Column("date", "Date", "date"), Column("branch", "Branch"),
            Column("invoice_no", "Invoice"), Column("customer", "Customer"), Column("reason", "Reason"),
            Column("status", "Status"), Column("subtotal", "Subtotal", "money", True),
            Column("tax_refund", "Tax", "money", True), Column("total_refund", "Total refund", "money", True),
            Column("refund_status", "Refund"),
        ])],
    )


register(ReportDef(
    "sales.invoice_register", "Sales invoice register", "Sales",
    "Every counted sales invoice in a period with net, tax, paid and balance.",
    Permissions.REPORTING_SALES_VIEW, _invoice_register, (DATE_FROM, DATE_TO, BRANCH, CUSTOMER, PAYMENT_STATUS),
    tags=("register",),
))
register(ReportDef(
    "sales.by_customer", "Sales by customer", "Sales",
    "Sales, returns and net sales per customer, ranked, with each customer's share.",
    Permissions.REPORTING_SALES_VIEW, _sales_by_customer, (DATE_FROM, DATE_TO, BRANCH),
))
register(ReportDef(
    "sales.returns", "Sales returns", "Sales",
    "Customer returns in a period with the invoice, reason and refund.",
    Permissions.SALES_RETURN_VIEW, _sales_returns, (DATE_FROM, DATE_TO, BRANCH, CUSTOMER, RETURN_STATUS),
    tags=("register",),
))


# ═══════════════════════════════ Purchasing ═══════════════════════════════
PO_STATUS = Param(
    "status", "Status", "select", default="open",
    options=(("open", "Open (approved / part received)"), ("all", "All except cancelled"),
             ("completed", "Completed"), ("pending_approval", "Pending approval")),
)


def _supplier_names(ctx: RunContext, ids) -> dict:
    from app.modules.purchasing.models import Supplier

    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {s.id: (s.supplier_no, s.company_name) for s in ctx.db.query(Supplier).filter(Supplier.id.in_(ids)).all()}


def _po_register(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.purchasing.models import GoodReceivedItems, GoodReceivedNote, PurchasingOrder, PurchasingOrderItems

    q = ctx.db.query(PurchasingOrder).filter(
        PurchasingOrder.purchasing_order_date.between(p["date_from"], p["date_to"]),
        _branch_filter(ctx, PurchasingOrder.branch_code, p["branch_code"]),
    )
    status = p["status"]
    if status == "open":
        q = q.filter(PurchasingOrder.status.in_(("approved", "partially_completed")))
    elif status == "all":
        q = q.filter(PurchasingOrder.status.notin_(("cancelled", "rejected")))
    else:
        q = q.filter(PurchasingOrder.status == status)
    if p["supplier_id"]:
        q = q.filter(PurchasingOrder.first_suppliers_id == p["supplier_id"])
    orders = q.order_by(PurchasingOrder.purchasing_order_date, PurchasingOrder.purchasing_order_no).all()
    ids = [o.id for o in orders]

    ordered: dict[int, Decimal] = {}
    received: dict[int, Decimal] = {}
    for i in range(0, len(ids), 1000):
        chunk = ids[i:i + 1000]
        for po_id, value in (
            ctx.db.query(PurchasingOrderItems.purchasingorders_id,
                         func.sum(PurchasingOrderItems.quantity * PurchasingOrderItems.unit_price))
            .filter(PurchasingOrderItems.purchasingorders_id.in_(chunk))
            .group_by(PurchasingOrderItems.purchasingorders_id).all()
        ):
            ordered[po_id] = _d(value)
        # Received value: units on posted GRNs at the order line's price.
        for po_id, value in (
            ctx.db.query(PurchasingOrderItems.purchasingorders_id,
                         func.sum(GoodReceivedItems.quantity * PurchasingOrderItems.unit_price))
            .join(GoodReceivedItems, GoodReceivedItems.purchasing_order_items_id == PurchasingOrderItems.id)
            # GRN lines point at their note by its number, not its id.
            .join(GoodReceivedNote, GoodReceivedNote.good_received_no == GoodReceivedItems.good_received_note)
            .filter(PurchasingOrderItems.purchasingorders_id.in_(chunk), GoodReceivedNote.status != "cancelled")
            .group_by(PurchasingOrderItems.purchasingorders_id).all()
        ):
            received[po_id] = _d(value)

    suppliers = _supplier_names(ctx, (o.first_suppliers_id for o in orders))
    rows = []
    for o in orders:
        value, got = ordered.get(o.id, ZERO), received.get(o.id, ZERO)
        rows.append({
            "po_no": o.purchasing_order_no, "date": o.purchasing_order_date, "required_date": o.required_date,
            "branch": o.branch_code, "supplier": (suppliers.get(o.first_suppliers_id) or (None, None))[1],
            "status": o.status, "ordered": value, "received": got, "to_receive": max(ZERO, value - got),
        })
    return ReportResult(
        metrics=[metric("Orders", len(rows), "int"),
                 metric("Ordered", sum((r["ordered"] for r in rows), ZERO), "money"),
                 metric("Still to receive", sum((r["to_receive"] for r in rows), ZERO), "money")],
        tables=[table("orders", "Purchase orders", rows, [
            Column("po_no", "PO"), Column("date", "Date", "date"), Column("required_date", "Required", "date"),
            Column("branch", "Branch"), Column("supplier", "Supplier"), Column("status", "Status"),
            Column("ordered", "Ordered", "money", True), Column("received", "Received", "money", True),
            Column("to_receive", "To receive", "money", True),
        ])],
        notes=["Values are quantity × the order line's unit price; received value counts posted goods received notes."],
    )


def _grn_register(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.purchasing.models import GoodReceivedItems, GoodReceivedNote, PurchasingOrder, PurchasingOrderItems

    q = (
        ctx.db.query(GoodReceivedNote, PurchasingOrder)
        .outerjoin(PurchasingOrder, PurchasingOrder.id == GoodReceivedNote.purchasingorders_id)
        .filter(
            GoodReceivedNote.good_received_date.between(p["date_from"], p["date_to"]),
            GoodReceivedNote.status != "cancelled",
            _branch_filter(ctx, GoodReceivedNote.branch_code, p["branch_code"]),
        )
    )
    if p["supplier_id"]:
        q = q.filter(PurchasingOrder.first_suppliers_id == p["supplier_id"])
    notes = q.order_by(GoodReceivedNote.good_received_date, GoodReceivedNote.good_received_no).all()
    # GRN lines point at their note by its number, not its id.
    numbers = [g.good_received_no for g, _po in notes]
    values: dict[str, tuple[Decimal, Decimal]] = {}
    for i in range(0, len(numbers), 1000):
        for grn_no, units, value in (
            ctx.db.query(GoodReceivedItems.good_received_note, func.sum(GoodReceivedItems.quantity),
                         func.sum(GoodReceivedItems.quantity * PurchasingOrderItems.unit_price))
            .outerjoin(PurchasingOrderItems, PurchasingOrderItems.id == GoodReceivedItems.purchasing_order_items_id)
            .filter(GoodReceivedItems.good_received_note.in_(numbers[i:i + 1000]))
            .group_by(GoodReceivedItems.good_received_note).all()
        ):
            values[grn_no] = (_d(units), _d(value))
    suppliers = _supplier_names(ctx, (po.first_suppliers_id for _g, po in notes if po))
    rows = []
    for g, po in notes:
        units, value = values.get(g.good_received_no, (ZERO, ZERO))
        rows.append({
            "grn_no": g.good_received_no, "date": g.good_received_date, "branch": g.branch_code,
            "po_no": po.purchasing_order_no if po else None,
            "supplier": (suppliers.get(po.first_suppliers_id) or (None, None))[1] if po else None,
            "supplier_invoice_no": g.supplier_invoice_no, "delivery_note_no": g.delivery_note_no,
            "units": units, "value": value,
        })
    return ReportResult(
        metrics=[metric("Goods received notes", len(rows), "int"),
                 metric("Value received", sum((r["value"] for r in rows), ZERO), "money")],
        tables=[table("grns", "Goods received", rows, [
            Column("grn_no", "GRN"), Column("date", "Date", "date"), Column("branch", "Branch"),
            Column("po_no", "PO"), Column("supplier", "Supplier"), Column("supplier_invoice_no", "Supplier invoice"),
            Column("delivery_note_no", "Delivery note"), Column("units", "Units", "number", True),
            Column("value", "Value", "money", True),
        ])],
    )


def _purchase_invoice_register(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.purchasing.invoice_models import PurchaseInvoice

    invoice_date = func.coalesce(PurchaseInvoice.supplier_invoice_date, PurchaseInvoice.received_date)
    q = ctx.db.query(PurchaseInvoice).filter(
        invoice_date.between(p["date_from"], p["date_to"]),
        PurchaseInvoice.status != "cancelled",
        _branch_filter(ctx, PurchaseInvoice.branch_code, p["branch_code"]),
    )
    if p["supplier_id"]:
        q = q.filter(PurchaseInvoice.supplier_id == p["supplier_id"])
    if p["payment_status"] and p["payment_status"] != "all":
        q = q.filter(PurchaseInvoice.payment_status == p["payment_status"])
    invoices = q.order_by(invoice_date, PurchaseInvoice.invoice_no).all()
    suppliers = _supplier_names(ctx, (i.supplier_id for i in invoices))
    rows = [{
        "invoice_no": i.invoice_no, "supplier_invoice_no": i.supplier_invoice_no,
        "date": i.supplier_invoice_date or i.received_date, "due_date": i.due_date, "branch": i.branch_code,
        "supplier": (suppliers.get(i.supplier_id) or (None, None))[1],
        "net_amount": _d(i.subtotal) - _d(i.discount_amount), "tax": _d(i.tax_amount),
        "total": _d(i.total_amount), "paid": _d(i.paid_amount), "balance": _d(i.balance_due),
        "status": i.payment_status,
    } for i in invoices]
    return ReportResult(
        metrics=[metric("Invoices", len(rows), "int"),
                 metric("Total", sum((r["total"] for r in rows), ZERO), "money"),
                 metric("Input tax", sum((r["tax"] for r in rows), ZERO), "money"),
                 metric("Outstanding", sum((r["balance"] for r in rows), ZERO), "money")],
        tables=[table("invoices", "Supplier invoices", rows, [
            Column("invoice_no", "Invoice"), Column("supplier_invoice_no", "Supplier's no"),
            Column("date", "Date", "date"), Column("due_date", "Due", "date"), Column("branch", "Branch"),
            Column("supplier", "Supplier"), Column("net_amount", "Net", "money", True),
            Column("tax", "Tax", "money", True), Column("total", "Total", "money", True),
            Column("paid", "Paid", "money", True), Column("balance", "Balance", "money", True),
            Column("status", "Payment"),
        ])],
    )


register(ReportDef(
    "purchasing.order_register", "Purchase order register", "Purchasing",
    "Purchase orders with ordered value, value received and what is still to come.",
    Permissions.PURCHASE_ORDER_VIEW, _po_register, (DATE_FROM, DATE_TO, BRANCH, SUPPLIER, PO_STATUS),
    tags=("register",),
))
register(ReportDef(
    "purchasing.grn_register", "Goods received register", "Purchasing",
    "Posted goods received notes with supplier, order and value.",
    Permissions.GRN_VIEW, _grn_register, (DATE_FROM, DATE_TO, BRANCH, SUPPLIER),
    tags=("register",),
))
register(ReportDef(
    "purchasing.invoice_register", "Supplier invoice register", "Purchasing",
    "Supplier invoices with net, tax, paid and balance.",
    Permissions.SUPPLIER_PAYMENT_VIEW, _purchase_invoice_register,
    (DATE_FROM, DATE_TO, BRANCH, SUPPLIER, PAYMENT_STATUS),
    tags=("register",),
))


# ═══════════════════════════════ Finance ═══════════════════════════════
EXPENSE_STATUS = Param(
    "status", "Status", "select", default="all",
    options=(("all", "All except rejected"), ("paid", "Paid"), ("unpaid", "Not yet paid")),
)


def _expenses(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.models import Expenses

    q = ctx.db.query(Expenses).filter(
        Expenses.expense_date.between(p["date_from"], p["date_to"]),
        Expenses.status.notin_(("rejected", "cancelled")),
        _branch_filter(ctx, Expenses.branch_code, p["branch_code"]),
    )
    if p["status"] == "paid":
        q = q.filter(Expenses.payment_status == "paid")
    elif p["status"] == "unpaid":
        q = q.filter(or_(Expenses.payment_status.is_(None), Expenses.payment_status != "paid"))
    items = q.order_by(Expenses.expense_date, Expenses.expenses_no).all()
    rows = [{
        "expense_no": e.expenses_no, "date": e.expense_date, "branch": e.branch_code, "type": e.expense_type,
        "category": e.expense_category, "vendor": e.vendor_name, "method": e.expenses_method,
        "account": e.account_code, "status": e.status, "payment": e.payment_status, "amount": _d(e.expense_amount),
    } for e in items]
    by_type: "OrderedDict[str, dict]" = OrderedDict()
    for r in sorted(rows, key=lambda r: r["type"] or ""):
        t = by_type.setdefault(r["type"] or "(none)", {"type": r["type"] or "(none)", "count": 0, "amount": ZERO})
        t["count"] += 1
        t["amount"] += r["amount"]
    return ReportResult(
        metrics=[metric("Expenses", len(rows), "int"),
                 metric("Total", sum((r["amount"] for r in rows), ZERO), "money")],
        tables=[
            table("by_type", "By expense type", list(by_type.values()), [
                Column("type", "Type"), Column("count", "Expenses", "int", True), Column("amount", "Amount", "money", True)]),
            table("expenses", "Expenses", rows, [
                Column("expense_no", "Expense"), Column("date", "Date", "date"), Column("branch", "Branch"),
                Column("type", "Type"), Column("category", "Category"), Column("vendor", "Vendor"),
                Column("method", "Method"), Column("account", "Account"), Column("status", "Status"),
                Column("payment", "Payment"), Column("amount", "Amount", "money", True)]),
        ],
    )


def _cost_center_pl(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.cost_centers import CostCenterService

    r = CostCenterService(ctx.db).profit_by_cost_center(
        p["date_from"], p["date_to"], ctx.single_branch(p["branch_code"]))
    rows = [{"code": l.code, "cost_center": l.name, "income": l.income, "costs": l.costs, "profit": l.profit}
            for l in r.lines]
    return ReportResult(
        metrics=[metric("Income", r.income, "money"), metric("Costs", r.costs, "money"),
                 metric("Profit", r.profit, "money")],
        tables=[table("cost_centers", "Profit by cost center", rows, [
            Column("code", "Code"), Column("cost_center", "Cost center"), Column("income", "Income", "money", True),
            Column("costs", "Costs", "money", True), Column("profit", "Profit", "money", True)])],
        notes=["From the general ledger, year-end closing entries excluded. Ledger lines without a cost center show as \"No cost center\"."],
    )


ASSET_STATUS = Param(
    "status", "Status", "select", default="active",
    options=(("active", "In use"), ("all", "All"), ("disposed", "Sold or scrapped")),
)


def _fixed_assets(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.fixed_assets import FixedAssetService

    svc = FixedAssetService(ctx.db)
    code, codes = ctx.branch_scope(p["branch_code"])
    assets = svc.list_assets(status_filter="active" if p["status"] == "active" else None,
                             branch_codes=[code] if code else codes)
    if p["status"] == "disposed":
        assets = [a for a in assets if a.status != "active"]
    rows = []
    for a in assets:
        r = svc.response(a)
        rows.append({
            "asset_no": r.asset_no, "name": r.name, "class": r.asset_class_name, "branch": r.branch_code,
            "location": r.location, "acquired": r.acquisition_date, "method": r.depreciation_method,
            "life_months": r.useful_life_months, "cost": r.cost, "accumulated": r.accumulated_depreciation,
            "book_value": r.book_value, "monthly": r.monthly_depreciation, "status": r.status,
            "disposed": r.disposal_date,
        })
    by_class: "OrderedDict[str, dict]" = OrderedDict()
    for r in sorted(rows, key=lambda r: r["class"] or ""):
        c = by_class.setdefault(r["class"] or "(none)", {"class": r["class"] or "(none)", "assets": 0,
                                                         "cost": ZERO, "accumulated": ZERO, "book_value": ZERO})
        c["assets"] += 1
        for k in ("cost", "accumulated", "book_value"):
            c[k] += _d(r[k])
    money = lambda k, label: Column(k, label, "money", True)  # noqa: E731
    return ReportResult(
        metrics=[metric("Assets", len(rows), "int"),
                 metric("Cost", sum((_d(r["cost"]) for r in rows), ZERO), "money"),
                 metric("Book value", sum((_d(r["book_value"]) for r in rows), ZERO), "money")],
        tables=[
            table("by_class", "By asset class", list(by_class.values()), [
                Column("class", "Class"), Column("assets", "Assets", "int", True),
                money("cost", "Cost"), money("accumulated", "Depreciation to date"), money("book_value", "Book value")]),
            table("assets", "Fixed asset register", rows, [
                Column("asset_no", "Asset"), Column("name", "Name"), Column("class", "Class"), Column("branch", "Branch"),
                Column("location", "Location"), Column("acquired", "Acquired", "date"), Column("method", "Method"),
                Column("life_months", "Life (months)", "int"), money("cost", "Cost"),
                money("accumulated", "Depreciation to date"), money("book_value", "Book value"),
                money("monthly", "Monthly depreciation"), Column("status", "Status"), Column("disposed", "Disposed", "date")]),
        ],
    )


register(ReportDef(
    "finance.expenses", "Expenses", "Finance",
    "Expense vouchers in a period by type, with vendor, account and payment status.",
    Permissions.EXPENSE_VIEW, _expenses, (DATE_FROM, DATE_TO, BRANCH, EXPENSE_STATUS),
    tags=("register",),
))
register(ReportDef(
    "finance.cost_center_pl", "Profit by cost center", "Finance",
    "Income, costs and profit per cost center from the general ledger.",
    Permissions.REPORTING_FINANCE_VIEW, _cost_center_pl, (DATE_FROM, DATE_TO, BRANCH),
))
register(ReportDef(
    "finance.fixed_assets", "Fixed asset register", "Finance",
    "Fixed assets with cost, depreciation to date and book value, by class.",
    Permissions.GENERAL_LEDGER_VIEW, _fixed_assets, (BRANCH, ASSET_STATUS),
    tags=("register",),
))


# ═══════════════════════════════ HR ═══════════════════════════════
PAID_BATCH_STATUSES = ("salary_paid", "statutory_paid", "completed")


def _employee_scope(ctx: RunContext, column):
    """Payroll rows of the user's branches (employees without a branch stay visible, as in HR)."""
    from app.modules.employees.models import Employee

    branches = ctx.allowed_branches
    if branches is None:
        return literal(True)
    return column.in_(
        ctx.db.query(Employee.employee_id).filter(or_(Employee.branch_code.in_(branches), Employee.branch_code.is_(None)))
    )


def _payroll_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.employees.models import Employee
    from app.modules.hr.models import PayrollBatch, Reimbursements
    from app.modules.employees.models import EmployeePayroll

    first = p["date_from"].year * 100 + p["date_from"].month
    last = p["date_to"].year * 100 + p["date_to"].month
    s = func.sum
    rows = (
        ctx.db.query(
            PayrollBatch.payroll_year, PayrollBatch.payroll_month, PayrollBatch.batch_no, PayrollBatch.status,
            func.count(EmployeePayroll.id), s(EmployeePayroll.gross_salary), s(EmployeePayroll.less_epf_employee),
            s(EmployeePayroll.less_apit), s(EmployeePayroll.total_deductions), s(EmployeePayroll.net_salary),
            s(EmployeePayroll.epf_employer), s(EmployeePayroll.etf_employer), s(EmployeePayroll.total_employer_cost),
        )
        .join(EmployeePayroll, EmployeePayroll.payroll_batch_no == PayrollBatch.batch_no)
        .filter(
            PayrollBatch.status.in_(PAID_BATCH_STATUSES),
            (PayrollBatch.payroll_year * 100 + PayrollBatch.payroll_month).between(first, last),
            _employee_scope(ctx, EmployeePayroll.employee_id),
        )
        .group_by(PayrollBatch.payroll_year, PayrollBatch.payroll_month, PayrollBatch.batch_no, PayrollBatch.status)
        .order_by(PayrollBatch.payroll_year, PayrollBatch.payroll_month, PayrollBatch.batch_no)
        .all()
    )
    out = [{
        "period": date(y, m, 1).strftime("%Y-%m"), "batch_no": b, "status": st, "employees": n,
        "gross": _d(g), "epf_employee": _d(ee), "apit": _d(apit), "deductions": _d(ded), "net": _d(net),
        "epf_employer": _d(er), "etf_employer": _d(etf), "employer_cost": _d(cost),
    } for y, m, b, st, n, g, ee, apit, ded, net, er, etf, cost in rows]

    reimb_q = ctx.db.query(func.coalesce(func.sum(func.coalesce(Reimbursements.approved_amount, Reimbursements.total_amount)), 0)).filter(
        Reimbursements.claim_date.between(p["date_from"], p["date_to"]),
        Reimbursements.status.in_(("approved", "verified", "paid", "completed")),
    )
    if ctx.allowed_branches is not None:
        reimb_q = reimb_q.filter(Reimbursements.branch_code.in_(ctx.allowed_branches))
    emp_q = ctx.db.query(func.count(Employee.id)).filter(Employee.status == "active")
    if ctx.allowed_branches is not None:
        emp_q = emp_q.filter(or_(Employee.branch_code.in_(ctx.allowed_branches), Employee.branch_code.is_(None)))
    money = lambda k, label: Column(k, label, "money", True)  # noqa: E731
    return ReportResult(
        metrics=[
            metric("Active employees", emp_q.scalar() or 0, "int"),
            metric("Gross pay", sum((r["gross"] for r in out), ZERO), "money"),
            metric("Net pay", sum((r["net"] for r in out), ZERO), "money"),
            metric("Employer cost", sum((r["employer_cost"] for r in out), ZERO), "money"),
            metric("Approved reimbursements", _d(reimb_q.scalar()), "money"),
        ],
        tables=[table("by_month", "Payroll by month", out, [
            Column("period", "Month"), Column("batch_no", "Batch"), Column("status", "Status"),
            Column("employees", "Employees", "int"), money("gross", "Gross"), money("epf_employee", "EPF (employee)"),
            money("apit", "APIT"), money("deductions", "Total deductions"), money("net", "Net pay"),
            money("epf_employer", "EPF (employer)"), money("etf_employer", "ETF"), money("employer_cost", "Employer cost")])],
        notes=["Paid payroll batches only (salary paid or later), for the months the dates fall in."],
    )


STATUTORY_KIND = Param(
    "kind", "Return", "select", required=True, default="epf",
    options=(("epf", "EPF (Form C)"), ("etf", "ETF (Form R4)"), ("apit", "APIT schedule")),
)
MONTH = Param("month", "Month", "int", required=True, default="current_month", min=1, max=12)


def _statutory(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.hr.models import PayrollBatch
    from app.modules.hr.sl_payroll import statutory_return

    batches = (
        ctx.db.query(PayrollBatch)
        .filter(PayrollBatch.payroll_year == p["year"], PayrollBatch.payroll_month == p["month"],
                PayrollBatch.status.notin_(("cancelled", "rejected", "draft")))
        .order_by(PayrollBatch.batch_no).all()
    )
    rows, warnings, batch_nos = [], [], []
    for b in batches:
        r = statutory_return(ctx.db, b.id, p["kind"], ctx.allowed_branches)
        batch_nos.append(b.batch_no)
        warnings += r["warnings"]
        rows += [{**row, "batch_no": b.batch_no} for row in r["rows"]]
    cols = {
        "epf": [Column("member_no", "Member no"), Column("earnings", "Earnings", "money", True),
                Column("employee", "Employee 8%", "money", True), Column("employer", "Employer 12%", "money", True),
                Column("total", "Total", "money", True)],
        "etf": [Column("member_no", "Member no"), Column("earnings", "Earnings", "money", True),
                Column("contribution", "Employer 3%", "money", True)],
        "apit": [Column("tin", "TIN"), Column("gross", "Gross", "money", True),
                 Column("taxable", "Taxable", "money", True), Column("apit", "APIT", "money", True)],
    }[p["kind"]]
    head = [Column("employee_id", "Employee"), Column("name", "Name"), Column("nic", "NIC")]
    total_key = {"epf": "total", "etf": "contribution", "apit": "apit"}[p["kind"]]
    notes = [f"Payroll batches: {', '.join(batch_nos)}." if batch_nos else "No payroll batch for this month."]
    notes += warnings[:20]
    return ReportResult(
        metrics=[metric("Employees", len(rows), "int"),
                 metric("Amount due", sum((_d(r[total_key]) for r in rows), ZERO), "money")],
        tables=[table("return", STATUTORY_KIND.options[[k for k, _ in STATUTORY_KIND.options].index(p["kind"])][1],
                      rows, head + cols + [Column("batch_no", "Batch")])],
        notes=notes,
    )


LOAN_STATUS = Param(
    "status", "Status", "select", default="active",
    options=(("active", "Active"), ("settled", "Settled"), ("all", "All except cancelled")),
)


def _loans(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.hr.loans import LoanService

    items = LoanService(ctx.db).list(None if p["status"] == "all" else p["status"],
                                     branches=ctx.allowed_branches)
    items = [i for i in items if i["status"] != "cancelled"]
    rows = [{
        "loan_no": i["loan_no"], "employee_id": i["employee_id"], "employee": i["employee_name"],
        "type": i["loan_type"], "issued": i["issue_date"], "installments": i["installments"],
        "installment": i["installment_amount"], "amount": i["amount"], "recovered": i["recovered"],
        "balance": i["balance"], "status": i["status"],
    } for i in items]
    return ReportResult(
        metrics=[metric("Loans", len(rows), "int"),
                 metric("Issued", sum((_d(r["amount"]) for r in rows), ZERO), "money"),
                 metric("Outstanding", sum((_d(r["balance"]) for r in rows), ZERO), "money")],
        tables=[table("loans", "Employee loans and advances", rows, [
            Column("loan_no", "Loan"), Column("employee_id", "Employee"), Column("employee", "Name"),
            Column("type", "Type"), Column("issued", "Issued", "date"), Column("installments", "Installments", "int"),
            Column("installment", "Installment", "money"), Column("amount", "Amount", "money", True),
            Column("recovered", "Recovered", "money", True), Column("balance", "Balance", "money", True),
            Column("status", "Status")])],
    )


register(ReportDef(
    "hr.payroll_summary", "Payroll summary", "HR",
    "Paid payroll by month: gross, EPF, APIT, deductions, net pay and employer cost.",
    Permissions.REPORTING_HR_VIEW, _payroll_summary, (DATE_FROM, DATE_TO),
))
register(ReportDef(
    "hr.statutory", "EPF / ETF / APIT returns", "HR",
    "Monthly statutory contributions per employee from the payroll.",
    Permissions.PAYROLL_VIEW, _statutory, (YEAR, MONTH, STATUTORY_KIND),
))
register(ReportDef(
    "hr.loans", "Employee loans", "HR",
    "Loans and salary advances with amount recovered and balance outstanding.",
    Permissions.DEDUCTION_VIEW, _loans, (LOAN_STATUS,),
))
