"""
Regression suite - sale-return money (QA report sales-order-money-2026-10-11:
C4, H3, H5, H9 and the return side of C3).

Convention under test
* a return refunds the NET value of the returned units: price - line discount -
  proportional header discount, plus the tax that belongs to them (exclusive: on
  top; inclusive: the part already in the price);
* the cumulative split makes the sum of all returns equal the invoice exactly;
* the receivable is cancelled first on credit sales (credit limit released);
* a credit-note refund ISSUES a customer credit note and never raises
  invoice.credit_note_amount (= notes redeemed on that invoice);
* the order shows as settled afterwards (balance_due never raised by a return).
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.finance.service import CustomerCreditNoteService
from app.modules.sales import schemas as sales_schemas
from app.modules.sales.models import Invoice, InvoiceItems, SaleReturn
from app.modules.sales.service import sales_service
from tests.integration.test_workflows.test_sales_guardrails import _location

S = "/api/v1/sales"
D = Decimal


@pytest.fixture
def shop(db, make_branch, make_customer, make_product, make_sales_stock):
    branch, product = make_branch(), make_product()
    product.tracking_type = "none"
    lot = make_sales_stock(product=product, branch=branch)
    lot.barcode = None
    lot.quantity = 100
    db.flush()
    customer = make_customer()
    customer.max_credit_limit = 10000
    customer.left_credit_amount = 10000
    db.flush()
    return branch, customer, product, _location(db, branch)


def _order(shop, rep_id, qty, price, **over):
    branch, customer, product, _ = shop
    body = {
        "branch_code": branch.branch_code,
        "customer_id": customer.id,
        "sale_rep_id": rep_id,
        "payment_method": "cash",
        "items": [
            {"product_id": product.id, "quantity": qty, "selling_price": price,
             "minimum_selling_price": 1.0, "warrenty_month": "0",
             **over.pop("item", {})}
        ],
    }
    body.update(over)
    return body


def _place(client, db, shop, rep_id, qty, price, **over):
    r = client.post(S + "/", json=_order(shop, rep_id, qty, price, **over))
    assert r.status_code == 201, r.text
    inv = db.query(Invoice).filter(Invoice.id == r.json()["id"]).one()
    item = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == inv.id).one()
    return inv, item


def _return(db, shop, user, inv, item, qty, method="cash", process=True):
    data = sales_schemas.SaleReturnCreate(
        branch_code=inv.branch_code,
        invoice_id=inv.id,
        good_received_locations_id=shop[3].id,
        payment_method=method,
        items=[sales_schemas.SaleReturnItemCreate(
            barcode="", return_price=float(item.selling_price),
            sold_price=float(item.selling_price), branch_code=inv.branch_code,
            invoice_item_id=item.id, quantity=qty)],
    )
    ret = sales_service.create_sale_return(db, data, user_id=user.id)
    if process:
        ret.status = "approved"
        db.flush()
        sales_service.process_sale_return(db, ret.id, user_id=user.id)
        db.refresh(ret)
        db.refresh(inv)
    return ret


def _je_lines(db, ret):
    from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
    rows = (
        db.query(ChartOfAccounts.account_code, GeneralLedger.debit_amount, GeneralLedger.credit_amount)
        .join(GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id)
        .filter(GeneralLedger.reference_type == "SaleReturn", GeneralLedger.reference_id == ret.id)
        .all()
    )
    if not rows:
        return None
    dr, cr = {}, {}
    for code, d, c in rows:
        if D(str(d)) > 0:
            dr[code] = dr.get(code, D(0)) + D(str(d))
        if D(str(c)) > 0:
            cr[code] = cr.get(code, D(0)) + D(str(c))
    assert sum(dr.values()) == sum(cr.values())  # reversal JE balanced
    return dr, cr


class TestPartialReturnNetValue:
    def test_line_discount_and_exclusive_tax_order_4123(self, db, superclient, superuser, shop):
        user = superuser[0]
        inv, item = _place(superclient, db, shop, user.id, 2, 100.0,
                           item={"discount_percent": 10}, tax_rate=5, cash_amount=189.0)
        assert (inv.subtotal, inv.tax_amount, inv.grand_total) == (D("180.00"), D("9.00"), D("189.00"))

        r1 = _return(db, shop, user, inv, item, 1)
        assert (D(str(r1.subtotal)), D(str(r1.tax_refund)), D(str(r1.total_refund))) == (
            D("90.00"), D("4.50"), D("94.50"))
        lines = _je_lines(db, r1)
        if lines:  # GL accounts are seeded in the dev DB
            dr, cr = lines
            assert dr["4030"] == D("90.00") and dr["2210"] == D("4.50")
            assert cr["1010"] == D("94.50")
        assert D(str(inv.paid_amount)) == D("94.50")
        assert D(str(inv.balance_due)) == D("0")

        r2 = _return(db, shop, user, inv, item, 1)
        assert D(str(r2.total_refund)) == D("94.50")
        assert D(str(r1.total_refund)) + D(str(r2.total_refund)) == D("189.00")
        assert D(str(inv.paid_amount)) == D("0") and D(str(inv.balance_due)) == D("0")
        assert inv.payment_status == "refunded"

        with pytest.raises(HTTPException):  # nothing left to return
            _return(db, shop, user, inv, item, 1, process=False)

    def test_rounding_residue_lands_on_last_return(self, db, superclient, superuser, shop):
        user = superuser[0]
        inv, item = _place(superclient, db, shop, user.id, 3, 33.33, cash_amount=99.99)
        parts = [_return(db, shop, user, inv, item, 1) for _ in range(3)]
        assert sum(D(str(p.total_refund)) for p in parts) == D("99.99")
        assert inv.payment_status == "refunded"


class TestFullReturnFlows:
    def test_tax_inclusive_full_return_refunds_105(self, db, superclient, superuser, shop):
        user = superuser[0]
        inv, item = _place(superclient, db, shop, user.id, 1, 105.0,
                           is_tax_invoice=True, tax_rate=5, cash_amount=105.0)
        assert (inv.subtotal, inv.tax_amount, inv.grand_total) == (D("100.00"), D("5.00"), D("105.00"))
        ret = sales_service.create_full_invoice_return(db, inv.id, "cash", user_id=user.id)
        assert (D(str(ret.subtotal)), D(str(ret.tax_refund)), D(str(ret.total_refund))) == (
            D("100.00"), D("5.00"), D("105.00"))

    def test_header_discount_full_return_refunds_180(self, db, superclient, superuser, shop):
        user = superuser[0]
        inv, item = _place(superclient, db, shop, user.id, 2, 100.0,
                           discount_percent=10, cash_amount=180.0)
        assert D(str(inv.grand_total)) == D("180.00")
        ret = sales_service.create_full_invoice_return(db, inv.id, "cash", user_id=user.id)
        assert D(str(ret.total_refund)) == D("180.00")
        ret.status = "approved"
        db.flush()
        sales_service.process_sale_return(db, ret.id, user_id=user.id)
        db.refresh(inv)
        # H3: settled order, not "customer owes the refunded amount"
        assert D(str(inv.balance_due)) == D("0") and D(str(inv.paid_amount)) == D("0")
        assert inv.payment_status == "refunded"
        assert D(str(inv.credit_note_amount)) == D("0")


class TestCreditNoteRefund:
    def test_credit_note_is_issued_not_redeemed(self, db, superclient, superuser, shop):
        user = superuser[0]
        inv, item = _place(superclient, db, shop, user.id, 2, 100.0, cash_amount=200.0)
        ret = _return(db, shop, user, inv, item, 2, method="credit_note")
        assert D(str(inv.credit_note_amount)) == D("0")  # redeemed-on-invoice untouched
        assert ret.credit_note_id is not None
        bal = CustomerCreditNoteService(db).get_customer_credit_balance(inv.customer_id)
        assert D(str(bal)) == D("200.00")
        lines = _je_lines(db, ret)
        if lines:
            assert lines[1]["2530"] == D("200.00") and "1010" not in lines[1]


class TestCreditOrderReturn:
    def test_return_releases_credit_limit(self, db, superclient, superuser, shop):
        user = superuser[0]
        branch, customer, product, _ = shop
        inv, item = _place(superclient, db, shop, user.id, 2, 100.0, payment_method="credit",
                           cash_amount=0, credit_amount=200.0, override_credit_validation=True)
        r = superclient.post(f"{S}/{inv.id}/approve")
        assert r.status_code == 200, r.text
        db.refresh(inv)
        db.refresh(customer)
        assert D(str(inv.credit_amount)) == D("200.00")
        assert customer.left_credit_amount == 9800

        ret = _return(db, shop, user, inv, item, 1, method="credit_note")
        db.refresh(customer)
        assert D(str(inv.credit_amount)) == D("100.00") and D(str(inv.balance_due)) == D("100.00")
        assert customer.left_credit_amount == 9900
        assert ret.credit_note_id is None  # AR cancelled, nothing paid -> no store credit
        assert D(str(inv.credit_note_amount)) == D("0")

        _return(db, shop, user, inv, item, 1, method="credit_note")
        db.refresh(customer)
        assert D(str(inv.balance_due)) == D("0") and inv.payment_status == "refunded"
        assert customer.left_credit_amount == 10000
        assert D(str(CustomerCreditNoteService(db).get_customer_credit_balance(customer.id))) == D("0")
