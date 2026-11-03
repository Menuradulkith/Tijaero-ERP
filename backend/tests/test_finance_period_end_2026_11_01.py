"""Fixed assets, recurring / auto-reversing journals, opening balances, closed-period
adjustments (2026-11-01, finance blueprint phase E)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.finance import accounting_schemas as schemas
from app.modules.finance.accounting_models import (
    AssetClass,
    ChartOfAccounts,
    FixedAsset,
    GeneralLedger,
    JournalEntry,
)
from app.modules.finance.accounting_service import JournalEntryService
from app.modules.finance.period_end import add_months
from tests.money_invariants import Books

A = "/api/v1/finance/accounting"
D = Decimal
TODAY = date.today()


def _acc(db, code):
    return db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).one()


def _asset(client, db, **over):
    equip = db.query(AssetClass).filter(AssetClass.code == "EQUIP").one()
    body = {"name": f"Laptop {uuid.uuid4().hex[:4]}", "asset_class_id": equip.id, "acquisition_date": str(TODAY.replace(day=1)),
            "cost": "12000", "useful_life_months": 12, "funding": "existing", **over}
    r = client.post(f"{A}/fixed-assets", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _approve_and_post(db, je_id, user_id=0):
    je = db.query(JournalEntry).filter(JournalEntry.id == je_id).one()
    je.status = "approved"
    db.flush()
    return JournalEntryService(db).post_journal_entry(je_id, posted_by=user_id, commit=False)


# ═══════════════════════════════════ fixed assets ═══════════════════════════════════
class TestFixedAssets:
    def test_purchase_from_bank_posts_the_cost(self, db, superclient):
        a = _asset(superclient, db, funding="bank")
        je = Books(db).entries_for("FixedAsset", a["id"])
        assert je["1310"] == (D("12000.00"), D("0")) and je["1020"] == (D("0"), D("12000.00"))
        assert D(str(a["monthly_depreciation"])) == D("1000.00")

    def test_monthly_run_reverse_and_no_double_run(self, db, superclient):
        a = _asset(superclient, db)
        r = superclient.post(f"{A}/depreciation-runs", json={"period_year": TODAY.year, "period_month": TODAY.month})
        assert r.status_code == 201, r.text
        run = r.json()
        asset = db.query(FixedAsset).filter(FixedAsset.id == a["id"]).one()
        db.refresh(asset)
        assert D(str(asset.accumulated_depreciation)) == D("1000.00")
        rows = db.query(GeneralLedger).filter(GeneralLedger.reference_type == "DepreciationRun", GeneralLedger.reference_id == run["id"]).all()
        assert sum(D(str(x.debit_amount)) for x in rows if x.account.account_code == "5170") >= D("1000.00")
        again = superclient.post(f"{A}/depreciation-runs", json={"period_year": TODAY.year, "period_month": TODAY.month})
        assert again.status_code == 422
        rev = superclient.post(f"{A}/depreciation-runs/{run['id']}/reverse")
        assert rev.status_code == 200 and rev.json()["status"] == "reversed"
        db.refresh(asset)
        assert D(str(asset.accumulated_depreciation)) == 0

    def test_declining_balance_amount(self, db, superclient):
        a = _asset(superclient, db, cost="10000", depreciation_method="declining", declining_rate="24")
        assert D(str(a["monthly_depreciation"])) == D("200.00")

    def test_never_below_salvage_and_fully_depreciated(self, db, superclient):
        from app.modules.finance.fixed_assets import monthly_depreciation
        a = _asset(superclient, db, cost="1000", salvage_value="100", useful_life_months=3, accumulated_depreciation="850")
        asset = db.query(FixedAsset).filter(FixedAsset.id == a["id"]).one()
        assert monthly_depreciation(asset) == D("50.00")  # only 50 left above salvage

    def test_sale_with_gain_and_scrap_with_loss(self, db, superclient):
        sold = _asset(superclient, db, cost="5000", accumulated_depreciation="2000")  # book 3000
        r = superclient.post(f"{A}/fixed-assets/{sold['id']}/dispose", json={"kind": "sold", "proceeds": "3500"})
        assert r.status_code == 200 and r.json()["status"] == "sold"
        je = Books(db).entries_for("FixedAsset", sold["id"])
        assert je["4130"] == (D("0"), D("500.00")) and je["1330"] == (D("2000.00"), D("0"))
        assert je["1310"][1] == D("5000.00") and je["1020"][0] == D("3500.00")

        scrap = _asset(superclient, db, cost="800")
        r = superclient.post(f"{A}/fixed-assets/{scrap['id']}/dispose", json={"kind": "scrapped"})
        assert r.status_code == 200
        assert Books(db).entries_for("FixedAsset", scrap["id"])["5187"] == (D("800.00"), D("0"))
        assert superclient.post(f"{A}/fixed-assets/{scrap['id']}/dispose", json={"kind": "scrapped"}).status_code == 422

    def test_validation(self, db, superclient):
        equip = db.query(AssetClass).filter(AssetClass.code == "EQUIP").one()
        base = {"name": "x", "asset_class_id": equip.id, "acquisition_date": str(TODAY), "funding": "existing"}
        assert superclient.post(f"{A}/fixed-assets", json={**base, "cost": "100", "salvage_value": "100"}).status_code == 422
        assert superclient.post(f"{A}/fixed-assets", json={**base, "cost": "100", "acquisition_date": str(TODAY + timedelta(days=3))}).status_code == 400


# ═══════════════════════════════════ recurring / auto-reverse ═══════════════════════════════════
class TestRecurringAndAutoReverse:
    def test_create_due_catches_up_and_sets_auto_reverse(self, db, superclient):
        rent, cash = _acc(db, "5120"), _acc(db, "1010")
        start = add_months(TODAY, -2)
        r = superclient.post(f"{A}/recurring-journals", json={
            "name": "Rent", "description": "Shop rent", "frequency": "monthly", "next_date": str(start), "auto_reverse": True,
            "lines": [{"account_id": rent.id, "debit_amount": "1000"}, {"account_id": cash.id, "credit_amount": "1000"}]})
        assert r.status_code == 201, r.text
        tid = r.json()["id"]
        created = superclient.post(f"{A}/recurring-journals/create-due")
        assert created.status_code == 200, created.text
        mine = db.query(JournalEntry).join(JournalEntry.lines).filter(
            JournalEntry.lines.any(reference_type="RecurringJournal", reference_id=tid)).all()
        assert len(mine) == 3 and all(j.status == "draft" and j.auto_reverse_date for j in mine)
        listed = {t["id"]: t for t in superclient.get(f"{A}/recurring-journals").json()}
        assert listed[tid]["next_date"] == str(add_months(start, 3))

    def test_unbalanced_template_is_refused(self, db, superclient):
        rent, cash = _acc(db, "5120"), _acc(db, "1010")
        r = superclient.post(f"{A}/recurring-journals", json={
            "name": "Bad", "description": "x", "next_date": str(TODAY),
            "lines": [{"account_id": rent.id, "debit_amount": "100"}, {"account_id": cash.id, "credit_amount": "90"}]})
        assert r.status_code == 422

    def test_posting_an_accrual_posts_its_reversal(self, db):
        misc, accr = _acc(db, "5190"), _acc(db, "2140")
        svc = JournalEntryService(db)
        je = svc.create_journal_entry(schemas.JournalEntryCreate(
            entry_date=TODAY, description="accrual", auto_reverse_date=TODAY + timedelta(days=1),
            lines=[schemas.JournalEntryLineCreate(line_number=1, account_id=misc.id, debit_amount=D("75")),
                   schemas.JournalEntryLineCreate(line_number=2, account_id=accr.id, credit_amount=D("75"))]),
            created_by=0, commit=False)
        _approve_and_post(db, je.id)
        db.refresh(je)
        assert je.status == "reversed" and je.reversed_by_je_id
        rev = db.query(JournalEntry).filter(JournalEntry.id == je.reversed_by_je_id).one()
        assert rev.entry_date == TODAY + timedelta(days=1)
        with pytest.raises(HTTPException):
            svc.create_journal_entry(schemas.JournalEntryCreate(
                entry_date=TODAY, description="bad", auto_reverse_date=TODAY,
                lines=[schemas.JournalEntryLineCreate(line_number=1, account_id=misc.id, debit_amount=D("1")),
                       schemas.JournalEntryLineCreate(line_number=2, account_id=accr.id, credit_amount=D("1"))]),
                created_by=0, commit=False)


# ═══════════════════════════════════ opening balances ═══════════════════════════════════
class TestOpeningBalances:
    def test_difference_goes_to_opening_equity_and_control_accounts_allowed(self, db, superclient):
        r = superclient.post(f"{A}/opening-balances", json={"entry_date": str(TODAY), "lines": [
            {"account_code": "1010", "debit": "500"}, {"account_code": "1110", "debit": "300"},
            {"account_code": "2010", "credit": "200"}]})
        assert r.status_code == 201, r.text
        je = r.json()
        assert je["voucher_type"] == "OB" and je["status"] == "draft"
        lines = {l["account_code"]: (D(str(l["debit_amount"])), D(str(l["credit_amount"]))) for l in je["lines"]}
        assert lines["3900"] == (D("0"), D("600.00"))

    def test_unknown_account_code(self, superclient):
        r = superclient.post(f"{A}/opening-balances", json={"entry_date": str(TODAY), "lines": [{"account_code": "NOPE9", "debit": "1"}]})
        assert r.status_code == 422 and "NOPE9" in r.text
