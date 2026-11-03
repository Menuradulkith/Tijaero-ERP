"""Security fixes (2026-11-03).

- Supplier invoice payment: two allocation lines for the same invoice are added up
  before the balance check, so they cannot overpay it.
- Purchase invoices, petty cash funds and the payroll / payslip prints are scoped to
  the user's branches.
- A bank statement line cannot be booked to a control account or a heading.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.auth.rbac import Permissions
from app.modules.employees.models import EmployeePayroll
from app.modules.finance.accounting_models import ChartOfAccounts
from app.modules.finance.models import PettyCash
from app.modules.purchasing.invoice_models import PurchaseInvoice

TODAY = date.today()


def _u(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


@pytest.fixture
def two_branches(make_branch):
    return make_branch(), make_branch()


def _invoice(db, supplier, branch_code, total="100.00"):
    inv = PurchaseInvoice(
        invoice_no=_u("PI-T"), supplier_invoice_no=_u("SINV"), supplier_invoice_date=TODAY,
        supplier_id=supplier.id, branch_code=branch_code, received_date=TODAY, due_date=TODAY + timedelta(days=30),
        subtotal=Decimal(total), total_amount=Decimal(total), paid_amount=Decimal("0"), balance_due=Decimal(total),
        payment_type="credit", status="unpaid", payment_status="unpaid",
    )
    db.add(inv)
    db.flush()
    return inv


def _pay_body(supplier, branch_code, allocations, amount):
    return {
        "supplier_id": supplier.id, "payment_date": str(TODAY), "payment_method": "Cash",
        "payment_amount": str(amount), "branch_code": branch_code,
        "allocations": [{"purchase_invoice_id": i, "allocated_amount": str(a)} for i, a in allocations],
    }


class TestSupplierInvoicePayment:
    def test_two_allocations_of_the_full_balance_are_refused(self, db, superclient, make_supplier, two_branches):
        a, _b = two_branches
        supplier = make_supplier()
        inv = _invoice(db, supplier, a.branch_code)
        r = superclient.post("/api/v1/purchasing/invoices/pay",
                             json=_pay_body(supplier, a.branch_code, [(inv.id, "100"), (inv.id, "100")], "200"))
        assert r.status_code == 400, r.text
        assert "more than once" in r.json()["detail"]
        db.refresh(inv)
        assert inv.balance_due == Decimal("100.00") and inv.paid_amount == Decimal("0")

    def test_allocation_over_the_balance_is_refused(self, db, superclient, make_supplier, two_branches):
        a, _b = two_branches
        supplier = make_supplier()
        inv = _invoice(db, supplier, a.branch_code)
        r = superclient.post("/api/v1/purchasing/invoices/pay",
                             json=_pay_body(supplier, a.branch_code, [(inv.id, "100.01")], "200"))
        assert r.status_code == 400 and "exceeds balance due" in r.json()["detail"], r.text

    def test_full_balance_in_one_line_still_pays(self, db, superclient, make_supplier, two_branches):
        a, _b = two_branches
        supplier = make_supplier()
        inv = _invoice(db, supplier, a.branch_code)
        r = superclient.post("/api/v1/purchasing/invoices/pay",
                             json=_pay_body(supplier, a.branch_code, [(inv.id, "100")], "100"))
        assert r.status_code == 201, r.text
        db.refresh(inv)
        assert inv.balance_due == Decimal("0.00") and inv.payment_status == "paid"

    def test_empty_allocations_are_refused(self, superclient, make_supplier, two_branches):
        a, _b = two_branches
        supplier = make_supplier()
        r = superclient.post("/api/v1/purchasing/invoices/pay", json=_pay_body(supplier, a.branch_code, [], "10"))
        assert r.status_code == 400


class TestPurchaseInvoiceBranchScope:
    def test_branch_a_user_cannot_see_or_pay_branch_b_invoice(self, db, api, make_user, make_supplier, two_branches):
        a, b = two_branches
        supplier = make_supplier()
        inv_a = _invoice(db, supplier, a.branch_code)
        inv_b = _invoice(db, supplier, b.branch_code)
        _user, tok = make_user(branches=[a], permissions=[
            Permissions.PURCHASE_ORDER_VIEW, Permissions.PURCHASE_ORDER_UPDATE, Permissions.SUPPLIER_PAYMENT_CREATE])
        c = api(tok)

        assert c.get(f"/api/v1/purchasing/invoices/{inv_a.id}").status_code == 200
        assert c.get(f"/api/v1/purchasing/invoices/{inv_b.id}").status_code == 403
        ids = {i["id"] for i in c.get("/api/v1/purchasing/invoices", params={"supplier_id": supplier.id}).json()}
        assert inv_a.id in ids and inv_b.id not in ids
        ids = {i["id"] for i in c.get("/api/v1/purchasing/invoices/outstanding", params={"supplier_id": supplier.id}).json()}
        assert inv_a.id in ids and inv_b.id not in ids
        ids = {i["id"] for i in c.get(f"/api/v1/purchasing/invoices/supplier/{supplier.id}/payable").json()}
        assert inv_a.id in ids and inv_b.id not in ids
        assert c.get("/api/v1/purchasing/invoices", params={"branch_code": b.branch_code}).status_code == 403

        # Paying a branch-B invoice, or booking a payment to branch B, is refused.
        r = c.post("/api/v1/purchasing/invoices/pay", json=_pay_body(supplier, a.branch_code, [(inv_b.id, "10")], "10"))
        assert r.status_code == 403
        r = c.post("/api/v1/purchasing/invoices/pay", json=_pay_body(supplier, b.branch_code, [(inv_a.id, "10")], "10"))
        assert r.status_code == 403
        assert c.post(f"/api/v1/purchasing/invoices/{inv_b.id}/cancel").status_code == 403
        assert c.patch(f"/api/v1/purchasing/invoices/{inv_b.id}", json={"remarks": "x"}).status_code == 403
        db.refresh(inv_b)
        assert inv_b.balance_due == Decimal("100.00") and inv_b.status == "unpaid"


class TestPettyCashBranchScope:
    def test_branch_a_user_cannot_use_branch_b_fund(self, db, api, make_user, two_branches):
        a, b = two_branches
        fund = PettyCash(petty_cash_no=_u("PC-T"), opening_balance=Decimal("500"), current_balance=Decimal("500"),
                         branch_code=b.branch_code, opened_date=TODAY, status="active", created_date=datetime.utcnow())
        db.add(fund)
        db.flush()
        _user, tok = make_user(branches=[a], permissions=[
            Permissions.CASHBOOK_VIEW, Permissions.CASHBOOK_CREATE, Permissions.CASHBOOK_UPDATE])
        c = api(tok)
        base = "/api/v1/finance/petty-cash"
        assert c.get(f"{base}/funds/{fund.id}").status_code == 403
        assert c.get(f"{base}/funds/{fund.id}/details").status_code == 403
        assert c.get(f"{base}/funds/{fund.id}/summary").status_code == 403
        assert c.get(f"{base}/funds/{fund.id}/transactions").status_code == 403
        r = c.post(f"{base}/expenses", json={"petty_cash_id": fund.id, "amount": "10", "expense_type": "Tea"})
        assert r.status_code == 403
        r = c.post(f"{base}/replenishments", json={"petty_cash_id": fund.id, "amount": "10"})
        assert r.status_code == 403
        r = c.post(f"{base}/funds/{fund.id}/reconcile", json={"physical_cash_count": "500"})
        assert r.status_code == 403
        db.refresh(fund)
        assert fund.current_balance == Decimal("500") and fund.status == "active"


class TestBankStatementEntryAccounts:
    def _line(self, superclient):
        A = "/api/v1/finance/accounting"
        bank = superclient.post(f"{A}/bank-accounts", json={
            "name": _u("Test bank"), "bank_name": "BOC", "account_number": "123",
            "reconcile_from": str(TODAY - timedelta(days=10))}).json()
        st = superclient.post(f"{A}/bank-statements", json={
            "bank_account_id": bank["id"], "statement_no": "ST-1",
            "date_from": str(TODAY - timedelta(days=10)), "date_to": str(TODAY),
            "opening_balance": "0", "closing_balance": "-15", "auto_match": False,
            "lines": [{"line_date": str(TODAY), "amount": "-15", "reference": "X", "description": "X"}]})
        assert st.status_code == 201, st.text
        return f"{A}/bank-statement-lines/{st.json()['lines'][0]['id']}/create-entry"

    @pytest.mark.parametrize("category", ["Receivable", "Payable", "Inventory"])
    def test_control_account_is_refused(self, db, superclient, make_account, category):
        acc = make_account()
        acc.account_category = category
        db.flush()
        r = superclient.post(self._line(superclient), json={"account_id": acc.id})
        assert r.status_code == 422 and "control account" in r.json()["detail"], r.text

    def test_heading_account_is_refused(self, db, superclient, make_account):
        parent = make_account()
        child = make_account()
        child.parent_account_id = parent.id
        db.flush()
        r = superclient.post(self._line(superclient), json={"account_id": parent.id})
        assert r.status_code == 422 and "heading" in r.json()["detail"], r.text

    def test_vat_account_is_refused(self, db, superclient):
        from app.modules.finance.tax_service import VatReturnService

        vat_ids = [i for ids in VatReturnService(db)._vat_account_ids().values() for i in ids]
        if not vat_ids:
            pytest.skip("no VAT account in this database")
        r = superclient.post(self._line(superclient), json={"account_id": vat_ids[0]})
        assert r.status_code == 422 and "VAT" in r.json()["detail"], r.text

    def test_ordinary_expense_account_still_posts(self, db, superclient):
        charges = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5184").one()
        r = superclient.post(self._line(superclient), json={"account_id": charges.id})
        assert r.status_code == 200, r.text


class TestPayrollPrintBranchScope:
    def test_branch_a_user_cannot_print_branch_b_payslip(self, db, api, make_user, make_employee, two_branches):
        a, b = two_branches
        emp_a, emp_b = make_employee(), make_employee()
        emp_a.branch_code, emp_b.branch_code = a.branch_code, b.branch_code
        year, month = 2091, 3  # a month no real payroll uses
        rows = []
        for emp in (emp_a, emp_b):
            p = EmployeePayroll(employee_id=emp.employee_id, payroll_year=year, payroll_month=month,
                                basic_salary=Decimal("50000"), gross_salary=Decimal("50000"), net_salary=Decimal("46000"))
            db.add(p)
            rows.append(p)
        db.flush()
        _user, tok = make_user(branches=[a], permissions=[Permissions.PAYROLL_VIEW])
        c = api(tok)
        R = "/api/v1/reporting/documents"
        assert c.get(f"{R}/payslip/{rows[0].id}").status_code == 200
        assert c.get(f"{R}/payslip/{rows[1].id}").status_code == 404
        assert c.get(f"{R}/payslip/{rows[1].id}/pdf").status_code == 404
        r = c.get(f"{R}/payroll", params={"period": f"{year}-{month:02d}"})
        assert r.status_code == 403 and b.branch_code in r.json()["detail"]

    def test_branch_a_user_cannot_print_branch_b_voucher(self, db, api, make_user, two_branches):
        from app.modules.customers.models import CustomerGiftVoucher

        a, b = two_branches
        v = CustomerGiftVoucher(barcode_no=_u("GV"), amount=Decimal("1000"), balance=Decimal("1000"), date=TODAY,
                                valid_period_in_months=12, status="active", branch_code=b.branch_code)
        db.add(v)
        db.flush()
        _user, tok = make_user(branches=[a], permissions=[Permissions.GIFT_VOUCHER_VIEW])
        assert api(tok).get(f"/api/v1/reporting/documents/voucher/{v.id}").status_code == 404
