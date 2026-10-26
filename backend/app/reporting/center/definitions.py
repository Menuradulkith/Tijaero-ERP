"""The reports in the Report Center.

Each entry wraps an existing report function (sales/finance/inventory summaries, the GL
statements, cashbook, payment and outstanding reports, HR reports, branch summary) and
maps its output to metrics and tables. Add a new report by appending a `register(...)`
call here (or in aging.py / stock.py / ledger.py for those areas); it then appears in the catalogue, the viewer and every export format.
"""

from __future__ import annotations

from app.auth.rbac import Permissions

from .core import (
    Column,
    Param,
    ReportDef,
    ReportResult,
    RunContext,
    metric,
    register,
    table,
    to_plain,
)

DATE_FROM = Param("date_from", "From", "date", required=True, default="month_start")
DATE_TO = Param("date_to", "To", "date", required=True, default="today")
BRANCH = Param("branch_code", "Branch", "branch")
FISCAL_YEAR = Param("fiscal_year", "Fiscal year", "year", required=True, default="current_year")
YEAR = Param("year", "Year", "year", required=True, default="current_year")
CUSTOMER = Param("customer_id", "Customer", "customer")
SUPPLIER = Param("supplier_id", "Supplier", "supplier")


def _reporting(ctx: RunContext):
    from app.modules.reporting.service import ReportingService

    return ReportingService(ctx.db)


def _gl(ctx: RunContext):
    from app.modules.finance.accounting_service import GeneralLedgerService

    return GeneralLedgerService(ctx.db)


# ═══════════════════════════════ Sales ═══════════════════════════════
def _sales_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.reporting.schemas import SalesReportRequest

    r = _reporting(ctx).get_sales_report(SalesReportRequest(
        start_date=p["date_from"], end_date=p["date_to"],
        branch_code=ctx.single_branch(p["branch_code"]), customer_id=p["customer_id"],
    ))
    return ReportResult(
        metrics=[
            metric("Total sales", r.total_sales, "money"),
            metric("Orders", r.total_orders, "int"),
            metric("Customers", r.total_customers, "int"),
            metric("Average order value", r.average_order_value, "money"),
        ],
        tables=[
            table("by_date", "Sales by date", r.sales_by_date, [
                Column("date", "Date", "date"), Column("orders", "Orders", "int", True),
                Column("revenue", "Revenue", "money", True)]),
            table("top_products", "Top products", r.top_products, [
                Column("product_name", "Product"), Column("quantity_sold", "Quantity sold", "number", True),
                Column("revenue", "Revenue", "money", True)]),
            table("by_branch", "Sales by branch", r.sales_by_branch, [
                Column("branch_code", "Branch"), Column("orders", "Orders", "int", True),
                Column("revenue", "Revenue", "money", True)]),
        ],
    )


register(ReportDef(
    "sales.summary", "Sales summary", "Sales",
    "Sales, orders and customers for a period, by date, product and branch.",
    Permissions.REPORTING_SALES_VIEW, _sales_summary, (DATE_FROM, DATE_TO, BRANCH, CUSTOMER),
))


# ═══════════════════════════════ Customers / suppliers ═══════════════════════════════
def _customer_payments(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.customers.credit_service import customer_credit_service

    r = to_plain(customer_credit_service.get_payment_report(
        ctx.db, p["date_from"], p["date_to"], p["customer_id"], ctx.single_branch(p["branch_code"])))
    s = r["summary"]
    return ReportResult(
        metrics=[metric("Total received", s.get("total_amount"), "money"), metric("Payments", s.get("total_count"), "int")],
        tables=[table("payments", "Customer payments", r["items"])],
    )


def _customer_outstanding(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.customers.credit_service import customer_credit_service

    r = to_plain(customer_credit_service.get_outstanding_documents(
        ctx.db, customer_id=p["customer_id"], branch_code=ctx.single_branch(p["branch_code"])))
    s = r["summary"]
    return ReportResult(
        metrics=[
            metric("Outstanding", s.get("total_outstanding"), "money"),
            metric("Overdue", s.get("total_overdue"), "money"),
            metric("Documents", s.get("total_documents"), "int"),
            metric("Overdue documents", s.get("overdue_count"), "int"),
        ],
        tables=[table("documents", "Outstanding invoices", r["items"])],
    )


def _supplier_payments(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.purchasing.credit_service import supplier_credit_service

    r = to_plain(supplier_credit_service.get_payment_report(
        ctx.db, date_from=p["date_from"], date_to=p["date_to"],
        supplier_id=p["supplier_id"], branch_code=ctx.single_branch(p["branch_code"])))
    s = r["summary"]
    return ReportResult(
        metrics=[
            metric("Total paid", s.get("total_amount"), "money"),
            metric("Payments", s.get("total_count"), "int"),
            metric("Pending", s.get("pending_amount"), "money"),
        ],
        tables=[table("payments", "Supplier payments", r["items"])],
    )


def _supplier_outstanding(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.purchasing.credit_service import supplier_credit_service

    r = to_plain(supplier_credit_service.get_outstanding_documents(
        ctx.db, supplier_id=p["supplier_id"], branch_code=ctx.single_branch(p["branch_code"])))
    s = r["summary"]
    return ReportResult(
        metrics=[
            metric("Outstanding", s.get("total_outstanding"), "money"),
            metric("Overdue", s.get("total_overdue"), "money"),
            metric("Documents", s.get("total_documents"), "int"),
            metric("Overdue documents", s.get("overdue_count"), "int"),
        ],
        tables=[table("documents", "Outstanding supplier documents", r["items"])],
    )


register(ReportDef(
    "customers.payments", "Customer payments", "Sales",
    "Payments received from customers against credit invoices.",
    Permissions.CUSTOMER_VIEW, _customer_payments, (DATE_FROM, DATE_TO, CUSTOMER, BRANCH),
))
register(ReportDef(
    "customers.outstanding", "Customer outstanding invoices", "Sales",
    "Unpaid and part-paid credit invoices, with days overdue.",
    Permissions.CUSTOMER_VIEW, _customer_outstanding, (CUSTOMER, BRANCH), tags=("receivables",),
))
register(ReportDef(
    "suppliers.payments", "Supplier payments", "Purchasing",
    "Payments made to suppliers: direct, credit settlements and advances.",
    Permissions.SUPPLIER_PAYMENT_VIEW, _supplier_payments, (DATE_FROM, DATE_TO, SUPPLIER, BRANCH),
))
register(ReportDef(
    "suppliers.outstanding", "Supplier outstanding documents", "Purchasing",
    "Unpaid and part-paid supplier documents, with days overdue.",
    Permissions.SUPPLIER_PAYMENT_VIEW, _supplier_outstanding, (SUPPLIER, BRANCH), tags=("payables",),
))


# ═══════════════════════════════ Finance ═══════════════════════════════
def _finance_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.reporting.schemas import FinanceReportRequest

    r = _reporting(ctx).get_finance_report(FinanceReportRequest(
        start_date=p["date_from"], end_date=p["date_to"], report_type="summary"))
    return ReportResult(
        metrics=[
            metric("Income", r.total_income, "money"),
            metric("Expenses", r.total_expenses, "money"),
            metric("Net profit", r.net_profit, "money"),
            metric("Bank deposits", r.bank_deposits, "money"),
            metric("Card payments", r.card_payments, "money"),
            metric("Cheque payments", r.cheque_payments, "money"),
        ],
        tables=[
            table("expenses", "Expenses by category", r.expenses_by_category, [
                Column("category", "Category"), Column("amount", "Amount", "money", True)]),
            table("monthly", "Monthly income", r.monthly_summary),
        ],
    )


def _statement_rows(sections: list[tuple[str, object]], subtotals: dict[str, tuple[str, object]]) -> list[dict]:
    rows = []
    for name, section in sections:
        for item in section.items:
            rows.append({"section": section.section_name or name, "account_code": item.account_code,
                         "account_name": item.account_name, "amount": item.amount})
        rows.append({"section": section.section_name or name, "account_code": None,
                     "account_name": f"Total {(section.section_name or name).lower()}", "amount": section.total})
        if name in subtotals:
            label, value = subtotals[name]
            rows.append({"section": label, "account_code": None, "account_name": label, "amount": value})
    return rows


_STATEMENT_COLUMNS = [
    Column("section", "Section"), Column("account_code", "Account"),
    Column("account_name", "Name"), Column("amount", "Amount", "money"),
]


def _income_statement(ctx: RunContext, p: dict) -> ReportResult:
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    r = _gl(ctx).get_income_statement(
        fiscal_year=p["fiscal_year"], date_from=p["date_from"], date_to=p["date_to"],
        branch_code=branch_code, branch_codes=branch_codes)
    rows = _statement_rows(
        [("Revenue", r.revenue), ("Cost of sales", r.cost_of_sales), ("Operating expenses", r.operating_expenses),
         ("Other income", r.other_income), ("Other expenses", r.other_expenses)],
        {"Cost of sales": ("Gross profit", r.gross_profit),
         "Operating expenses": ("Operating income", r.operating_income),
         "Other expenses": ("Net income", r.net_income)},
    )
    return ReportResult(
        metrics=[
            metric("Revenue", r.revenue.total, "money"),
            metric("Gross profit", r.gross_profit, "money"),
            metric("Operating income", r.operating_income, "money"),
            metric("Net income", r.net_income, "money"),
        ],
        tables=[table("statement", "Income statement", rows, _STATEMENT_COLUMNS)],
    )


def _balance_sheet(ctx: RunContext, p: dict) -> ReportResult:
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    r = _gl(ctx).get_balance_sheet(
        fiscal_year=p["fiscal_year"], as_of_date=p["as_of_date"],
        branch_code=branch_code, branch_codes=branch_codes)
    rows = _statement_rows(
        [("Current assets", r.current_assets), ("Non-current assets", r.non_current_assets),
         ("Current liabilities", r.current_liabilities), ("Non-current liabilities", r.non_current_liabilities),
         ("Equity", r.equity)],
        {"Non-current assets": ("Total assets", r.total_assets),
         "Non-current liabilities": ("Total liabilities", r.total_liabilities),
         "Equity": ("Total liabilities and equity", r.total_liabilities_and_equity)},
    )
    notes = []
    if r.total_assets != r.total_liabilities_and_equity:
        notes.append(f"Out of balance by {r.total_assets - r.total_liabilities_and_equity:,.2f}.")
    return ReportResult(
        metrics=[
            metric("Total assets", r.total_assets, "money"),
            metric("Total liabilities", r.total_liabilities, "money"),
            metric("Total equity", r.total_equity, "money"),
        ],
        tables=[table("statement", "Balance sheet", rows, _STATEMENT_COLUMNS)],
        notes=notes,
    )


def _trial_balance(ctx: RunContext, p: dict) -> ReportResult:
    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    r = _gl(ctx).get_trial_balance(
        fiscal_year=p["fiscal_year"], as_of_date=p["as_of_date"],
        branch_code=branch_code, branch_codes=branch_codes)
    return ReportResult(
        metrics=[
            metric("Total debit", r.total_debit, "money"),
            metric("Total credit", r.total_credit, "money"),
            metric("Difference", r.total_debit - r.total_credit, "money"),
        ],
        tables=[table("accounts", "Trial balance", r.accounts, [
            Column("account_code", "Account"), Column("account_name", "Name"), Column("account_type", "Type"),
            Column("total_debit", "Debit", "money", True), Column("total_credit", "Credit", "money", True),
            Column("net_balance", "Balance", "money")])],
    )


def _day_end(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance.reconciliation_service import ReconciliationService

    r = ReconciliationService(ctx.db).day_end(p["date"], branch_code=ctx.single_branch(p["branch_code"]))
    checks = [
        ("GL debits", r.gl_total_debit, "money"), ("GL credits", r.gl_total_credit, "money"),
        ("Trial balance balanced", r.trial_balanced, "bool"),
        ("GL cash + bank movement", r.gl_cash_bank_net, "money"), ("Cashbook net", r.cashbook_net, "money"),
        ("Cashbook bank deposits", r.cashbook_bank_deposits, "money"),
        ("Cash reconciled", r.cash_reconciled, "bool"), ("Cash difference", r.cash_difference, "money"),
        ("Pending GL posting failures", r.posting_failures_pending, "int"),
        ("Unposted journal entries", r.unposted_je_count, "int"),
    ]
    return ReportResult(
        metrics=[metric("Books balance", r.is_balanced, "bool"), metric("Cash difference", r.cash_difference, "money")],
        tables=[table("checks", "Checks", [{"check": c, "value": str(v) if t != "bool" else ("Yes" if v else "No")} for c, v, t in checks], [
            Column("check", "Check"), Column("value", "Value")])],
        notes=list(r.discrepancies) + list(r.warnings),
    )


def _cashbook(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.finance import schemas as fs
    from app.modules.finance.service import CashbookService

    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    r = CashbookService(ctx.db).get_cashbook_report(fs.CashbookFilter(
        branch_code=branch_code, branch_codes=branch_codes, date_from=p["date_from"], date_to=p["date_to"]))
    s = r.summary
    return ReportResult(
        metrics=[
            metric("Opening balance", s.opening_balance, "money"),
            metric("Money in", s.total_money_in, "money"),
            metric("Money out", s.total_money_out, "money"),
            metric("Closing balance", s.closing_balance, "money"),
        ],
        tables=[table("entries", "Cashbook entries", r.entries, [
            Column("transaction_date", "Date", "datetime"), Column("entry_type", "Type"),
            Column("reference_no", "Reference"), Column("party_name", "Party"),
            Column("payment_method", "Method"), Column("description", "Description"),
            Column("money_in", "In", "money", True), Column("money_out", "Out", "money", True),
            Column("running_balance", "Balance", "money"), Column("branch_code", "Branch")])],
    )


register(ReportDef(
    "finance.summary", "Finance summary", "Finance",
    "Income, expenses and payments received for a period, company-wide.",
    Permissions.REPORTING_FINANCE_VIEW, _finance_summary, (DATE_FROM, DATE_TO), company_wide=True,
))
register(ReportDef(
    "finance.income_statement", "Income statement", "Finance",
    "Profit and loss from the general ledger.",
    Permissions.REPORTING_FINANCE_VIEW, _income_statement,
    (FISCAL_YEAR, Param("date_from", "From", "date"), Param("date_to", "To", "date"), BRANCH),
    tags=("p&l", "profit"),
))
register(ReportDef(
    "finance.balance_sheet", "Balance sheet", "Finance",
    "Assets, liabilities and equity from the general ledger.",
    Permissions.REPORTING_FINANCE_VIEW, _balance_sheet,
    (FISCAL_YEAR, Param("as_of_date", "As of", "date", default="today"), BRANCH),
))
register(ReportDef(
    "finance.trial_balance", "Trial balance", "Finance",
    "Debit and credit totals per account.",
    Permissions.GENERAL_LEDGER_VIEW, _trial_balance,
    (FISCAL_YEAR, Param("as_of_date", "As of", "date"), BRANCH),
))
register(ReportDef(
    "finance.day_end", "Day-end reconciliation", "Finance",
    "Do the books balance for a day: trial balance, cash against the cashbook, posting health.",
    Permissions.GENERAL_LEDGER_VIEW, _day_end, (Param("date", "Date", "date", required=True, default="today"), BRANCH),
))
register(ReportDef(
    "finance.cashbook", "Cashbook", "Finance",
    "Every cash and bank movement with the running balance.",
    Permissions.CASHBOOK_VIEW, _cashbook, (DATE_FROM, DATE_TO, BRANCH),
))


# ═══════════════════════════════ Inventory / warehouse ═══════════════════════════════
def _inventory_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.reporting.schemas import InventoryReportRequest

    r = _reporting(ctx).get_inventory_report(InventoryReportRequest(low_stock_threshold=p["low_stock_threshold"]))
    return ReportResult(
        metrics=[metric("Products", r.total_products, "int"), metric("Stock value", r.total_stock_value, "money"),
                 metric("Low-stock items", len(r.low_stock_items), "int")],
        tables=[
            table("low_stock", "Low-stock items", r.low_stock_items, [
                Column("item_code", "Item code"), Column("product_name", "Product"),
                Column("available_quantity", "Available", "number"), Column("cost_price", "Cost price", "money")]),
            table("by_category", "Products by category", r.stock_by_category, [
                Column("category_id", "Category ID", "int"), Column("count", "Products", "int", True)]),
        ],
    )


def _warehouse_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.reporting.schemas import WarehouseReportRequest

    r = _reporting(ctx).get_warehouse_report(WarehouseReportRequest(start_date=p["date_from"], end_date=p["date_to"]))
    return ReportResult(metrics=[
        metric("Transfers", r.total_transfers, "int"), metric("Receipts", r.total_receives, "int"),
        metric("Pending approvals", r.pending_approvals, "int")])


register(ReportDef(
    "inventory.summary", "Inventory summary", "Inventory",
    "Product count, stock value and items below a stock threshold.",
    Permissions.REPORTING_INVENTORY_VIEW, _inventory_summary,
    (Param("low_stock_threshold", "Low-stock threshold", "int", required=True, default=10, min=0, max=100000),),
    company_wide=True,
))
register(ReportDef(
    "warehouse.summary", "Warehouse activity", "Warehouse",
    "Transfers, receipts and pending approvals for a period.",
    Permissions.REPORTING_WAREHOUSE_VIEW, _warehouse_summary, (DATE_FROM, DATE_TO), company_wide=True,
))


# ═══════════════════════════════ HR ═══════════════════════════════
def _hr_reports():
    from app.modules.hr_core import reports

    return reports


def _hr_payroll(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.reporting.schemas import HRReportRequest

    r = _reporting(ctx).get_hr_report(HRReportRequest(start_date=p["date_from"], end_date=p["date_to"]))
    return ReportResult(metrics=[
        metric("Employees", r.total_employees, "int"), metric("Payroll", r.total_payroll, "money"),
        metric("Reimbursements", r.total_reimbursements, "money"), metric("Deductions", r.total_deductions, "money")])


def _breakdown(rows) -> list[dict]:
    return [{"group": r.get("label"), "count": r.get("count")} for r in rows]


_BREAKDOWN = [Column("group", "Group"), Column("count", "Employees", "int", True)]


def _headcount(ctx: RunContext, p: dict) -> ReportResult:
    r = _hr_reports().headcount(ctx.db, ctx.allowed_branches)
    return ReportResult(
        metrics=[metric("Headcount", r["total"], "int")],
        tables=[table(k, k.replace("by_", "By ").replace("_", " "), _breakdown(r.get(k) or []), _BREAKDOWN)
                for k in ("by_status", "by_department", "by_designation", "by_employment_type", "by_branch", "by_gender")],
    )


def _upcoming(kind: str):
    def run(ctx: RunContext, p: dict) -> ReportResult:
        rows = getattr(_hr_reports(), kind)(ctx.db, ctx.allowed_branches, p["days"])
        return ReportResult(metrics=[metric("Employees", len(rows), "int")],
                            tables=[table("employees", kind.title(), rows, totals=False)])
    return run


def _expiring(ctx: RunContext, p: dict) -> ReportResult:
    r = _hr_reports().expiring(ctx.db, ctx.allowed_branches, p["days"])
    names = {"contracts": "Contracts ending", "probation": "Probation ending",
             "retirements": "Retirements", "documents": "Documents expiring"}
    return ReportResult(
        metrics=[metric(names[k], len(r.get(k) or []), "int") for k in names],
        tables=[table(k, names[k], r.get(k) or [], totals=False) for k in names],
    )


def _leave_summary(ctx: RunContext, p: dict) -> ReportResult:
    r = _hr_reports().leave_summary(ctx.db, ctx.allowed_branches, p["year"])
    return ReportResult(
        metrics=[metric("On leave today", len(r.get("on_leave_today") or []), "int")],
        tables=[table("by_type", "Leave by type", r.get("by_type") or [], totals=False),
                table("on_leave", "On leave today", r.get("on_leave_today") or [], totals=False)],
    )


def _attrition(ctx: RunContext, p: dict) -> ReportResult:
    r = _hr_reports().attrition(ctx.db, ctx.allowed_branches, p["year"])
    return ReportResult(
        metrics=[
            metric("Opening headcount", r["opening_headcount"], "int"), metric("Joiners", r["joiners"], "int"),
            metric("Leavers", r["leavers"], "int"), metric("Closing headcount", r["closing_headcount"], "int"),
            metric("Attrition rate", r["attrition_rate_percent"], "percent"),
        ],
        tables=[table("by_exit_type", "Leavers by exit type", r.get("by_exit_type") or [], totals=False),
                table("leavers", "Leavers", r.get("leaver_list") or [], totals=False)],
    )


DAYS_30 = Param("days", "Days ahead", "int", required=True, default=30, min=0, max=365)
register(ReportDef(
    "hr.payroll_summary", "Payroll summary", "HR",
    "Employees, payroll, reimbursements and deductions for a period, company-wide.",
    Permissions.REPORTING_HR_VIEW, _hr_payroll, (DATE_FROM, DATE_TO), company_wide=True,
))
register(ReportDef("hr.headcount", "Headcount", "HR", "Employees by status, department, designation, type, branch and gender.",
                   Permissions.HR_REPORTS_VIEW, _headcount))
register(ReportDef("hr.birthdays", "Upcoming birthdays", "HR", "Employee birthdays in the coming days.",
                   Permissions.HR_REPORTS_VIEW, _upcoming("birthdays"), (DAYS_30,)))
register(ReportDef("hr.anniversaries", "Work anniversaries", "HR", "Service anniversaries in the coming days.",
                   Permissions.HR_REPORTS_VIEW, _upcoming("anniversaries"), (DAYS_30,)))
register(ReportDef("hr.expiring", "Expiring contracts and documents", "HR",
                   "Contracts, probations, retirements and documents ending soon.",
                   Permissions.HR_REPORTS_VIEW, _expiring,
                   (Param("days", "Days ahead", "int", required=True, default=60, min=0, max=730),)))
register(ReportDef("hr.leave_summary", "Leave summary", "HR", "Leave taken by type for a year, and who is on leave today.",
                   Permissions.HR_REPORTS_VIEW, _leave_summary, (YEAR,)))
register(ReportDef("hr.attrition", "Attrition", "HR", "Joiners, leavers and attrition rate for a year.",
                   Permissions.HR_REPORTS_VIEW, _attrition, (YEAR,)))


# ═══════════════════════════════ Support / branches ═══════════════════════════════
def _support_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.modules.reporting.schemas import SupportReportRequest

    r = _reporting(ctx).get_support_report(SupportReportRequest(
        start_date=p["date_from"], end_date=p["date_to"], branch_code=ctx.single_branch(p["branch_code"])))
    return ReportResult(
        metrics=[metric("Tickets", r.total_tickets, "int"), metric("Open", r.open_tickets, "int"),
                 metric("Closed", r.closed_tickets, "int"), metric("Warranty claims", r.total_warranty_claims, "int")],
        tables=[table("by_type", "Tickets by job type", r.tickets_by_type, [
            Column("job_type", "Job type"), Column("count", "Tickets", "int", True)])],
    )


def _branch_summary(ctx: RunContext, p: dict) -> ReportResult:
    from app.reporting import branch_summary_reports

    branch_code, branch_codes = ctx.branch_scope(p["branch_code"])
    rows = branch_summary_reports.get_branch_daily_summary(
        ctx.db, p["date_from"], p["date_to"], [branch_code] if branch_code else branch_codes)
    t = table("branches", "Branch summary", rows, exclude=("start_date", "end_date"))
    for c in t.columns:
        c.label = c.label.replace("Sales · ", "Sales ").replace("Cash banking · ", "Cash ")
        c.total = c.type in ("money", "int")
    return ReportResult(
        metrics=[metric("Net sales", sum((r.get("net_sales") or 0) for r in rows), "money"),
                 metric("Branches", len(rows), "int")],
        tables=[t],
    )


register(ReportDef(
    "support.summary", "Support tickets", "Support",
    "Tickets opened, closed and by job type for a period.",
    Permissions.REPORTING_SUPPORT_VIEW, _support_summary, (DATE_FROM, DATE_TO, BRANCH),
))
register(ReportDef(
    "branches.daily_summary", "Branch account summary", "Branches",
    "Sales, returns, purchasing, banking, expenses and vouchers per branch for a period.",
    Permissions.REPORTING_BRANCH_SUMMARY_GENERATE, _branch_summary, (DATE_FROM, DATE_TO, BRANCH),
))
