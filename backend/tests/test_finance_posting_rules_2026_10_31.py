"""Posting rules and voucher types (2026-10-31, finance blueprint phase A).

1. Without rules every posting type posts to its built-in default (no behaviour change).
2. A rule re-points a posting type; per-branch and per-expense-category splits work,
   reset returns to the default, and the cashbook / day-end follow a re-pointed cash account.
3. Saving a rule rejects accounts of the wrong type, heading accounts and disallowed splits.
4. Every journal entry is stamped with a voucher type.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy import text

from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntry
from app.modules.finance.posting_rules import (
    POSTING_TYPES,
    PostingRef,
    PostingRuleResolver,
    expense_ref,
    posting_ref,
    voucher_type_for_prefix,
)
from tests.money_invariants import Books, D

F = "/api/v1/finance"
A = F + "/accounting"


def _account(db, account_type: str, normal_balance: str, parent_code: str | None = None) -> ChartOfAccounts:
    parent = None
    if parent_code:
        parent = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == parent_code).first()
    acc = ChartOfAccounts(
        account_code=f"T{uuid.uuid4().hex[:8].upper()}",
        account_name="Posting rule test account",
        account_type=account_type,
        normal_balance=normal_balance,
        parent_account_id=parent.parent_account_id if parent else None,
        is_active=True,
    )
    db.add(acc)
    db.flush()
    return acc


def _paid_expense(client, branch, category, amount, method="cash"):
    e = client.post(F + "/expenses", json={
        "expense_category": category, "expenses_method": method, "expense_amount": amount,
        "branch_code": branch.branch_code, "description": "posting rule test"})
    assert e.status_code in (200, 201), e.text
    eid = e.json()["id"]
    for step, body in (("submit", None), ("approve", {}), ("process-payment", {"payment_method": method})):
        r = client.post(f"{F}/expenses/{eid}/{step}", json=body) if body is not None else client.post(f"{F}/expenses/{eid}/{step}")
        assert r.status_code in (200, 201), (step, r.text)
    return eid


def _rule(client, posting_type, **body):
    return client.put(f"{A}/posting-rules/{posting_type}", json=body)


# ═══════════════════════════════════ 1. defaults ═══════════════════════════════════
class TestDefaults:
    def test_posting_ref_is_its_default_code(self):
        ref = posting_ref("BANK")
        assert ref == "1020" and isinstance(ref, str) and ref.posting_type == "BANK"
        assert f"Dr {ref}" == "Dr 1020"
        assert {ref: "x"}["1020"] == "x"
        with pytest.raises(KeyError):
            posting_ref("NO_SUCH_TYPE")

    def test_expense_ref_keeps_category_defaults(self):
        assert expense_ref("Maintenance & Repairs") == "5181"
        assert expense_ref("travel_transportation").controls == {"expense_category": "travel"}
        assert expense_ref("something_new") == "5190"

    def test_every_default_account_is_a_seeded_leaf_of_the_right_type(self, db):
        accounts = {a.account_code: a for a in db.query(ChartOfAccounts).all()}
        parents = {a.parent_account_id for a in accounts.values() if a.is_active and a.parent_account_id}
        for t in POSTING_TYPES.values():
            acc = accounts.get(t.default_account)
            assert acc is not None, t.code
            assert acc.id not in parents, f"{t.code} default {t.default_account} is a heading"
            assert acc.account_type in t.account_types, (t.code, acc.account_type)

    def test_no_rule_resolves_to_default(self, db):
        r = PostingRuleResolver(db)
        lines = r.apply([{"account_code": posting_ref("CASH"), "debit": 1, "credit": 0},
                         {"account_code": "5190", "debit": 0, "credit": 1}], branch_code=None)
        assert [l["account_code"] for l in lines] == ["1010", "5190"]
        assert type(lines[0]["account_code"]) is str and lines[0]["posting_type"] == "CASH"
        assert "posting_type" not in lines[1]

    def test_voucher_type_for_prefix(self):
        assert voucher_type_for_prefix("JE-SALE") == "SALE"
        assert voucher_type_for_prefix("JE-CAA-REV") == "CAA-REV"
        assert voucher_type_for_prefix("JE") == "AUTO"
        assert voucher_type_for_prefix(None) == "AUTO"


# ═══════════════════════════════════ 2. rules move postings ═══════════════════════════════════
class TestRulesMovePostings:
    def test_single_account_override_and_reset(self, db, superclient, make_branch):
        target = _account(db, "Expense", "Debit")
        r = _rule(superclient, "EXPENSE", control_type="none", account_id=target.id)
        assert r.status_code == 200, r.text
        row = next(t for t in r.json()["posting_types"] if t["code"] == "EXPENSE")
        assert row["is_customized"] and row["account"]["account_code"] == target.account_code

        branch = make_branch()
        eid = _paid_expense(superclient, branch, "utilities", "120.00")
        je = Books(db).entries_for("Expense", eid)
        assert je[target.account_code] == (D("120.00"), D("0")), je
        assert "5130" not in je

        assert superclient.delete(f"{A}/posting-rules/EXPENSE").status_code == 200
        eid2 = _paid_expense(superclient, branch, "utilities", "80.00")
        assert Books(db).entries_for("Expense", eid2)["5130"] == (D("80.00"), D("0"))

    def test_split_by_expense_category(self, db, superclient, make_branch):
        travel = _account(db, "Expense", "Debit")
        r = _rule(superclient, "EXPENSE", control_type="expense_category",
                  details=[{"control_value": "Travel", "account_id": travel.id}])
        assert r.status_code == 200, r.text
        branch = make_branch()
        # an alias of the category hits the same detail; other categories keep their own default
        t_id = _paid_expense(superclient, branch, "travel_transportation", "55.00")
        u_id = _paid_expense(superclient, branch, "utilities", "66.00")
        assert Books(db).entries_for("Expense", t_id)[travel.account_code] == (D("55.00"), D("0"))
        assert Books(db).entries_for("Expense", u_id)["5130"] == (D("66.00"), D("0"))

    def test_split_cash_by_branch_feeds_cashbook_and_day_end(self, db, superclient, make_branch):
        branch_a, branch_b = make_branch(), make_branch()
        till_a = _account(db, "Asset", "Debit")
        r = _rule(superclient, "CASH", control_type="branch",
                  details=[{"control_value": branch_a.branch_code, "account_id": till_a.id}])
        assert r.status_code == 200, r.text

        a_id = _paid_expense(superclient, branch_a, "rent", "300.00")
        b_id = _paid_expense(superclient, branch_b, "rent", "200.00")
        assert Books(db).entries_for("Expense", a_id)[till_a.account_code] == (D("0"), D("300.00"))
        assert Books(db).entries_for("Expense", b_id)["1010"] == (D("0"), D("200.00"))

        # the re-pointed till is still a cash account: cashbook row written, day-end reconciles
        out = db.execute(text(
            "SELECT COALESCE(SUM(money_out), 0) FROM cashbook_entries WHERE branch_code = :b"
        ), {"b": branch_a.branch_code}).scalar()
        assert Decimal(str(out)) == D("300.00")
        rec = superclient.get(f"{A}/reports/day-end-reconciliation",
                              params={"reconciliation_date": str(date.today()), "branch_code": branch_a.branch_code})
        assert rec.status_code == 200, rec.text
        assert rec.json()["cash_reconciled"] is True, rec.json()

    def test_rounding_uses_rule(self, db):
        from app.modules.finance.gl_posting_service import GLPostingService
        from app.modules.finance.accounting_models import PostingRule

        target = _account(db, "Expense", "Debit")
        db.add(PostingRule(posting_type="ROUNDING", control_type="none", account_id=target.id))
        db.flush()
        res = GLPostingService(db).post(
            reference_type="PostingRuleTest", reference_id=int(uuid.uuid4().int % 10**8),
            lines=[{"account_code": "1010", "debit": D("10.03"), "credit": 0},
                   {"account_code": "4010", "debit": 0, "credit": D("10.00")}],
            entry_date=date.today(), description="rounding rule test", branch_code=None, user_id=0,
            record_failure=False,
        )
        assert res.posted, res.error_message
        codes = {l.account.account_code for l in res.journal_entry.lines}
        assert target.account_code in codes and "5900" not in codes


# ═══════════════════════════════════ 3. validation ═══════════════════════════════════
class TestRuleValidation:
    def test_wrong_account_type_is_rejected(self, db, superclient):
        expense = _account(db, "Expense", "Debit")
        r = _rule(superclient, "BANK", control_type="none", account_id=expense.id)
        assert r.status_code == 422 and "Asset" in r.text

    def test_heading_account_is_rejected(self, db, superclient):
        heading = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5100").first()
        r = _rule(superclient, "EXPENSE", control_type="none", account_id=heading.id)
        assert r.status_code == 422 and "heading" in r.text

    def test_disallowed_split_and_unknown_type(self, db, superclient, make_branch):
        eq = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "3100").first()
        r = _rule(superclient, "RETAINED_EARNINGS", control_type="branch",
                  details=[{"control_value": make_branch().branch_code, "account_id": eq.id}])
        assert r.status_code == 422
        assert _rule(superclient, "NOPE", control_type="none", account_id=eq.id).status_code == 404

    def test_unknown_branch_and_duplicates(self, db, superclient, make_branch):
        acc = _account(db, "Asset", "Debit")
        r = _rule(superclient, "BANK", control_type="branch",
                  details=[{"control_value": "NO-SUCH-BRANCH", "account_id": acc.id}])
        assert r.status_code == 422
        b = make_branch().branch_code
        r = _rule(superclient, "BANK", control_type="branch",
                  details=[{"control_value": b, "account_id": acc.id}, {"control_value": b, "account_id": acc.id}])
        assert r.status_code == 422 and "twice" in r.text


# ═══════════════════════════════════ 4. voucher types ═══════════════════════════════════
class TestVoucherTypes:
    def test_auto_and_manual_entries_are_stamped(self, db, superclient, make_branch):
        eid = _paid_expense(superclient, make_branch(), "rent", "40.00")
        je = db.query(JournalEntry).join(JournalEntry.lines).filter(
            JournalEntry.lines.any(reference_type="Expense", reference_id=eid)).first()
        assert je.voucher_type == "EXP"

        cash = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1010").first()
        misc = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "5190").first()
        r = superclient.post(f"{A}/journal-entries", json={
            "entry_date": str(date.today()), "entry_type": "Manual", "description": "voucher type test",
            "lines": [{"line_number": 1, "account_id": misc.id, "debit_amount": "5.00", "credit_amount": "0"},
                      {"line_number": 2, "account_id": cash.id, "debit_amount": "0", "credit_amount": "5.00"}]})
        assert r.status_code in (200, 201), r.text
        assert r.json()["voucher_type"] == "MJ"

        listed = superclient.get(f"{A}/journal-entries", params={"voucher_type": "MJ", "search": r.json()["journal_entry_no"]})
        assert [j["journal_entry_no"] for j in listed.json()["items"]] == [r.json()["journal_entry_no"]]

    def test_list_is_read_only(self, superclient):
        types = superclient.get(f"{A}/voucher-types")
        assert types.status_code == 200, types.text
        codes = {t["code"] for t in types.json()}
        assert {"MJ", "SALE", "PUR", "EXP", "YE", "FA", "OB"} <= codes
        assert superclient.put(f"{A}/voucher-types/EXP", json={"name": "x"}).status_code in (404, 405)
