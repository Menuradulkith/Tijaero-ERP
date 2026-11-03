"""Regression tests for the 2026-11-03 Finance QA audit (FIN-01..40)."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.finance import accounting_schemas as schemas
from app.modules.finance.accounting_models import (
    AccountingPeriod,
    CashFlowStatement,
    ChartOfAccounts,
    JournalEntry,
    RecurringJournal,
)
from app.modules.finance.accounting_service import (
    AccountingPeriodService,
    CashFlowService,
    JournalEntryService,
)
from app.modules.finance.period_end import RecurringJournalService
from app.core import timezone as tz

A = "/api/v1/finance/accounting"
F = "/api/v1/finance"
D = Decimal
TODAY = tz.today()


def _acc(db, code):
    return db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).one()


def _lines(db, amount="25.00"):
    return [
        {"line_number": 1, "account_id": _acc(db, "5190").id, "debit_amount": amount},
        {"line_number": 2, "account_id": _acc(db, "1010").id, "credit_amount": amount},
    ]


def _create_je(client, db, on=TODAY, **over):
    r = client.post(f"{A}/journal-entries", json={
        "entry_date": str(on), "description": f"QA fin {uuid.uuid4().hex[:6]}", "lines": _lines(db), **over})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def two_users(make_user, api):
    """(maker_client_fn, checker_client_fn): superusers, switched through the shared client."""
    maker, maker_tok = make_user(is_superuser=True)
    checker, checker_tok = make_user(is_superuser=True)
    return (lambda: api(maker_tok)), (lambda: api(checker_tok)), maker, checker


def _approved_je(db, two_users, on=TODAY):
    as_maker, as_checker, _, _ = two_users
    je = _create_je(as_maker(), db, on=on)
    assert as_maker().post(f"{A}/journal-entries/{je['id']}/submit", json={}).status_code == 200
    r = as_checker().post(f"{A}/journal-entries/{je['id']}/approve", json={})
    assert r.status_code == 200, r.text
    return je


# ── FIN-01: submit -> approve (other user) -> post through the API ──────────
def test_fin01_manual_je_full_workflow(db, two_users):
    as_maker, as_checker, maker, _ = two_users
    je = _create_je(as_maker(), db)
    r = as_maker().post(f"{A}/journal-entries/{je['id']}/post", json={})
    assert r.status_code == 400 and "approved" in r.json()["detail"]
    r = as_maker().post(f"{A}/journal-entries/{je['id']}/submit", json={})
    assert r.status_code == 200 and r.json()["status"] == "submitted"
    assert r.json()["submitted_by_name"]  # names are serialized now
    assert as_maker().post(f"{A}/journal-entries/{je['id']}/approve", json={}).status_code == 403
    r = as_checker().post(f"{A}/journal-entries/{je['id']}/approve", json={})
    assert r.status_code == 200 and r.json()["status"] == "approved"
    r = as_maker().post(f"{A}/journal-entries/{je['id']}/post", json={})
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "posted" and r.json()["posted_by_name"]


# ── FIN-02: no posting into a year without accounting periods ───────────────
def test_fin02_post_needs_an_existing_period(db, two_users):
    no_period_day = date(1991, 3, 4)
    assert not db.query(AccountingPeriod).filter(
        AccountingPeriod.start_date <= no_period_day, AccountingPeriod.end_date >= no_period_day).first()
    je = _approved_je(db, two_users, on=no_period_day)
    as_maker = two_users[0]
    r = as_maker().post(f"{A}/journal-entries/{je['id']}/post", json={})
    assert r.status_code == 400 and "No accounting period" in r.json()["detail"]
    assert db.get(JournalEntry, je["id"]).status == "approved"


# ── FIN-03: /post can't move an approved entry into another period ──────────
def test_fin03_post_date_cannot_change_period(db, two_users):
    je = _approved_je(db, two_users)
    other_month = (TODAY.replace(day=1) - timedelta(days=1)).replace(day=15)
    r = two_users[0]().post(f"{A}/journal-entries/{je['id']}/post", json={"posting_date": str(other_month)})
    assert r.status_code == 400 and "outside the entry's period" in r.json()["detail"]


# ── FIN-04: overlapping fiscal years refused; overlapping closed period wins ─
def test_fin04_overlapping_fiscal_year_is_refused(db):
    svc = AccountingPeriodService(db)
    svc.generate_periods(schemas.GeneratePeriodsRequest(fiscal_year=2091))
    with pytest.raises(HTTPException) as exc:
        svc.generate_periods(schemas.GeneratePeriodsRequest(fiscal_year=2090, start_month=7))
    assert exc.value.status_code == 400 and "overlaps" in exc.value.detail


def test_fin04_closed_overlapping_period_blocks_posting(db):
    AccountingPeriodService(db).generate_periods(schemas.GeneratePeriodsRequest(fiscal_year=2093))
    # a stray overlapping (pre-fix) period that is closed
    db.add(AccountingPeriod(fiscal_year=2092, period_number=13, period_name="stray", status="closed",
                            start_date=date(2093, 3, 1), end_date=date(2093, 3, 31)))
    db.flush()
    with pytest.raises(HTTPException) as exc:
        JournalEntryService(db)._validate_date_open(date(2093, 3, 10))
    assert exc.value.status_code == 400 and "closed" in exc.value.detail


# ── FIN-05 / FIN-13: expense date rule on update; no self-approval ─────────
def _branch_staff(make_user, api, branch, perms):
    """(maker_fn, checker_fn): two non-superusers of ``branch`` with the same permissions."""
    _, t1 = make_user(permissions=perms, branches=[branch])
    _, t2 = make_user(permissions=perms, branches=[branch])
    return (lambda: api(t1)), (lambda: api(t2))


def test_fin05_fin13_expense_update_date_and_maker_checker(db, make_user, api, make_branch):
    branch = make_branch()
    as_maker, as_checker = _branch_staff(make_user, api, branch, [
        ("expenses", "create"), ("expenses", "update"), ("expense_approvals", "approve")])
    e = as_maker().post(f"{F}/expenses", json={
        "expense_category": "Office Supplies", "expenses_method": "cash", "expense_amount": "40.00",
        "branch_code": branch.branch_code, "description": "QA fin paper"})
    assert e.status_code in (200, 201), e.text
    eid = e.json()["id"]
    r = as_maker().put(f"{F}/expenses/{eid}", json={"expense_date": str(TODAY + timedelta(days=5))})
    assert r.status_code == 400 and "future" in r.json()["detail"]
    assert as_maker().post(f"{F}/expenses/{eid}/submit").status_code == 200
    assert as_maker().post(f"{F}/expenses/{eid}/approve", json={}).status_code == 403
    assert as_checker().post(f"{F}/expenses/{eid}/approve", json={}).status_code == 200


# ── FIN-06 / FIN-35: manual reverse refuses source-document entries and reversals
def test_fin06_reverse_refuses_auto_and_reversal_entries(db, two_users):
    as_maker = two_users[0]
    svc = JournalEntryService(db)
    auto = svc.create_journal_entry(
        schemas.JournalEntryCreate(entry_date=TODAY, entry_type="Auto", description="QA auto",
                                   lines=[schemas.JournalEntryLineCreate(**l) for l in _lines(db)]),
        created_by=0,
    )
    svc.post_journal_entry(auto.id, posted_by=0)
    r = as_maker().post(f"{A}/journal-entries/{auto.id}/reverse", json={"reason": "QA"})
    assert r.status_code == 400 and "source document" in r.json()["detail"]

    je = _approved_je(db, two_users)
    assert as_maker().post(f"{A}/journal-entries/{je['id']}/post", json={}).status_code == 200
    rev = as_maker().post(f"{A}/journal-entries/{je['id']}/reverse", json={"reason": "QA"})
    assert rev.status_code == 200, rev.text
    again = as_maker().post(f"{A}/journal-entries/{rev.json()['id']}/reverse", json={"reason": "QA"})
    assert again.status_code == 400 and "itself a reversal" in again.json()["detail"]


# ── FIN-07: recurring journals / opening balances respect branch access ─────
def test_fin07_branch_checks(db, make_user, make_branch, api):
    mine, other = make_branch(), make_branch()
    _, tok = make_user(permissions=[("journal_entries", "create")], branches=[mine])
    c = api(tok)
    body = {"name": "QA rj", "description": "QA rj", "next_date": str(TODAY), "frequency": "monthly",
            "branch_code": other.branch_code,
            "lines": [{"account_id": _acc(db, "5190").id, "debit_amount": "5"},
                      {"account_id": _acc(db, "1010").id, "credit_amount": "5"}]}
    assert c.post(f"{A}/recurring-journals", json=body).status_code == 403
    r = c.post(f"{A}/opening-balances", json={"entry_date": str(TODAY), "branch_code": other.branch_code,
                                              "lines": [{"account_code": "5190", "debit": "5"}]})
    assert r.status_code == 403


# ── FIN-08: a bank account binds only to a bank / cash GL account ───────────
def test_fin08_bank_account_not_on_control_account(db, superclient):
    r = superclient.post(f"{A}/bank-accounts", json={"name": f"QA {uuid.uuid4().hex[:5]}",
                                                     "account_id": _acc(db, "1110").id})
    assert r.status_code == 422 and "not a bank or cash account" in r.json()["detail"]


# ── FIN-09: a correction waits for a second approver ────────────────────────
def test_fin09_correction_is_submitted_not_posted(db, two_users):
    as_maker, as_checker, _, _ = two_users
    je = _approved_je(db, two_users)
    assert as_maker().post(f"{A}/journal-entries/{je['id']}/post", json={}).status_code == 200
    r = as_checker().post(f"{A}/journal-entries/{je['id']}/correct", json={
        "reason": "wrong amount", "corrected_lines": _lines(db, "20.00")})
    assert r.status_code == 200, r.text
    corr = db.get(JournalEntry, r.json()["correction_je_id"])
    assert corr.status == "submitted"
    assert as_checker().post(f"{A}/journal-entries/{corr.id}/approve", json={}).status_code == 403
    assert as_maker().post(f"{A}/journal-entries/{corr.id}/approve", json={}).status_code == 200
    # the reversal itself can't be "corrected"
    r = as_checker().post(f"{A}/journal-entries/{r.json()['reversal_je_id']}/correct", json={
        "reason": "x", "corrected_lines": _lines(db)})
    assert r.status_code == 400


# ── FIN-10 / FIN-12: recurring drafts deletable; one bad template doesn't block
def test_fin10_fin12_recurring_create_due(db, make_user):
    user, _ = make_user(is_superuser=True)
    good_exp = _acc(db, "5190")
    bad = ChartOfAccounts(account_code=f"QA{uuid.uuid4().hex[:6]}", account_name="QA bad", account_type="Expense",
                          normal_balance="Debit", is_active=True)
    db.add(bad)
    db.flush()
    svc = RecurringJournalService(db)

    def template(acc):
        return svc.create(schemas.RecurringJournalCreate(
            name="QA rj", description="QA rj", next_date=TODAY, frequency="monthly",
            lines=[schemas.RecurringLineInput(account_id=acc.id, debit_amount=D("5")),
                   schemas.RecurringLineInput(account_id=_acc(db, "1010").id, credit_amount=D("5"))],
        ), user_id=user.id)

    bad_t, good_t = template(bad), template(good_exp)
    bad.is_active = False
    db.flush()
    svc.create_due(user_id=user.id)
    db.refresh(good_t)
    db.refresh(bad_t)
    assert good_t.last_journal_entry_id and good_t.next_date > TODAY
    assert bad_t.next_date == TODAY  # skipped, still due
    assert JournalEntryService(db).delete_journal_entry(good_t.last_journal_entry_id, deleted_by=user.id)
    db.refresh(good_t)
    assert good_t.last_journal_entry_id is None


# ── FIN-11: an approved, unposted entry can be sent back to draft ──────────
def test_fin11_reject_approved_entry(db, two_users):
    je = _approved_je(db, two_users)
    r = two_users[1]().post(f"{A}/journal-entries/{je['id']}/reject", json={"reason": "wrong period"})
    assert r.status_code == 200 and r.json()["status"] == "draft" and r.json()["approved_by"] is None


# ── FIN-14: no self-verification of a hand-entered deposit ──────────────────
def test_fin14_deposit_maker_checker(db, make_user, api, make_branch):
    branch = make_branch()
    as_maker, as_checker = _branch_staff(make_user, api, branch, [
        ("bank_deposits", "create"), ("bank_transfer_verify", "approve")])
    dep = as_maker().post(f"{F}/bank-deposits", json={
        "deposits_amount": "80.00", "branch_code": branch.branch_code, "bank_name": "BOC", "payment_for": "cash_deposit"})
    assert dep.status_code in (200, 201), dep.text
    assert as_maker().patch(f"{F}/bank-deposits/{dep.json()['id']}/verify").status_code == 403
    assert as_checker().patch(f"{F}/bank-deposits/{dep.json()['id']}/verify").status_code == 200


# ── FIN-16: overlapping bank statements refused ─────────────────────────────
def test_fin16_overlapping_statement(db, superclient):
    b = superclient.post(f"{A}/bank-accounts", json={"name": f"QA {uuid.uuid4().hex[:6]}",
                                                    "reconcile_from": str(TODAY - timedelta(days=30))}).json()
    body = {"bank_account_id": b["id"], "date_from": str(TODAY - timedelta(days=10)), "date_to": str(TODAY)}
    assert superclient.post(f"{A}/bank-statements", json=body).status_code == 201
    r = superclient.post(f"{A}/bank-statements", json={**body, "date_from": str(TODAY - timedelta(days=3))})
    assert r.status_code == 400 and "overlaps" in r.json()["detail"]


# ── FIN-21: malformed date params are a 422, not a 500 ──────────────────────
@pytest.mark.parametrize("path", [
    "/general-ledger?date_from=31-12-2026",
    "/journal-entries?date_to=nope",
    "/general-ledger/trial-balance?fiscal_year=2026&as_of_date=xx",
    "/audit-trail?date_from=2026-13-01",
])
def test_fin21_bad_dates_are_422(superclient, path):
    assert superclient.get(A + path).status_code == 422


# ── FIN-22 / FIN-23: cash-flow permissions and maker-checker ────────────────
def test_fin22_cash_flow_generate_needs_more_than_view(make_user, api):
    _, tok = make_user(permissions=[("cash_flow", "view")])
    r = api(tok).post(f"{A}/cash-flow/statements/generate", json={"fiscal_year": TODAY.year, "fiscal_period": 1})
    assert r.status_code == 403


def test_fin23_preparer_cannot_approve_cash_flow(db, make_user):
    preparer, _ = make_user(is_superuser=True)
    st = CashFlowStatement(statement_no=f"QA-CFS-{uuid.uuid4().hex[:6]}", fiscal_year=2160, fiscal_period=1,
                           period_start_date=date(2160, 1, 1), period_end_date=date(2160, 1, 31),
                           opening_cash_balance=0, closing_cash_balance=0, status="final", prepared_by=preparer.id)
    db.add(st)
    db.flush()
    with pytest.raises(HTTPException) as exc:
        CashFlowService(db).approve_statement(st.id, approved_by=preparer.id)
    assert exc.value.status_code == 403


# ── Low: input validation ───────────────────────────────────────────────────
def test_low_je_input_validation(db, superclient):
    r = superclient.post(f"{A}/journal-entries", json={"entry_date": str(TODAY), "description": "   ", "lines": _lines(db)})
    assert r.status_code == 422  # FIN-32
    r = superclient.post(f"{A}/journal-entries", json={"entry_date": str(TODAY), "description": "x",
                                                       "lines": _lines(db, "10.005")})
    assert r.status_code == 422  # FIN-34
    r = superclient.post(f"{A}/journal-entries", json={"entry_date": str(TODAY), "description": "x",
                                                       "branch_code": "NO-SUCH-BRANCH-QA", "lines": _lines(db)})
    assert r.status_code == 404  # FIN-31


def test_low_retry_missing_failure_is_404(superclient):
    assert superclient.post(f"{A}/posting-failures/999999999/retry").status_code == 404  # FIN-37


def test_low_coa_code_case_and_leaf_with_postings(db, superclient):
    code = f"QAc{uuid.uuid4().hex[:5]}"
    body = {"account_code": code, "account_name": "QA", "account_type": "Expense", "normal_balance": "Debit"}
    assert superclient.post(f"{A}/chart-of-accounts", json=body).status_code == 201
    assert superclient.post(f"{A}/chart-of-accounts", json={**body, "account_code": code.upper()}).status_code == 400  # FIN-28
    # FIN-15: 5190 carries ledger rows, so it can't silently become a heading
    r = superclient.post(f"{A}/chart-of-accounts", json={**body, "account_code": code + "x",
                                                         "parent_account_id": _acc(db, "5190").id})
    assert r.status_code == 400 and "ledger postings" in r.json()["detail"]
