"""Payment terms, customer write-offs and the cheque register (2026-10-31, blueprint phase C).

1. A credit sale stores its due date from the customer's credit days; changing
   them later doesn't move it.
2. A write-off lowers the balance like a payment, posts Dr 5185 / Cr 1110, frees
   credit, drops out of aging; limits per group; reversal reopens it.
3. Cheques: a sale cheque is received until its deposit is confirmed; a bounce
   puts the debt back on the customer (GL + invoice + credit); a bounced
   settlement cheque reopens the settled balance.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.modules.customers.credit_service import customer_credit_service
from app.modules.finance.models import ChequePayments
from app.modules.sales.models import Invoice
from tests.money_invariants import Books
from tests.test_sales_money_audit_fixes_2026_10_12 import _body, shop  # noqa: F401

S = "/api/v1/sales"
A = "/api/v1/finance/accounting"
D = Decimal
TODAY = date.today()


def _credit_order(client, rep_id, shop, amount=200.0):  # noqa: F811
    shop[1].max_credit_limit = 100000
    r = client.post(S + "/", json=_body(shop, rep_id, price=amount, payment_method="credit", cash_amount=0,
                                        override_credit_validation=True))
    assert r.status_code == 201, r.text
    oid = r.json()["id"]
    assert client.post(f"{S}/{oid}/approve").status_code == 200
    return oid


def _outstanding(db, customer):
    return customer_credit_service._calculate_outstanding_credit(db, customer.id)


# ═══════════════════════════════════ 1. payment terms ═══════════════════════════════════
class TestDueDates:
    def test_due_date_comes_from_credit_days_and_is_kept(self, db, superclient, superuser, shop):  # noqa: F811
        shop[1].credit_days = 12
        db.flush()
        oid = _credit_order(superclient, superuser[0].id, shop)
        inv = db.query(Invoice).filter(Invoice.id == oid).one()
        assert inv.due_date == TODAY + timedelta(days=12)
        shop[1].credit_days = 45  # a later change of terms does not re-age issued invoices
        db.flush()
        db.refresh(inv)
        assert inv.due_date == TODAY + timedelta(days=12)


# ═══════════════════════════════════ 2. write-offs ═══════════════════════════════════
class TestWriteOffs:
    def test_write_off_and_reverse(self, db, superclient, superuser, shop):  # noqa: F811
        cust = shop[1]
        oid = _credit_order(superclient, superuser[0].id, shop, 200.0)
        pay = {"payment_method": "cash", "payment_amount": 195.0, "payment_date": TODAY.isoformat()}
        assert superclient.post(f"{S}/{oid}/settle-payment", json=pay).status_code == 200
        assert _outstanding(db, cust) == D("5.00")

        r = superclient.post(f"{A}/write-offs", json={"invoice_id": oid, "amount": 5, "reason": "small_balance"})
        assert r.status_code == 201, r.text
        wo = r.json()
        inv = db.query(Invoice).filter(Invoice.id == oid).one()
        db.refresh(inv)
        assert D(str(inv.balance_due)) == 0 and inv.payment_status == "paid" and inv.approval_status == "completed"
        assert _outstanding(db, cust) == 0
        je = Books(db).entries_for("CustomerWriteOff", wo["id"])
        assert je["5185"] == (D("5.00"), D("0")) and je["1110"] == (D("0"), D("5.00"))
        aging = customer_credit_service.get_aging_report(db, customer_id=cust.id)
        assert aging["total"]["amount"] == 0

        r = superclient.post(f"{A}/write-offs/{wo['id']}/reverse", json={"reason": "customer will pay after all"})
        assert r.status_code == 200 and r.json()["status"] == "reversed"
        db.refresh(inv)
        assert D(str(inv.balance_due)) == D("5.00") and inv.approval_status == "approved"
        assert _outstanding(db, cust) == D("5.00")
        assert customer_credit_service.get_aging_report(db, customer_id=cust.id)["total"]["amount"] == 5.0

    def test_cannot_write_off_more_than_is_open(self, superclient, superuser, shop):  # noqa: F811
        oid = _credit_order(superclient, superuser[0].id, shop, 100.0)
        r = superclient.post(f"{A}/write-offs", json={"invoice_id": oid, "amount": 101, "reason": "bad_debt"})
        assert r.status_code == 422

    def test_group_limit_applies_to_non_superusers(self, db):
        from app.auth.models import Group, User
        from app.modules.finance.accounting_models import WriteOffLimit
        from app.modules.finance.write_off_service import WriteOffService

        g = Group(name=f"wo-test-{TODAY.isoformat()}-{id(db)}")
        db.add(g)
        db.flush()
        db.add(WriteOffLimit(group_id=g.id, max_amount=50))
        db.flush()
        u = User(is_superuser=False, username="x", first_name="x", last_name="x", hashed_password="x")
        u.groups = [g]
        assert WriteOffService(db).user_limit(u) == D("50.00")
        u.groups = []
        assert WriteOffService(db).user_limit(u) == D("0.00")
        u.is_superuser = True
        assert WriteOffService(db).user_limit(u) is None

    def test_reasons_and_my_limit(self, superclient):
        s = superclient.get(f"{A}/write-offs/setup").json()
        assert {r["value"] for r in s["reasons"]} >= {"bad_debt", "small_balance"} and s["my_limit"] is None


# ═══════════════════════════════════ 3. cheques ═══════════════════════════════════
def _cheque_sale(client, db, rep_id, shop, amount=150.0):  # noqa: F811
    r = client.post(S + "/", json=_body(shop, rep_id, price=amount, payment_method="cheque", cash_amount=0,
                                        cheque_amount=amount, cheque_number=f"CHQ{id(shop) % 100000}",
                                        cheque_bank="BOC", cheque_date=TODAY.isoformat()))
    assert r.status_code == 201, r.text
    inv = db.query(Invoice).filter(Invoice.id == r.json()["id"]).one()
    chq = db.query(ChequePayments).filter(ChequePayments.invoice_no == inv.invoice_no).one()
    return inv, chq


class TestCheques:
    def test_sale_cheque_lifecycle_deposit_then_clear(self, db, superclient, superuser, shop):  # noqa: F811
        inv, chq = _cheque_sale(superclient, db, superuser[0].id, shop)
        assert chq.status == "received" and chq.bank_deposit_id
        assert superclient.post(f"{A}/cheques/{chq.id}/clear", json={}).status_code == 422  # not deposited yet
        r = superclient.patch(f"/api/v1/finance/bank-deposits/{chq.bank_deposit_id}/verify")
        assert r.status_code == 200, r.text
        db.refresh(chq)
        assert chq.status == "deposited"
        r = superclient.post(f"{A}/cheques/{chq.id}/clear", json={})
        assert r.status_code == 200 and r.json()["status"] == "cleared"

    def test_bounced_sale_cheque_before_deposit(self, db, superclient, superuser, shop):  # noqa: F811
        cust = shop[1]
        cust.max_credit_limit = 100000
        db.flush()
        before = _outstanding(db, cust)
        inv, chq = _cheque_sale(superclient, db, superuser[0].id, shop, 150.0)
        r = superclient.post(f"{A}/cheques/{chq.id}/bounce", json={"reason": "insufficient funds"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "bounced"
        db.refresh(inv)
        assert D(str(inv.balance_due)) == D("150.00") and D(str(inv.credit_amount)) >= D("150.00")
        assert _outstanding(db, cust) - before == D("150.00")
        je = Books(db).entries_for("ChequeBounce", chq.id)
        assert je["1110"] == (D("150.00"), D("0")) and je["1040"] == (D("0"), D("150.00"))
        from app.modules.finance.models import BankDeposits
        dep = db.query(BankDeposits).filter(BankDeposits.id == chq.bank_deposit_id).one()
        assert dep.status == "rejected"  # the cheque will never be deposited now
        # the customer can now pay it like any credit invoice
        pay = {"payment_method": "cash", "payment_amount": 150.0, "payment_date": TODAY.isoformat()}
        assert superclient.post(f"{S}/{inv.id}/settle-payment", json=pay).status_code == 200
        assert superclient.post(f"{A}/cheques/{chq.id}/bounce", json={"reason": "again"}).status_code == 422

    def test_bounced_settlement_cheque_reopens_the_balance(self, db, superclient, superuser, shop):  # noqa: F811
        cust = shop[1]
        oid = _credit_order(superclient, superuser[0].id, shop, 300.0)
        pay = {"payment_method": "cheque", "payment_amount": 300.0, "payment_date": TODAY.isoformat(),
               "cheque_number": "SET-77", "cheque_bank": "HNB", "cheque_date": TODAY.isoformat()}
        assert superclient.post(f"{S}/{oid}/settle-payment", json=pay).status_code == 200, "settle"
        inv = db.query(Invoice).filter(Invoice.id == oid).one()
        chq = db.query(ChequePayments).filter(ChequePayments.invoice_no == inv.invoice_no,
                                              ChequePayments.payment_for == "Credit Settlement").one()
        assert chq.status == "deposited" and chq.settlement_transaction_id
        assert _outstanding(db, cust) == 0
        r = superclient.post(f"{A}/cheques/{chq.id}/bounce", json={"reason": "account closed"})
        assert r.status_code == 200, r.text
        db.refresh(inv)
        assert D(str(inv.balance_due)) == D("300.00") and inv.approval_status == "approved"
        assert _outstanding(db, cust) == D("300.00")
        assert customer_credit_service.get_aging_report(db, customer_id=cust.id)["total"]["amount"] == 300.0
        je = Books(db).entries_for("ChequeBounce", chq.id)
        assert je["1110"] == (D("300.00"), D("0")) and je["1020"] == (D("0"), D("300.00"))
