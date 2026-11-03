"""Reports agree with the ledger they claim to show (simulated-month findings, 2026-11-03).

1. Payables aging / supplier outstanding documents = calculate_amount_owed = GL 2010:
   verified direct and invoice payments, invoice VAT and landed costs all count.
2. Supplier payments report counts a supplier advance once (when paid).
3. Branch account summary: cash in hand = the branch's GL cash (1010); gross sales =
   the sale value the GL posts, before customer advances / vouchers.
4. VAT summary input tax = the VAT return's (tax ledger), whatever the invoice status.
5. Timestamp date ranges keep the last day (customer payments, bank deposits).
6. Finance summary income / expenses / net profit = the income statement.
7. Payroll summary reads the payroll records of the period's paid batches.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
from app.modules.purchasing.credit_service import supplier_credit_service
from tests.integration.test_workflows.test_grn_receive_cancel import P, _uid, world  # noqa: F401
from tests.money_invariants import Books
from tests.test_finance_vat_2026_10_31 import _invoice, _receive, credit_world  # noqa: F401
from tests.test_sales_return_money_2026_10_12 import _place, shop  # noqa: F401

D = Decimal
TODAY = date.today()
RC = "/api/v1/reporting/center"


def _run(client, key, params):
    r = client.post(f"{RC}/reports/{key}/run", json={"params": params})
    assert r.status_code == 200, r.text
    return r.json()


def _metric(body, label):
    return D(str(next(m["value"] for m in body["metrics"] if m["label"] == label)))


def _ok(r, code=(200, 201)):
    assert r.status_code in code, r.text
    return r.json()


def _gl_balance(db, code, branch_code=None):
    q = db.query(
        GeneralLedger.debit_amount, GeneralLedger.credit_amount
    ).join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id).filter(ChartOfAccounts.account_code == code)
    if branch_code:
        q = q.filter(GeneralLedger.branch_code == branch_code)
    return sum((D(str(d or 0)) - D(str(c or 0)) for d, c in q.all()), D("0"))


# ═══════════════════════════════════ 1-2. payables ═══════════════════════════════════
class TestPayables:
    @pytest.fixture
    def payables(self, db, superclient, credit_world, make_supplier):
        w = credit_world
        sup_id = w["po"].first_suppliers_id
        grn = _receive(superclient, w, qty=10)                       # Cr 2010 100
        inv = _ok(_invoice(superclient, w, grn, tax=18.0))           # Cr 2010 18 (VAT)
        fwd = make_supplier()
        _ok(superclient.post(f"{P}/grn/{grn['id']}/landed-costs", json={  # Cr 2010 7, owed to the forwarder
            "charge_type": "freight", "amount": "7.00", "payment_method": "credit", "supplier_id": fwd.id}))
        branch = w["branch"].branch_code
        # invoice payment 50, verified -> Dr 2010 50 (allocated to the GRN line)
        pay = _ok(superclient.post(f"{P}/invoices/pay", json={
            "supplier_id": sup_id, "payment_date": str(TODAY), "payment_method": "bank_transfer",
            "payment_amount": 50, "branch_code": branch, "reference_number": _uid("TT"),
            "allocations": [{"purchase_invoice_id": inv["id"], "allocated_amount": 50}]}))
        _ok(superclient.post(f"{P}/supplier-payments/{pay['payment_id']}/verify", json={}))
        # direct payment 20 against the GRN, verified -> Dr 2010 20
        sp = _ok(superclient.post(f"{P}/supplier-payments", json={
            "supplier_id": sup_id, "payment_date": str(TODAY), "payment_method": "bank_transfer",
            "payment_amount": "20", "reference_number": _uid("TT"), "bank_name": "BOC", "branch_code": branch,
            "payment_for": "grn", "invoice_reference": grn["good_received_no"]}))
        _ok(superclient.post(f"{P}/supplier-payments/{sp['id']}/verify", json={}))
        # advance 5 paid, then applied to the GRN -> Dr 2010 5
        adv = _ok(superclient.post(f"{P}/supplier-advances", json={
            "supplier_id": sup_id, "payment_date": str(TODAY), "payment_method": "bank_transfer",
            "original_amount": "5", "reference_number": _uid("TT"), "bank_name": "BOC", "branch_code": branch}))
        _ok(superclient.post(f"{P}/supplier-advance-applications", json={
            "advance_id": adv["id"], "grn_id": grn["id"], "applied_amount": "5", "application_date": str(TODAY)}))
        return w, sup_id, fwd.id

    def test_aging_and_outstanding_equal_gl_2010(self, db, superclient, payables):
        _w, sup_id, fwd_id = payables
        dr, cr = Books(db).balances().get("2010", (D("0"), D("0")))
        gl_owed = cr - dr
        assert gl_owed == D("50.00")  # 100 + 18 + 7 - 50 - 20 - 5

        owed = supplier_credit_service.calculate_amount_owed(db, sup_id) + \
            supplier_credit_service.calculate_amount_owed(db, fwd_id)
        assert owed == gl_owed

        outstanding = sum(
            D(str(supplier_credit_service.get_outstanding_documents(db, supplier_id=s)["summary"]["total_outstanding"]))
            for s in (sup_id, fwd_id))
        aging = sum(
            D(str(supplier_credit_service.get_aging_report(db, supplier_id=s)["total"]["amount"])) for s in (sup_id, fwd_id))
        assert outstanding == aging == gl_owed

        docs = supplier_credit_service.get_outstanding_documents(db, supplier_id=sup_id)["items"]
        by_type = {d["document_type"]: D(str(d["balance_due"])) for d in docs}
        # GRN 100 - invoice payment 50 - direct 20 - advance 5; the VAT is its own line
        assert by_type == {"Credit GRN": D("25.00"), "Invoice VAT / discount": D("18.00")}

        rc = _metric(_run(superclient, "suppliers.outstanding", {"supplier_id": sup_id}), "Outstanding")
        assert rc == D("43.00")

    def test_supplier_payments_count_an_advance_once(self, db, superclient, payables):
        _w, sup_id, _fwd = payables
        s = supplier_credit_service.get_payment_report(db, date_from=TODAY, date_to=TODAY, supplier_id=sup_id)["summary"]
        # invoice payment 50 + direct 20 + advance 5 (paid); the application only moves the 5
        assert D(str(s["total_amount"])) == D("75.00")
        assert D(str(s["advance_applications"])) == D("5.00")


# ═══════════════════════════════════ 3. branch account summary ═══════════════════════════════════
class TestBranchSummary:
    def test_cash_in_hand_is_gl_cash_and_gross_includes_the_advance(self, db, superclient, superuser, shop):  # noqa: F811
        branch, customer, _product, _loc = shop
        adv = _ok(superclient.post("/api/v1/finance/advance-payments", json={
            "customer_id": customer.id, "payment_method": "cash", "branch_code": branch.branch_code,
            "payment_amount": "40", "cheque_date": str(TODAY)}))
        inv, _ = _place(superclient, db, shop, superuser[0].id, 1, 100.0, cash_amount=60.0,
                        customer_advance_payments_id=adv["id"], customer_advance_amount=40.0)
        from app.reporting import branch_summary_reports

        row = branch_summary_reports.get_branch_daily_summary(db, TODAY, TODAY, [branch.branch_code])[0]
        # gross = what the GL credits to revenue + tax for the sale (not grand_total, net of the advance)
        gl_sale = -sum((_gl_balance(db, c, branch.branch_code) for c in ("4010", "4020", "2210")), D("0"))
        assert D(str(row["sales"]["total_gross"])) == gl_sale == D(str(inv.subtotal)) + D(str(inv.tax_amount or 0))
        assert D(str(row["sales"]["other"])) == D("40.00")
        assert D(str(row["cash_banking"]["cash_in_hand_eod"])) == _gl_balance(db, "1010", branch.branch_code) == D("100.00")


# ═══════════════════════════════════ 4. VAT summary ═══════════════════════════════════
class TestVatSummary:
    def test_input_tax_matches_the_vat_return(self, db, superclient, credit_world):
        from app.modules.finance.tax_service import VatReturnService

        w = credit_world
        grn = _receive(superclient, w)
        inv = _ok(_invoice(superclient, w, grn, tax=18.0))
        assert inv["status"] == "unpaid"
        b = w["branch"].branch_code
        body = _run(superclient, "finance.vat_summary", {"date_from": str(TODAY), "date_to": str(TODAY), "branch_code": b})
        ret = VatReturnService(db).vat_return(TODAY, TODAY, b)
        assert _metric(body, "Input tax") == ret.input_tax == D("18.00")


# ═══════════════════════════════════ 5. last day of a timestamp range ═══════════════════════════════════
class TestLastDay:
    def test_customer_payment_late_on_the_last_day_is_listed(self, db, superclient, superuser, shop):  # noqa: F811
        from app.modules.customers.credit_service import customer_credit_service
        from app.modules.customers.models import CustomerCreditsSettle, CustomerCreditsSettleTransaction

        branch, customer, _p, _l = shop
        inv, _ = _place(superclient, db, shop, superuser[0].id, 1, 30.0, cash_amount=30.0)
        late = datetime.combine(TODAY, datetime.min.time()) + timedelta(hours=18)
        cs = CustomerCreditsSettle(customer_credits_settle_no=_uid("CS"), branch_code=branch.branch_code,
                                   created_date=late, customer_id=customer.id)
        db.add(cs)
        db.flush()
        db.add(CustomerCreditsSettleTransaction(payment_method="cash", cheque_date=TODAY, payment_amount=12,
                                                created_date=late, customer_credit_settle_id=cs.id, invoice_id=inv.id))
        db.flush()
        r = customer_credit_service.get_payment_report(db, TODAY, TODAY, customer.id)
        assert D(str(r["summary"]["total_amount"])) == D("12.00")

    def test_bank_deposit_on_the_last_day_is_counted(self, db, make_branch):
        from app.modules.finance.models import BankDeposits
        from app.modules.reporting.schemas import FinanceReportRequest
        from app.modules.reporting.service import ReportingService

        req = FinanceReportRequest(start_date=TODAY, end_date=TODAY, report_type="summary")
        before = D(str(ReportingService(db).get_finance_report(req).bank_deposits))
        db.add(BankDeposits(deposits_amount=77, created_date=datetime.combine(TODAY, datetime.min.time()) + timedelta(hours=15),
                            branch_code=make_branch().branch_code, status="confirmed"))
        db.flush()
        after = D(str(ReportingService(db).get_finance_report(req).bank_deposits))
        assert after - before == D("77.00")


# ═══════════════════════════════════ 6. finance summary ═══════════════════════════════════
class TestFinanceSummary:
    def test_net_profit_is_the_income_statement(self, db, superclient):
        from app.modules.finance.accounting_service import GeneralLedgerService

        start = TODAY.replace(day=1)
        body = _run(superclient, "finance.summary", {"date_from": str(start), "date_to": str(TODAY)})
        stmt = GeneralLedgerService(db).get_income_statement(fiscal_year=TODAY.year, date_from=start, date_to=TODAY)
        assert _metric(body, "Net profit") == D(str(stmt.net_income)).quantize(D("0.01"))
        assert _metric(body, "Income") == (D(str(stmt.revenue.total)) + D(str(stmt.other_income.total))).quantize(D("0.01"))
        assert "Receipts" in {m["label"] for m in body["metrics"]}


# ═══════════════════════════════════ 7. payroll summary ═══════════════════════════════════
class TestPayrollSummary:
    def test_reads_the_paid_batches_of_the_range(self, db, make_employee):
        from app.modules.employees.models import EmployeePayroll
        from app.modules.hr.models import PayrollBatch
        from app.modules.reporting.schemas import HRReportRequest
        from app.modules.reporting.service import ReportingService

        emp = make_employee()
        year = 2091  # a period nothing else uses
        for month, status, gross, ded in ((3, "salary_paid", 1000, 120), (3, "draft", 500, 50), (4, "completed", 900, 90)):
            b = PayrollBatch(batch_no=_uid("PB"), payroll_month=month, payroll_year=year, status=status)
            db.add(b)
            db.flush()
            db.add(EmployeePayroll(employee_id=emp.employee_id, payroll_month=month, payroll_year=year,
                                   payroll_batch_no=b.batch_no, basic_salary=gross, gross_salary=gross,
                                   total_deductions=ded, net_salary=gross - ded, status=status))
        db.flush()
        r = ReportingService(db).get_hr_report(HRReportRequest(start_date=date(year, 3, 1), end_date=date(year, 3, 31)))
        assert (D(str(r.total_payroll)), D(str(r.total_deductions))) == (D("1000.00"), D("120.00"))
