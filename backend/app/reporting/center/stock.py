"""Stock valuation and stock movement.

Valuation uses the same rules as the inventory Stock Summary
(InventoryService.get_stock_summary): on hand = available + reserved + frozen units,
valued at what each unit was bought for (its purchase-order line), falling back to the
product's cost price. Units in transit or damaged are shown but not valued.

There is no stock ledger table, so movements are rebuilt from the documents that move
stock: goods received, counted sales, restocked customer returns, approved supplier
returns and item transfers. Anything changed outside those documents (damage, manual
fixes) shows up as the difference between the computed closing quantity and the units
actually on hand.
"""

from __future__ import annotations

from decimal import Decimal

from sqlalchemy import Date, and_, case, cast, func, literal, or_, select, union_all
from sqlalchemy.orm import aliased

from app.auth.rbac import Permissions
from app.common.enums import StockStatus
from app.core import timezone as tz

from .core import Column, Param, ReportDef, ReportResult, RunContext, metric, register, table

def _on_hand_statuses():
    from app.modules.inventory.service import SalesStockService

    return SalesStockService._SUMMARY_ON_HAND_STATUSES


ON_HAND = _on_hand_statuses()  # same "on hand" as the inventory Stock Summary
IN_TRANSIT = (StockStatus.TRANSFER_PENDING.value, StockStatus.IN_TRANSIT.value)
# Transfer notes whose stock has left the source branch.
TRANSFER_OUT_STATUSES = ("approved", "dispatched", "in_transit", "partially_received", "received")
INVENTORY_ACCOUNTS = ("1200", "1210")

BRANCH = Param("branch_code", "Branch", "branch")
PRODUCT = Param("product_id", "Product", "product")


def _branch_filter(column, branch_code, branch_codes):
    if branch_code:
        return column == branch_code
    if branch_codes is not None:
        return column.in_(branch_codes)
    return literal(True)


def _models():
    from app.modules.products.models import Category, ItemsBrand, Product

    return Product, Category, ItemsBrand


# --------------------------------------------------------------------------- #
# Valuation
# --------------------------------------------------------------------------- #
def _stock_valuation(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
    from app.modules.inventory.models import SalesStock
    from app.modules.purchasing.models import PurchasingOrderItems

    Product, Category, ItemsBrand = _models()
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    group = p["group_by"]

    unit_cost = func.coalesce(PurchasingOrderItems.unit_price, Product.cost_price, 0)

    def qty(*statuses):
        return func.coalesce(func.sum(case((SalesStock.status.in_(statuses), SalesStock.quantity), else_=0)), 0)

    value = func.coalesce(func.sum(case((SalesStock.status.in_(ON_HAND), SalesStock.quantity * unit_cost), else_=0)), 0)
    item_code, product = Product.item_code.label("item_code"), Product.name.label("product")
    category, brand = Category.name.label("category"), ItemsBrand.brand_name.label("brand")
    branch = SalesStock.branch_code.label("branch_code")
    keys = {
        "product": [item_code, product, category, brand],
        "product_branch": [item_code, product, category, brand, branch],
        "category": [category],
        "brand": [brand],
        "branch": [branch],
    }[group]
    rows = (
        ctx.db.query(
            *keys,
            qty(StockStatus.AVAILABLE.value).label("available"),
            qty(StockStatus.RESERVED.value).label("reserved"),
            qty(StockStatus.FROZEN.value).label("frozen"),
            qty(*ON_HAND).label("on_hand"),
            qty(*IN_TRANSIT).label("in_transit"),
            qty(StockStatus.DAMAGED.value).label("damaged"),
            value.label("value"),
        )
        .join(Product, Product.id == SalesStock.product_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .outerjoin(ItemsBrand, ItemsBrand.id == Product.items_brand_id)
        .outerjoin(PurchasingOrderItems, PurchasingOrderItems.id == SalesStock.purchasing_order_items_id)
        .filter(
            SalesStock.status.in_(ON_HAND + IN_TRANSIT + (StockStatus.DAMAGED.value,)),
            _branch_filter(SalesStock.branch_code, branch_code, branch_codes),
        )
        .group_by(*keys)
        .all()
    )

    out = []
    for r in rows:
        m = r._mapping
        on_hand = int(m["on_hand"])
        val = Decimal(str(m["value"]))
        if on_hand == 0 and not m["in_transit"] and not m["damaged"]:
            continue
        out.append({
            "item_code": m.get("item_code"), "product": m.get("product"), "category": m.get("category"),
            "brand": m.get("brand"), "branch_code": m.get("branch_code"),
            "available": int(m["available"]), "reserved": int(m["reserved"]), "frozen": int(m["frozen"]),
            "on_hand": on_hand, "avg_cost": (val / on_hand) if on_hand else None, "value": val,
            "in_transit": int(m["in_transit"]), "damaged": int(m["damaged"]),
        })
    out.sort(key=lambda r: r["value"], reverse=True)

    label_cols = {
        "product": [Column("item_code", "Item code"), Column("product", "Product"),
                    Column("category", "Category"), Column("brand", "Brand")],
        "product_branch": [Column("item_code", "Item code"), Column("product", "Product"),
                           Column("category", "Category"), Column("brand", "Brand"), Column("branch_code", "Branch")],
        "category": [Column("category", "Category")],
        "brand": [Column("brand", "Brand")],
        "branch": [Column("branch_code", "Branch")],
    }[group]
    cols = label_cols + [
        Column("available", "Available", "int", True), Column("reserved", "Reserved", "int", True),
        Column("frozen", "Frozen", "int", True), Column("on_hand", "On hand", "int", True),
        Column("avg_cost", "Avg. unit cost", "money"), Column("value", "Value", "money", True),
        Column("in_transit", "In transit", "int", True), Column("damaged", "Damaged", "int", True),
    ]

    total_value = sum((r["value"] for r in out), Decimal("0"))
    gl = (
        ctx.db.query(func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0))
        .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
        .filter(ChartOfAccounts.account_code.in_(INVENTORY_ACCOUNTS),
                _branch_filter(GeneralLedger.branch_code, branch_code, branch_codes))
        .scalar()
    )
    gl = Decimal(str(gl or 0))
    return ReportResult(
        metrics=[
            metric("Stock value", total_value, "money"),
            metric("Units on hand", sum(r["on_hand"] for r in out), "int"),
            metric("GL inventory (1200, 1210)", gl, "money"),
            metric("Difference to GL", total_value - gl, "money"),
        ],
        tables=[table("valuation", "Stock valuation", out, cols)],
        notes=[
            "On hand = available + reserved + frozen, valued at each unit's purchase cost (product cost when "
            "there is no purchase line). In-transit and damaged units are listed but not valued.",
            f"Valued as of now ({tz.now():%Y-%m-%d %H:%M}). A difference to the GL comes from landed costs, "
            "damaged or adjusted stock, and postings outside stock documents.",
        ],
    )


register(ReportDef(
    "inventory.valuation", "Stock valuation", "Inventory",
    "Quantity and value of stock on hand at purchase cost, compared with the GL inventory accounts.",
    Permissions.REPORTING_INVENTORY_VIEW, _stock_valuation,
    (
        Param("group_by", "Group by", "select", required=True, default="product", options=(
            ("product", "Product"), ("product_branch", "Product and branch"),
            ("category", "Category"), ("brand", "Brand"), ("branch", "Branch"))),
        BRANCH,
    ),
    tags=("stock value", "inventory value"),
))


# --------------------------------------------------------------------------- #
# Movement
# --------------------------------------------------------------------------- #
def movements_query():
    """Every document line that moved stock: date, kind, document, branch, product, qty in, qty out."""
    from app.modules.common.models import Locations
    from app.modules.purchasing.models import (
        GoodReceivedItems, GoodReceivedNote, PurchasingOrderItems, PurchasingReturn, PurchasingReturnItems,
    )
    from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn, SaleReturnItems
    from app.modules.sales.sales_metrics import counted_invoice_filters
    from app.modules.warehouse.models import ItemReceiveNote, ItemTransferNote, ItemTransferNoteItems

    zero = literal(0)
    received = (
        select(GoodReceivedNote.good_received_date.label("on"), literal("Goods received").label("kind"),
               GoodReceivedNote.good_received_no.label("document"), GoodReceivedNote.branch_code.label("branch"),
               PurchasingOrderItems.product_id.label("product_id"),
               GoodReceivedItems.quantity.label("qty_in"), zero.label("qty_out"))
        .select_from(GoodReceivedItems)
        .join(GoodReceivedNote, GoodReceivedNote.good_received_no == GoodReceivedItems.good_received_note)
        .join(PurchasingOrderItems, PurchasingOrderItems.id == GoodReceivedItems.purchasing_order_items_id)
        .where(GoodReceivedNote.status != "cancelled")
    )
    sold = (
        select(Invoice.created_date, literal("Sale"), Invoice.invoice_no, Invoice.branch_code,
               InvoiceItems.product_id, zero, InvoiceItems.quantity)
        .select_from(InvoiceItems)
        .join(Invoice, Invoice.id == InvoiceItems.invoice_id)
        .where(*counted_invoice_filters())
    )
    customer_returns = (
        select(SaleReturn.added_date, literal("Customer return"), SaleReturn.sale_return_no, SaleReturn.branch_code,
               SaleReturnItems.product_id, SaleReturnItems.quantity, zero)
        .select_from(SaleReturnItems)
        .join(SaleReturn, SaleReturn.id == SaleReturnItems.sale_return_id)
        .where(SaleReturn.status == "processed", SaleReturnItems.restocked.is_(True),
               SaleReturnItems.product_id.isnot(None))
    )
    supplier_returns = (
        select(func.coalesce(cast(PurchasingReturn.approved_date, Date), PurchasingReturn.added_date),
               literal("Supplier return"), PurchasingReturn.purchasing_return_no, PurchasingReturn.branch_code,
               PurchasingReturnItems.product_id, zero, PurchasingReturnItems.quantity)
        .select_from(PurchasingReturnItems)
        .join(PurchasingReturn, PurchasingReturn.id == PurchasingReturnItems.purchasingreturn_id)
        .where(PurchasingReturn.status == "approved")
    )
    src, dst = aliased(Locations), aliased(Locations)
    transfers_out = (
        select(ItemTransferNote.created_date, literal("Transfer out"), ItemTransferNote.item_transfer_note,
               src.branch_code, ItemTransferNoteItems.product_id, zero, ItemTransferNoteItems.quantity)
        .select_from(ItemTransferNoteItems)
        .join(ItemTransferNote, ItemTransferNote.id == ItemTransferNoteItems.itemtransfernote_id)
        .join(src, src.id == ItemTransferNote.from_location_id)
        .where(ItemTransferNote.status.in_(TRANSFER_OUT_STATUSES))
    )
    received_on = (
        select(ItemReceiveNote.item_transfer_note_id.label("itn_id"),
               func.max(cast(ItemReceiveNote.recieved_date, Date)).label("on"))
        .group_by(ItemReceiveNote.item_transfer_note_id)
        .subquery()
    )
    transfers_in = (
        select(func.coalesce(received_on.c.on, ItemTransferNote.created_date), literal("Transfer in"),
               ItemTransferNote.item_transfer_note, dst.branch_code, ItemTransferNoteItems.product_id,
               ItemTransferNoteItems.quantity, zero)
        .select_from(ItemTransferNoteItems)
        .join(ItemTransferNote, ItemTransferNote.id == ItemTransferNoteItems.itemtransfernote_id)
        .join(dst, dst.id == ItemTransferNote.to_location_id)
        .outerjoin(received_on, received_on.c.itn_id == ItemTransferNote.id)
        .where(ItemTransferNoteItems.item_recieved.is_(True))
    )
    return union_all(received, sold, customer_returns, supplier_returns, transfers_out, transfers_in).subquery("movements")


KINDS = ("Goods received", "Customer return", "Transfer in", "Sale", "Supplier return", "Transfer out")


def _stock_movement(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.inventory.models import SalesStock

    Product, _Category, _Brand = _models()
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    by_branch = p["group_by"] == "product_branch"
    mv = movements_query()

    where = [_branch_filter(mv.c.branch, branch_code, branch_codes), Product.item_type != "service"]
    if p["product_id"]:
        where.append(mv.c.product_id == p["product_id"])
    start, end = p["date_from"], p["date_to"]

    keys = [Product.id, Product.item_code, Product.name] + ([mv.c.branch] if by_branch else [])
    net = mv.c.qty_in - mv.c.qty_out
    in_period = and_(mv.c.on >= start, mv.c.on <= end)
    agg = [func.coalesce(func.sum(case((mv.c.on < start, net), else_=0)), 0).label("opening")]
    agg += [
        func.coalesce(func.sum(case((and_(in_period, mv.c.kind == k), mv.c.qty_in + mv.c.qty_out), else_=0)), 0).label(f"k{i}")
        for i, k in enumerate(KINDS)
    ]
    agg.append(func.coalesce(func.sum(case((mv.c.on <= end, net), else_=0)), 0).label("closing"))
    rows = (
        ctx.db.query(*keys, *agg)
        .select_from(mv)
        .join(Product, Product.id == mv.c.product_id)
        .filter(*where, mv.c.on <= end)
        .group_by(*keys)
        .all()
    )

    show_on_hand = end >= tz.today()
    on_hand: dict = {}
    if show_on_hand:
        q = ctx.db.query(SalesStock.product_id, *( [SalesStock.branch_code] if by_branch else []),
                         func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
            SalesStock.status.in_(ON_HAND), _branch_filter(SalesStock.branch_code, branch_code, branch_codes))
        if p["product_id"]:
            q = q.filter(SalesStock.product_id == p["product_id"])
        q = q.group_by(SalesStock.product_id, *([SalesStock.branch_code] if by_branch else []))
        for r in q.all():
            on_hand[tuple(r[:-1])] = int(r[-1])

    summary = []
    for r in rows:
        m = r._mapping
        moved = [int(m[f"k{i}"]) for i in range(len(KINDS))]
        if int(m["opening"]) == 0 and not any(moved) and int(m["closing"]) == 0:
            continue
        row = {"item_code": m["item_code"], "product": m["name"], "branch_code": m.get("branch") if by_branch else None,
               "opening": int(m["opening"]), **{f"k{i}": v for i, v in enumerate(moved)}, "closing": int(m["closing"])}
        if show_on_hand:
            key = (m["id"], m["branch"]) if by_branch else (m["id"],)
            row["on_hand"] = on_hand.get(key, 0)
            row["difference"] = row["on_hand"] - row["closing"]
        summary.append(row)
    summary.sort(key=lambda r: (r["product"] or "", r["branch_code"] or ""))

    cols = [Column("item_code", "Item code"), Column("product", "Product")]
    if by_branch:
        cols.append(Column("branch_code", "Branch"))
    cols += [Column("opening", "Opening", "int", True)]
    cols += [Column(f"k{i}", k, "int", True) for i, k in enumerate(KINDS)]
    cols += [Column("closing", "Closing", "int", True)]
    if show_on_hand:
        cols += [Column("on_hand", "On hand now", "int", True), Column("difference", "Difference", "int", True)]

    lines = (
        ctx.db.query(mv.c.on, mv.c.kind, mv.c.document, mv.c.branch, Product.item_code, Product.name,
                     mv.c.qty_in, mv.c.qty_out)
        .select_from(mv)
        .join(Product, Product.id == mv.c.product_id)
        .filter(*where, in_period)
        .order_by(mv.c.on, mv.c.document)
        .all()
    )
    detail = [{"date": r[0], "kind": r[1], "document": r[2], "branch_code": r[3], "item_code": r[4],
               "product": r[5], "qty_in": int(r[6]), "qty_out": int(r[7])} for r in lines]

    total_in = sum(d["qty_in"] for d in detail)
    total_out = sum(d["qty_out"] for d in detail)
    notes = ["Movements are rebuilt from goods received, counted sales, restocked customer returns, "
             "approved supplier returns and item transfers (out on approval, in on receipt)."]
    if show_on_hand:
        notes.append("Difference = units on hand now minus the computed closing quantity: stock changed outside "
                     "these documents (damage, frozen, manual fixes) or still waiting for approval.")
    return ReportResult(
        metrics=[metric("Units in", total_in, "int"), metric("Units out", total_out, "int"),
                 metric("Net movement", total_in - total_out, "int"), metric("Products", len(summary), "int")],
        tables=[
            table("summary", "Movement by product", summary, cols),
            table("lines", "Movement lines", detail, [
                Column("date", "Date", "date"), Column("kind", "Movement"), Column("document", "Document"),
                Column("branch_code", "Branch"), Column("item_code", "Item code"), Column("product", "Product"),
                Column("qty_in", "In", "int", True), Column("qty_out", "Out", "int", True)]),
        ],
        notes=notes,
    )


register(ReportDef(
    "inventory.movement", "Stock movement", "Inventory",
    "Opening, received, sold, returned, transferred and closing quantities per product for a period.",
    Permissions.REPORTING_INVENTORY_VIEW, _stock_movement,
    (
        Param("date_from", "From", "date", required=True, default="month_start"),
        Param("date_to", "To", "date", required=True, default="today"),
        BRANCH, PRODUCT,
        Param("group_by", "Show", "select", required=True, default="product", options=(
            ("product", "Per product"), ("product_branch", "Per product and branch"))),
    ),
    tags=("stock card", "stock ledger", "movement"),
))
