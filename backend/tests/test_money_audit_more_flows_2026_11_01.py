"""Money audit for flows the 2026-10-12 cross-module audit did not cover (2026-11-01):
petty cash (open → spend → top up → close with a shortage or surplus) and gift
voucher refunds. Each flow must leave the books balanced and the cashbook equal
to the cash/bank ledger accounts.
"""

from __future__ import annotations

import uuid

from tests.money_invariants import Books, D

F = "/api/v1/finance"
C = "/api/v1/customers"


def _ok(r):
    assert r.status_code in (200, 201), r.text
    return r.json()


class TestPettyCash:
    def _cycle(self, superclient, branch, physical):
        fund = _ok(superclient.post(F + "/petty-cash/funds", json={"opening_balance": "1000.00", "branch_code": branch.branch_code}))
        _ok(superclient.post(F + "/petty-cash/expenses", json={
            "petty_cash_id": fund["id"], "amount": "150.00", "expense_type": "Office Supplies", "purpose": "Pens"}))
        _ok(superclient.post(F + "/petty-cash/replenishments", json={"petty_cash_id": fund["id"], "amount": "150.00"}))
        return fund, _ok(superclient.post(f"{F}/petty-cash/funds/{fund['id']}/reconcile", json={"physical_cash_count": physical}))

    def test_close_with_shortage(self, db, superclient, make_branch):
        _, closed = self._cycle(superclient, make_branch(), "990.00")
        assert D(str(closed["discrepancy"])) == D("-10.00")
        b = Books(db)
        assert b.net("1030") == 0, b.net("1030")  # fund emptied
        # Bank: -1000 opened, -150 top-up, +990 returned. Cost: 150 spent + 10 short.
        assert b.net("1020") == D("-160.00"), b.net("1020")
        assert b.cashbook_net() == b.gl_cash_net() == D("-160.00"), (b.cashbook_net(), b.gl_cash_net())
        b.assert_balanced("petty cash shortage")

    def test_close_with_surplus(self, db, superclient, make_branch):
        self._cycle(superclient, make_branch(), "1005.00")
        b = Books(db)
        assert b.net("1030") == 0, b.net("1030")
        assert b.net("1020") == D("-145.00"), b.net("1020")  # 150 spent, 5 found
        assert b.cashbook_net() == b.gl_cash_net() == D("-145.00"), (b.cashbook_net(), b.gl_cash_net())
        b.assert_balanced("petty cash surplus")


class TestGiftVoucherRefund:
    def _sell(self, superclient, branch):
        return _ok(superclient.post(C + "/vouchers/", json={
            "barcode_no": f"QA-GV-{uuid.uuid4().hex[:10]}", "amount": "500.00", "payment_method": "cash",
            "branch_code": branch.branch_code}))

    def test_refund_of_unused_voucher_returns_the_cash(self, db, superclient, make_branch):
        v = self._sell(superclient, make_branch())
        _ok(superclient.delete(f"{C}/vouchers/{v['id']}"))
        b = Books(db)
        assert b.net("2510") == 0 and b.net("1010") == 0, (b.net("2510"), b.net("1010"))
        assert b.cashbook_net() == b.gl_cash_net() == 0, (b.cashbook_net(), b.gl_cash_net())
        b.assert_balanced("voucher refund")

    def test_expired_voucher_cannot_be_refunded(self, db, superclient, make_branch):
        """Its value is already income (breakage); refunding it would pay the cash out twice."""
        from app.modules.customers.models import CustomerGiftVoucher

        v = self._sell(superclient, make_branch())
        db.query(CustomerGiftVoucher).filter(CustomerGiftVoucher.id == v["id"]).update({"status": "expired"})
        db.flush()
        r = superclient.delete(f"{C}/vouchers/{v['id']}")
        assert r.status_code == 400, r.text
        assert Books(db).entries_for("GiftVoucherRefund", v["id"]) == {}
