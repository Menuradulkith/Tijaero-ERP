"""
QA suite — Finance / Accounting process (double-entry GL).

Service-layer tests against the auto-rolled-back ``db`` session.

Process rules verified
----------------------
Chart of Accounts:
* create account
* duplicate account_code -> 400
* missing parent account -> 404
* cannot modify a system account -> 400
* get missing account -> 404

Journal Entry creation (schema-enforced double-entry):
* balanced multi-line entry -> created in 'draft', totals set
* unbalanced lines -> pydantic ValidationError (rejected before service)
* fewer than 2 lines -> ValidationError
* zero-total entry -> ValidationError
* non-existent account id -> 400 (service-level check)

Journal Entry workflow (draft -> submitted -> approved -> posted):
* Manual JE cannot post directly from draft (needs approval)
* submit runs validation and moves to 'submitted'
* approve moves submitted -> approved
* approved Manual JE can post -> 'posted', GL rows created
* reject moves submitted -> draft
* draft can be deleted; posted cannot
* cannot edit a non-draft entry

Auto JE:
* Auto entry posts directly from draft

Trial balance:
* after posting a balanced JE, trial-balance total debit == total credit
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.modules.finance import accounting_schemas as schemas
from app.modules.finance.accounting_service import (
    ChartOfAccountsService,
    GeneralLedgerService,
    JournalEntryService,
)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _line(account_id, debit="0", credit="0", line_number=1, **kw):
    return schemas.JournalEntryLineCreate(
        line_number=line_number,
        account_id=account_id,
        debit_amount=Decimal(debit),
        credit_amount=Decimal(credit),
        **kw,
    )


def _balanced_je(debit_account_id, credit_account_id, amount="100", entry_type="Manual"):
    return schemas.JournalEntryCreate(
        entry_date=date.today(),
        entry_type=entry_type,
        description="Test entry",
        lines=[
            _line(debit_account_id, debit=amount, line_number=1),
            _line(credit_account_id, credit=amount, line_number=2),
        ],
    )


# --------------------------------------------------------------------------- #
# Chart of Accounts
# --------------------------------------------------------------------------- #
class TestChartOfAccounts:
    def _payload(self, **over):
        base = dict(
            account_code="1000-TEST",
            account_name="Cash",
            account_type="Asset",
            normal_balance="Debit",
        )
        base.update(over)
        return schemas.ChartOfAccountCreate(**base)

    def test_create_account(self, db):
        svc = ChartOfAccountsService(db)
        acc = svc.create_account(self._payload(account_code="1000-A"), created_by=1)
        assert acc.id is not None
        assert acc.account_type == "Asset"

    def test_duplicate_code_rejected(self, db, make_account):
        existing = make_account(code="DUP-001")
        svc = ChartOfAccountsService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_account(self._payload(account_code="DUP-001"), created_by=1)
        assert exc.value.status_code == 400
        assert "already exists" in exc.value.detail.lower()

    def test_missing_parent_rejected(self, db):
        svc = ChartOfAccountsService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_account(
                self._payload(account_code="CHILD-1", parent_account_id=99_999_999),
                created_by=1,
            )
        assert exc.value.status_code == 404

    def test_cannot_modify_system_account(self, db, make_account):
        sys_acc = make_account(is_system_account=True)
        svc = ChartOfAccountsService(db)
        with pytest.raises(HTTPException) as exc:
            svc.update_account(
                sys_acc.id, schemas.ChartOfAccountUpdate(account_name="Hacked")
            )
        assert exc.value.status_code == 400

    def test_get_missing_account_404(self, db):
        svc = ChartOfAccountsService(db)
        with pytest.raises(HTTPException) as exc:
            svc.get_account(99_999_999)
        assert exc.value.status_code == 404


# --------------------------------------------------------------------------- #
# Journal Entry creation & double-entry enforcement
# --------------------------------------------------------------------------- #
class TestJournalEntryCreate:
    def test_balanced_entry_created_draft(self, db, make_account):
        debit_acc = make_account(normal_balance="Debit")
        credit_acc = make_account(normal_balance="Credit", account_type="Revenue")
        svc = JournalEntryService(db)
        je = svc.create_journal_entry(
            _balanced_je(debit_acc.id, credit_acc.id, "250"), created_by=1
        )
        assert je.id is not None
        assert je.status == "draft"
        assert je.total_debit == Decimal("250")
        assert je.total_credit == Decimal("250")
        assert je.journal_entry_no.startswith("JE-")

    def test_unbalanced_entry_rejected_by_schema(self, db, make_account):
        a, b = make_account(), make_account()
        with pytest.raises(ValidationError):
            schemas.JournalEntryCreate(
                entry_date=date.today(),
                description="bad",
                lines=[
                    _line(a.id, debit="100", line_number=1),
                    _line(b.id, credit="90", line_number=2),
                ],
            )

    def test_single_line_rejected_by_schema(self, db, make_account):
        a = make_account()
        with pytest.raises(ValidationError):
            schemas.JournalEntryCreate(
                entry_date=date.today(),
                description="bad",
                lines=[_line(a.id, debit="100", line_number=1)],
            )

    def test_zero_total_rejected_by_schema(self, db, make_account):
        a, b = make_account(), make_account()
        with pytest.raises(ValidationError):
            schemas.JournalEntryCreate(
                entry_date=date.today(),
                description="bad",
                lines=[
                    _line(a.id, debit="0", line_number=1),
                    _line(b.id, credit="0", line_number=2),
                ],
            )

    def test_nonexistent_account_rejected_by_service(self, db, make_account):
        real = make_account()
        svc = JournalEntryService(db)
        # Schema is balanced, but one account id does not exist -> service 400.
        data = schemas.JournalEntryCreate(
            entry_date=date.today(),
            description="bad account",
            lines=[
                _line(real.id, debit="100", line_number=1),
                _line(99_999_999, credit="100", line_number=2),
            ],
        )
        with pytest.raises(HTTPException) as exc:
            svc.create_journal_entry(data, created_by=1)
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Journal Entry workflow
# --------------------------------------------------------------------------- #
class TestJournalEntryWorkflow:
    def _draft(self, db, make_account, entry_type="Manual"):
        debit_acc = make_account(normal_balance="Debit")
        credit_acc = make_account(normal_balance="Credit", account_type="Revenue")
        svc = JournalEntryService(db)
        je = svc.create_journal_entry(
            _balanced_je(debit_acc.id, credit_acc.id, "100", entry_type), created_by=1
        )
        return svc, je

    def test_manual_cannot_post_from_draft(self, db, make_account):
        svc, je = self._draft(db, make_account, entry_type="Manual")
        with pytest.raises(HTTPException) as exc:
            svc.post_journal_entry(je.id, posted_by=1)
        assert exc.value.status_code == 400
        assert "approved" in exc.value.detail.lower()

    def test_submit_moves_to_submitted(self, db, make_account):
        svc, je = self._draft(db, make_account)
        result = svc.submit_journal_entry(je.id, submitted_by=1)
        assert result.status == "submitted"

    def test_approve_moves_to_approved(self, db, make_account):
        svc, je = self._draft(db, make_account)
        svc.submit_journal_entry(je.id, submitted_by=1)
        result = svc.approve_journal_entry(je.id, approved_by=2)
        assert result.status == "approved"

    def test_full_approve_then_post_creates_gl(self, db, make_account):
        svc, je = self._draft(db, make_account)
        svc.submit_journal_entry(je.id, submitted_by=1)
        svc.approve_journal_entry(je.id, approved_by=2)
        posted = svc.post_journal_entry(je.id, posted_by=2)
        assert posted.status == "posted"

        # GL rows must exist for this JE
        from app.modules.finance.accounting_models import GeneralLedger
        gl_count = db.query(GeneralLedger).filter(
            GeneralLedger.journal_entry_id == je.id
        ).count()
        assert gl_count == 2

    def test_reject_moves_back_to_draft(self, db, make_account):
        svc, je = self._draft(db, make_account)
        svc.submit_journal_entry(je.id, submitted_by=1)
        result = svc.reject_journal_entry(je.id, rejected_by=2, reason="wrong account")
        assert result.status == "draft"

    def test_draft_can_be_deleted(self, db, make_account):
        svc, je = self._draft(db, make_account)
        assert svc.delete_journal_entry(je.id) is True

    def test_posted_cannot_be_deleted(self, db, make_account):
        svc, je = self._draft(db, make_account)
        svc.submit_journal_entry(je.id, submitted_by=1)
        svc.approve_journal_entry(je.id, approved_by=2)
        svc.post_journal_entry(je.id, posted_by=2)
        with pytest.raises(HTTPException) as exc:
            svc.delete_journal_entry(je.id)
        assert exc.value.status_code == 400

    def test_cannot_edit_non_draft(self, db, make_account):
        svc, je = self._draft(db, make_account)
        svc.submit_journal_entry(je.id, submitted_by=1)
        with pytest.raises(HTTPException) as exc:
            svc.update_journal_entry(
                je.id, schemas.JournalEntryUpdate(description="changed")
            )
        assert exc.value.status_code == 400

    def test_auto_entry_posts_from_draft(self, db, make_account):
        svc, je = self._draft(db, make_account, entry_type="Auto")
        posted = svc.post_journal_entry(je.id, posted_by=1)
        assert posted.status == "posted"


# --------------------------------------------------------------------------- #
# Trial balance
# --------------------------------------------------------------------------- #
class TestTrialBalance:
    def test_trial_balance_balances_after_posting(self, db, make_account):
        debit_acc = make_account(normal_balance="Debit")
        credit_acc = make_account(normal_balance="Credit", account_type="Revenue")
        svc = JournalEntryService(db)
        je = svc.create_journal_entry(
            _balanced_je(debit_acc.id, credit_acc.id, "500", "Auto"), created_by=1
        )
        svc.post_journal_entry(je.id, posted_by=1)

        gl_svc = GeneralLedgerService(db)
        tb = gl_svc.get_trial_balance(fiscal_year=je.fiscal_year)
        assert tb.total_debit == tb.total_credit
        assert tb.total_debit >= Decimal("500")
