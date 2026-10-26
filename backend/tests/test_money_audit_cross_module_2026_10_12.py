"""Cross-module money audit (2026-10-12): every flow that moves money must leave the books
balanced to the cent, and each document must post exactly what it says.

Runs against a database that has the project's real schema (alembic head: cashbook
trigger functions included) and a seeded chart of accounts. Each test is isolated by the
transactional ``db`` fixture, so the whole-ledger invariants are evaluated over the flow
the test just ran.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from tests.integration.test_workflows.test_grn_receive_cancel import (  # noqa: F401  (fixtures + helpers)
    P,
    _body,
    _uid,
    world,
)
from tests.money_invariants import Books, D

S = "/api/v1/sales"
F = "/api/v1/finance"
HR = "/api/v1/hr"


def books(db) -> Books:
    return Books(db)


def money(value) -> Decimal:
    return D(str(value)).quantize(D("0.01"))


# ═══════════════════════════════════════════════ sales ═══════════════════════════════════════════════
@pytest.fixture
def shop(db, make_branch, make_customer, make_product, make_sales_stock):
    branch, product = make_branch(), make_product()
    for _ in range(10):
        make_sales_stock(product=product, branch=branch)
    return branch, make_customer(), product


def _order(shop, rep_id, qty=1, price=100.0, **over):
    branch, customer, product = shop
    body = {
        "branch_code": branch.branch_code, "customer_id": customer.id, "sale_rep_id": rep_id,
        "payment_method": "cash", "cash_amount": price * qty,
        "items": [{"product_id": product.id, "quantity": qty, "selling_price": price,
                   "minimum_selling_price": 1.0, "warrenty_month": "12"}],
    }
    body.update(over)
    return body


class TestSalesLedger:
    def test_cash_sale_posts_revenue_and_cogs_once(self, db, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_order(shop, superuser[0].id, qty=3, price=100.0))
        assert r.status_code == 201, r.text
        inv = r.json()
        je = books(db).entries_for("Invoice", inv["id"])
        assert je["1010"] == (D("300.00"), D("0")), je
        assert je["4010"] == (D("0"), D("300.00")), je
        # COGS = product cost (make_product cost 100) x 3, against inventory
        assert je["5010"][0] == je["1210"][1] and je["5010"][0] > 0, je
        books(db).assert_balanced("cash sale")

    def test_cash_sale_cashbook_matches_gl(self, db, superclient, superuser, shop):
        superclient.post(S + "/", json=_order(shop, superuser[0].id, qty=2, price=50.0))
        b = books(db)
        assert b.cashbook_net() == b.gl_cash_net() == D("100.00"), (b.cashbook_net(), b.gl_cash_net())

    def test_credit_sale_approval_and_part_settlement(self, db, superclient, superuser, shop):
        o = superclient.post(S + "/", json=_order(
            shop, superuser[0].id, qty=5, price=100.0, payment_method="credit", cash_amount=0,
            credit_amount=500.0, override_credit_validation=True))
        assert o.status_code == 201, o.text
        inv = o.json()
        assert inv["approval_status"] == "pending_approval"
        # nothing is revenue until the credit order is approved
        assert books(db).entries_for("Invoice", inv["id"]) == {}

        ap = superclient.post(f"{S}/{inv['id']}/approve")
        assert ap.status_code == 200, ap.text
        je = books(db).entries_for("Invoice", inv["id"])
        assert je.get("1110", (0, 0))[0] == D("500.00") and je.get("4020", (0, 0))[1] == D("500.00"), (je, inv)

        st = superclient.post(f"{S}/{inv['id']}/settle-payment", json={
            "payment_method": "cash", "payment_amount": 200.0, "payment_date": str(date.today())})
        assert st.status_code in (200, 201), st.text
        b = books(db)
        assert b.net("1110") == D("300.00"), b.net("1110")  # debtors = 500 - 200
        b.assert_balanced("credit sale + settlement")
        assert b.cashbook_net() == b.gl_cash_net() == D("200.00"), (b.cashbook_net(), b.gl_cash_net())

    def test_cancelled_pending_order_leaves_no_trace_in_the_ledger(self, db, superclient, superuser, shop):
        o = superclient.post(S + "/", json=_order(
            shop, superuser[0].id, qty=2, price=100.0, payment_method="credit", cash_amount=0,
            credit_amount=200.0, override_credit_validation=True)).json()
        assert superclient.post(f"{S}/{o['id']}/cancel").status_code == 200
        b = books(db)
        assert b.entries_for("Invoice", o["id"]) == {}
        assert b.net("1110") == 0
        b.assert_balanced("cancelled credit order")


# ════════════════════════════════════════════ purchasing ════════════════════════════════════════════
def _all_lines(w, *, serial=3, batch=100, none=50):
    return [
        {"purchasing_order_items_id": w["items"]["serial"].id, "units": [{"barcode": _uid("SN")} for _ in range(serial)]},
        {"purchasing_order_items_id": w["items"]["batch"].id, "quantity": batch, "batch_no": "B-1"},
        {"purchasing_order_items_id": w["items"]["none"].id, "quantity": none},
    ]


class TestPurchasingLedger:
    def test_credit_receipt_posts_inventory_against_trade_creditors(self, db, superclient, world):
        w = world
        w["po"].payment_method = "credit"
        db.flush()
        r = superclient.post(f"{P}/grn/receive", params={"allow_credit_override": True}, json=_body(w, _all_lines(w)))
        assert r.status_code == 201, r.text
        grn = r.json()["grn"]
        je = books(db).entries_for("GRN", grn["id"])
        # (3 + 100 + 50) units x 10.00
        assert je["1210"] == (D("1530.00"), D("0")), je
        assert je["2010"] == (D("0"), D("1530.00")), je
        books(db).assert_balanced("credit GRN")

    def test_cash_receipt_posts_inventory_against_bank(self, db, superclient, world):
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, _all_lines(w)))
        assert r.status_code == 201, r.text
        je = books(db).entries_for("GRN", r.json()["grn"]["id"])
        assert je["1210"][0] == D("1530.00") and sum(c for _, c in je.values()) == D("1530.00"), je
        books(db).assert_balanced("cash GRN")

    def test_grn_cancel_reverses_the_receipt_exactly(self, db, superclient, world):
        w = world
        w["po"].payment_method = "credit"
        db.flush()
        grn_id = superclient.post(f"{P}/grn/receive", params={"allow_credit_override": True},
                                  json=_body(w, _all_lines(w))).json()["grn"]["id"]
        assert superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"}).status_code == 200
        b = books(db)
        assert b.net("1210") == 0 and b.net("2010") == 0, (b.net("1210"), b.net("2010"))
        b.assert_balanced("GRN cancel")

    def test_landed_cost_capitalises_and_reverses(self, db, superclient, world):
        w = world
        grn_id = superclient.post(f"{P}/grn/receive", json=_body(w, _all_lines(w))).json()["grn"]["id"]
        before = books(db).net("1210")
        v = superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={
            "charge_type": "freight", "amount": "300.00", "payment_method": "cash"}).json()
        assert books(db).net("1210") == before + D("300.00")
        assert superclient.post(f"{P}/landed-costs/{v['id']}/cancel", json={"reason": "Charged twice"}).status_code == 200
        b = books(db)
        assert b.net("1210") == before
        b.assert_balanced("landed cost")


class TestSupplierMoney:
    def _credit_grn(self, db, superclient, world):
        w = world
        w["po"].payment_method = "credit"
        db.flush()
        r = superclient.post(f"{P}/grn/receive", params={"allow_credit_override": True}, json=_body(w, _all_lines(w)))
        assert r.status_code == 201, r.text
        return w, r.json()["grn"]

    def test_credit_settlement_pays_down_creditors_and_cashbook(self, db, superclient, world):
        w, grn = self._credit_grn(db, superclient, world)
        r = superclient.post(f"{P}/credit-settlements", json={
            "supplier_credits_settle_no": _uid("CS"), "branch_code": w["branch"].branch_code,
            "suppliers_id": w["po"].first_suppliers_id,
            "transactions": [{"payment_method": "cash", "cheque_date": str(date.today()),
                              "payment_amount": "500.00", "good_received_id": grn["id"]}]})
        assert r.status_code in (200, 201), r.text
        settle = r.json()
        v = superclient.post(f"{P}/credit-settlements/{settle['id']}/verify")
        assert v.status_code == 200, v.text
        b = books(db)
        assert b.net("2010") == D("-1030.00"), b.net("2010")  # owed: 1530 - 500
        b.assert_balanced("supplier credit settlement")
        assert b.cashbook_net() == b.gl_cash_net() == D("-500.00"), (b.cashbook_net(), b.gl_cash_net())

    def test_supplier_advance_and_return(self, db, superclient, world):
        w = world
        r = superclient.post(f"{P}/supplier-advances", json={
            "supplier_id": w["po"].first_suppliers_id, "payment_date": str(date.today()), "payment_method": "cash",
            "original_amount": "300.00", "branch_code": w["branch"].branch_code})
        assert r.status_code in (200, 201), r.text
        adv = r.json()
        b = books(db)
        assert b.net("2020") == D("300.00"), b.net("2020")  # supplier advances = asset, Dr
        assert b.cashbook_net() == b.gl_cash_net() == D("-300.00"), (b.cashbook_net(), b.gl_cash_net())
        b.assert_balanced("supplier advance")

    def test_purchase_return_reverses_inventory_and_creditors(self, db, superclient, world):
        w, grn = self._credit_grn(db, superclient, world)
        # the serial units received on this GRN
        from app.modules.inventory.models import SalesStock
        unit = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"], SalesStock.barcode.isnot(None)).first()
        r = superclient.post(f"{P}/returns", json={
            "branch_code": w["branch"].branch_code, "goodreceivednote_id": grn["id"], "require_approval": False,
            "items": [{"product_id": unit.product_id, "purchasing_price": "10.00", "return_price": "10.00",
                       "barcode": unit.barcode, "sales_stock_id": unit.id}]})
        assert r.status_code in (200, 201), r.text
        b = books(db)
        assert b.net("1210") == D("1520.00"), b.net("1210")  # 1530 received - 10 returned
        assert b.net("2010") == D("-1520.00"), b.net("2010")
        b.assert_balanced("purchase return")


class TestFinanceLedger:
    def test_expense_cycle_posts_once_and_hits_the_cashbook(self, db, superclient, make_branch):
        branch = make_branch()
        e = superclient.post(F + "/expenses", json={
            "expense_category": "Office Supplies", "expenses_method": "cash", "expense_amount": "250.00",
            "branch_code": branch.branch_code, "description": "Paper"})
        assert e.status_code in (200, 201), e.text
        eid = e.json()["id"]
        for step, body in (("submit", None), ("approve", {}), ("process-payment", {"payment_method": "cash"})):
            r = superclient.post(f"{F}/expenses/{eid}/{step}", json=body) if body is not None else superclient.post(f"{F}/expenses/{eid}/{step}")
            assert r.status_code in (200, 201), (step, r.text)
        b = books(db)
        je = b.entries_for("Expense", eid)
        assert sum(dr for dr, _ in je.values()) == D("250.00") and sum(cr for _, cr in je.values()) == D("250.00"), je
        assert b.cashbook_net() == b.gl_cash_net() == D("-250.00"), (b.cashbook_net(), b.gl_cash_net(), je)
        b.assert_balanced("expense")

    def test_bank_deposit_moves_cash_to_bank(self, db, superclient, make_branch):
        branch = make_branch()
        r = superclient.post(F + "/bank-deposits", json={
            "deposits_amount": "800.00", "branch_code": branch.branch_code, "bank_name": "BOC", "payment_for": "cash_deposit"})
        assert r.status_code in (200, 201), r.text
        dep = r.json()
        v = superclient.patch(f"{F}/bank-deposits/{dep['id']}/verify", json={})
        assert v.status_code in (200, 201), v.text
        books(db).assert_balanced("bank deposit")

    def test_manual_journal_entry_post_and_reverse(self, db, superclient, superuser, make_user, api):
        from app.modules.finance.accounting_models import ChartOfAccounts
        cash = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1010").one()
        sales = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "4010").one()
        je = superclient.post(F + "/accounting/journal-entries", json={
            "entry_date": str(date.today()), "description": "Manual audit entry",
            "lines": [{"line_number": 1, "account_id": cash.id, "debit_amount": "123.45", "credit_amount": "0"},
                      {"line_number": 2, "account_id": sales.id, "debit_amount": "0", "credit_amount": "123.45"}]})
        assert je.status_code in (200, 201), je.text
        jid = je.json()["id"]
        # Maker-checker: a second user approves.
        _checker, checker_token = make_user(is_superuser=True)
        for step, token in (("submit", superuser[1]), ("approve", checker_token), ("post", superuser[1])):
            r = api(token).post(f"{F}/accounting/journal-entries/{jid}/{step}", json={})
            assert r.status_code in (200, 201), (step, r.text)
        assert books(db).net("1010") == D("123.45")
        rv = superclient.post(f"{F}/accounting/journal-entries/{jid}/reverse", json={"reason": "audit"})
        assert rv.status_code in (200, 201), rv.text
        b = books(db)
        assert b.net("1010") == 0
        b.assert_balanced("manual JE + reversal")

    def test_unbalanced_manual_entry_is_refused(self, db, superclient):
        from app.modules.finance.accounting_models import ChartOfAccounts
        cash = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1010").one()
        sales = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "4010").one()
        r = superclient.post(F + "/accounting/journal-entries", json={
            "entry_date": str(date.today()), "description": "Unbalanced",
            "lines": [{"line_number": 1, "account_id": cash.id, "debit_amount": "100", "credit_amount": "0"},
                      {"line_number": 2, "account_id": sales.id, "debit_amount": "0", "credit_amount": "99.99"}]})
        if r.status_code in (200, 201):  # created as a draft: it must never be postable
            jid = r.json()["id"]
            for step in ("submit", "approve", "post"):
                rr = superclient.post(f"{F}/accounting/journal-entries/{jid}/{step}", json={})
                if rr.status_code >= 400:
                    break
            else:
                pytest.fail("an unbalanced journal entry was posted")
        books(db).assert_balanced("unbalanced manual entry")


# ═══════════════════════════════════════════════ HR ═══════════════════════════════════════════════
class TestHRLedger:
    def _employee_with_profile(self, db, superclient, make_employee, basic="100000.00", add1="5000.00"):
        emp = make_employee()
        r = superclient.post(f"{HR}/salary-profiles", json={
            "employee_id": emp.employee_id, "basic_salary": basic, "add_1_name": "Transport", "add_1_value": add1})
        assert r.status_code in (200, 201), r.text
        return emp

    def _run(self, superclient):
        today = date.today()
        r = superclient.post(f"{HR}/payroll/run", json={"payroll_month": today.month, "payroll_year": today.year})
        assert r.status_code in (200, 201), r.text
        return r.json()

    def test_payroll_records_add_up_and_the_batch_posts_balanced(self, db, superclient, make_employee):
        self._employee_with_profile(db, superclient, make_employee)
        batch = self._run(superclient)
        from app.modules.employees.models import EmployeePayroll
        recs = db.query(EmployeePayroll).filter(EmployeePayroll.payroll_batch_no == batch["batch_no"]).all()
        assert recs
        for p in recs:
            gross = D(str(p.gross_salary))
            assert gross == D(str(p.basic_salary)) + D(str(p.add_1_value or 0)) + D(str(p.add_2_value or 0)) + D(str(p.add_sales_commision or 0))
            parts = sum(D(str(getattr(p, f) or 0)) for f in (
                "less_epf_employee", "less_etf_employee", "less_stamp_duty", "less_late_deductions",
                "less_salary_advance_repayment", "less_loan_repayment", "less_other_deductions", "less_apit"))
            assert D(str(p.total_deductions)) == parts, (p.employee_id, p.total_deductions, parts)
            assert D(str(p.net_salary)) == gross - parts
            assert D(str(p.total_employer_cost)) == gross + D(str(p.epf_employer)) + D(str(p.etf_employer))
        assert D(str(batch["total_net_salary"])) == sum(D(str(p.net_salary)) for p in recs)
        assert D(str(batch["total_gross_salary"])) == sum(D(str(p.gross_salary)) for p in recs)

    def test_payroll_full_cycle_gl_matches_the_batch(self, db, superclient, make_employee):
        self._employee_with_profile(db, superclient, make_employee)
        batch = self._run(superclient)
        bid = batch["id"]
        for step in ("submit", "approve"):
            r = superclient.post(f"{HR}/payroll/batches/{bid}/{step}", json={})
            assert r.status_code in (200, 201), (step, r.text)
        assert books(db).entries_for("PayrollBatch", bid) == {}  # approval alone posts nothing
        pay = superclient.post(f"{HR}/payroll/batches/{bid}/process-payment", json={"payment_method": "bank_transfer"})
        assert pay.status_code in (200, 201), pay.text
        b = books(db)
        je = b.entries_for("PayrollBatch", bid)
        assert je, ("approving a payroll batch posted nothing to the GL", b.balances(), r.json() if False else None)
        net = D(str(batch["total_net_salary"]))
        assert je.get("2110", (D(0), D(0)))[1] == net, (je, net)  # salaries payable = net pay
        # expense side = gross + employer EPF + employer ETF
        expense = sum(je.get(c, (D(0), D(0)))[0] for c in ("5110", "5150", "5210", "5220"))
        assert expense == D(str(batch["total_employer_cost"])), (expense, batch["total_employer_cost"], je)
        b.assert_balanced("payroll accrual")

        # paying the salaries must clear Salaries Payable and reduce cash/bank by the net pay
        assert b.net("2110") == 0, ("salaries payable not cleared after salary payment", b.net("2110"))
        assert b.gl_cash_net() == -net, ("cash/bank not reduced by net salary", b.gl_cash_net(), net)

        st = superclient.post(f"{HR}/payroll/batches/{bid}/process-statutory", json={})
        assert st.status_code in (200, 201), st.text
        b = books(db)
        assert b.net("2120") == 0 and b.net("2130") == 0, (b.net("2120"), b.net("2130"))
        b.assert_balanced("payroll statutory")

    def test_reimbursement_pay_posts_once(self, db, superclient, make_employee, make_branch):
        emp = make_employee()
        branch = make_branch()
        r = superclient.post(f"{HR}/reimbursements", json={
            "employee_id": emp.employee_id, "branch_code": branch.branch_code, "claim_date": str(date.today()),
            "reimbursement_type": "travel", "items": [{"expense_type": "transport", "amount": "1500.00"}]})
        assert r.status_code in (200, 201), r.text
        rid = r.json()["id"]
        for step, body in (("approve", {}), ("verify", {}), ("pay", {"payment_method": "cash", "paid_amount": "1500.00"})):
            x = superclient.post(f"{HR}/reimbursements/{rid}/{step}", json=body)
            assert x.status_code in (200, 201), (step, x.text)
        b = books(db)
        je = b.entries_for("Reimbursement", rid)
        assert sum(dr for dr, _ in je.values()) == D("1500.00") == sum(cr for _, cr in je.values()), je
        # NOTE: known gap (audit finding) - no cashbook trigger exists for reimbursement/payroll/commission cash-outs,
        # so only the GL is asserted here.
        assert b.gl_cash_net() == D("-1500.00"), b.gl_cash_net()
        b.assert_balanced("reimbursement")
