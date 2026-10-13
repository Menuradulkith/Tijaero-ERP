"""Regression tests for the 2026-10-11 sales money audit: C2 (credit-note redemption), H4 (outstanding credit vs
settlements), H8 (customer advance applied to an order), H10 (bank deposit of a rejected / cancelled order)."""
from datetime import date
from decimal import Decimal

import pytest

S = "/api/v1/sales"
FIN = "/api/v1/finance"


@pytest.fixture
def shop(make_branch, make_customer, make_product, make_sales_stock):
    b = make_branch()
    p = make_product()
    for _ in range(6):
        make_sales_stock(product=p, branch=b)
    return b, make_customer(), p


def _body(shop, rep_id, qty=1, price=100.0, customer=None, **over):
    b, c, p = shop
    body = {"branch_code": b.branch_code, "customer_id": (customer or c).id, "sale_rep_id": rep_id,
            "payment_method": "cash", "cash_amount": price * qty,
            "items": [{"product_id": p.id, "quantity": qty, "selling_price": price, "minimum_selling_price": 1.0,
                       "warrenty_month": "12"}]}
    body.update(over)
    return body


def _je_lines(db, invoice_id, reference_type="Invoice"):
    from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntry, JournalEntryLine

    marker = {"Invoice": "Auto GL - Sale Revenue%Invoice ID: " + str(invoice_id),
              "CustomerAdvanceApplication": "%CustomerAdvanceApplication InvID: " + str(invoice_id) + " AdvID:%",
              "CustomerAdvanceApplicationReversal": "%CustomerAdvanceApplicationReversal InvID: " + str(invoice_id) + " AdvID:%"}[reference_type]
    rows = (db.query(JournalEntry, JournalEntryLine, ChartOfAccounts.account_code)
            .join(JournalEntryLine, JournalEntryLine.journal_entry_id == JournalEntry.id)
            .join(ChartOfAccounts, ChartOfAccounts.id == JournalEntryLine.account_id)
            .filter(JournalEntry.description.like(marker)).all())
    out = [(code, Decimal(str(l.debit_amount or 0)), Decimal(str(l.credit_amount or 0))) for _, l, code in rows]
    return out


def _balanced(lines):
    return sum(d for _, d, _ in lines) == sum(c for _, _, c in lines)


def _make_advance(db, customer, branch, amount, **over):
    from app.modules.customers.models import CustomerAdvancePayments

    adv = CustomerAdvancePayments(
        advance_payments_no=f"ADV-T-{abs(hash((customer.id, amount, over.get('n', 0), date.today()))) % 10**9}-{id(over)}",
        payment_method="cash", branch_code=branch.branch_code, payment_amount=Decimal(str(amount)),
        applied_amount=Decimal("0"), remaining_amount=Decimal(str(amount)), is_fully_applied=False,
        created_date=date.today(), customer_id=customer.id, cheque_date=date.today(), active=True)
    db.add(adv)
    db.flush()
    return adv


def _make_note(db, customer, amount):
    from datetime import datetime
    from app.modules.customers.models import CustomerCreditNotes

    n = CustomerCreditNotes(customer_id=customer.id, date=datetime.utcnow(), amount=Decimal(str(amount)), remark="QA note")
    db.add(n)
    db.flush()
    return n


# ---------------------------------------------------------------- C2
class TestCreditNoteRedemption:
    def test_redeem_exact_remaining_then_refused(self, db, superclient, superuser, shop):
        _make_note(db, shop[1], 100)
        r1 = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=60, credit_note_amount=40))
        assert r1.status_code == 201, r1.text
        assert r1.json()["credit_note_amount"] == 40.0
        r2 = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=40, credit_note_amount=60))
        assert r2.status_code == 201, r2.text
        r3 = superclient.post(S + "/", json=_body(shop, superuser[0].id, cash_amount=99, credit_note_amount=1))
        assert r3.status_code == 400 and "Insufficient credit balance" in r3.text

    def test_credit_note_redemption_takes_the_row_lock(self, db, shop, monkeypatch):
        """The balance check must run under SELECT ... FOR UPDATE on the customer's credit notes."""
        from app.modules.finance.service import CustomerCreditNoteService

        _make_note(db, shop[1], 40)
        seen = []
        orig = CustomerCreditNoteService.get_customer_credit_balance

        def spy(self, customer_id, lock=False):
            seen.append(lock)
            return orig(self, customer_id, lock=lock)

        monkeypatch.setattr(CustomerCreditNoteService, "get_customer_credit_balance", spy)
        from app.modules.sales import schemas, service as svc
        payload = schemas.InvoiceCreate(**_body(shop, 1, cash_amount=60, credit_note_amount=40))
        from app.auth.models import User
        uid = db.query(User.id).filter(User.is_superuser == True).first()[0]  # noqa: E712
        payload.sale_rep_id = uid
        svc.sales_service.create_invoice(db, payload, user_id=uid)
        assert seen and all(seen)


# ---------------------------------------------------------------- H4
class TestOutstandingCredit:
    def _credit_order(self, superclient, superuser, shop, amount=200.0):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=amount, payment_method="credit", cash_amount=0,
                                                 override_credit_validation=True))
        assert r.status_code == 201, r.text
        oid = r.json()["id"]
        assert superclient.post(f"{S}/{oid}/approve").status_code == 200
        return oid

    def _outstanding(self, db, customer):
        from app.modules.customers.credit_service import customer_credit_service
        return customer_credit_service._calculate_outstanding_credit(db, customer.id)

    def test_pending_and_rejected_bank_settlement_never_free_credit(self, db, superclient, superuser, shop):
        c = shop[1]
        c.max_credit_limit = 10000
        oid = self._credit_order(superclient, superuser, shop, 200.0)
        assert self._outstanding(db, c) == Decimal("200.00")

        pay = {"payment_method": "cash", "payment_amount": 70.0, "payment_date": date.today().isoformat()}
        assert superclient.post(f"{S}/{oid}/settle-payment", json=pay).status_code == 200
        assert self._outstanding(db, c) == Decimal("130.00")

        # pending bank transfer of 30: nothing is received yet
        bt = {"payment_method": "bank_transfer", "payment_amount": 30.0, "payment_date": date.today().isoformat(),
              "bank_name": "QA Bank", "bank_transfer_ref": "QA-REF-1"}
        r = superclient.post(f"{S}/{oid}/settle-payment", json=bt)
        assert r.status_code == 200, r.text
        assert self._outstanding(db, c) == Decimal("130.00")

        from app.modules.customers.models import CustomerCreditsSettleTransaction
        txn = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.invoice_id == oid,
            CustomerCreditsSettleTransaction.status == "pending_verification").one()
        rej = superclient.post(f"{S}/credit-settlement/{txn.id}/bank-transfer/reject", json={"reason": "no funds"})
        assert rej.status_code == 200, rej.text
        db.refresh(c)
        assert self._outstanding(db, c) == Decimal("130.00")
        assert c.left_credit_amount == 10000 - 130

        # a second transfer that IS verified reduces it
        r = superclient.post(f"{S}/{oid}/settle-payment", json={**bt, "bank_transfer_ref": "QA-REF-2"})
        assert r.status_code == 200, r.text
        txn2 = db.query(CustomerCreditsSettleTransaction).filter(
            CustomerCreditsSettleTransaction.invoice_id == oid,
            CustomerCreditsSettleTransaction.status == "pending_verification").one()
        assert self._outstanding(db, c) == Decimal("130.00")
        assert superclient.post(f"{S}/credit-settlement/{txn2.id}/bank-transfer/verify").status_code == 200
        db.refresh(c)
        assert self._outstanding(db, c) == Decimal("100.00")
        assert c.left_credit_amount == 10000 - 100
        # single source of truth: invoice balance_due
        from app.modules.sales.models import Invoice
        assert Decimal(str(db.query(Invoice).get(oid).balance_due)) == Decimal("100.00")

    def test_cancelled_credit_order_is_not_outstanding(self, db, superclient, superuser, shop):
        c = shop[1]
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=300.0, payment_method="credit", cash_amount=0,
                                                 override_credit_validation=True))
        assert r.status_code == 201, r.text
        assert self._outstanding(db, c) == Decimal("300.00")
        assert superclient.post(f"{S}/{r.json()['id']}/cancel").status_code == 200
        assert self._outstanding(db, c) == Decimal("0")


# ---------------------------------------------------------------- H8
class TestCustomerAdvance:
    def test_advance_reduces_order_and_is_consumed(self, db, superclient, superuser, shop):
        b, c, p = shop
        adv = _make_advance(db, c, b, 150)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=200.0, cash_amount=50,
                                                 customer_advance_payments_id=adv.id))
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["grand_total"] == 50.0 and d["paid_amount"] == 50.0 and d["balance_due"] == 0
        assert d["customer_advance_payments_id"] == adv.id
        db.refresh(adv)
        assert adv.applied_amount == Decimal("150.00") and adv.remaining_amount == Decimal("0.00") and adv.is_fully_applied
        sale = _je_lines(db, d["id"])
        assert _balanced(sale)
        assert sum(c_ for code, _, c_ in sale if code == "4010") == Decimal("200.00")  # revenue is the full 200
        appl = _je_lines(db, d["id"], "CustomerAdvanceApplication")
        assert _balanced(appl) and sum(dr for code, dr, _ in appl if code == "2520") == Decimal("150.00")
        # net effect across both entries: Dr cash 50 + Dr 2520 150 = Cr revenue 200 (1110 nets to zero)
        net_1110 = sum(dr - cr for code, dr, cr in sale + appl if code == "1110")
        assert net_1110 == Decimal("0")

    def test_partial_advance_amount_and_remaining_kept(self, db, superclient, superuser, shop):
        b, c, p = shop
        adv = _make_advance(db, c, b, 150)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=100.0, cash_amount=60,
                                                 customer_advance_payments_id=adv.id, customer_advance_amount=40))
        assert r.status_code == 201, r.text
        assert r.json()["grand_total"] == 60.0
        db.refresh(adv)
        assert adv.applied_amount == Decimal("40.00") and adv.remaining_amount == Decimal("110.00") and not adv.is_fully_applied

    def test_advance_capped_at_order_total(self, db, superclient, superuser, shop):
        b, c, p = shop
        adv = _make_advance(db, c, b, 500)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=100.0, cash_amount=0,
                                                 customer_advance_payments_id=adv.id))
        assert r.status_code == 201, r.text
        assert r.json()["grand_total"] == 0.0
        db.refresh(adv)
        assert adv.applied_amount == Decimal("100.00") and adv.remaining_amount == Decimal("400.00")

    def test_invalid_advances_are_refused(self, db, superclient, superuser, shop, make_customer):
        b, c, p = shop
        other = make_customer()
        foreign = _make_advance(db, other, b, 100)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, customer_advance_payments_id=foreign.id))
        assert r.status_code == 400 and "different customer" in r.text
        mine = _make_advance(db, c, b, 50)
        assert superclient.post(S + "/", json=_body(shop, superuser[0].id, price=100.0, cash_amount=50,
                                                    customer_advance_payments_id=mine.id,
                                                    customer_advance_amount=60)).status_code == 400  # > remaining
        assert superclient.post(S + "/", json=_body(shop, superuser[0].id, price=40.0, cash_amount=0,
                                                    customer_advance_payments_id=mine.id,
                                                    customer_advance_amount=50)).status_code == 400  # > order total
        assert superclient.post(S + "/", json=_body(shop, superuser[0].id, customer_advance_payments_id=2 ** 40)).status_code == 422
        assert superclient.post(S + "/", json=_body(shop, superuser[0].id, customer_advance_payments_id=999999999)).status_code == 400
        mine.applied_amount, mine.remaining_amount, mine.is_fully_applied = Decimal("50"), Decimal("0"), True
        db.flush()
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, customer_advance_payments_id=mine.id))
        assert r.status_code == 400 and "no balance" in r.text
        db.refresh(mine)
        assert mine.applied_amount == Decimal("50")

    def test_cancel_releases_the_advance(self, db, superclient, superuser, shop):
        b, c, p = shop
        adv = _make_advance(db, c, b, 150)
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=200.0, payment_method="credit", cash_amount=0,
                                                 override_credit_validation=True, customer_advance_payments_id=adv.id))
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["grand_total"] == 50.0 and d["credit_amount"] == 50.0
        db.refresh(adv)
        assert adv.remaining_amount == Decimal("0.00")
        assert superclient.post(f"{S}/{d['id']}/cancel").status_code == 200
        db.refresh(adv)
        assert adv.applied_amount == Decimal("0.00") and adv.remaining_amount == Decimal("150.00") and not adv.is_fully_applied
        total = _je_lines(db, d["id"], "CustomerAdvanceApplication") + _je_lines(db, d["id"], "CustomerAdvanceApplicationReversal")
        assert _balanced(total)
        assert sum(dr - cr for code, dr, cr in total if code == "2520") == Decimal("0")  # liability restored


# ---------------------------------------------------------------- H10
class TestBankDepositOfDeadOrder:
    def _bank_order(self, superclient, superuser, shop):
        r = superclient.post(S + "/", json=_body(shop, superuser[0].id, price=185.0, payment_method="bank_transfer", cash_amount=0,
                                                 bank_transfer_amount=185.0, bank_name="QA Bank", bank_transfer_ref="QA-R"))
        assert r.status_code == 201, r.text
        return r.json()

    def _deposit(self, db, order):
        from app.modules.finance.models import BankDeposits
        return db.query(BankDeposits).filter(BankDeposits.invoice_no == order["invoice_no"]).one()

    def test_reject_voids_deposit_and_verify_is_refused(self, db, superclient, superuser, shop):
        o = self._bank_order(superclient, superuser, shop)
        dep = self._deposit(db, o)
        assert dep.status == "pending"
        r = superclient.post(f"{S}/{o['id']}/bank-transfer/reject", json={"reason": "no funds"})
        assert r.status_code == 200, r.text
        db.refresh(dep)
        assert dep.status == "rejected" and not dep.verified
        v = superclient.patch(f"{FIN}/bank-deposits/{dep.id}/verify")
        assert v.status_code == 400, v.text
        db.refresh(dep)
        assert not dep.verified and dep.status == "rejected"

    def test_cancel_voids_deposit(self, db, superclient, superuser, shop):
        o = self._bank_order(superclient, superuser, shop)
        dep = self._deposit(db, o)
        assert superclient.post(f"{S}/{o['id']}/cancel").status_code == 200
        db.refresh(dep)
        assert dep.status == "rejected"
        assert superclient.patch(f"{FIN}/bank-deposits/{dep.id}/verify").status_code == 400

    def test_confirmed_deposit_is_not_touched(self, db, superclient, superuser, shop):
        o = self._bank_order(superclient, superuser, shop)
        dep = self._deposit(db, o)
        v = superclient.post(f"{S}/{o['id']}/bank-transfer/verify")
        assert v.status_code == 200, v.text
        db.refresh(dep)
        assert dep.verified and dep.status == "confirmed"
        from app.modules.sales.service import sales_service
        inv = db.query(__import__("app.modules.sales.models", fromlist=["Invoice"]).Invoice).get(o["id"])
        assert sales_service._void_pending_bank_deposits(db, inv, 1) == 0
        db.refresh(dep)
        assert dep.status == "confirmed" and dep.verified
        # a normal pending deposit of a live order can still be verified
        o2 = self._bank_order(superclient, superuser, shop)
        dep2 = self._deposit(db, o2)
        assert superclient.patch(f"{FIN}/bank-deposits/{dep2.id}/verify").status_code == 200
