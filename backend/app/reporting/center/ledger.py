"""VAT summary and general ledger detail.

VAT: output tax comes from counted sales invoices less the tax refunded on processed
returns (exactly what the sales GL posting credits/debits to 2210 VAT/Tax Payable), and
is checked against the 2210 account itself. Input tax comes from verified purchase
invoices; it is not posted to the GL today, so it is reported from the documents only.

GL detail: every posting for the chosen accounts in a period, with each account's
opening balance and running balance (debits positive, credits negative). Balance-sheet
accounts open with everything posted before the period; income and expense accounts
open with what was posted earlier in the same fiscal year.
"""

from __future__ import annotations

from collections import defaultdict
from decimal import Decimal

from sqlalchemy import case, func, literal, or_

from app.auth.rbac import Permissions

from .core import Column, Param, ReportDef, ReportResult, RunContext, metric, register, table

VAT_ACCOUNT = "2210"
INPUT_VAT_STATUSES = ("verified", "partially_paid", "paid")
PL_TYPES = ("revenue", "income", "expense", "cost of sales", "cogs")

DATE_FROM = Param("date_from", "From", "date", required=True, default="month_start")
DATE_TO = Param("date_to", "To", "date", required=True, default="today")
BRANCH = Param("branch_code", "Branch", "branch")


def _branch(column, branch_code, branch_codes, include_unassigned=False):
    if branch_code:
        return column == branch_code
    if branch_codes is not None:
        # Company-level GL postings carry no branch; branch users see them, as in the GL list.
        return or_(column.in_(branch_codes), column.is_(None)) if include_unassigned else column.in_(branch_codes)
    return literal(True)


# --------------------------------------------------------------------------- #
# VAT summary
# --------------------------------------------------------------------------- #
def _vat_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
    from app.modules.purchasing.invoice_models import PurchaseInvoice
    from app.modules.purchasing.models import Supplier
    from app.modules.sales.models import Invoice, SaleReturn
    from app.modules.sales.sales_metrics import counted_invoice_filters

    db = ctx.db
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    start, end = p["date_from"], p["date_to"]

    by_rate = (
        db.query(
            Invoice.tax_rate, Invoice.is_tax_invoice, func.count(Invoice.id),
            func.coalesce(func.sum(Invoice.subtotal), 0), func.coalesce(func.sum(Invoice.tax_amount), 0),
        )
        .filter(*counted_invoice_filters(), Invoice.created_date >= start, Invoice.created_date <= end,
                _branch(Invoice.branch_code, branch_code, branch_codes))
        .group_by(Invoice.tax_rate, Invoice.is_tax_invoice)
        .order_by(Invoice.tax_rate.desc(), Invoice.is_tax_invoice)
        .all()
    )
    output_rows = [
        {"rate": Decimal(str(r or 0)), "pricing": "Tax inclusive" if inclusive else "Tax exclusive",
         "invoices": n, "sales": Decimal(str(net)), "tax": Decimal(str(tax))}
        for r, inclusive, n, net, tax in by_rate
    ]
    output_tax = sum((r["tax"] for r in output_rows), Decimal("0"))

    # Same rule as post_sale_return_to_gl: an invalid tax_refund (negative or above the refund) is ignored.
    refund_expr = case(
        (or_(SaleReturn.tax_refund < 0, SaleReturn.tax_refund > SaleReturn.total_refund), 0),
        else_=SaleReturn.tax_refund,
    )
    returns = (
        db.query(SaleReturn.sale_return_no, SaleReturn.added_date, SaleReturn.branch_code, refund_expr)
        .filter(SaleReturn.status == "processed", SaleReturn.added_date >= start, SaleReturn.added_date <= end,
                SaleReturn.total_refund > 0, _branch(SaleReturn.branch_code, branch_code, branch_codes))
        .order_by(SaleReturn.added_date)
        .all()
    )
    return_rows = [{"document": no, "date": on, "branch_code": b, "tax_refunded": Decimal(str(t or 0))}
                   for no, on, b, t in returns if t]
    refunded = sum((r["tax_refunded"] for r in return_rows), Decimal("0"))

    purchases = (
        db.query(Supplier.company_name, Supplier.tax_registration_number, func.count(PurchaseInvoice.id),
                 func.coalesce(func.sum(PurchaseInvoice.subtotal), 0),
                 func.coalesce(func.sum(PurchaseInvoice.tax_amount), 0))
        .join(Supplier, Supplier.id == PurchaseInvoice.supplier_id)
        .filter(PurchaseInvoice.status.in_(INPUT_VAT_STATUSES),
                PurchaseInvoice.supplier_invoice_date >= start, PurchaseInvoice.supplier_invoice_date <= end,
                PurchaseInvoice.tax_amount != 0,
                _branch(PurchaseInvoice.branch_code, branch_code, branch_codes))
        .group_by(Supplier.company_name, Supplier.tax_registration_number)
        .order_by(func.sum(PurchaseInvoice.tax_amount).desc())
        .all()
    )
    input_rows = [{"supplier": s, "tax_registration_number": trn, "invoices": n,
                   "purchases": Decimal(str(net)), "tax": Decimal(str(tax))} for s, trn, n, net, tax in purchases]
    input_tax = sum((r["tax"] for r in input_rows), Decimal("0"))

    gl = (
        db.query(GeneralLedger.reference_type,
                 func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
                 func.coalesce(func.sum(GeneralLedger.credit_amount), 0))
        .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
        .filter(ChartOfAccounts.account_code == VAT_ACCOUNT,
                GeneralLedger.posting_date >= start, GeneralLedger.posting_date <= end,
                _branch(GeneralLedger.branch_code, branch_code, branch_codes, include_unassigned=True))
        .group_by(GeneralLedger.reference_type)
        .all()
    )
    gl_rows = [{"source": t or "Other", "debit": Decimal(str(d)), "credit": Decimal(str(c)),
                "net": Decimal(str(c)) - Decimal(str(d))} for t, d, c in gl]
    gl_net = sum((r["net"] for r in gl_rows), Decimal("0"))

    net_output = output_tax - refunded
    notes = [
        "Output tax: approved and completed sales invoices by invoice date, less tax refunded on processed returns.",
        "Input tax: verified, part-paid and paid purchase invoices by supplier invoice date. It is not posted to "
        "the GL, so it does not appear in account 2210.",
    ]
    if net_output != gl_net:
        notes.append(f"Output tax on documents differs from GL account {VAT_ACCOUNT} by {net_output - gl_net:,.2f}: "
                     "check for sales not yet posted (see posting failures) or manual journals to 2210.")
    return ReportResult(
        metrics=[
            metric("Output tax", output_tax, "money"),
            metric("Tax refunded", refunded, "money"),
            metric("Net output tax", net_output, "money"),
            metric("Input tax", input_tax, "money"),
            metric("Net VAT payable", net_output - input_tax, "money"),
            metric(f"GL {VAT_ACCOUNT} net credit", gl_net, "money"),
        ],
        tables=[
            table("output", "Output tax by rate", output_rows, [
                Column("rate", "Rate", "percent"), Column("pricing", "Pricing"), Column("invoices", "Invoices", "int", True),
                Column("sales", "Net sales", "money", True), Column("tax", "Tax", "money", True)]),
            table("refunds", "Tax refunded on returns", return_rows, [
                Column("date", "Date", "date"), Column("document", "Return"), Column("branch_code", "Branch"),
                Column("tax_refunded", "Tax refunded", "money", True)]),
            table("input", "Input tax by supplier", input_rows, [
                Column("supplier", "Supplier"), Column("tax_registration_number", "Tax reg. no."),
                Column("invoices", "Invoices", "int", True), Column("purchases", "Net purchases", "money", True),
                Column("tax", "Tax", "money", True)]),
            table("gl", f"GL {VAT_ACCOUNT} VAT/Tax Payable by source", gl_rows, [
                Column("source", "Source"), Column("debit", "Debit", "money", True),
                Column("credit", "Credit", "money", True), Column("net", "Net credit", "money", True)]),
        ],
        notes=notes,
    )


register(ReportDef(
    "finance.vat_summary", "VAT summary", "Finance",
    "Output tax on sales, tax refunded on returns and input tax on purchases for a period, checked against the GL.",
    Permissions.REPORTING_FINANCE_VIEW, _vat_summary, (DATE_FROM, DATE_TO, BRANCH),
    tags=("tax", "vat return", "gst"),
))


# --------------------------------------------------------------------------- #
# GL detail
# --------------------------------------------------------------------------- #
def _fiscal_year_of(db, on) -> int:
    from app.modules.finance.accounting_models import AccountingPeriod

    fy = (
        db.query(AccountingPeriod.fiscal_year)
        .filter(AccountingPeriod.start_date <= on, AccountingPeriod.end_date >= on)
        .order_by(AccountingPeriod.fiscal_year.desc())
        .scalar()
    )
    return fy or on.year


def _gl_detail(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger

    db = ctx.db
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    start, end = p["date_from"], p["date_to"]
    acct_filter = [ChartOfAccounts.account_code == p["account_code"]] if p["account_code"] else []
    branch = _branch(GeneralLedger.branch_code, branch_code, branch_codes, include_unassigned=True)
    if p["account_code"] and not db.query(ChartOfAccounts.id).filter(*acct_filter).first():
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail=f"Account {p['account_code']} does not exist")

    is_pl = func.lower(ChartOfAccounts.account_type).in_(PL_TYPES)
    fy = _fiscal_year_of(db, start)
    opening_q = (
        db.query(ChartOfAccounts.account_code,
                 func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0))
        .join(GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id)
        .filter(*acct_filter, branch, GeneralLedger.posting_date < start,
                or_(~is_pl, GeneralLedger.fiscal_year == fy))
        .group_by(ChartOfAccounts.account_code)
    )
    opening = {code: Decimal(str(v)) for code, v in opening_q.all()}

    entries = (
        db.query(GeneralLedger, ChartOfAccounts.account_code, ChartOfAccounts.account_name)
        .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
        .filter(*acct_filter, branch, GeneralLedger.posting_date >= start, GeneralLedger.posting_date <= end)
        .order_by(ChartOfAccounts.account_code, GeneralLedger.posting_date, GeneralLedger.id)
        .all()
    )
    names = dict(db.query(ChartOfAccounts.account_code, ChartOfAccounts.account_name)
                 .filter(ChartOfAccounts.account_code.in_(list(opening) or [""])).all())

    rows, running, per_account = [], dict(opening), defaultdict(lambda: [Decimal("0"), Decimal("0")])
    seen_accounts: list[str] = []
    for gl, code, name in entries:
        if code not in seen_accounts:
            seen_accounts.append(code)
            rows.append({"date": None, "account_code": code, "account_name": name, "reference": None,
                         "description": "Opening balance", "debit": None, "credit": None,
                         "balance": running.get(code, Decimal("0")), "branch_code": None})
            names[code] = name
        debit, credit = Decimal(str(gl.debit_amount or 0)), Decimal(str(gl.credit_amount or 0))
        running[code] = running.get(code, Decimal("0")) + debit - credit
        per_account[code][0] += debit
        per_account[code][1] += credit
        rows.append({
            "date": gl.posting_date, "account_code": code, "account_name": name,
            "reference": " ".join(x for x in (gl.reference_type, gl.reference_no) if x) or None,
            "description": gl.description, "debit": debit, "credit": credit,
            "balance": running[code], "branch_code": gl.branch_code,
        })

    accounts = []
    for code in sorted(set(opening) | set(per_account)):
        o = opening.get(code, Decimal("0"))
        d, c = per_account[code]
        if o == 0 and d == 0 and c == 0:
            continue
        accounts.append({"account_code": code, "account_name": names.get(code), "opening": o,
                         "debit": d, "credit": c, "closing": o + d - c})

    total_debit = sum((a["debit"] for a in accounts), Decimal("0"))
    total_credit = sum((a["credit"] for a in accounts), Decimal("0"))
    return ReportResult(
        metrics=[metric("Debits", total_debit, "money"), metric("Credits", total_credit, "money"),
                 metric("Net movement", total_debit - total_credit, "money"), metric("Accounts", len(accounts), "int")],
        tables=[
            table("accounts", "Accounts", accounts, [
                Column("account_code", "Account"), Column("account_name", "Name"),
                Column("opening", "Opening", "money"), Column("debit", "Debit", "money", True),
                Column("credit", "Credit", "money", True), Column("closing", "Closing", "money")]),
            table("entries", "Postings", rows, [
                Column("date", "Date", "date"), Column("account_code", "Account"), Column("account_name", "Name"),
                Column("reference", "Reference"), Column("description", "Description"),
                Column("debit", "Debit", "money", True), Column("credit", "Credit", "money", True),
                Column("balance", "Balance", "money"), Column("branch_code", "Branch")]),
        ],
        notes=["Balances are debit minus credit (credit balances are negative). Income and expense accounts open "
               f"with fiscal year {fy}'s postings before the period; other accounts with everything before it."],
    )


register(ReportDef(
    "finance.gl_detail", "General ledger detail", "Finance",
    "Every posting to the chosen accounts for a period, with opening and running balances.",
    Permissions.GENERAL_LEDGER_VIEW, _gl_detail,
    (DATE_FROM, DATE_TO, Param("account_code", "Account", "account", help="Leave empty for all accounts"), BRANCH),
    tags=("gl", "ledger", "account statement", "transactions"),
))
