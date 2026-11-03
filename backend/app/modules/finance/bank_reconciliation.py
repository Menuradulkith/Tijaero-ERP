"""
Bank accounts and bank reconciliation (finance blueprint phase C, IFS CashAccount /
BankStatement / transaction matching).

Reconciling = proving the books and the bank agree:

* A bank account is tied to the leaf GL account its money posts to.
* A statement (imported CSV or typed) has lines: + money in, - money out.
* Each line is matched to the GL row(s) on that account it represents, or,
  for things only the bank knows about (charges, interest), a journal entry is
  created from the line and matched at once.
* The summary compares: GL balance - entries not yet on any statement
  (outstanding) + statement lines not yet in the books  vs.  statement closing
  balance. Zero difference and no unmatched lines -> the statement can be
  marked reconciled (its matches are then locked).
"""
from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import timezone as tz

from . import accounting_schemas as schemas
from .accounting_models import (
    BankAccount,
    BankReconciliationMatch,
    BankStatement,
    BankStatementLine,
    ChartOfAccounts,
    GeneralLedger,
    JournalEntry,
)

CENT = Decimal("0.01")
AUTO_MATCH_DAYS = 5       # a GL row may be this many days before/after the statement line
CANDIDATE_DAYS_AFTER = 10  # unmatched GL rows shown this long past the statement end


def _d(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(CENT)


def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


class BankReconciliationService:
    def __init__(self, db: Session):
        self.db = db

    # ─── Bank accounts ────────────────────────────────────────────────────
    def _gl_balance(self, account_id: int, on: Optional[date] = None) -> Decimal:
        q = self.db.query(func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0)).filter(
            GeneralLedger.account_id == account_id
        )
        if on:
            q = q.filter(GeneralLedger.transaction_date <= on)
        return _d(q.scalar())

    def _account_response(self, ba: BankAccount) -> schemas.BankAccountResponse:
        last = (
            self.db.query(func.max(BankStatement.date_to))
            .filter(BankStatement.bank_account_id == ba.id, BankStatement.status == "reconciled")
            .scalar()
        )
        open_count = self.db.query(func.count(BankStatement.id)).filter(
            BankStatement.bank_account_id == ba.id, BankStatement.status == "open"
        ).scalar()
        return schemas.BankAccountResponse(
            id=ba.id, name=ba.name, bank_name=ba.bank_name, account_number=ba.account_number,
            branch_code=ba.branch_code, account_id=ba.account_id,
            account_code=ba.account.account_code if ba.account else "",
            account_name=ba.account.account_name if ba.account else "",
            currency=ba.currency, reconcile_from=ba.reconcile_from, is_active=ba.is_active, notes=ba.notes,
            book_balance=self._gl_balance(ba.account_id), last_reconciled_to=last, open_statements=int(open_count or 0),
        )

    def list_accounts(self) -> List[schemas.BankAccountResponse]:
        rows = self.db.query(BankAccount).order_by(BankAccount.is_active.desc(), BankAccount.name).all()
        return [self._account_response(b) for b in rows]

    def _next_bank_code(self) -> Tuple[str, Optional[int]]:
        parent = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == "1000").first()
        used = {c for (c,) in self.db.query(ChartOfAccounts.account_code).all()}
        for n in range(1021, 1100):
            if str(n) not in used:
                return str(n), parent.id if parent else None
        raise _bad("No free account code between 1021 and 1099 for a new bank account.")

    def create_account(self, data: schemas.BankAccountCreate, user_id: int) -> schemas.BankAccountResponse:
        if data.account_id:
            acc = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.id == data.account_id).first()
            if acc is None or not acc.is_active:
                raise _bad("The chosen GL account does not exist or is inactive.")
            if acc.account_type != "Asset":
                raise _bad(f"{acc.account_code} is not an asset account.")
            if self.db.query(ChartOfAccounts.id).filter(
                ChartOfAccounts.parent_account_id == acc.id, ChartOfAccounts.is_active.is_(True)
            ).first():
                raise _bad(f"{acc.account_code} is a heading account; choose one under it.")
            if self.db.query(BankAccount.id).filter(BankAccount.account_id == acc.id).first():
                raise _bad(f"{acc.account_code} already belongs to another bank account.")
        else:
            code, parent_id = self._next_bank_code()
            acc = ChartOfAccounts(
                account_code=code, account_name=f"Bank - {data.name}"[:255], account_type="Asset",
                account_category="Bank", parent_account_id=parent_id, is_active=True, is_system_account=False,
                normal_balance="Debit", description=f"{data.bank_name or ''} {data.account_number or ''}".strip() or None,
                created_by=user_id,
            )
            self.db.add(acc)
            self.db.flush()
        ba = BankAccount(
            name=data.name.strip(), bank_name=data.bank_name, account_number=data.account_number,
            branch_code=data.branch_code or None, account_id=acc.id, currency=data.currency or "LKR",
            reconcile_from=data.reconcile_from or tz.today().replace(day=1), notes=data.notes,
            is_active=True, created_by=user_id,
        )
        self.db.add(ba)
        self.db.commit()
        self.db.refresh(ba)
        return self._account_response(ba)

    def update_account(self, account_id: int, data: schemas.BankAccountUpdate, user_id: int) -> schemas.BankAccountResponse:
        ba = self._get_account(account_id)
        fields = data.model_dump(exclude_unset=True)
        if "reconcile_from" in fields and fields["reconcile_from"] != ba.reconcile_from:
            if self.db.query(BankStatement.id).filter(
                BankStatement.bank_account_id == ba.id, BankStatement.status == "reconciled"
            ).first():
                raise _bad("This account already has reconciled statements; its start date can't move.")
        for k, v in fields.items():
            setattr(ba, k, v)
        ba.updated_by = user_id
        self.db.commit()
        self.db.refresh(ba)
        return self._account_response(ba)

    def _get_account(self, account_id: int) -> BankAccount:
        ba = self.db.query(BankAccount).filter(BankAccount.id == account_id).first()
        if ba is None:
            raise _bad("Bank account not found", status.HTTP_404_NOT_FOUND)
        return ba

    # ─── Statements ───────────────────────────────────────────────────────
    def _get_statement(self, statement_id: int, lock: bool = False) -> BankStatement:
        q = self.db.query(BankStatement).filter(BankStatement.id == statement_id)
        if lock:
            q = q.with_for_update()
        st = q.first()
        if st is None:
            raise _bad("Statement not found", status.HTTP_404_NOT_FOUND)
        return st

    def _require_open(self, st: BankStatement) -> None:
        if st.status != "open":
            raise _bad("This statement is reconciled. Reopen it to change it.")

    def list_statements(self, bank_account_id: int) -> List[BankStatement]:
        return (
            self.db.query(BankStatement)
            .filter(BankStatement.bank_account_id == bank_account_id)
            .order_by(BankStatement.date_to.desc(), BankStatement.id.desc())
            .all()
        )

    def create_statement(self, data: schemas.BankStatementCreate, user_id: int) -> schemas.BankStatementDetail:
        ba = self._get_account(data.bank_account_id)
        if data.date_from > data.date_to:
            raise _bad("The statement's start date is after its end date.")
        for ln in data.lines:
            if not (data.date_from <= ln.line_date <= data.date_to):
                raise _bad(f"Line dated {ln.line_date} is outside the statement period.")
            if _d(ln.amount) == 0:
                raise _bad("A statement line can't be zero.")
        expected = _d(data.opening_balance) + sum((_d(ln.amount) for ln in data.lines), Decimal("0"))
        if expected != _d(data.closing_balance):
            raise _bad(
                f"The closing balance ({_d(data.closing_balance)}) should be the opening balance plus the "
                f"lines ({expected}). It is off by {_d(data.closing_balance) - expected} - check for a "
                "missing or mistyped line."
            )
        statement_no = (data.statement_no or "").strip() or None
        if statement_no and self.db.query(BankStatement.id).filter(
            BankStatement.bank_account_id == ba.id, func.lower(BankStatement.statement_no) == statement_no.lower()
        ).first():
            raise _bad(f"Statement {statement_no} was already entered for this bank account.",
                       status.HTTP_400_BAD_REQUEST)
        st = BankStatement(
            bank_account_id=ba.id, statement_no=statement_no, date_from=data.date_from, date_to=data.date_to,
            opening_balance=data.opening_balance, closing_balance=data.closing_balance, status="open",
            notes=data.notes, created_by=user_id,
        )
        for ln in data.lines:
            st.lines.append(BankStatementLine(
                line_date=ln.line_date, description=ln.description, reference=ln.reference,
                amount=_d(ln.amount), created_by=user_id,
            ))
        self.db.add(st)
        self.db.flush()
        if data.auto_match:
            self._auto_match(st)
        self.db.commit()
        return self.statement_detail(st.id)

    def delete_statement(self, statement_id: int) -> None:
        st = self._get_statement(statement_id, lock=True)
        self._require_open(st)
        if any(m.match_type == "created" for ln in st.lines for m in ln.matches):
            raise _bad("Entries were created from this statement. Unmatch and reverse them first.")
        self.db.delete(st)
        self.db.commit()

    # ─── GL rows on the bank account ──────────────────────────────────────
    def _cleared_ids(self, ba: BankAccount, upto: Optional[date] = None):
        """GL row ids matched to statement lines of this account (dated up to ``upto``)."""
        q = (
            self.db.query(BankReconciliationMatch.gl_id)
            .join(BankStatementLine, BankStatementLine.id == BankReconciliationMatch.statement_line_id)
            .join(BankStatement, BankStatement.id == BankStatementLine.statement_id)
            .filter(BankStatement.bank_account_id == ba.id)
        )
        if upto:
            q = q.filter(BankStatementLine.line_date <= upto)
        return q

    def _unmatched_gl(self, ba: BankAccount, until: date, cleared_upto: Optional[date] = None) -> List[GeneralLedger]:
        """GL rows on the bank account up to ``until`` not cleared by a statement line
        (dated up to ``cleared_upto`` when given: the outstanding list at that date)."""
        matched = self.db.query(BankReconciliationMatch.gl_id) if cleared_upto is None else self._cleared_ids(ba, cleared_upto)
        rows = (
            self.db.query(GeneralLedger)
            .filter(
                GeneralLedger.account_id == ba.account_id,
                GeneralLedger.transaction_date >= ba.reconcile_from,
                GeneralLedger.transaction_date <= until,
                ~GeneralLedger.id.in_(matched),
            )
            .order_by(GeneralLedger.transaction_date, GeneralLedger.id)
            .all()
        )
        # A journal entry and its reversal that never reached the bank cancel out:
        # leave both off the outstanding list.
        je_ids = {r.journal_entry_id for r in rows if r.journal_entry_id}
        if je_ids:
            pairs = self.db.query(JournalEntry.id, JournalEntry.reversed_by_je_id).filter(
                JournalEntry.id.in_(je_ids), JournalEntry.status == "reversed", JournalEntry.reversed_by_je_id.isnot(None)
            ).all()
            by_je: Dict[int, Decimal] = {}
            for r in rows:
                by_je[r.journal_entry_id] = by_je.get(r.journal_entry_id, Decimal("0")) + _d(r.debit_amount) - _d(r.credit_amount)
            cancelled = set()
            for orig, rev in pairs:
                if rev in by_je and by_je[orig] + by_je[rev] == 0:
                    cancelled |= {orig, rev}
            rows = [r for r in rows if r.journal_entry_id not in cancelled]
        return rows

    @staticmethod
    def _gl_amount(r: GeneralLedger) -> Decimal:
        return _d(r.debit_amount) - _d(r.credit_amount)

    def _gl_item(self, r: GeneralLedger, je_no: Optional[str] = None) -> schemas.BankGLItem:
        return schemas.BankGLItem(
            gl_id=r.id, transaction_date=r.transaction_date, amount=self._gl_amount(r),
            description=r.description, reference_type=r.reference_type, reference_no=r.reference_no,
            journal_entry_id=r.journal_entry_id, journal_entry_no=je_no,
        )

    # ─── Matching ─────────────────────────────────────────────────────────
    def _auto_match(self, st: BankStatement) -> int:
        ba = st.bank_account
        pool = self._unmatched_gl(ba, st.date_to + timedelta(days=AUTO_MATCH_DAYS))
        taken = set()
        count = 0
        for ln in st.lines:
            if ln.matches:
                continue
            amount = _d(ln.amount)
            cands = [
                r for r in pool
                if r.id not in taken and self._gl_amount(r) == amount
                and abs((r.transaction_date - ln.line_date).days) <= AUTO_MATCH_DAYS
            ]
            if len(cands) > 1 and ln.reference:
                ref = ln.reference.strip().lower()
                by_ref = [r for r in cands if ref and ref in f"{r.reference_no or ''} {r.description or ''}".lower()]
                if by_ref:
                    cands = by_ref
            if len(cands) > 1:
                same_day = [r for r in cands if r.transaction_date == ln.line_date]
                if len(same_day) == 1:
                    cands = same_day
            if len(cands) == 1:  # only a single unambiguous candidate is matched automatically
                taken.add(cands[0].id)
                ln.matches.append(BankReconciliationMatch(gl_id=cands[0].id, match_type="auto"))
                count += 1
        self.db.flush()
        return count

    def auto_match(self, statement_id: int) -> schemas.BankStatementDetail:
        st = self._get_statement(statement_id, lock=True)
        self._require_open(st)
        self._auto_match(st)
        self.db.commit()
        return self.statement_detail(st.id)

    def _get_line(self, line_id: int) -> BankStatementLine:
        ln = self.db.query(BankStatementLine).filter(BankStatementLine.id == line_id).first()
        if ln is None:
            raise _bad("Statement line not found", status.HTTP_404_NOT_FOUND)
        self._require_open(self._get_statement(ln.statement_id, lock=True))
        return ln

    def match(self, line_id: int, gl_ids: List[int], user_id: int) -> schemas.BankStatementDetail:
        ln = self._get_line(line_id)
        if ln.matches:
            raise _bad("This line is already matched. Unmatch it first.")
        if not gl_ids or len(set(gl_ids)) != len(gl_ids):
            raise _bad("Choose the ledger entries this line represents.")
        ba = ln.statement.bank_account
        rows = self.db.query(GeneralLedger).filter(GeneralLedger.id.in_(gl_ids)).all()
        if len(rows) != len(gl_ids) or any(r.account_id != ba.account_id for r in rows):
            raise _bad("Every chosen entry must be on this bank account.")
        if self.db.query(BankReconciliationMatch.id).filter(BankReconciliationMatch.gl_id.in_(gl_ids)).first():
            raise _bad("One of the chosen entries is already matched to another statement line.")
        total = sum((self._gl_amount(r) for r in rows), Decimal("0"))
        if total != _d(ln.amount):
            raise _bad(f"The chosen entries add up to {total}, but the statement line is {_d(ln.amount)}.")
        for r in rows:
            ln.matches.append(BankReconciliationMatch(gl_id=r.id, match_type="manual", created_by=user_id))
        self.db.commit()
        return self.statement_detail(ln.statement_id)

    def unmatch(self, line_id: int, user_id: int = 0) -> schemas.BankStatementDetail:
        """Free the line. An entry that was created from this line (bank charge,
        interest...) is reversed too, so the line can be entered again."""
        from .accounting_service import JournalEntryService

        ln = self._get_line(line_id)
        if not ln.matches:
            raise _bad("This line is not matched, so there is nothing to unmatch.", status.HTTP_400_BAD_REQUEST)
        created_gl = [m.gl_id for m in ln.matches if m.match_type == "created"]
        created = {je for (je,) in self.db.query(GeneralLedger.journal_entry_id).filter(GeneralLedger.id.in_(created_gl))} if created_gl else set()
        ln.matches.clear()
        for je_id in created:
            JournalEntryService(self.db).reverse_journal_entry(
                je_id, reversed_by=user_id, reason="Bank statement line unmatched", commit=False)
        self.db.commit()
        return self.statement_detail(ln.statement_id)

    def create_entry(self, line_id: int, data: schemas.BankLineEntryCreate, user_id: int) -> schemas.BankStatementDetail:
        """Post a journal entry for a line only the bank knew about (charge,
        interest, direct debit...) and match the line to it."""
        from .gl_posting_service import GLPostingService

        ln = self._get_line(line_id)
        if ln.matches:
            raise _bad("This line is already matched.")
        ba = ln.statement.bank_account
        contra = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.id == data.account_id).first()
        if contra is None or not contra.is_active:
            raise _bad("Choose an active account.")
        if contra.id == ba.account_id:
            raise _bad("Choose the account the money came from or went to, not the bank account itself.")
        # The entry posts straight away, so the manual-journal account rules apply: no
        # headings, and no control or VAT accounts (those move with their source documents).
        from .accounting_service import CONTROL_ACCOUNT_CATEGORIES
        from .tax_service import VatReturnService

        if self.db.query(ChartOfAccounts.id).filter(ChartOfAccounts.parent_account_id == contra.id).first():
            raise _bad(f"Account {contra.account_code} is a heading, not an account you can post to: choose one of its sub-accounts.")
        if contra.account_category in CONTROL_ACCOUNT_CATEGORIES:
            raise _bad(f"Account {contra.account_code} is a control account ({contra.account_category}): "
                       "record this through its source document (customer receipt, supplier payment...) and match the line to it.")
        if any(contra.id in ids for ids in VatReturnService(self.db)._vat_account_ids().values()):
            raise _bad(f"Account {contra.account_code} is a VAT account: settle VAT through the VAT return, then match the line to it.")
        amount = _d(ln.amount)
        desc = (data.description or ln.description or "Bank statement item")[:500]
        bank_line = {"account_code": ba.account.account_code, "description": desc,
                     "debit": amount if amount > 0 else Decimal("0"), "credit": -amount if amount < 0 else Decimal("0")}
        contra_line = {"account_code": contra.account_code, "description": desc,
                       "debit": bank_line["credit"], "credit": bank_line["debit"]}
        result = GLPostingService(self.db).post(
            reference_type="BankStatementLine", reference_id=ln.id,
            reference_no=ln.reference or ln.statement.statement_no, lines=[bank_line, contra_line],
            entry_date=ln.line_date, description=f"Bank statement item: {desc}",
            branch_code=ba.branch_code, user_id=user_id, transaction_type="BankStatement",
            je_prefix="JE-BREC", source_module="finance", record_failure=False,
        )
        if not result.posted:
            self.db.rollback()
            raise _bad(f"The entry could not be posted: {result.error_message}")
        gl_row = (
            self.db.query(GeneralLedger)
            .filter(GeneralLedger.journal_entry_id == result.journal_entry.id, GeneralLedger.account_id == ba.account_id)
            .first()
        )
        ln.matches.append(BankReconciliationMatch(gl_id=gl_row.id, match_type="created", created_by=user_id))
        self.db.commit()
        return self.statement_detail(ln.statement_id)

    # ─── Detail / summary / finish ────────────────────────────────────────
    def statement_detail(self, statement_id: int) -> schemas.BankStatementDetail:
        st = self._get_statement(statement_id)
        ba = st.bank_account
        matched_ids = [m.gl_id for ln in st.lines for m in ln.matches]
        matched_rows = {
            r.id: r for r in self.db.query(GeneralLedger).filter(GeneralLedger.id.in_(matched_ids or [0])).all()
        }
        outstanding = self._unmatched_gl(ba, st.date_to, cleared_upto=st.date_to)
        candidates = self._unmatched_gl(ba, st.date_to + timedelta(days=CANDIDATE_DAYS_AFTER))
        je_ids = {r.journal_entry_id for r in list(matched_rows.values()) + candidates if r.journal_entry_id}
        je_nos = dict(self.db.query(JournalEntry.id, JournalEntry.journal_entry_no).filter(
            JournalEntry.id.in_(je_ids or [0])).all())

        lines = []
        unmatched_lines_total = Decimal("0")
        unmatched_count = 0
        for ln in st.lines:
            items = [self._gl_item(matched_rows[m.gl_id], je_nos.get(matched_rows[m.gl_id].journal_entry_id))
                     for m in ln.matches if m.gl_id in matched_rows]
            if not ln.matches:
                unmatched_lines_total += _d(ln.amount)
                unmatched_count += 1
            lines.append(schemas.BankStatementLineResponse(
                id=ln.id, line_date=ln.line_date, description=ln.description, reference=ln.reference,
                amount=_d(ln.amount), status=(ln.matches[0].match_type if ln.matches else "unmatched"),
                matched=items,
            ))

        book = self._gl_balance(ba.account_id, st.date_to)
        outstanding_total = sum((self._gl_amount(r) for r in outstanding), Decimal("0"))
        # Entries booked after the statement date that the bank already shows on it.
        early = _d(
            self.db.query(func.coalesce(func.sum(GeneralLedger.debit_amount - GeneralLedger.credit_amount), 0))
            .filter(GeneralLedger.id.in_(self._cleared_ids(ba, st.date_to)), GeneralLedger.transaction_date > st.date_to)
            .scalar()
        )
        # Bank items not in the books yet, on this or an earlier statement.
        bank_only = _d(
            self.db.query(func.coalesce(func.sum(BankStatementLine.amount), 0))
            .join(BankStatement, BankStatement.id == BankStatementLine.statement_id)
            .filter(
                BankStatement.bank_account_id == ba.id,
                BankStatementLine.line_date <= st.date_to,
                ~BankStatementLine.id.in_(self.db.query(BankReconciliationMatch.statement_line_id)),
            )
            .scalar()
        )
        adjusted_book = book - outstanding_total + early + bank_only
        closing = _d(st.closing_balance)
        lines_total = sum((_d(ln.amount) for ln in st.lines), Decimal("0"))
        warnings = []
        if _d(st.opening_balance) + lines_total != closing:
            warnings.append(
                f"Opening balance {_d(st.opening_balance)} + lines {lines_total} = {_d(st.opening_balance) + lines_total}, "
                f"but the closing balance is {closing}. A line may be missing or mistyped."
            )
        return schemas.BankStatementDetail(
            id=st.id, bank_account_id=ba.id, bank_account_name=ba.name, statement_no=st.statement_no,
            date_from=st.date_from, date_to=st.date_to, opening_balance=_d(st.opening_balance),
            closing_balance=closing, status=st.status, notes=st.notes, lines=lines,
            candidates=[self._gl_item(r, je_nos.get(r.journal_entry_id)) for r in candidates],
            summary=schemas.BankReconciliationSummary(
                book_balance=book,
                outstanding_count=len(outstanding),
                outstanding_total=outstanding_total,
                unmatched_lines_count=unmatched_count,
                unmatched_lines_total=unmatched_lines_total,
                cleared_after_period=early,
                bank_only_total=bank_only,
                adjusted_book_balance=adjusted_book,
                statement_closing_balance=closing,
                difference=adjusted_book - closing,
            ),
            warnings=warnings,
        )

    def finish(self, statement_id: int, user_id: int) -> schemas.BankStatementDetail:
        st = self._get_statement(statement_id, lock=True)
        self._require_open(st)
        detail = self.statement_detail(st.id)
        if detail.summary.unmatched_lines_count:
            raise _bad(f"{detail.summary.unmatched_lines_count} statement line(s) are not matched yet.")
        if detail.summary.difference != 0:
            raise _bad(f"The books and the bank still differ by {detail.summary.difference}.")
        st.status = "reconciled"
        st.reconciled_at = tz.now()
        st.reconciled_by = user_id
        self.db.commit()
        return self.statement_detail(st.id)

    def reopen(self, statement_id: int) -> schemas.BankStatementDetail:
        st = self._get_statement(statement_id, lock=True)
        if st.status != "reconciled":
            raise _bad("This statement is not reconciled.")
        later = self.db.query(BankStatement.id).filter(
            BankStatement.bank_account_id == st.bank_account_id, BankStatement.status == "reconciled",
            BankStatement.date_to > st.date_to,
        ).first()
        if later:
            raise _bad("A later statement is reconciled. Reopen that one first.")
        st.status = "open"
        st.reconciled_at = None
        st.reconciled_by = None
        self.db.commit()
        return self.statement_detail(st.id)
