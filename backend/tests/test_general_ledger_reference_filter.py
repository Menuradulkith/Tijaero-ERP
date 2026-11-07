"""General ledger list: search by document number (UX review #19).

``reference`` matches the GL row's reference number (INV-…, EXP-…) or the number of
the journal entry it came from (JE-…), and keeps the caller's branch scope.
"""
from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from app.modules.finance import accounting_schemas as schemas
from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger, JournalEntry
from app.modules.finance.accounting_service import GeneralLedgerService

TODAY = date.today()
D = Decimal


def _uid(p="QA"):
    return f"{p}{uuid.uuid4().hex[:8].upper()}"


def _cash_account(db):
    return db.query(ChartOfAccounts).filter(ChartOfAccounts.account_type == "Asset").order_by(ChartOfAccounts.account_code).first()


def _je(db, no, branch_code):
    je = JournalEntry(
        journal_entry_no=no, entry_date=TODAY, posting_date=TODAY, entry_type="Manual",
        description="QA reference filter", total_debit=D("10"), total_credit=D("10"),
        status="posted", fiscal_year=TODAY.year, fiscal_period=TODAY.month,
        branch_code=branch_code, created_by=1,
    )
    db.add(je)
    db.flush()
    return je


def _gl(db, account, branch_code, reference_no, je=None):
    row = GeneralLedger(
        transaction_date=TODAY, posting_date=TODAY, account_id=account.id,
        debit_amount=D("10"), credit_amount=D("0"), transaction_type="Adjustment",
        reference_type="QA", reference_no=reference_no, branch_code=branch_code,
        journal_entry_id=je.id if je else None,
        fiscal_year=TODAY.year, fiscal_period=TODAY.month,
    )
    db.add(row)
    db.flush()
    return row


def _ids(db, **kw):
    items, _ = GeneralLedgerService(db).list_gl_entries(schemas.GLListFilter(**kw))
    return {i["id"] for i in items}


def test_reference_matches_document_number_and_journal_entry_number(db, make_branch):
    branch = make_branch()
    acc = _cash_account(db)
    inv_no = _uid("INV-QA-")
    je_no = _uid("JE-QA-")
    je = _je(db, je_no, branch.branch_code)
    by_doc = _gl(db, acc, branch.branch_code, inv_no)
    by_je = _gl(db, acc, branch.branch_code, _uid("EXP-QA-"), je=je)
    other = _gl(db, acc, branch.branch_code, _uid("INV-QA-"))

    # Part of the number, any case
    found = _ids(db, reference=inv_no.lower()[3:])
    assert by_doc.id in found and other.id not in found and by_je.id not in found

    found = _ids(db, reference=je_no)
    assert found == {by_je.id}

    # Blank reference is no filter at all
    assert {by_doc.id, by_je.id, other.id} <= _ids(db, reference="  ", limit=100000)


def test_reference_filter_keeps_branch_scope(db, make_branch):
    mine, theirs = make_branch(), make_branch()
    acc = _cash_account(db)
    ref = _uid("INV-QA-")
    in_mine = _gl(db, acc, mine.branch_code, ref + "-A")
    in_theirs = _gl(db, acc, theirs.branch_code, ref + "-B")

    assert _ids(db, reference=ref, branch_codes=[mine.branch_code]) == {in_mine.id}
    assert _ids(db, reference=ref, branch_code=theirs.branch_code) == {in_theirs.id}


def test_reference_query_param_reaches_the_list(superclient, db, make_branch):
    branch = make_branch()
    ref = _uid("EXP-QA-")
    row = _gl(db, _cash_account(db), branch.branch_code, ref)
    r = superclient.get("/api/v1/finance/accounting/general-ledger", params={"reference": ref})
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["id"] for i in body["items"]] == [row.id]
    assert body["total"] == 1
