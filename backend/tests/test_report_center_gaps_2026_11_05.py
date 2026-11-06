"""Report Center: the reports added on 2026-11-05 and the fixes from that review.

* every report runs with its default parameters;
* the new sales reports agree with the Sales summary;
* reports built on the shared reporting service respect the user's branches;
* supplier payments: the table total equals "Total paid";
* export totals rows never overwrite a total with the "Total" label.
"""

from decimal import Decimal

import pytest

from app.auth.rbac import Permissions as P
from app.reporting.center import REGISTRY
from app.reporting.center.core import Column, Table
from app.reporting.center.exporters import totals_row

API = "/api/v1"
CENTER = f"{API}/reporting/center"
SPAN = {"date_from": "2020-01-01", "date_to": "2026-12-31"}
EXTRA = {"hr.statutory": {"month": 10, "year": 2026}}


def _run(client, key, params):
    return client.post(f"{CENTER}/reports/{key}/run", json={"params": params})


def _metric(body, label):
    return Decimal(str(next(m["value"] for m in body["metrics"] if m["label"] == label)))


NEW_REPORTS = [
    "sales.invoice_register", "sales.by_customer", "sales.returns",
    "purchasing.order_register", "purchasing.grn_register", "purchasing.invoice_register",
    "finance.expenses", "finance.cost_center_pl", "finance.fixed_assets",
    "hr.payroll_summary", "hr.statutory", "hr.loans",
]


def test_new_reports_are_registered():
    assert set(NEW_REPORTS) <= set(REGISTRY)


@pytest.mark.parametrize("key", sorted(REGISTRY))
def test_every_report_runs(superclient, key):
    keys = {p.key for p in REGISTRY[key].params}
    params = {k: v for k, v in SPAN.items() if k in keys}
    params.update(EXTRA.get(key, {}))
    r = _run(superclient, key, params)
    assert r.status_code == 200, r.text
    body = r.json()
    for t in body["tables"]:
        for c in t["columns"]:
            if c["total"]:
                assert c["type"] in ("money", "number", "int"), (key, t["key"], c["key"])


def test_sales_by_customer_and_register_agree_with_summary(superclient):
    summary = _run(superclient, "sales.summary", SPAN).json()
    by_customer = _run(superclient, "sales.by_customer", SPAN).json()
    register = _run(superclient, "sales.invoice_register", SPAN).json()
    assert _metric(by_customer, "Net sales") == _metric(summary, "Total sales")
    assert _metric(register, "Invoices") == _metric(summary, "Orders")


def test_statutory_month_defaults_and_is_bounded(superclient):
    assert _run(superclient, "hr.statutory", {"year": 2026}).status_code == 200  # current month
    assert _run(superclient, "hr.statutory", {"year": 2026, "month": 13}).status_code == 422
    assert _run(superclient, "hr.statutory", {"year": 2026, "month": 0}).status_code == 422


@pytest.mark.parametrize("key,perm", [
    ("finance.summary", P.REPORTING_FINANCE_VIEW),
    ("inventory.summary", P.REPORTING_INVENTORY_VIEW),
    ("warehouse.summary", P.REPORTING_WAREHOUSE_VIEW),
    ("support.summary", P.REPORTING_SUPPORT_VIEW),
    ("sales.invoice_register", P.REPORTING_SALES_VIEW),
    ("finance.expenses", P.EXPENSE_VIEW),
    ("purchasing.order_register", P.PURCHASE_ORDER_VIEW),
])
def test_branch_limited_user_cannot_pick_another_branch(make_user, api, make_branch, key, perm):
    own, other = make_branch(), make_branch()
    _u, token = make_user(permissions=[perm], branches=[own])
    c = api(token)
    params = {k: v for k, v in SPAN.items() if k in {p.key for p in REGISTRY[key].params}}
    assert _run(c, key, params).status_code == 200
    assert _run(c, key, {**params, "branch_code": other.branch_code}).status_code == 403


def test_no_report_ignores_branches_silently():
    """Only reports with no branch data at all may skip the branch parameter."""
    allowed_company_wide = {"manufacturing.bom_cost"}
    assert {k for k, r in REGISTRY.items() if r.company_wide} <= allowed_company_wide


def test_supplier_payments_table_total_matches_total_paid(superclient):
    body = _run(superclient, "suppliers.payments", SPAN).json()
    table = next(t for t in body["tables"] if t["key"] == "payments")
    if table["totals"] and "amount" in table["totals"]:
        assert Decimal(str(table["totals"]["amount"])) == _metric(body, "Total paid")


def test_totals_row_keeps_every_total():
    t = Table("t", "T", [Column("amount", "Amount", "money", True), Column("name", "Name"),
                         Column("qty", "Qty", "int", True)], [], totals={"amount": 5, "qty": 2})
    assert totals_row(t, lambda v, _c: v) == [5, "Total", 2]
    t.columns = [Column("amount", "Amount", "money", True)]
    t.totals = {"amount": 5}
    assert totals_row(t, lambda v, _c: v) == [5]
