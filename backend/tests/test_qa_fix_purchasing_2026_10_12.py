"""QA fixes 2026-10-12 (docs/qa/e2e-balancing-2026-10-12.md) - purchasing.

F1   purchase returns (both paths) post exactly one JE and it is COMMITTED
F1b  a supplier invoice payment JE is COMMITTED
F2   the same stock unit cannot be put on two purchase returns (create + approve)
F3   AP aging / credit-status only count credit GRNs as payable
F14  a cash PO GRN credits 1010 Cash on Hand (bank/cheque stay on 1020)
F7   purchasing money inputs are capped at MAX_MONEY

Durability: the transactional ``db`` fixture shares ONE session with the app and
never closes it, so a hook that only flushes still "works" inside a test (and a
``db.rollback()`` would roll back the fixture's outer transaction too). The
``commits`` spy therefore records the highest journal_entries.id that existed at
every ``db.commit()``; a JE whose id is above the last recorded value was only
flushed after the last commit and would be discarded when ``get_db`` closes the
session. On the old code these tests fail exactly that way.
"""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func

from app.modules.finance.accounting_models import JournalEntryLine
from app.modules.inventory.models import SalesStock
from app.modules.purchasing import models as pm
from app.modules.purchasing.invoice_models import PurchaseInvoice
from app.modules.purchasing.service import PurchasingReturnService
from tests.integration.test_workflows.test_grn_receive_cancel import (  # noqa: F401  (fixtures + helpers)
    P,
    _body,
    _uid,
    world,
)
from tests.money_invariants import Books, D

A = "/api/v1/common/approvals"


def _lines(w, *, serial=3, batch=100, none=50):
    return [
        {"purchasing_order_items_id": w["items"]["serial"].id, "units": [{"barcode": _uid("SN")} for _ in range(serial)]},
        {"purchasing_order_items_id": w["items"]["batch"].id, "quantity": batch, "batch_no": "B-1"},
        {"purchasing_order_items_id": w["items"]["none"].id, "quantity": none},
    ]


def _receive(db, client, w, method):
    w["po"].payment_method = method
    db.flush()
    r = client.post(f"{P}/grn/receive", params={"allow_credit_override": True}, json=_body(w, _lines(w)))
    assert r.status_code == 201, r.text
    return r.json()["grn"]


def _serial_unit(db, grn_id):
    return (
        db.query(SalesStock)
        .filter(SalesStock.good_received_note_id == grn_id, SalesStock.barcode.isnot(None))
        .order_by(SalesStock.id)
        .first()
    )


def _return_body(w, grn_id, unit, require_approval):
    return {
        "branch_code": w["branch"].branch_code, "goodreceivednote_id": grn_id, "require_approval": require_approval,
        "items": [{"product_id": unit.product_id, "purchasing_price": "10.00", "return_price": "10.00",
                   "barcode": unit.barcode, "sales_stock_id": unit.id}],
    }


def _je_ids(db, ref_type, ref_id):
    return {
        r[0] for r in db.query(JournalEntryLine.journal_entry_id).filter(
            JournalEntryLine.reference_type == ref_type, JournalEntryLine.reference_id == ref_id
        ).all()
    }


@pytest.fixture
def commits(db, monkeypatch):
    """Spy on the request session's commit(): remember the newest JE id at each commit."""
    from sqlalchemy import text

    state = {"je_max": 0, "n": 0}
    original = db.commit

    def spy():
        db.flush()
        state["je_max"] = db.execute(text("SELECT COALESCE(MAX(id), 0) FROM journal_entries")).scalar()
        state["n"] += 1
        original()

    monkeypatch.setattr(db, "commit", spy)
    return state


def _assert_one_committed_je(db, commits, ref_type, ref_id):
    ids = _je_ids(db, ref_type, ref_id)
    assert len(ids) == 1, ids
    assert max(ids) <= commits["je_max"], (
        f"JE {ids} was flushed after the last commit (newest committed JE id {commits['je_max']}): "
        "get_db would discard it"
    )


# ════════════════════════════════════ F1: purchase returns ════════════════════════════════════
class TestPurchaseReturnPostsAndCommits:
    def test_no_approval_return_je_is_committed(self, db, superclient, world, commits):
        grn = _receive(db, superclient, world, "credit")
        unit = _serial_unit(db, grn["id"])
        r = superclient.post(f"{P}/returns", json=_return_body(world, grn["id"], unit, False))
        assert r.status_code == 201, r.text
        rid = r.json()["id"]

        _assert_one_committed_je(db, commits, "PurchaseReturn", rid)
        je = Books(db).entries_for("PurchaseReturn", rid)
        assert je["2010"] == (D("10.00"), D("0")), je
        assert je["1210"] == (D("0"), D("10.00")), je

    def test_approved_return_via_approval_dashboard_je_is_committed(self, db, superclient, world, commits):
        grn = _receive(db, superclient, world, "credit")
        unit = _serial_unit(db, grn["id"])
        r = superclient.post(f"{P}/returns", json=_return_body(world, grn["id"], unit, True))
        assert r.status_code == 201, r.text
        ret = r.json()
        assert ret["status"] == "pending" and ret["approval_id"]
        assert _je_ids(db, "PurchaseReturn", ret["id"]) == set()

        a = superclient.post(f"{A}/{ret['approval_id']}/approve", json={})
        assert a.status_code == 200, a.text

        _assert_one_committed_je(db, commits, "PurchaseReturn", ret["id"])
        je = Books(db).entries_for("PurchaseReturn", ret["id"])
        assert je["2010"] == (D("10.00"), D("0")), je
        db.expire_all()
        assert db.get(SalesStock, unit.id).status == "returned_to_supplier"
        assert db.get(pm.PurchasingReturn, ret["id"]).status == "approved"

    def test_cash_po_return_refunds_cash_on_hand_and_cashbook(self, db, superclient, world, commits):
        grn = _receive(db, superclient, world, "cash")
        unit = _serial_unit(db, grn["id"])
        r = superclient.post(f"{P}/returns", json=_return_body(world, grn["id"], unit, False))
        assert r.status_code == 201, r.text
        rid = r.json()["id"]

        _assert_one_committed_je(db, commits, "PurchaseReturn", rid)
        je = Books(db).entries_for("PurchaseReturn", rid)
        assert je["1010"] == (D("10.00"), D("0")), je  # F14: cash PO refund -> Cash on Hand, not Bank
        # The refund is money-in on the cashbook. (Dev databases without the
        # fn_insert_cashbook_entry function skip it - the JE must survive that.)
        from sqlalchemy import text
        if db.execute(text("SELECT 1 FROM pg_proc WHERE proname = 'fn_insert_cashbook_entry'")).first():
            from app.modules.finance.models import CashbookEntryRecord
            row = db.query(CashbookEntryRecord).filter(
                CashbookEntryRecord.source_table == "purchasing_returns", CashbookEntryRecord.source_id == rid).one()
            assert row.money_in == D("10.00")


# ════════════════════════════════ F1b: supplier invoice payment ════════════════════════════════
class TestSupplierInvoicePaymentCommits:
    def test_non_credit_invoice_payment_je_is_committed(self, db, superclient, world, commits):
        w = world
        inv = PurchaseInvoice(
            invoice_no=_uid("PI"), supplier_invoice_no=_uid("SINV"), supplier_invoice_date=date.today(),
            supplier_id=w["po"].first_suppliers_id, branch_code=w["branch"].branch_code,
            received_date=date.today(), due_date=date.today(), subtotal=Decimal("100.00"),
            total_amount=Decimal("100.00"), paid_amount=Decimal("0"), balance_due=Decimal("100.00"),
            payment_type="non_credit", status="verified", payment_status="unpaid",
        )
        db.add(inv)
        db.commit()
        r = superclient.post(f"{P}/invoices/pay", json={
            "supplier_id": w["po"].first_suppliers_id, "payment_date": str(date.today()), "payment_method": "cash",
            "payment_amount": "100.00", "branch_code": w["branch"].branch_code,
            "allocations": [{"purchase_invoice_id": inv.id, "allocated_amount": "100.00"}]})
        assert r.status_code == 201, r.text
        pid = r.json()["payment_id"]

        _assert_one_committed_je(db, commits, "SupplierPayment", pid)
        je = Books(db).entries_for("SupplierPayment", pid)
        assert je["1010"] == (D("0"), D("100.00")), je

    def test_payment_amount_is_capped(self, superclient, world):
        w = world
        r = superclient.post(f"{P}/invoices/pay", json={
            "supplier_id": w["po"].first_suppliers_id, "payment_date": str(date.today()), "payment_method": "cash",
            "payment_amount": "1e30", "branch_code": w["branch"].branch_code,
            "allocations": [{"purchase_invoice_id": 1, "allocated_amount": "1e30"}]})
        assert r.status_code == 422, r.text


# ════════════════════════════════ F2: duplicate return of one unit ════════════════════════════════
class TestDuplicateReturnRefused:
    def test_second_return_of_same_unit_is_refused(self, db, superclient, world):
        grn = _receive(db, superclient, world, "credit")
        unit = _serial_unit(db, grn["id"])
        body = _return_body(world, grn["id"], unit, True)
        first = superclient.post(f"{P}/returns", json=body)
        assert first.status_code == 201, first.text
        second = superclient.post(f"{P}/returns", json=body)  # double-clicked Save
        assert second.status_code == 400, second.text
        n = db.query(func.count(pm.PurchasingReturnItems.id)).filter(
            pm.PurchasingReturnItems.sales_stock_id == unit.id).scalar()
        assert n == 1

    def test_same_barcode_twice_on_one_return_is_refused(self, db, superclient, world):
        grn = _receive(db, superclient, world, "credit")
        unit = _serial_unit(db, grn["id"])
        body = _return_body(world, grn["id"], unit, True)
        body["items"] = body["items"] * 2
        r = superclient.post(f"{P}/returns", json=body)
        assert r.status_code == 400, r.text

    def test_approve_refuses_a_unit_held_by_another_return(self, db, superclient, world):
        """Legacy duplicate (two pending returns of one unit, as created by the
        race): only the return currently holding the unit can be approved, and
        once it is, the other can't be."""
        grn = _receive(db, superclient, world, "credit")
        unit = _serial_unit(db, grn["id"])
        a = superclient.post(f"{P}/returns", json=_return_body(world, grn["id"], unit, True)).json()
        # Forge the duplicate the old code allowed.
        b = pm.PurchasingReturn(
            purchasing_return_no=_uid("PR"), branch_code=world["branch"].branch_code, status="pending",
            added_date=date.today(), goodreceivednote_id=grn["id"],
        )
        db.add(b)
        db.flush()
        db.add(pm.PurchasingReturnItems(
            purchasing_price=10, return_price=10, barcode=unit.barcode, quantity=1,
            branch_code=world["branch"].branch_code, added_date=date.today(), product_id=unit.product_id,
            purchasingreturn_id=b.id, sales_stock_id=unit.id,
        ))
        db.get(SalesStock, unit.id).purchase_return_id = b.id
        db.commit()

        svc = PurchasingReturnService(db)
        with pytest.raises(HTTPException) as exc:
            svc.approve_return(a["id"], True, user_id=0)
        assert exc.value.status_code == 400

        svc.approve_return(b.id, True, user_id=0)
        assert len(_je_ids(db, "PurchaseReturn", b.id)) == 1
        # A is still pending but its unit is gone: approving it must fail, not post a 2nd JE.
        db.get(SalesStock, unit.id).purchase_return_id = a["id"]  # even if the pointer were moved back
        db.flush()
        with pytest.raises(HTTPException) as exc:
            svc.approve_return(a["id"], True, user_id=0)
        assert exc.value.status_code == 400
        assert _je_ids(db, "PurchaseReturn", a["id"]) == set()

    def test_unit_not_available_is_refused(self, db, superclient, world):
        grn = _receive(db, superclient, world, "credit")
        unit = _serial_unit(db, grn["id"])
        unit.status = "reserved"
        db.flush()
        r = superclient.post(f"{P}/returns", json=_return_body(world, grn["id"], unit, True))
        assert r.status_code == 400, r.text


# ════════════════════════════════════ F14: GRN account mapping ════════════════════════════════════
class TestGrnSettlementAccount:
    @pytest.mark.parametrize("method,account", [("cash", "1010"), ("cheque", "1020"), ("bank-transfer", "1020"), ("credit", "2010")])
    def test_grn_credit_account_follows_po_payment_method(self, db, superclient, world, method, account):
        grn = _receive(db, superclient, world, method)
        je = Books(db).entries_for("GRN", grn["id"])
        assert je[account] == (D("0"), D("1530.00")), je


# ════════════════════════════════════════ F3: AP aging ════════════════════════════════════════
class TestPayablesOnlyCountCreditGrns:
    def test_cash_grn_is_not_payable(self, db, superclient, world):
        _receive(db, superclient, world, "cash")
        sid = world["po"].first_suppliers_id
        aging = superclient.get(f"{P}/suppliers/{sid}/aging-report").json()
        assert aging["total"]["amount"] == 0, aging
        cs = superclient.get(f"{P}/suppliers/{sid}/credit-status").json()
        assert cs["unpaid_grns"] == [] and cs["outstanding_payable"] == 0, cs
        ps = superclient.get(f"{P}/suppliers/{sid}/payment-status").json()
        assert ps["non_credit_outstanding"] == 0, ps
        all_aging = superclient.get(f"{P}/reports/payables-aging",
                                    params={"branch_code": world["branch"].branch_code}).json()
        assert all_aging["total"]["amount"] == 0, all_aging

    def test_credit_grn_is_payable_net_of_verified_settlements_and_returns(self, db, superclient, world):
        grn = _receive(db, superclient, world, "credit")
        sid = world["po"].first_suppliers_id
        # a pending (unverified) settlement does not reduce the reported payable
        r = superclient.post(f"{P}/credit-settlements", json={
            "supplier_credits_settle_no": _uid("CS"), "branch_code": world["branch"].branch_code, "suppliers_id": sid,
            "transactions": [{"payment_method": "cash", "cheque_date": str(date.today()),
                              "payment_amount": "500.00", "good_received_id": grn["id"]}]})
        assert r.status_code in (200, 201), r.text
        unit = _serial_unit(db, grn["id"])
        assert superclient.post(f"{P}/returns", json=_return_body(world, grn["id"], unit, False)).status_code == 201

        cs = superclient.get(f"{P}/suppliers/{sid}/credit-status").json()
        assert cs["outstanding_payable"] == 1520.0, cs  # 1530 received - 10 approved return
        aging = superclient.get(f"{P}/reports/payables-aging",
                                params={"branch_code": world["branch"].branch_code}).json()
        assert aging["total"]["amount"] == 1520.0, aging

        assert superclient.post(f"{P}/credit-settlements/{r.json()['id']}/verify").status_code == 200
        cs = superclient.get(f"{P}/suppliers/{sid}/credit-status").json()
        assert cs["outstanding_payable"] == 1020.0, cs

    def test_payables_aging_branch_filter(self, db, superclient, world, make_branch):
        _receive(db, superclient, world, "credit")
        other = make_branch()
        r = superclient.get(f"{P}/reports/payables-aging", params={"branch_code": other.branch_code}).json()
        assert r["total"]["amount"] == 0, r


# ═══════════════════════════════════════ F7: money caps ═══════════════════════════════════════
class TestMoneyCaps:
    def test_schemas_reject_absurd_amounts(self):
        from pydantic import ValidationError
        from app.modules.purchasing import schemas as s

        too_big = "1000000000.00"
        with pytest.raises(ValidationError):
            s.SupplierAdvancePaymentCreate(supplier_id=1, payment_date=date.today(), payment_method="cash",
                                           original_amount=too_big, branch_code="B")
        with pytest.raises(ValidationError):
            s.SupplierAdvancePaymentCreate(supplier_id=1, payment_date=date.today(), payment_method="cash",
                                           original_amount="0", branch_code="B")
        with pytest.raises(ValidationError):
            s.SupplierPaymentCreate(supplier_id=1, payment_date=date.today(), payment_method="cash",
                                    payment_amount=too_big, branch_code="B", payment_for="x")
        with pytest.raises(ValidationError):
            s.PurchasingReturnItemCreate(product_id=1, purchasing_price="10", return_price=too_big)
        with pytest.raises(ValidationError):
            s.LandedCostCreate(charge_type="freight", amount=too_big)
        with pytest.raises(ValidationError):
            s.SupplierCreditsSettleTransactionCreate(payment_method="cash", cheque_date=date.today(),
                                                     payment_amount="-1", good_received_id=1)
        # response schemas stay lenient for stored legacy rows
        s.PurchasingReturnItemBase(product_id=1, purchasing_price="1e30", return_price="1e30")


class TestLotReturnCappedByReceivedQty:
    def test_pending_plus_new_lot_returns_cannot_exceed_grn_received(self, db, superclient, world):
        grn = _receive(db, superclient, world, "credit")
        lot = db.query(SalesStock).filter(
            SalesStock.good_received_note_id == grn["id"], SalesStock.barcode.is_(None),
            SalesStock.purchasing_order_items_id == world["items"]["batch"].id).one()
        body = {
            "branch_code": world["branch"].branch_code, "goodreceivednote_id": grn["id"], "require_approval": True,
            "items": [{"product_id": lot.product_id, "purchasing_price": "10.00", "return_price": "10.00",
                       "sales_stock_id": lot.id, "quantity": 100}],  # the whole line (100 received)
        }
        assert superclient.post(f"{P}/returns", json=body).status_code == 201
        # data drift: an extra on-hand lot row on the same GRN line (e.g. a bad import)
        extra = SalesStock(
            product_id=lot.product_id, barcode=None, quantity=10, batch_no="B-1", branch_code=lot.branch_code,
            location_id=lot.location_id, good_received_note_id=grn["id"], purchasing_order_items_id=lot.purchasing_order_items_id,
            status="available", is_active=True, added_date=lot.added_date,
        )
        db.add(extra)
        db.flush()
        body["items"][0].update(sales_stock_id=extra.id, quantity=10)
        r = superclient.post(f"{P}/returns", json=body)
        assert r.status_code == 400, r.text
        assert "received" in r.text
