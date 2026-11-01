"""Cost centers and stock-movement postings (2026-11-01, finance blueprint phase D).

1. Income / expense lines carry a cost center (the one named, else the branch
   default); balance-sheet lines never do; required accounts are enforced on
   manual journals; reversals keep the cost center; profit-by-cost-center adds up.
2. Stock: marking a unit damaged writes it off (and back), a cross-branch
   transfer moves its value to the receiving branch through 1220, a damaged
   arrival is written off there, and stock moved to company assets moves to 1310.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import func

from app.common.enums import StockStatus
from app.modules.finance.accounting_models import (
    ChartOfAccounts,
    CostCenter,
    GeneralLedger,
    JournalEntry,
)
from app.modules.finance.gl_posting_service import GLPostingService
from app.modules.inventory.service import SalesStockService
from app.modules.warehouse import schemas as wh
from app.modules.warehouse.service import ItemReceiveNoteService
from tests.test_warehouse_itn_2026_10_22 import _approved_note_with, world  # noqa: F401

A = "/api/v1/finance/accounting"
D = Decimal
TODAY = date.today()


def _acc(db, code):
    return db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).one()


def _cc(db, branch=None, default=False):
    cc = CostCenter(code=f"CC{uuid.uuid4().hex[:6].upper()}", name="Test cost center",
                    branch_code=branch, is_branch_default=default, is_active=True)
    db.add(cc)
    db.flush()
    return cc


def _gl(db, je_id):
    return {(r.account.account_code): r for r in db.query(GeneralLedger).filter(GeneralLedger.journal_entry_id == je_id).all()}


def _net(db, code, reference_type, reference_id, branch=None):
    q = (db.query(func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0))
         .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
         .filter(ChartOfAccounts.account_code == code, GeneralLedger.reference_type == reference_type,
                 GeneralLedger.reference_id == reference_id))
    if branch:
        q = q.filter(GeneralLedger.branch_code == branch)
    return D(str(q.scalar()))


# ═══════════════════════════════════ 1. cost centers ═══════════════════════════════════
class TestCostCenters:
    def test_branch_default_applies_to_pl_lines_only(self, db, make_branch):
        b = make_branch()
        cc = _cc(db, b.branch_code, default=True)
        res = GLPostingService(db).post(
            reference_type="CCTest", reference_id=uuid.uuid4().int % 10**8, branch_code=b.branch_code, user_id=0,
            lines=[{"account_code": "5190", "debit": D("40"), "credit": 0}, {"account_code": "1010", "debit": 0, "credit": D("40")}],
            entry_date=TODAY, description="cc default", record_failure=False,
        )
        assert res.posted, res.error_message
        rows = _gl(db, res.journal_entry.id)
        assert rows["5190"].cost_center_id == cc.id and rows["1010"].cost_center_id is None
        line = next(l for l in res.journal_entry.lines if l.account.account_code == "5190")
        assert line.cost_center_id == cc.id

    def test_named_cost_center_beats_the_default(self, db, make_branch):
        b = make_branch()
        _cc(db, b.branch_code, default=True)
        named = _cc(db)
        res = GLPostingService(db).post(
            reference_type="CCTest", reference_id=uuid.uuid4().int % 10**8, branch_code=b.branch_code, user_id=0,
            lines=[{"account_code": "5190", "debit": D("10"), "credit": 0, "cost_center": named.code},
                   {"account_code": "1010", "debit": 0, "credit": D("10")}],
            entry_date=TODAY, description="cc named", record_failure=False,
        )
        assert _gl(db, res.journal_entry.id)["5190"].cost_center_id == named.id

    def test_manual_journal_rules_and_reversal(self, db, superclient):
        misc, cash = _acc(db, "5190"), _acc(db, "1010")
        cc = _cc(db)
        body = lambda cc_misc, cc_cash=None: {  # noqa: E731
            "entry_date": str(TODAY), "entry_type": "Manual", "description": "cc manual",
            "lines": [{"line_number": 1, "account_id": misc.id, "debit_amount": "25", "credit_amount": "0", "cost_center_id": cc_misc},
                      {"line_number": 2, "account_id": cash.id, "debit_amount": "0", "credit_amount": "25", "cost_center_id": cc_cash}]}
        # a balance-sheet line takes no cost center
        assert superclient.post(f"{A}/journal-entries", json=body(cc.id, cc.id)).status_code == 400
        r = superclient.post(f"{A}/journal-entries", json=body(cc.id))
        assert r.status_code in (200, 201), r.text
        je_id = r.json()["id"]
        assert next(l for l in r.json()["lines"] if l["account_id"] == misc.id)["cost_center_id"] == cc.id
        je = db.query(JournalEntry).filter(JournalEntry.id == je_id).one()
        je.status = "approved"
        db.flush()
        from app.modules.finance.accounting_service import JournalEntryService
        JournalEntryService(db).post_journal_entry(je_id, posted_by=0, commit=False)
        assert _gl(db, je_id)["5190"].cost_center_id == cc.id
        rev = JournalEntryService(db).reverse_journal_entry(je_id, reversed_by=0, reason="test", commit=False)
        assert _gl(db, rev.id)["5190"].cost_center_id == cc.id

    def test_profit_by_cost_center(self, db, superclient, make_branch):
        b = make_branch()
        cc = _cc(db, b.branch_code, default=True)
        entries = [
            [("1010", "500", "0"), ("4190", "0", "500")],   # income 500
            [("5190", "120", "0"), ("1010", "0", "120")],   # cost 120
        ]
        for pair in entries:
            GLPostingService(db).post(
                reference_type="CCTest", reference_id=uuid.uuid4().int % 10**8, branch_code=b.branch_code, user_id=0,
                lines=[{"account_code": a, "debit": D(d), "credit": D(c)} for a, d, c in pair],
                entry_date=TODAY, description="cc profit", record_failure=False,
            )
        r = superclient.get(f"{A}/reports/profit-by-cost-center",
                            params={"date_from": str(TODAY), "date_to": str(TODAY), "branch_code": b.branch_code})
        assert r.status_code == 200, r.text
        line = next(l for l in r.json()["lines"] if l["cost_center_id"] == cc.id)
        assert (D(str(line["income"])), D(str(line["costs"])), D(str(line["profit"]))) == (D("500"), D("120"), D("380"))

    def test_setup_api_one_default_per_branch(self, superclient, make_branch):
        b = make_branch().branch_code
        first = superclient.post(f"{A}/cost-centers", json={"code": f"X{uuid.uuid4().hex[:5]}", "name": "Sales", "branch_code": b, "is_branch_default": True})
        second = superclient.post(f"{A}/cost-centers", json={"code": f"Y{uuid.uuid4().hex[:5]}", "name": "Service", "branch_code": b, "is_branch_default": True})
        assert first.status_code == 201 and second.status_code == 201
        listed = {c["id"]: c for c in superclient.get(f"{A}/cost-centers").json()}
        assert listed[second.json()["id"]]["is_branch_default"] and not listed[first.json()["id"]]["is_branch_default"]


# ═══════════════════════════════════ 2. stock movements ═══════════════════════════════════
@pytest.fixture
def costed(world, db):  # noqa: F811
    world["product"].cost_price = 100
    db.flush()
    return world


class TestStockPostings:
    def test_damaged_and_back(self, db, costed):
        unit = costed["units"][0]
        SalesStockService(db).update_status(unit.id, "damaged", user_id=costed["user"].id)
        assert _net(db, "5186", "SalesStock", unit.id) == D("100.00")
        assert _net(db, "1210", "SalesStock", unit.id) == D("-100.00")
        SalesStockService(db).update_status(unit.id, "available", user_id=costed["user"].id)
        assert _net(db, "5186", "SalesStock", unit.id) == 0 and _net(db, "1210", "SalesStock", unit.id) == 0
        SalesStockService(db).update_status(unit.id, "reserved", user_id=costed["user"].id)  # no value change
        assert _net(db, "1210", "SalesStock", unit.id) == 0

    def test_cross_branch_transfer_moves_value_and_writes_off_damage(self, db, costed):
        w = costed
        u1, u2 = w["units"][0], w["units"][1]
        note = _approved_note_with(db, w, [u1, u2])
        ItemReceiveNoteService(db).receive_items(note.id, wh.ReceiveItemsRequest(
            received_user_id=w["user"].id, barcodes=[u1.barcode, u2.barcode],
            lines=[wh.ReceiveLine(barcode=u2.barcode, damaged_quantity=1)]))
        a, b = w["a"].branch_code, w["b"].branch_code
        assert _net(db, "1210", "ItemTransferNote", note.id, a) == D("-200.00")
        assert _net(db, "1210", "ItemTransferNote", note.id, b) == D("200.00")
        assert _net(db, "1220", "ItemTransferNote", note.id) == 0  # nothing left in transit
        db.refresh(u2)
        assert u2.status == StockStatus.DAMAGED
        assert _net(db, "5186", "SalesStock", u2.id, b) == D("100.00")

    def test_company_asset_reclass_and_return(self, db, costed):
        from app.modules.inventory.reclassification import ReclassificationService

        unit = costed["units"][2]
        res = ReclassificationService(db).move_stock_to_company_asset(unit.id, "office use", costed["user"].id)
        assert _net(db, "1310", "SalesStock", unit.id) == D("100.00")
        assert _net(db, "1210", "SalesStock", unit.id) == D("-100.00")
        ReclassificationService(db).return_asset_to_stock(res["company_asset_id"], "back to sale", costed["user"].id)
        assert _net(db, "1310", "SalesStock", unit.id) == 0 and _net(db, "1210", "SalesStock", unit.id) == 0
