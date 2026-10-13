"""Regression tests: reports must agree with the ledger and the documents.

* Income Statement: contra-revenue (4030 Sales Returns) reduces revenue.
* Balance Sheet: assets come from the chart's Asset accounts and the sheet
  balances when the books balance (current earnings included in equity).
* Sales report / statistics: only approved/completed orders, grand_total net of
  returns, branch filter everywhere.
* Customer statement: live credit invoices only, verified settlements only,
  returns netted; current_balance == sum(balance_due).
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from app.modules.customers.credit_service import customer_credit_service
from app.modules.customers.models import (
    CustomerCreditsSettle,
    CustomerCreditsSettleTransaction,
)
from app.modules.finance.accounting_service import GeneralLedgerService
from app.modules.finance.gl_posting_service import GLPostingService
from app.modules.reporting import schemas as rep_schemas
from app.modules.reporting.service import ReportingService
from app.modules.sales.models import Invoice, SaleReturn
from app.modules.sales.service import sales_service

D = Decimal
FY_DATE = date(2091, 6, 15)  # no accounting period / no pre-existing GL


def _uid() -> str:
    return uuid.uuid4().hex[:8]


def _post(db, lines, ref):
    res = GLPostingService(db).post(
        reference_type="QA",
        reference_id=ref,
        lines=[
            {"account_code": c, "debit": D(d), "credit": D(cr), "description": "qa"}
            for c, d, cr in lines
        ],
        entry_date=FY_DATE,
        description="QA reporting",
        branch_code=f"QA{_uid()}",
        user_id=1,
    )
    assert res.posted, res.error_message
    db.flush()


def _post_known_books(db):
    base = int(_uid(), 16) % 900_000
    _post(db, [("1010", "1000", "0"), ("4010", "0", "1000")], base + 1)  # cash sale 1000
    _post(db, [("1110", "500", "0"), ("4020", "0", "500")], base + 2)  # credit sale 500
    _post(db, [("4030", "150", "0"), ("1010", "0", "150")], base + 3)  # return 150
    _post(db, [("1010", "10", "0"), ("4110", "0", "10")], base + 4)  # other income 10
    _post(db, [("5010", "400", "0"), ("1210", "0", "400")], base + 5)  # COGS 400
    _post(db, [("5160", "20", "0"), ("1010", "0", "20")], base + 6)  # expense 20


class TestIncomeStatement:
    def test_contra_revenue_reduces_revenue_and_net_income_matches_ledger(self, db):
        _post_known_books(db)
        svc = GeneralLedgerService(db)
        r = svc.get_income_statement(fiscal_year=2091)

        by_code = {i.account_code: i.amount for i in r.revenue.items}
        assert by_code == {
            "4010": D("1000"),
            "4020": D("500"),
            "4030": D("-150"),
            "4110": D("10"),
        }
        assert r.revenue.total == D("1360")  # 1000 + 500 - 150 + 10
        assert r.cost_of_sales.total == D("400")
        assert r.gross_profit == D("960")
        assert r.operating_expenses.total == D("20")
        assert r.net_income == D("940")

        # Net income == trial-balance movement of the P&L accounts
        tb = svc.get_trial_balance(fiscal_year=2091)
        pl = {a.account_code: a for a in tb.accounts}
        tb_net = sum(
            pl[c].total_credit - pl[c].total_debit for c in ("4010", "4020", "4030", "4110")
        ) - sum(pl[c].total_debit - pl[c].total_credit for c in ("5010", "5160"))
        assert tb_net == r.net_income


class TestBalanceSheet:
    def test_assets_picked_up_and_balanced(self, db):
        svc = GeneralLedgerService(db)
        before = svc.get_balance_sheet(fiscal_year=2091, as_of_date=FY_DATE)
        _post_known_books(db)
        after = svc.get_balance_sheet(fiscal_year=2091, as_of_date=FY_DATE)

        codes = {i.account_code for i in after.current_assets.items}
        assert {"1010", "1020", "1110", "1210"} <= codes
        # 1010: +1000 -150 +10 -20 = 840 ; 1110 +500 ; 1210 -400  => +940
        assert after.total_assets - before.total_assets == D("940")
        assert after.total_liabilities == before.total_liabilities
        assert after.total_equity - before.total_equity == D("940")  # current earnings
        # the new entries add no imbalance
        assert (after.total_assets - after.total_liabilities_and_equity) == (
            before.total_assets - before.total_liabilities_and_equity
        )
        if before.is_balanced:
            assert after.is_balanced is True


def _invoice(
    db, customer, branch, *, status, approval_status, grand, credit="0", balance=None
):
    inv = Invoice(
        invoice_no=f"QA-INV-{_uid()}",
        branch_code=branch.branch_code,
        payment_method="credit" if D(credit) > 0 else "cash",
        created_date=date.today(),
        customer_id=customer.id,
        approval=approval_status in ("approved", "completed"),
        approval_status=approval_status,
        bank_transfer_amount=D("0"),
        card_amex_amount=D("0"),
        card_mastercard_amount=D("0"),
        card_visa_amount=D("0"),
        cash_amount=D(grand) - D(credit),
        cheque_date=date.today(),
        cheque_amount=D("0"),
        payment_adjustments=D("0"),
        credit_amount=D(credit),
        special=False,
        created_date_time=datetime.utcnow(),
        status=status,
        grand_total=D(grand),
        subtotal=D(grand),
        balance_due=D(balance if balance is not None else credit),
    )
    db.add(inv)
    db.flush()
    return inv


def _return(db, invoice, location, branch, method, amount):
    db.add(
        SaleReturn(
            sale_return_no=f"QA-SR-{_uid()}",
            branch_code=branch.branch_code,
            added_date=date.today(),
            good_received_locations_id=location.id,
            invoice_id=invoice.id,
            cheque_date=date.today(),
            payment_method=method,
            status="processed",
            subtotal=D(amount),
            tax_refund=D("0"),
            total_refund=D(amount),
            refund_status="processed",
            refund_amount=D(amount),
        )
    )
    db.flush()


class TestSalesReport:
    def test_counts_only_real_sales_net_of_returns_and_branch_filtered(
        self, db, make_branch, make_customer, make_location
    ):
        br, other = make_branch(), make_branch()
        cust = make_customer()
        loc = make_location(branch=br)
        today = date.today()
        ok1 = _invoice(db, cust, br, status=True, approval_status="completed", grand="100.00")
        ok2 = _invoice(
            db, cust, br, status=True, approval_status="approved", grand="50.00", credit="50.00"
        )
        _invoice(db, cust, br, status=False, approval_status="cancelled", grand="999.00")
        _invoice(db, cust, br, status=True, approval_status="pending_approval", grand="777.00")
        _invoice(
            db, cust, br, status=True, approval_status="pending_bank_verification", grand="555.00"
        )
        _invoice(db, cust, other, status=True, approval_status="completed", grand="333.00")
        _return(db, ok1, loc, br, "cash", "30.00")

        rep = ReportingService(db).get_sales_report(
            rep_schemas.SalesReportRequest(
                start_date=today, end_date=today, branch_code=br.branch_code
            )
        )
        assert rep.total_orders == 2
        assert D(str(rep.total_sales)) == D("120.00")  # 100 + 50 - 30 return
        assert [b["branch_code"] for b in rep.sales_by_branch] == [br.branch_code]
        assert rep.sales_by_date[0]["orders"] == 2

        stats = sales_service.get_sales_statistics(db, [br.branch_code])
        assert stats["total_orders"] == 2
        assert D(str(stats["total_revenue"])) == D("120.00")
        assert stats["pending_approval"] == 1  # cancelled / counted orders excluded
        assert ok2.id in {i["id"] for i in stats["top_invoices"]}


class TestCustomerStatement:
    def test_statement_lists_live_invoices_only_and_matches_balance_due(
        self, db, make_branch, make_customer
    ):
        br = make_branch()
        cust = make_customer()
        today = date.today()
        live = _invoice(
            db, cust, br, status=True, approval_status="approved",
            grand="1200.00", credit="1200.00", balance="1100.00",  # 100 verified
        )
        _invoice(db, cust, br, status=False, approval_status="cancelled", grand="3000.00", credit="3000.00")
        _invoice(db, cust, br, status=True, approval_status="pending_approval", grand="2000.00", credit="2000.00")
        _invoice(db, cust, br, status=True, approval_status="rejected", grand="900.00", credit="900.00")
        settle = CustomerCreditsSettle(
            customer_credits_settle_no=f"QA-CCS-{_uid()}",
            branch_code=br.branch_code,
            created_date=datetime.utcnow(),
            customer_id=cust.id,
        )
        db.add(settle)
        db.flush()
        for amt, st in (
            ("100.00", "completed"),
            ("40.00", "pending_verification"),
            ("30.00", "rejected"),
        ):
            db.add(
                CustomerCreditsSettleTransaction(
                    payment_method="cash",
                    cheque_date=today,
                    payment_amount=D(amt),
                    created_date=datetime.utcnow(),
                    customer_credit_settle_id=settle.id,
                    invoice_id=live.id,
                    status=st,
                )
            )
        db.flush()

        st = customer_credit_service.get_customer_statement(db, cust.id)
        assert st["current_balance"] == 1100.0
        assert [l["type"] for l in st["statement_lines"]] == ["INVOICE", "PAYMENT"]
        assert st["statement_lines"][1]["credit"] == 100.0

    def test_returned_credit_invoice_nets_to_zero(
        self, db, make_branch, make_customer, make_location
    ):
        br = make_branch()
        cust = make_customer()
        loc = make_location(branch=br)
        inv = _invoice(
            db, cust, br, status=True, approval_status="approved",
            grand="200.00", credit="200.00", balance="0.00",
        )
        _return(db, inv, loc, br, "credit_note", "200.00")
        st = customer_credit_service.get_customer_statement(db, cust.id)
        assert st["current_balance"] == 0.0
        assert [l["type"] for l in st["statement_lines"]] == ["INVOICE", "RETURN"]
