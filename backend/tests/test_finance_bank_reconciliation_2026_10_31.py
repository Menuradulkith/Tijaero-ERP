"""Bank accounts + bank reconciliation (2026-10-31, finance blueprint phase C).

Each test opens a fresh bank account (its own GL account) so the shared dev
ledger does not interfere, posts some bank movements through the gateway, then
reconciles a statement against them.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.modules.finance.accounting_models import ChartOfAccounts
from app.modules.finance.gl_posting_service import GLPostingService

A = "/api/v1/finance/accounting"
D = Decimal
TODAY = date.today()


def _bank(client, **over):
    r = client.post(f"{A}/bank-accounts", json={
        "name": f"Test bank {uuid.uuid4().hex[:6]}", "bank_name": "BOC", "account_number": "123",
        "reconcile_from": str(TODAY - timedelta(days=10)), **over})
    assert r.status_code == 201, r.text
    return r.json()


def _move(db, bank, amount, on=TODAY, ref="REF"):
    """Post +amount (money in, from 4190) or -amount (money out, to 5190) on the bank account."""
    amount = D(str(amount))
    other = "4190" if amount > 0 else "5190"
    res = GLPostingService(db).post(
        reference_type="BankRecTest", reference_id=uuid.uuid4().int % 10**8, reference_no=ref,
        lines=[
            {"account_code": bank["account_code"], "debit": max(amount, D(0)), "credit": max(-amount, D(0)), "description": ref},
            {"account_code": other, "debit": max(-amount, D(0)), "credit": max(amount, D(0)), "description": ref},
        ],
        entry_date=on, description=f"bank rec test {ref}", branch_code=None, user_id=0, record_failure=False,
    )
    assert res.posted, res.error_message
    db.flush()
    return res.journal_entry


def _statement(client, bank, lines, opening=0, closing=None, auto=True):
    closing = sum(D(str(l[1])) for l in lines) + D(str(opening)) if closing is None else closing
    r = client.post(f"{A}/bank-statements", json={
        "bank_account_id": bank["id"], "statement_no": "ST-1",
        "date_from": str(TODAY - timedelta(days=10)), "date_to": str(TODAY),
        "opening_balance": str(opening), "closing_balance": str(closing), "auto_match": auto,
        "lines": [{"line_date": str(d), "amount": str(a), "reference": ref, "description": ref} for d, a, ref in lines]})
    assert r.status_code == 201, r.text
    return r.json()


class TestBankAccounts:
    def test_create_makes_a_leaf_gl_account_under_cash_and_bank(self, db, superclient):
        b = _bank(superclient)
        acc = db.query(ChartOfAccounts).filter(ChartOfAccounts.id == b["account_id"]).one()
        parent = db.query(ChartOfAccounts).filter(ChartOfAccounts.id == acc.parent_account_id).one()
        assert acc.account_type == "Asset" and acc.account_category == "Bank" and parent.account_code == "1000"
        assert D(str(b["book_balance"])) == 0

    def test_seeded_main_account_and_gl_validation(self, db, superclient):
        listed = superclient.get(f"{A}/bank-accounts").json()
        assert any(b["account_code"] == "1020" for b in listed)
        main = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1020").one()
        assert superclient.post(f"{A}/bank-accounts", json={"name": "dup", "account_id": main.id}).status_code == 422
        exp = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5190").one()
        assert superclient.post(f"{A}/bank-accounts", json={"name": "bad", "account_id": exp.id}).status_code == 422


class TestReconciliation:
    def test_auto_match_create_entry_and_finish(self, db, superclient):
        b = _bank(superclient)
        _move(db, b, 1000, TODAY - timedelta(days=3), "DEP-1")
        _move(db, b, -250, TODAY - timedelta(days=2), "CHQ-7")
        _move(db, b, -40, TODAY - timedelta(days=1), "CHQ-8")  # not on the statement yet: outstanding
        st = _statement(superclient, b, [
            (TODAY - timedelta(days=2), "1000", "DEP-1"),   # bank shows it a day later -> still matched
            (TODAY - timedelta(days=2), "-250", "CHQ-7"),
            (TODAY, "-15", "FEE"),                            # bank charge: only the bank knows
        ])
        status = {l["reference"]: l["status"] for l in st["lines"]}
        assert status == {"DEP-1": "auto", "CHQ-7": "auto", "FEE": "unmatched"}
        s = st["summary"]
        assert D(str(s["book_balance"])) == D("710.00")
        assert D(str(s["outstanding_total"])) == D("-40.00") and s["outstanding_count"] == 1
        assert D(str(s["difference"])) == D("0"), s  # 710 + 40 - 15 = 735 = closing
        assert superclient.post(f"{A}/bank-statements/{st['id']}/finish").status_code == 422  # FEE unmatched

        fee = next(l for l in st["lines"] if l["reference"] == "FEE")
        charges = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5184").one()
        r = superclient.post(f"{A}/bank-statement-lines/{fee['id']}/create-entry",
                             json={"account_id": charges.id, "description": "Monthly fee"})
        assert r.status_code == 200, r.text
        st = r.json()
        assert {l["reference"]: l["status"] for l in st["lines"]}["FEE"] == "created"
        assert D(str(st["summary"]["book_balance"])) == D("695.00")
        assert D(str(st["summary"]["difference"])) == D("0")

        done = superclient.post(f"{A}/bank-statements/{st['id']}/finish")
        assert done.status_code == 200 and done.json()["status"] == "reconciled"
        # locked until reopened
        assert superclient.post(f"{A}/bank-statement-lines/{fee['id']}/unmatch").status_code == 422
        assert superclient.post(f"{A}/bank-statements/{st['id']}/reopen").json()["status"] == "open"
        accounts = {x["id"]: x for x in superclient.get(f"{A}/bank-accounts").json()}
        assert accounts[b["id"]]["open_statements"] == 1

        # Entered against the wrong account? Unmatching reverses the created entry,
        # so the line can be entered again (book balance back to 710, then 695).
        st = superclient.post(f"{A}/bank-statement-lines/{fee['id']}/unmatch").json()
        assert D(str(st["summary"]["book_balance"])) == D("710.00")
        misc = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5190").one()
        r = superclient.post(f"{A}/bank-statement-lines/{fee['id']}/create-entry", json={"account_id": misc.id})
        assert r.status_code == 200, r.text
        assert D(str(r.json()["summary"]["book_balance"])) == D("695.00")

    def test_ambiguous_lines_wait_for_manual_match(self, db, superclient):
        b = _bank(superclient)
        _move(db, b, 300, TODAY - timedelta(days=4), "A")
        _move(db, b, 300, TODAY - timedelta(days=4), "B")
        st = _statement(superclient, b, [(TODAY - timedelta(days=3), "300", "")])
        line = st["lines"][0]
        assert line["status"] == "unmatched"  # two equal candidates: never guessed
        cands = [c for c in st["candidates"] if D(str(c["amount"])) == D("300")]
        assert len(cands) == 2
        r = superclient.post(f"{A}/bank-statement-lines/{line['id']}/match", json={"gl_ids": [cands[0]["gl_id"]]})
        assert r.status_code == 200 and r.json()["lines"][0]["status"] == "manual"

    def test_one_line_can_clear_several_entries_but_totals_must_agree(self, db, superclient):
        b = _bank(superclient)
        _move(db, b, 100, TODAY - timedelta(days=2), "X1")
        _move(db, b, 50, TODAY - timedelta(days=2), "X2")
        st = _statement(superclient, b, [(TODAY - timedelta(days=1), "150", "DEP")])
        line, ids = st["lines"][0], [c["gl_id"] for c in st["candidates"]]
        assert superclient.post(f"{A}/bank-statement-lines/{line['id']}/match", json={"gl_ids": ids[:1]}).status_code == 422
        r = superclient.post(f"{A}/bank-statement-lines/{line['id']}/match", json={"gl_ids": ids})
        assert r.status_code == 200 and len(r.json()["lines"][0]["matched"]) == 2
        assert D(str(r.json()["summary"]["difference"])) == D("0")

    def test_reversed_entry_drops_off_the_outstanding_list(self, db, superclient):
        b = _bank(superclient)
        je = _move(db, b, -80, TODAY - timedelta(days=2), "VOID")
        r = superclient.post(f"{A}/journal-entries/{je.id}/reverse", json={"reason": "cheque voided"})
        assert r.status_code == 200, r.text
        st = _statement(superclient, b, [], opening=0, closing=0)
        assert st["summary"]["outstanding_count"] == 0 and D(str(st["summary"]["difference"])) == 0

    def test_lines_outside_the_period_and_unbalanced_statements(self, superclient):
        b = _bank(superclient)
        r = superclient.post(f"{A}/bank-statements", json={
            "bank_account_id": b["id"], "date_from": str(TODAY - timedelta(days=5)), "date_to": str(TODAY),
            "lines": [{"line_date": str(TODAY - timedelta(days=30)), "amount": "10"}]})
        assert r.status_code == 422
        st = _statement(superclient, b, [(TODAY, "10", "Z")], opening=0, closing=99)
        assert st["warnings"] and "closing balance" in st["warnings"][0]


class TestCashbookSeesRegisteredBanks:
    def test_registered_bank_account_counts_as_bank_for_cashbook_and_day_end(self, db, superclient, make_branch):
        from app.modules.finance.posting_rules import PostingRuleResolver

        branch = make_branch().branch_code
        b = _bank(superclient)
        assert PostingRuleResolver(db).cashbook_accounts()[b["account_code"]] == "Bank Transfer"
        # cash moved into the new bank account: no money left the business, day-end still reconciles
        res = GLPostingService(db).post(
            reference_type="BankRecTest", reference_id=uuid.uuid4().int % 10**8, reference_no="XFER",
            lines=[{"account_code": b["account_code"], "debit": D("500"), "credit": 0, "description": "to bank"},
                   {"account_code": "1010", "debit": 0, "credit": D("500"), "description": "from till"}],
            entry_date=TODAY, description="cash to new bank", branch_code=branch, user_id=0, record_failure=False)
        assert res.posted
        rec = superclient.get(f"{A}/reports/day-end-reconciliation",
                              params={"reconciliation_date": str(TODAY), "branch_code": branch})
        assert rec.status_code == 200 and rec.json()["cash_reconciled"] is True, rec.json()
