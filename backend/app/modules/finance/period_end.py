"""
Month-end helpers (finance blueprint phase E): recurring journals and opening balances.

* Recurring journal: a saved journal (rent, insurance, standing accrual) with a
  frequency. "Create due entries" makes a draft manual journal for every due
  date up to today; each still goes through the normal approve -> post. With
  ``auto_reverse`` the entry carries an auto-reverse date (the 1st of the next
  month), so posting it also posts its reversal: an accrual.
* Opening balances: the account balances on the day the books start, entered
  as one "Opening" journal (voucher OB). Control accounts are allowed here
  (it is the only way to bring in their starting balance); anything that does
  not balance goes to 3900 Opening balance equity. It is approved and posted
  like any manual journal.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, selectinload

from app.core import timezone as tz

from . import accounting_schemas as schemas
from .accounting_models import ChartOfAccounts, JournalEntry, RecurringJournal, RecurringJournalLine
from .posting_rules import PostingRuleResolver

CENT = Decimal("0.01")
FREQUENCIES = {"monthly": 1, "quarterly": 3, "yearly": 12}


def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def add_months(d: date, months: int) -> date:
    import calendar

    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def first_of_next_month(d: date) -> date:
    return add_months(d.replace(day=1), 1)


class RecurringJournalService:
    def __init__(self, db: Session):
        self.db = db

    def _validate(self, data) -> None:
        if data.frequency not in FREQUENCIES:
            raise _bad("Frequency must be monthly, quarterly or yearly.")
        if len(data.lines) < 2:
            raise _bad("A journal needs at least two lines.")
        dr = sum((Decimal(str(l.debit_amount or 0)) for l in data.lines), Decimal("0"))
        cr = sum((Decimal(str(l.credit_amount or 0)) for l in data.lines), Decimal("0"))
        if dr.quantize(CENT) != cr.quantize(CENT) or dr <= 0:
            raise _bad(f"Debits ({dr}) and credits ({cr}) must be equal and more than zero.")
        for l in data.lines:
            if bool(l.debit_amount) == bool(l.credit_amount):
                raise _bad("Each line is either a debit or a credit.")
        # same account rules as a manual journal
        from .accounting_service import JournalEntryService

        JournalEntryService(self.db)._validate_line_accounts(
            [schemas.JournalEntryLineCreate(line_number=i + 1, account_id=l.account_id, debit_amount=l.debit_amount,
                                            credit_amount=l.credit_amount, cost_center_id=l.cost_center_id)
             for i, l in enumerate(data.lines)],
            "Manual",
        )

    def list_templates(self) -> List[RecurringJournal]:
        return (
            self.db.query(RecurringJournal).options(selectinload(RecurringJournal.lines))
            .order_by(RecurringJournal.is_active.desc(), RecurringJournal.next_date).all()
        )

    def create(self, data: schemas.RecurringJournalCreate, user_id: int) -> RecurringJournal:
        self._validate(data)
        t = RecurringJournal(
            name=data.name.strip(), description=data.description.strip(), branch_code=data.branch_code,
            frequency=data.frequency, next_date=data.next_date, end_date=data.end_date,
            auto_reverse=data.auto_reverse, is_active=True, created_by=user_id,
        )
        for i, l in enumerate(data.lines, 1):
            t.lines.append(RecurringJournalLine(
                line_number=i, account_id=l.account_id, debit_amount=l.debit_amount, credit_amount=l.credit_amount,
                description=l.description, cost_center_id=l.cost_center_id, created_by=user_id,
            ))
        self.db.add(t)
        self.db.commit()
        self.db.refresh(t)
        return t

    def update(self, template_id: int, data: schemas.RecurringJournalUpdate, user_id: int) -> RecurringJournal:
        t = self.db.query(RecurringJournal).filter(RecurringJournal.id == template_id).first()
        if t is None:
            raise _bad("Recurring journal not found", status.HTTP_404_NOT_FOUND)
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(t, k, v)
        t.updated_by = user_id
        self.db.commit()
        self.db.refresh(t)
        return t

    def create_due(self, user_id: int, until: Optional[date] = None) -> List[str]:
        """Draft journals for every due date up to ``until`` (default today). Returns their numbers."""
        from .accounting_service import JournalEntryService

        until = until or tz.today()
        je_svc = JournalEntryService(self.db)
        created: List[str] = []
        due = (
            self.db.query(RecurringJournal)
            .filter(RecurringJournal.is_active.is_(True), RecurringJournal.next_date <= until)
            .with_for_update().all()
        )
        for t in due:
            while t.is_active and t.next_date <= until:
                if t.end_date and t.next_date > t.end_date:
                    t.is_active = False
                    break
                on = t.next_date
                je = je_svc.create_journal_entry(
                    schemas.JournalEntryCreate(
                        entry_date=on, entry_type="Manual", branch_code=t.branch_code,
                        description=f"{t.description} ({on:%b %Y})",
                        auto_reverse_date=first_of_next_month(on) if t.auto_reverse else None,
                        lines=[schemas.JournalEntryLineCreate(
                            line_number=l.line_number, account_id=l.account_id, debit_amount=l.debit_amount,
                            credit_amount=l.credit_amount, description=l.description, cost_center_id=l.cost_center_id,
                            reference_type="RecurringJournal", reference_id=t.id,
                        ) for l in t.lines],
                    ),
                    created_by=user_id, commit=False,
                )
                created.append(je.journal_entry_no)
                t.last_journal_entry_id = je.id
                t.next_date = add_months(on, FREQUENCIES[t.frequency])
        self.db.commit()
        return created


class OpeningBalanceService:
    def __init__(self, db: Session):
        self.db = db

    def create(self, data: schemas.OpeningBalanceCreate, user_id: int) -> JournalEntry:
        from .accounting_service import JournalEntryService

        codes = {l.account_code.strip() for l in data.lines}
        accounts = {a.account_code: a for a in self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_code.in_(codes)).all()}
        missing = sorted(codes - set(accounts))
        if missing:
            raise _bad(f"These account codes don't exist: {', '.join(missing)}")
        lines = []
        total = Decimal("0")
        for l in data.lines:
            dr, cr = Decimal(str(l.debit or 0)).quantize(CENT), Decimal(str(l.credit or 0)).quantize(CENT)
            if dr and cr:
                raise _bad(f"{l.account_code}: give a debit or a credit, not both.")
            if not dr and not cr:
                continue
            total += dr - cr
            lines.append(schemas.JournalEntryLineCreate(
                line_number=len(lines) + 1, account_id=accounts[l.account_code.strip()].id, debit_amount=dr,
                credit_amount=cr, description=l.description or "Opening balance",
            ))
        if not lines:
            raise _bad("Enter at least one balance.")
        if total != 0:
            equity_code = PostingRuleResolver(self.db).resolve("OPENING_BALANCE_EQUITY")
            equity = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == equity_code).first()
            if equity is None:
                raise _bad(f"Opening balance equity account {equity_code} is missing.")
            lines.append(schemas.JournalEntryLineCreate(
                line_number=len(lines) + 1, account_id=equity.id,
                debit_amount=-total if total < 0 else Decimal("0"), credit_amount=total if total > 0 else Decimal("0"),
                description="Opening balance difference",
            ))
        if len(lines) < 2:
            raise _bad("Enter at least two balances (or one, balanced against opening balance equity).")
        je = JournalEntryService(self.db).create_journal_entry(
            schemas.JournalEntryCreate(
                entry_date=data.entry_date, entry_type="Opening", branch_code=data.branch_code,
                description=data.description or f"Opening balances at {data.entry_date}", lines=lines,
            ),
            created_by=user_id,
        )
        return je
