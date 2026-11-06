"""F26 (2026-11-05 deep UI QA): a customer payment with several method rows is posted as one all-or-nothing
request (POST /sales/settle-payments) instead of one settle-payment call per row."""
from datetime import date
from decimal import Decimal

import pytest

S = "/api/v1/sales"
TODAY = date.today().isoformat()


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(4):
        make_sales_stock(product=p, branch=b)
    c = make_customer()
    c.max_credit_limit = 10000
    return b, c, p


def _credit_order(superclient, superuser, shop, price=100.0):
    b, c, p = shop
    r = superclient.post(S + "/", json={
        "branch_code": b.branch_code, "customer_id": c.id, "sale_rep_id": superuser[0].id,
        "payment_method": "credit", "cash_amount": 0, "override_credit_validation": True,
        "items": [{"product_id": p.id, "quantity": 1, "selling_price": price, "minimum_selling_price": 1.0,
                   "warrenty_month": "12"}]})
    assert r.status_code == 201, r.text
    oid = r.json()["id"]
    assert superclient.post(f"{S}/{oid}/approve").status_code == 200
    return oid


def _state(db, oid):
    from app.modules.customers.models import CustomerCreditsSettleTransaction
    from app.modules.sales.models import Invoice

    db.expire_all()
    inv = db.query(Invoice).get(oid)
    txns = db.query(CustomerCreditsSettleTransaction).filter(CustomerCreditsSettleTransaction.invoice_id == oid).count()
    return Decimal(str(inv.balance_due)), Decimal(str(inv.paid_amount)), txns


def _cash(oid, amount):
    return {"invoice_id": oid, "payment_method": "cash", "payment_amount": amount, "payment_date": TODAY}


def test_split_rows_post_together(db, superclient, superuser, shop):
    oid = _credit_order(superclient, superuser, shop)
    r = superclient.post(f"{S}/settle-payments", json={"payments": [_cash(oid, 60.0), _cash(oid, 30.0)]})
    assert r.status_code == 200, r.text
    results = r.json()["results"]
    assert [x["new_balance"] for x in results] == [40.0, 10.0]
    assert _state(db, oid) == (Decimal("10.00"), Decimal("90.00"), 2)
    db.refresh(shop[1])
    assert shop[1].left_credit_amount == 10000 - 10


def test_a_refused_row_posts_nothing(db, superclient, superuser, shop):
    oid = _credit_order(superclient, superuser, shop)
    r = superclient.post(f"{S}/settle-payments", json={"payments": [_cash(oid, 60.0), _cash(oid, 50.0)]})
    assert r.status_code == 400, r.text
    assert "exceeds available balance" in r.text
    assert _state(db, oid) == (Decimal("100.00"), Decimal("0.00"), 0)


def test_a_refused_row_on_another_invoice_posts_nothing(db, superclient, superuser, shop):
    first = _credit_order(superclient, superuser, shop)
    second = _credit_order(superclient, superuser, shop)
    cheque_without_bank = {"invoice_id": second, "payment_method": "cheque", "payment_amount": 20.0,
                           "payment_date": TODAY, "cheque_number": "123"}
    r = superclient.post(f"{S}/settle-payments", json={"payments": [_cash(first, 50.0), cheque_without_bank]})
    assert r.status_code == 400, r.text
    assert _state(db, first) == (Decimal("100.00"), Decimal("0.00"), 0)
    assert _state(db, second) == (Decimal("100.00"), Decimal("0.00"), 0)


def test_rows_need_an_invoice_id(superclient):
    r = superclient.post(f"{S}/settle-payments", json={"payments": [
        {"payment_method": "cash", "payment_amount": 10.0, "payment_date": TODAY}]})
    assert r.status_code == 422
    assert superclient.post(f"{S}/settle-payments", json={"payments": []}).status_code == 422


def test_single_row_endpoint_unchanged(db, superclient, superuser, shop):
    oid = _credit_order(superclient, superuser, shop)
    r = superclient.post(f"{S}/{oid}/settle-payment", json=_cash(oid, 25.0))
    assert r.status_code == 200, r.text
    assert r.json()["new_balance"] == 75.0
    assert _state(db, oid) == (Decimal("75.00"), Decimal("25.00"), 1)
