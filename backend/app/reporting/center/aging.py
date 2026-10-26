"""Receivables and payables aging.

Built on the same outstanding-document services as the "outstanding" reports, so the
balances always agree with them; this adds the age buckets. Age is counted in days
from the due date (default) or the document date, as of today.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date
from decimal import Decimal
from typing import Optional

from app.auth.rbac import Permissions
from app.core import timezone as tz

from .core import Column, Param, ReportDef, ReportResult, RunContext, metric, register, table, to_plain

BUCKETS = (
    ("current", "Not yet due", None, 0),
    ("d1_30", "1–30 days", 1, 30),
    ("d31_60", "31–60 days", 31, 60),
    ("d61_90", "61–90 days", 61, 90),
    ("d90_plus", "Over 90 days", 91, None),
)

AGE_BY = Param(
    "age_by", "Age by", "select", required=True, default="due_date",
    options=(("due_date", "Due date"), ("document_date", "Document date")),
    help="Due date: how late a balance is. Document date: how old it is.",
)


def bucket_for(days: int) -> str:
    for key, _label, lo, hi in BUCKETS:
        if (lo is None or days >= lo) and (hi is None or days <= hi):
            return key
    return "current"


def _days(on: Optional[str], today: date) -> int:
    if not on:
        return 0
    try:
        return (today - date.fromisoformat(str(on)[:10])).days
    except ValueError:
        return 0


def _aging(items: list[dict], party_key: str, party_label: str, date_key: str, number_key: str,
           doc_title: str, age_by: str) -> ReportResult:
    today = tz.today()
    totals = {k: Decimal("0") for k, *_ in BUCKETS}
    parties: "OrderedDict[str, dict]" = OrderedDict()
    detail = []
    for it in items:
        balance = Decimal(str(it.get("balance_due") or 0))
        if balance == 0:
            continue
        when = it.get("due_date") if age_by == "due_date" else it.get(date_key)
        days = _days(when, today)
        key = bucket_for(days)
        totals[key] += balance
        name = it.get(party_key) or "Unknown"
        row = parties.setdefault(name, {"party": name, **{k: Decimal("0") for k, *_ in BUCKETS}, "total": Decimal("0")})
        row[key] += balance
        row["total"] += balance
        detail.append({
            "party": name, "document_no": it.get(number_key), "document_date": it.get(date_key),
            "due_date": it.get("due_date"), "days": max(days, 0) if age_by == "due_date" else days,
            "bucket": next(label for k, label, *_ in BUCKETS if k == key),
            "balance": balance, "branch_code": it.get("branch_code"),
        })

    summary = sorted(parties.values(), key=lambda r: r["total"], reverse=True)
    grand = sum(totals.values(), Decimal("0"))
    bucket_cols = [Column(k, label, "money", True) for k, label, *_ in BUCKETS]
    days_label = "Days overdue" if age_by == "due_date" else "Age (days)"
    return ReportResult(
        metrics=[metric("Total outstanding", grand, "money")]
        + [metric(label, totals[k], "money") for k, label, *_ in BUCKETS],
        tables=[
            table("summary", f"Aging by {party_label.lower()}", summary,
                  [Column("party", party_label), *bucket_cols, Column("total", "Total", "money", True)]),
            table("documents", doc_title, sorted(detail, key=lambda r: r["days"], reverse=True), [
                Column("party", party_label), Column("document_no", "Document"),
                Column("document_date", "Date", "date"), Column("due_date", "Due", "date"),
                Column("days", days_label, "int"), Column("bucket", "Bucket"),
                Column("balance", "Balance", "money", True), Column("branch_code", "Branch")]),
        ],
        notes=[f"Aged as of {today.isoformat()} by {'due date' if age_by == 'due_date' else 'document date'}."],
    )


def _ar_aging(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.customers.credit_service import customer_credit_service

    r = to_plain(customer_credit_service.get_outstanding_documents(
        ctx.db, customer_id=p["customer_id"], branch_code=ctx.single_branch(p["branch_code"])))
    return _aging(r["items"], "customer_name", "Customer", "invoice_date", "invoice_no",
                  "Outstanding invoices", p["age_by"])


def _ap_aging(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.purchasing.credit_service import supplier_credit_service

    r = to_plain(supplier_credit_service.get_outstanding_documents(
        ctx.db, supplier_id=p["supplier_id"], branch_code=ctx.single_branch(p["branch_code"])))
    return _aging(r["items"], "supplier_name", "Supplier", "document_date", "document_no",
                  "Outstanding supplier documents", p["age_by"])


register(ReportDef(
    "customers.aging", "Receivables aging", "Sales",
    "Customer balances by age: not yet due, 1–30, 31–60, 61–90 and over 90 days.",
    Permissions.CUSTOMER_VIEW, _ar_aging,
    (AGE_BY, Param("customer_id", "Customer", "customer"), Param("branch_code", "Branch", "branch")),
    tags=("ar", "debtors", "receivables", "overdue"),
))
register(ReportDef(
    "suppliers.aging", "Payables aging", "Purchasing",
    "Supplier balances by age: not yet due, 1–30, 31–60, 61–90 and over 90 days.",
    Permissions.SUPPLIER_PAYMENT_VIEW, _ap_aging,
    (AGE_BY, Param("supplier_id", "Supplier", "supplier"), Param("branch_code", "Branch", "branch")),
    tags=("ap", "creditors", "payables", "overdue"),
))
