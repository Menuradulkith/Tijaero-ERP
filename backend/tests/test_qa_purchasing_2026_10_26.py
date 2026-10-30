"""QA audit fixes (2026-10-26): supplier -> PO -> advance -> GRN -> invoice -> payment.

1. A GRN cannot be dated in the future.
2. An advance applied to a (credit) GRN settles Trade Creditors - it must not debit Inventory again.
3. A credit settlement cannot pay more than is still owed on the GRN (the endpoint used to skip the check).
4. An advance cannot be applied beyond what the GRN still owes.
5. A purchase invoice is matched to what was received, at the PO price, and its totals must add up.
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import text

from tests.integration.test_workflows.test_grn_receive_cancel import P, _body, _uid, world  # noqa: F401

TODAY = str(date.today())


@pytest.fixture
def credit_world(world, db):  # noqa: F811
    """The shared approved PO, but payable to the supplier (what every new PO is now)."""
    world["po"].payment_method = "credit"
    db.flush()
    return world


def _receive(client, w, qty=50, **over):
    r = client.post(f"{P}/grn/receive", json=_body(
        w, [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": qty}],
        supplier_invoice_no=_uid("INV"), **over))
    assert r.status_code == 201, r.text
    return r.json()["grn"]


def _advance(client, w, amount):
    r = client.post(f"{P}/supplier-advances", json={
        "supplier_id": w["po"].first_suppliers_id, "purchasing_order_id": w["po"].id, "payment_date": TODAY,
        "payment_method": "cash", "original_amount": amount, "branch_code": w["branch"].branch_code})
    assert r.status_code == 201, r.text
    return r.json()


def _settle(client, w, grn_id, amount):
    return client.post(f"{P}/credit-settlements", json={
        "supplier_credits_settle_no": _uid("CS"), "branch_code": w["branch"].branch_code,
        "suppliers_id": w["po"].first_suppliers_id,
        "transactions": [{"payment_method": "cash", "cheque_date": TODAY, "payment_amount": amount, "good_received_id": grn_id}]})


class TestGrnDate:
    def test_future_dated_grn_is_refused(self, superclient, credit_world):
        w = credit_world
        r = superclient.post(f"{P}/grn/receive", json=_body(
            w, [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": 1}],
            good_received_date=str(date.today() + timedelta(days=30))))
        assert r.status_code == 422, r.text


class TestAdvanceOnCreditGrn:
    def test_application_debits_trade_creditors_not_inventory(self, superclient, db, credit_world):
        w = credit_world
        adv = _advance(superclient, w, 100)
        grn = _receive(superclient, w)  # 50 x 10 = 500
        r = superclient.post(f"{P}/supplier-advance-applications", json={
            "advance_id": adv["id"], "grn_id": grn["id"], "applied_amount": 100, "application_date": TODAY})
        assert r.status_code == 201, r.text
        rows = db.execute(text("""
            select ca.account_code, jl.debit_amount, jl.credit_amount
            from journal_entries je join journal_entry_lines jl on jl.journal_entry_id = je.id
            join chart_of_accounts ca on ca.id = jl.account_id
            where je.description like :d"""), {"d": f"%Advance Application%GRN: {grn['good_received_no']}%"}).all()
        by_acct = {code: (dr, cr) for code, dr, cr in rows}
        assert by_acct.get("2010", (0, 0))[0] == 100, by_acct   # Dr Trade Creditors
        assert by_acct.get("2020", (0, 0))[1] == 100, by_acct   # Cr Supplier Advances
        assert "1210" not in by_acct, by_acct                   # the GRN already debited Inventory

    def test_cannot_apply_more_than_the_grn_still_owes(self, superclient, credit_world):
        w = credit_world
        adv = _advance(superclient, w, 900)
        grn = _receive(superclient, w, qty=5)  # 50
        r = superclient.post(f"{P}/supplier-advance-applications", json={
            "advance_id": adv["id"], "grn_id": grn["id"], "applied_amount": 80, "application_date": TODAY})
        assert r.status_code == 400, r.text


class TestCreditSettlement:
    # One refused call per test: a rejected request ends the test's transaction.
    def test_single_overpayment_is_refused(self, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w, qty=10)  # 100 owed
        assert _settle(superclient, w, grn["id"], 150).status_code == 400

    def test_pending_settlements_count_against_what_is_owed(self, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w, qty=10)
        assert _settle(superclient, w, grn["id"], 60).status_code == 201
        assert _settle(superclient, w, grn["id"], 50).status_code == 400   # 60 pending + 50 > 100

    def test_fully_paid_grn_accepts_nothing_more(self, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w, qty=10)
        assert _settle(superclient, w, grn["id"], 100).status_code == 201
        assert _settle(superclient, w, grn["id"], 1).status_code == 400

    def test_payment_history_reports_this_receipt_only(self, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w, qty=10)
        _receive(superclient, w, qty=20)
        h = superclient.get(f"{P}/grn/{grn['id']}/payment-history").json()
        assert h["total_amount"] == 100.0 and h["remaining"] == 100.0


class TestPurchaseInvoiceMatch:
    def _invoice(self, client, w, grn, no, qty=10, price=10.0, total=None, sub=None, line=None):
        total = qty * price if total is None else total
        return client.post(f"{P}/invoices", json={
            "supplier_invoice_no": no, "supplier_invoice_date": TODAY, "supplier_id": w["po"].first_suppliers_id,
            "branch_code": w["branch"].branch_code, "received_date": TODAY, "due_date": str(date.today() + timedelta(days=30)),
            "payment_type": "credit", "subtotal": qty * price if sub is None else sub, "tax_amount": 0, "discount_amount": 0, "total_amount": total,
            "items": [{"grn_id": grn["id"], "purchasing_order_id": w["po"].id, "product_id": w["products"]["none"].id,
                       "quantity": qty, "unit_price": price, "line_total": qty * price if line is None else line}]})

    @pytest.mark.parametrize("over", [{"qty": 11}, {"price": 12.0}, {"total": 999}, {"sub": 7}, {"line": 5}])
    def test_mismatching_invoice_is_refused(self, superclient, credit_world, over):
        w = credit_world
        grn = _receive(superclient, w, qty=10)
        assert self._invoice(superclient, w, grn, _uid("S"), **over).status_code == 400

    def test_matching_invoice_is_accepted_once(self, superclient, credit_world):
        w = credit_world
        grn = _receive(superclient, w, qty=10)
        assert self._invoice(superclient, w, grn, _uid("S")).status_code == 201
        assert self._invoice(superclient, w, grn, _uid("S"), qty=1).status_code == 400   # already fully invoiced


class TestFinanceAgreesWithSubledger:
    def test_supplier_statement_matches_what_is_owed(self, superclient, credit_world):
        w = credit_world
        sid = w["po"].first_suppliers_id
        adv = _advance(superclient, w, 30)  # before the receipt: an advance needs a PO with no GRN yet
        grn = _receive(superclient, w, qty=10)  # 100, on a PO worth far more
        s = _settle(superclient, w, grn["id"], 40)
        assert s.status_code == 201, s.text
        assert superclient.post(f"{P}/credit-settlements/{s.json()['id']}/verify", json={}).status_code == 200
        assert superclient.post(f"{P}/supplier-advance-applications", json={
            "advance_id": adv["id"], "grn_id": grn["id"], "applied_amount": 30, "application_date": TODAY}).status_code == 201
        st = superclient.get(f"{P}/suppliers/{sid}/statement").json()
        purchases = [ln for ln in st["statement_lines"] if ln["type"] == "PURCHASE"]
        assert purchases and purchases[0]["debit"] == 100.0           # this receipt, not the PO total
        assert {ln["type"] for ln in st["statement_lines"]} >= {"PURCHASE", "PAYMENT", "ADVANCE"}
        assert st["current_balance"] == 30.0                           # 100 - 40 paid - 30 advance
        ps = superclient.get(f"{P}/suppliers/{sid}/payment-status").json()
        assert ps["credit_outstanding"] == st["current_balance"]

    def test_cancelling_a_verified_settlement_reverses_the_ledger(self, superclient, db, credit_world):
        w = credit_world
        grn = _receive(superclient, w, qty=10)  # 100
        s = _settle(superclient, w, grn["id"], 100).json()
        assert superclient.post(f"{P}/credit-settlements/{s['id']}/verify", json={}).status_code == 200

        def net_2010():
            return db.execute(text("""
                select coalesce(sum(jl.debit_amount - jl.credit_amount), 0)
                from journal_entries je join journal_entry_lines jl on jl.journal_entry_id = je.id
                join chart_of_accounts ca on ca.id = jl.account_id
                where ca.account_code = '2010' and je.branch_code = :b and je.status = 'posted'"""),
                {"b": w["branch"].branch_code}).scalar()

        assert net_2010() == 0                       # +100 owed by the GRN, -100 paid
        assert superclient.post(f"{P}/credit-settlements/{s['id']}/cancel", json={}).status_code == 200
        assert net_2010() == -100                    # the payment is undone: 100 owed again
        again = _settle(superclient, w, grn["id"], 100)
        assert again.status_code == 201, again.text  # and it can be paid again
