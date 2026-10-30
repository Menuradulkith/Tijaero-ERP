"""
General Ledger & Accounting Service

Business logic for:
- Chart of Accounts management
- Journal Entry creation, posting, reversal
- General Ledger posting and querying
- Accounting Period management
- Cash Flow Statement generation
- Trial Balance reporting
"""

from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, and_, or_, case, text
from typing import Dict, List, Optional, Tuple
from datetime import date, datetime
from decimal import Decimal, localcontext
import functools
from fastapi import HTTPException, status
from app.core import timezone as tz
from app.common.audit import log_audit, diff_changes

from .accounting_models import (
    ChartOfAccounts,
    JournalEntry,
    JournalEntryLine,
    GeneralLedger,
    AccountingPeriod,
    CashFlowCategory,
    CashFlowStatement,
    CashFlowStatementLine,
)
from . import accounting_schemas as schemas


# Report totals are summed in Python ``Decimal``. The default context keeps only
# 28 significant digits, so a ledger with very large balances (e.g. 1e30 next to
# cents) lost the cents in the totals and the balance sheet reported
# ``is_balanced: false`` although the ledger balanced exactly. Reports therefore
# sum in a local high-precision context and quantize their totals to cents.
_REPORT_PRECISION = 80
_CENTS = Decimal("0.01")


def _high_precision(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with localcontext() as ctx:
            ctx.prec = _REPORT_PRECISION
            return fn(*args, **kwargs)
    return wrapper


def _cents(value) -> Decimal:
    with localcontext() as ctx:
        ctx.prec = _REPORT_PRECISION
        return Decimal(value).quantize(_CENTS)


BALANCE_SHEET_TYPES = ("Asset", "Liability", "Equity")
PROFIT_AND_LOSS_TYPES = ("Revenue", "Expense")
RETAINED_EARNINGS_CODE = "3100"
CURRENT_YEAR_PL_CODE = "3200"
# Sub-ledger controlled accounts: manual journals may not post to them.
CONTROL_ACCOUNT_CATEGORIES = ("Receivable", "Payable", "Inventory")


def _not_closing(column):
    """GL rows that are not year-end closing entries (NULL-safe)."""
    return func.coalesce(column, "") != "Closing"


def _cashbook_for_je(db: Session, je, lines, on: date, description, swap: bool) -> None:
    """Mirror a posted (or reversing, ``swap=True``) JE's cash/bank movement
    into the cashbook. Closing entries never touch cash."""
    from .gl_posting_service import record_cashbook_from_gl

    if je.entry_type == "Closing":
        return
    codes = dict(db.query(ChartOfAccounts.id, ChartOfAccounts.account_code).filter(
        ChartOfAccounts.id.in_({line.account_id for line in lines})
    ).all())
    record_cashbook_from_gl(
        db, reference_type="JE", reference_id=je.id, reference_no=je.journal_entry_no,
        entry_date=on, branch_code=je.branch_code, description=description,
        lines=[
            {
                "account_code": codes.get(line.account_id),
                "debit": line.credit_amount if swap else line.debit_amount,
                "credit": line.debit_amount if swap else line.credit_amount,
                "description": line.description,
            }
            for line in lines
        ],
    )


def _refresh_balances(db: Session, lines, from_date: date) -> None:
    """Best-effort running-balance refresh after a multi-entry commit."""
    try:
        GeneralLedgerService(db).update_account_balances(
            list({line.account_id for line in lines}), from_date=from_date
        )
    except Exception as e:  # non-blocking, same as single-entry posting
        import logging
        logging.getLogger(__name__).warning(f"Balance update warning (non-blocking): {e}")


def _branch_criteria(column, branch_code: Optional[str], branch_codes: Optional[List[str]]):
    """Branch scope for a report: an explicit branch, else the user's branch list
    (None = superuser, no restriction)."""
    if branch_code:
        return [column == branch_code]
    if branch_codes is not None:
        return [column.in_(branch_codes)]
    return []


# =============================================================================
# CHART OF ACCOUNTS SERVICE
# =============================================================================

def _attach_user_names(db: Session, records: List) -> None:
    """Resolve created_by/updated_by (or similar actor) ids to display names
    and stamp them onto each record as dynamic attributes. Shared across the
    various AuditMixin-based accounting entities in this module."""
    from app.auth.models import User

    user_ids = {
        uid for r in records for uid in (getattr(r, "created_by", None), getattr(r, "updated_by", None)) if uid
    }
    if not user_ids:
        for r in records:
            r.created_by_name = None
            r.updated_by_name = None
        return

    users = db.query(User).filter(User.id.in_(user_ids)).all()
    name_map = {
        u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
        for u in users
    }
    for r in records:
        r.created_by_name = name_map.get(getattr(r, "created_by", None))
        r.updated_by_name = name_map.get(getattr(r, "updated_by", None))


class ChartOfAccountsService:
    def __init__(self, db: Session):
        self.db = db

    def create_account(self, data: schemas.ChartOfAccountCreate, created_by: int = None) -> ChartOfAccounts:
        # Check unique account_code
        existing = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_code == data.account_code
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Account code '{data.account_code}' already exists"
            )

        # Validate parent exists if provided
        if data.parent_account_id:
            parent = self.db.query(ChartOfAccounts).filter(
                ChartOfAccounts.id == data.parent_account_id
            ).first()
            if not parent:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Parent account with id {data.parent_account_id} not found"
                )

        account = ChartOfAccounts(
            **data.model_dump(),
            created_by=created_by,
        )
        self.db.add(account)
        self.db.flush()
        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="chart_of_account", entity_id=account.id,
            changes={"account_code": account.account_code, "account_type": account.account_type, "normal_balance": account.normal_balance},
        )
        self.db.commit()
        self.db.refresh(account)
        _attach_user_names(self.db, [account])
        return account

    def update_account(self, account_id: int, data: schemas.ChartOfAccountUpdate, updated_by: int = None) -> ChartOfAccounts:
        account = self.get_account(account_id)
        if account.is_system_account:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot modify system account"
            )

        update_data = data.model_dump(exclude_none=True)

        # Guard: an account's classification drives the sign of every posted
        # amount in the trial balance and financial statements. Once it has GL
        # history, changing account_type/normal_balance would silently restate
        # prior periods — block it and require a new account instead.
        classification_changed = (
            ("account_type" in update_data and update_data["account_type"] != account.account_type)
            or ("normal_balance" in update_data and update_data["normal_balance"] != account.normal_balance)
        )
        if classification_changed:
            gl_count = self.db.query(func.count(GeneralLedger.id)).filter(
                GeneralLedger.account_id == account_id
            ).scalar()
            if gl_count > 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Cannot change account_type/normal_balance for account "
                        f"'{account.account_code}' with {gl_count} GL entries. "
                        f"Create a new account instead."
                    ),
                )

        # A balance-sheet account still holding a balance cannot be deactivated:
        # the balance would vanish from new postings' pick-lists while staying in
        # the statements. Clear it to zero first. (P&L accounts may be
        # deactivated; the income statement still reports their postings.)
        if (
            update_data.get("is_active") is False
            and account.is_active
            and account.account_type in BALANCE_SHEET_TYPES
        ):
            balance = self.db.query(
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0)
                - func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
            ).filter(GeneralLedger.account_id == account_id).scalar()
            if Decimal(str(balance or 0)) != 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"Cannot deactivate account '{account.account_code}' while it has a "
                        f"balance of {_cents(Decimal(str(balance)))}. Transfer the balance first."
                    ),
                )

        before_values = {key: getattr(account, key, None) for key in update_data}

        for key, value in update_data.items():
            setattr(account, key, value)

        changes = diff_changes(before_values, update_data)
        if changes:
            log_audit(
                self.db, user_id=updated_by or 0, action="update",
                entity_type="chart_of_account", entity_id=account.id,
                changes=changes,
            )
        self.db.commit()
        self.db.refresh(account)
        _attach_user_names(self.db, [account])
        return account

    def get_account(self, account_id: int) -> ChartOfAccounts:
        account = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.id == account_id
        ).first()
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Account with id {account_id} not found"
            )
        _attach_user_names(self.db, [account])
        return account

    def get_account_by_code(self, account_code: str) -> Optional[ChartOfAccounts]:
        return self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_code == account_code
        ).first()

    def list_accounts(self, filters: schemas.COAListFilter) -> List[ChartOfAccounts]:
        query = self.db.query(ChartOfAccounts)

        if filters.account_type:
            query = query.filter(ChartOfAccounts.account_type == filters.account_type)
        if filters.account_category:
            query = query.filter(ChartOfAccounts.account_category == filters.account_category)
        if filters.is_active is not None:
            query = query.filter(ChartOfAccounts.is_active == filters.is_active)
        if filters.parent_account_id is not None:
            query = query.filter(ChartOfAccounts.parent_account_id == filters.parent_account_id)
        if filters.search:
            s = f"%{filters.search}%"
            query = query.filter(or_(
                ChartOfAccounts.account_code.ilike(s),
                ChartOfAccounts.account_name.ilike(s),
                ChartOfAccounts.description.ilike(s),
            ))

        accounts = query.order_by(ChartOfAccounts.account_code).all()
        _attach_user_names(self.db, accounts)
        return accounts

    def get_account_tree(self) -> List[dict]:
        """Get hierarchical tree structure of COA."""
        accounts = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.is_active == True
        ).order_by(ChartOfAccounts.account_code).all()

        account_map = {}
        for acc in accounts:
            account_map[acc.id] = {
                "id": acc.id,
                "account_code": acc.account_code,
                "account_name": acc.account_name,
                "account_type": acc.account_type,
                "account_category": acc.account_category,
                "normal_balance": acc.normal_balance,
                "is_system_account": acc.is_system_account,
                "parent_account_id": acc.parent_account_id,
                "children": [],
            }

        tree = []
        for acc_id, acc_data in account_map.items():
            parent_id = acc_data["parent_account_id"]
            if parent_id and parent_id in account_map:
                account_map[parent_id]["children"].append(acc_data)
            else:
                tree.append(acc_data)

        return tree

    def delete_account(self, account_id: int, deleted_by: int = None) -> bool:
        account = self.get_account(account_id)
        if account.is_system_account:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete system account"
            )

        # Check if account has GL entries
        gl_count = self.db.query(func.count(GeneralLedger.id)).filter(
            GeneralLedger.account_id == account_id
        ).scalar()
        if gl_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete account with {gl_count} GL entries. Deactivate instead."
            )

        # Check if account has children
        child_count = self.db.query(func.count(ChartOfAccounts.id)).filter(
            ChartOfAccounts.parent_account_id == account_id
        ).scalar()
        if child_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete account with {child_count} child accounts"
            )

        log_audit(
            self.db, user_id=deleted_by or 0, action="delete",
            entity_type="chart_of_account", entity_id=account.id,
            changes={"account_code": account.account_code},
        )
        self.db.delete(account)
        self.db.commit()
        return True


# =============================================================================
# JOURNAL ENTRY SERVICE
# =============================================================================

def _attach_je_user_names(db: Session, entries: List) -> None:
    """Resolve created_by/submitted_by/approved_by/posted_by ids to display
    names for a batch of JournalEntry rows."""
    from app.auth.models import User

    fields = ("created_by", "submitted_by", "approved_by", "posted_by")
    user_ids = {getattr(e, f, None) for e in entries for f in fields} - {None}
    name_map = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        name_map = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in users
        }
    for e in entries:
        e.created_by_name = name_map.get(getattr(e, "created_by", None))
        e.submitted_by_name = name_map.get(getattr(e, "submitted_by", None))
        e.approved_by_name = name_map.get(getattr(e, "approved_by", None))
        e.posted_by_name = name_map.get(getattr(e, "posted_by", None))


class JournalEntryService:
    def __init__(self, db: Session):
        self.db = db

    def _generate_je_number(self) -> str:
        today = tz.today()
        prefix = f"JE-{today.strftime('%Y%m')}-"
        # Advisory lock to prevent race conditions on sequence generation
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        # Highest number, not highest string: "...-10000" sorts below "...-9999"
        # as text, so order by length first (the suffix has no extra zeros).
        last = self.db.query(JournalEntry.journal_entry_no).filter(
            JournalEntry.journal_entry_no.like(f"{prefix}%")
        ).order_by(
            func.length(JournalEntry.journal_entry_no).desc(),
            JournalEntry.journal_entry_no.desc(),
        ).first()

        if last and last[0].startswith(prefix):
            try:
                seq = int(last[0].split("-")[-1]) + 1
            except ValueError:
                seq = 1
        else:
            seq = 1
        return f"{prefix}{seq:04d}"

    def _get_fiscal_period(self, entry_date: date) -> Tuple[int, int]:
        """Determine fiscal year and period from date."""
        period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.start_date <= entry_date,
            AccountingPeriod.end_date >= entry_date,
        ).first()

        if period:
            return period.fiscal_year, period.period_number
        # Fallback: use calendar year/month
        return entry_date.year, entry_date.month

    def _validate_period_open(self, fiscal_year: int, fiscal_period: int) -> None:
        """Ensure the accounting period is open for posting.

        Reads the period FOR SHARE so a concurrent close (FOR UPDATE) waits for
        this posting to commit instead of closing over it."""
        period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.fiscal_year == fiscal_year,
            AccountingPeriod.period_number == fiscal_period,
        ).with_for_update(read=True).first()

        if period and period.status != "open":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Accounting period {fiscal_year}-{fiscal_period} is {period.status}. Cannot post transactions."
            )

    def _validate_line_accounts(self, lines, entry_type: str) -> None:
        """Every line must hit an existing, active, postable (leaf) account.

        Manual entries may not post to control accounts (receivables, payables,
        inventory): those balances belong to their sub-ledgers and are changed
        only through the source documents."""
        account_ids = {line.account_id for line in lines}
        accounts = {
            a.id: a for a in self.db.query(ChartOfAccounts).filter(
                ChartOfAccounts.id.in_(account_ids)
            ).all()
        }
        missing = account_ids - set(accounts)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Account IDs not found: {sorted(missing)}"
            )
        header_ids = {
            pid for (pid,) in self.db.query(ChartOfAccounts.parent_account_id).filter(
                ChartOfAccounts.parent_account_id.in_(account_ids)
            ).distinct()
        }
        problems = []
        for acc in accounts.values():
            label = f"{acc.account_code} - {acc.account_name}"
            # Year-end closing must zero every P&L account that holds a balance,
            # deactivated or header, so it is exempt from both checks.
            if entry_type == "Closing":
                continue
            if not acc.is_active:
                problems.append(f"account {label} is inactive")
            if acc.id in header_ids:
                problems.append(f"account {label} is a header account; post to one of its sub-accounts")
            if entry_type == "Manual" and acc.account_category in CONTROL_ACCOUNT_CATEGORIES:
                problems.append(
                    f"account {label} is a control account ({acc.account_category}); "
                    f"change it through its source documents"
                )
        if problems:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot use " + "; ".join(sorted(problems)),
            )

    def create_journal_entry(
        self, data: schemas.JournalEntryCreate, created_by: int, commit: bool = True
    ) -> JournalEntry:
        """Create a draft JE. ``commit=False`` only flushes, so a caller can make
        several entries in one transaction (correction, year-end close)."""
        posting_date = data.posting_date or data.entry_date
        fiscal_year, fiscal_period = self._get_fiscal_period(posting_date)

        total_debit = sum(line.debit_amount for line in data.lines)
        total_credit = sum(line.credit_amount for line in data.lines)

        self._validate_line_accounts(data.lines, data.entry_type)

        je = JournalEntry(
            journal_entry_no=self._generate_je_number(),
            entry_date=data.entry_date,
            posting_date=posting_date,
            entry_type=data.entry_type,
            description=data.description,
            total_debit=total_debit,
            total_credit=total_credit,
            status="draft",
            fiscal_year=fiscal_year,
            fiscal_period=fiscal_period,
            branch_code=data.branch_code,
            created_by=created_by,
        )
        self.db.add(je)
        self.db.flush()

        for line_data in data.lines:
            line = JournalEntryLine(
                journal_entry_id=je.id,
                line_number=line_data.line_number,
                account_id=line_data.account_id,
                debit_amount=line_data.debit_amount,
                credit_amount=line_data.credit_amount,
                description=line_data.description,
                reference_type=line_data.reference_type,
                reference_id=line_data.reference_id,
                reference_no=line_data.reference_no,
            )
            self.db.add(line)

        log_audit(
            self.db, user_id=created_by or 0, action="create",
            entity_type="journal_entry", entity_id=je.id,
            changes={"journal_entry_no": je.journal_entry_no, "entry_type": je.entry_type},
        )

        if not commit:
            self.db.flush()
            return je
        self.db.commit()
        self.db.refresh(je)
        _attach_je_user_names(self.db, [je])
        return je

    def update_journal_entry(
        self, je_id: int, data: schemas.JournalEntryUpdate, updated_by: Optional[int] = None
    ) -> JournalEntry:
        je = self.get_journal_entry(je_id)
        if je.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit journal entry in '{je.status}' status"
            )

        changed_fields = set()
        field_values: dict = {}
        if data.entry_date and data.entry_date != je.entry_date:
            field_values["entry_date"] = {"old": je.entry_date.isoformat(), "new": data.entry_date.isoformat()}
            # A posting date that simply followed the entry date keeps following
            # it; the fiscal period always comes from the posting (GL) date.
            if je.posting_date == je.entry_date:
                je.posting_date = data.entry_date
            je.entry_date = data.entry_date
            fiscal_year, fiscal_period = self._get_fiscal_period(je.posting_date)
            je.fiscal_year = fiscal_year
            je.fiscal_period = fiscal_period
            changed_fields.add("entry_date")
        if data.description and data.description != je.description:
            field_values["description"] = {"old": je.description, "new": data.description}
            je.description = data.description
            changed_fields.add("description")
        if data.branch_code is not None and data.branch_code != je.branch_code:
            field_values["branch_code"] = {"old": je.branch_code, "new": data.branch_code}
            je.branch_code = data.branch_code
            changed_fields.add("branch_code")

        if data.lines is not None:
            self._validate_line_accounts(data.lines, je.entry_type)
            changed_fields.add("lines")
            # Replace all lines
            self.db.query(JournalEntryLine).filter(
                JournalEntryLine.journal_entry_id == je_id
            ).delete()

            total_debit = sum(line.debit_amount for line in data.lines)
            total_credit = sum(line.credit_amount for line in data.lines)
            je.total_debit = total_debit
            je.total_credit = total_credit

            for line_data in data.lines:
                line = JournalEntryLine(
                    journal_entry_id=je.id,
                    line_number=line_data.line_number,
                    account_id=line_data.account_id,
                    debit_amount=line_data.debit_amount,
                    credit_amount=line_data.credit_amount,
                    description=line_data.description,
                    reference_type=line_data.reference_type,
                    reference_id=line_data.reference_id,
                    reference_no=line_data.reference_no,
                )
                self.db.add(line)

        if changed_fields:
            log_audit(
                self.db, user_id=updated_by or 0, action="update",
                entity_type="journal_entry", entity_id=je.id,
                changes={"fields": sorted(changed_fields), "values": field_values},
            )

        self.db.commit()
        self.db.refresh(je)
        _attach_je_user_names(self.db, [je])
        return je

    def get_journal_entry(self, je_id: int) -> JournalEntry:
        je = self.db.query(JournalEntry).options(
            joinedload(JournalEntry.lines).joinedload(JournalEntryLine.account)
        ).filter(JournalEntry.id == je_id).first()
        if not je:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Journal entry with id {je_id} not found"
            )
        _attach_je_user_names(self.db, [je])
        return je

    def list_journal_entries(self, filters: schemas.JournalEntryListFilter) -> Tuple[List[JournalEntry], int]:
        query = self.db.query(JournalEntry).options(
            joinedload(JournalEntry.lines).joinedload(JournalEntryLine.account)
        )

        if filters.status:
            query = query.filter(JournalEntry.status == filters.status)
        if filters.entry_type:
            query = query.filter(JournalEntry.entry_type == filters.entry_type)
        if filters.branch_code:
            query = query.filter(JournalEntry.branch_code == filters.branch_code)
        elif filters.branch_codes:
            # Branch-scoped users see their branches plus company-wide (null-branch) entries.
            query = query.filter(or_(
                JournalEntry.branch_code.in_(filters.branch_codes),
                JournalEntry.branch_code.is_(None),
            ))
        if filters.fiscal_year:
            query = query.filter(JournalEntry.fiscal_year == filters.fiscal_year)
        if filters.fiscal_period:
            query = query.filter(JournalEntry.fiscal_period == filters.fiscal_period)
        if filters.date_from:
            query = query.filter(JournalEntry.entry_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(JournalEntry.entry_date <= filters.date_to)
        if filters.search:
            s = f"%{filters.search}%"
            query = query.filter(or_(
                JournalEntry.journal_entry_no.ilike(s),
                JournalEntry.description.ilike(s),
            ))
        if filters.reference_type or filters.reference_id:
            # Drill from a source document (e.g. Purchase Return) to its JEs
            ref_subq = self.db.query(JournalEntryLine.journal_entry_id)
            if filters.reference_type:
                ref_subq = ref_subq.filter(JournalEntryLine.reference_type == filters.reference_type)
            if filters.reference_id is not None:
                ref_subq = ref_subq.filter(JournalEntryLine.reference_id == filters.reference_id)
            query = query.filter(JournalEntry.id.in_(ref_subq.subquery()))

        from app.common.pagination import fast_count
        total = fast_count(query)
        items = query.order_by(JournalEntry.entry_date.desc(), JournalEntry.id.desc()).offset(
            filters.skip
        ).limit(filters.limit).all()

        _attach_je_user_names(self.db, items)
        return items, total

    def post_journal_entry(
        self, je_id: int, posted_by: int, posting_date: Optional[date] = None, commit: bool = True
    ) -> JournalEntry:
        """
        Post a journal entry - creates GL entries and updates account balances (Step 5-6).

        Manual JE: Can only post from 'approved' status (requires approval workflow).
        Auto JE:   Can post from 'draft' status (system-generated, no approval needed).
        ``commit=False`` flushes only; the caller commits (and the running-balance
        refresh is left to it).
        """
        # Lock row to prevent double-post race condition
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        je = self.get_journal_entry(je_id)

        # Only system-generated "Auto" entries (created internally by integrations,
        # never through the public API) may post directly from draft. Every
        # human-facing entry type — Manual, Adjustment, Closing — must go through
        # submit → approve before it can reach the General Ledger.
        if je.entry_type == "Auto":
            allowed_statuses = ["draft", "approved"]
        else:
            allowed_statuses = ["approved"]

        if je.status not in allowed_statuses:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Journal entry must be approved before posting. Current status: '{je.status}'"
            )

        if posting_date:
            je.posting_date = posting_date
            fiscal_year, fiscal_period = self._get_fiscal_period(posting_date)
            je.fiscal_year = fiscal_year
            je.fiscal_period = fiscal_period

        # Validate period is open
        self._validate_period_open(je.fiscal_year, je.fiscal_period)

        # Accounts may have been deactivated (or gained sub-accounts) since the
        # entry was drafted.
        if je.lines:
            self._validate_line_accounts(je.lines, je.entry_type)

        # Defensive double-entry check at the actual posting boundary. Auto
        # entries post straight from draft without going through
        # validate_journal_entry, so this is the last line of defence against
        # writing an unbalanced set of rows into the General Ledger.
        if not je.lines:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Journal entry has no lines to post",
            )
        total_debit = sum((Decimal(str(line.debit_amount or 0)) for line in je.lines), Decimal("0"))
        total_credit = sum((Decimal(str(line.credit_amount or 0)) for line in je.lines), Decimal("0"))
        if total_debit.quantize(Decimal("0.01")) != total_credit.quantize(Decimal("0.01")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Journal entry is not balanced: debits {total_debit} "
                    f"!= credits {total_credit}"
                ),
            )

        # Create GL entries from JE lines
        gl_service = GeneralLedgerService(self.db)
        for line in je.lines:
            gl_service.create_gl_entry(
                transaction_date=je.entry_date,
                posting_date=je.posting_date,
                account_id=line.account_id,
                debit_amount=line.debit_amount,
                credit_amount=line.credit_amount,
                transaction_type=je.entry_type if je.entry_type != "Manual" else "Manual JE",
                reference_type="JE",
                reference_id=je.id,
                reference_no=je.journal_entry_no,
                journal_entry_id=je.id,
                description=line.description or je.description,
                branch_code=je.branch_code,
                fiscal_year=je.fiscal_year,
                fiscal_period=je.fiscal_period,
                created_by=posted_by,
            )

        _cashbook_for_je(self.db, je, je.lines, je.posting_date, je.description, swap=False)

        je.status = "posted"
        je.posted_by = posted_by
        je.posted_at = tz.now()

        log_audit(
            self.db, user_id=posted_by or 0, action="post",
            entity_type="journal_entry", entity_id=je.id,
            changes={"status": "posted"},
        )

        if not commit:
            self.db.flush()
            return je
        self.db.commit()

        # Step 6: Update running balances for affected accounts
        try:
            affected_account_ids = list({line.account_id for line in je.lines})
            gl_service.update_account_balances(affected_account_ids, from_date=je.posting_date)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Balance update warning (non-blocking): {e}")

        self.db.refresh(je)
        return je

    def reverse_journal_entry(
        self, je_id: int, reversed_by: int, reason: str, reversal_date: Optional[date] = None,
        commit: bool = True,
    ) -> JournalEntry:
        """Reverse a posted JE by creating a mirror JE with opposite debits/credits.

        The original keeps its GL rows and becomes status ``reversed``."""
        # Lock row to prevent double-reverse race condition
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        je = self.get_journal_entry(je_id)
        if je.status != "posted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Can only reverse posted journal entries. Current status: '{je.status}'"
            )
        if je.is_reversed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Journal entry has already been reversed"
            )

        rev_date = reversal_date or tz.today()
        if rev_date < je.posting_date:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Reversal date {rev_date} is before the entry's posting date {je.posting_date}",
            )
        fiscal_year, fiscal_period = self._get_fiscal_period(rev_date)
        self._validate_period_open(fiscal_year, fiscal_period)

        # Create reversal JE
        reversal_je = JournalEntry(
            journal_entry_no=self._generate_je_number(),
            entry_date=rev_date,
            posting_date=rev_date,
            entry_type="Adjustment",
            description=f"Reversal of {je.journal_entry_no}: {reason}",
            total_debit=je.total_debit,
            total_credit=je.total_credit,
            status="posted",
            fiscal_year=fiscal_year,
            fiscal_period=fiscal_period,
            branch_code=je.branch_code,
            created_by=reversed_by,
            posted_by=reversed_by,
            posted_at=tz.now(),
        )
        self.db.add(reversal_je)
        self.db.flush()

        # Create reversed lines and GL entries
        gl_service = GeneralLedgerService(self.db)
        for i, line in enumerate(je.lines, 1):
            rev_line = JournalEntryLine(
                journal_entry_id=reversal_je.id,
                line_number=i,
                account_id=line.account_id,
                debit_amount=line.credit_amount,  # Swap!
                credit_amount=line.debit_amount,   # Swap!
                description=f"Reversal: {line.description or ''}",
                reference_type=line.reference_type,
                reference_id=line.reference_id,
                reference_no=line.reference_no,
            )
            self.db.add(rev_line)

            gl_service.create_gl_entry(
                transaction_date=rev_date,
                posting_date=rev_date,
                account_id=line.account_id,
                debit_amount=line.credit_amount,
                credit_amount=line.debit_amount,
                # Undoing a year-end close is itself a closing movement: keep it
                # out of the income statement like the entry it cancels.
                transaction_type="Closing" if je.entry_type == "Closing" else "Adjustment",
                reference_type="JE",
                reference_id=reversal_je.id,
                reference_no=reversal_je.journal_entry_no,
                journal_entry_id=reversal_je.id,
                description=f"Reversal of {je.journal_entry_no}",
                branch_code=je.branch_code,
                fiscal_year=fiscal_year,
                fiscal_period=fiscal_period,
                created_by=reversed_by,
            )

        _cashbook_for_je(self.db, reversal_je, je.lines, rev_date, reversal_je.description, swap=True)

        # Mark original as reversed
        je.status = "reversed"
        je.is_reversed = True
        je.reversed_by_je_id = reversal_je.id

        log_audit(
            self.db, user_id=reversed_by or 0, action="reverse",
            entity_type="journal_entry", entity_id=je.id,
            changes={"reason": reason, "reversal_je_id": reversal_je.id},
        )
        log_audit(
            self.db, user_id=reversed_by or 0, action="create",
            entity_type="journal_entry", entity_id=reversal_je.id,
            changes={"journal_entry_no": reversal_je.journal_entry_no, "reverses_je_id": je.id},
        )

        if not commit:
            self.db.flush()
            return reversal_je
        self.db.commit()

        # Update running balances for affected accounts
        try:
            affected_account_ids = list({line.account_id for line in je.lines})
            gl_service.update_account_balances(affected_account_ids, from_date=rev_date)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Balance update warning (non-blocking): {e}")

        self.db.refresh(reversal_je)
        return reversal_je

    def delete_journal_entry(self, je_id: int, deleted_by: Optional[int] = None) -> bool:
        # Lock row to prevent concurrent status mutation
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        je = self.get_journal_entry(je_id)
        if je.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete journal entry in '{je.status}' status. Only draft entries can be deleted."
            )
        log_audit(
            self.db, user_id=deleted_by or 0, action="delete",
            entity_type="journal_entry", entity_id=je_id,
            changes={"journal_entry_no": je.journal_entry_no},
        )
        self.db.delete(je)
        self.db.commit()
        return True

    # ─────────────────────────────────────────────────────────────────────
    # Scenario 33: Manual JE Validation, Submission & Approval Workflow
    # ─────────────────────────────────────────────────────────────────────

    def validate_journal_entry(self, je_id: int) -> schemas.ValidateJournalEntryResponse:
        """
        Comprehensive validation of a journal entry (Step 3).
        Checks: debit==credit, all accounts active, amounts positive, description provided.
        Also recalculates and updates total_debit/total_credit on the JE header.
        """
        je = self.get_journal_entry(je_id)
        errors = []
        warnings = []

        # 1. Must have at least 2 lines
        if len(je.lines) < 2:
            errors.append(f"Journal entry must have at least 2 lines, found {len(je.lines)}")

        # 2. Calculate totals from lines
        total_debit = sum(Decimal(str(line.debit_amount or 0)) for line in je.lines)
        total_credit = sum(Decimal(str(line.credit_amount or 0)) for line in je.lines)

        # 3. Check debit == credit
        if total_debit != total_credit:
            errors.append(f"Total debits ({total_debit}) must equal total credits ({total_credit})")

        # 4. Check total is non-zero
        if total_debit == 0 and total_credit == 0:
            errors.append("Journal entry total cannot be zero")

        # 5. Validate each line
        for line in je.lines:
            debit = Decimal(str(line.debit_amount or 0))
            credit = Decimal(str(line.credit_amount or 0))

            # Check amounts are non-negative
            if debit < 0:
                errors.append(f"Line {line.line_number}: Debit amount cannot be negative ({debit})")
            if credit < 0:
                errors.append(f"Line {line.line_number}: Credit amount cannot be negative ({credit})")

            # Exactly one of debit/credit per line
            if debit > 0 and credit > 0:
                errors.append(f"Line {line.line_number}: Both debit and credit are set; a line is one or the other.")
            if debit == 0 and credit == 0:
                warnings.append(f"Line {line.line_number}: Both debit and credit are zero - this line has no effect")

            # Check account is active
            if line.account:
                if not line.account.is_active:
                    errors.append(
                        f"Line {line.line_number}: Account '{line.account.account_code} - {line.account.account_name}' is inactive"
                    )
            else:
                errors.append(f"Line {line.line_number}: Account ID {line.account_id} not found")

        # 6. Check description provided
        if not je.description or not je.description.strip():
            errors.append("Journal entry description is required")

        # 7. Update totals on JE header
        if total_debit == total_credit and je.status == "draft":
            je.total_debit = total_debit
            je.total_credit = total_credit
            self.db.commit()

        return schemas.ValidateJournalEntryResponse(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            total_debit=total_debit,
            total_credit=total_credit,
            line_count=len(je.lines),
        )

    def submit_journal_entry(self, je_id: int, submitted_by: int, remarks: Optional[str] = None) -> JournalEntry:
        """
        Submit a draft manual JE for approval (Step 3→4).
        Runs validation first, then moves to 'submitted' status.
        """
        # Lock row to prevent concurrent status mutation
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        je = self.get_journal_entry(je_id)
        if je.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot submit journal entry in '{je.status}' status. Only draft entries can be submitted."
            )

        # Run validation
        validation = self.validate_journal_entry(je_id)
        if not validation.is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Validation failed: {'; '.join(validation.errors)}"
            )

        je.status = "submitted"
        je.submitted_by = submitted_by
        je.submitted_at = tz.now()
        je.rejection_reason = None  # Clear any previous rejection

        if remarks:
            je.description = je.description + f"\n[Submitted] {remarks}"

        log_audit(
            self.db, user_id=submitted_by or 0, action="submit",
            entity_type="journal_entry", entity_id=je.id,
            changes={"status": "submitted"},
        )

        self.db.commit()
        self.db.refresh(je)
        return je

    def approve_journal_entry(self, je_id: int, approved_by: int, remarks: Optional[str] = None) -> JournalEntry:
        """
        Approve a submitted manual JE (Step 4).
        Finance manager verification step. After approval, JE can be posted.
        """
        # Lock row to prevent concurrent status mutation
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        je = self.get_journal_entry(je_id)
        if je.status != "submitted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve journal entry in '{je.status}' status. Only submitted entries can be approved."
            )
        # Maker-checker: the person who prepared or submitted the entry cannot
        # also approve it.
        if approved_by is not None and approved_by in (je.created_by, je.submitted_by):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot approve a journal entry you created or submitted",
            )

        je.status = "approved"
        je.approved_by = approved_by
        je.approved_at = tz.now()

        if remarks:
            je.description = je.description + f"\n[Approved] {remarks}"

        log_audit(
            self.db, user_id=approved_by or 0, action="approve",
            entity_type="journal_entry", entity_id=je.id,
            changes={"status": "approved"},
        )

        self.db.commit()
        self.db.refresh(je)
        return je

    def reject_journal_entry(self, je_id: int, rejected_by: int, reason: str) -> JournalEntry:
        """
        Reject a submitted manual JE back to draft (Step 4 - rejection path).
        Allows the accountant to fix errors and resubmit.
        """
        # Lock row to prevent concurrent status mutation
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        je = self.get_journal_entry(je_id)
        if je.status != "submitted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject journal entry in '{je.status}' status. Only submitted entries can be rejected."
            )

        je.status = "draft"
        je.rejection_reason = reason
        je.submitted_by = None
        je.submitted_at = None

        je.description = je.description + f"\n[Rejected] {reason}"

        log_audit(
            self.db, user_id=rejected_by or 0, action="reject",
            entity_type="journal_entry", entity_id=je.id,
            changes={"reason": reason},
        )

        self.db.commit()
        self.db.refresh(je)
        return je


# =============================================================================
# GENERAL LEDGER SERVICE
# =============================================================================

class GeneralLedgerService:
    def __init__(self, db: Session):
        self.db = db

    def create_gl_entry(
        self,
        transaction_date: date,
        posting_date: date,
        account_id: int,
        debit_amount: Decimal,
        credit_amount: Decimal,
        transaction_type: str,
        reference_type: Optional[str] = None,
        reference_id: Optional[int] = None,
        reference_no: Optional[str] = None,
        journal_entry_id: Optional[int] = None,
        description: Optional[str] = None,
        branch_code: Optional[str] = None,
        fiscal_year: Optional[int] = None,
        fiscal_period: Optional[int] = None,
        created_by: Optional[int] = None,
    ) -> GeneralLedger:
        if not fiscal_year or not fiscal_period:
            fiscal_year = posting_date.year
            fiscal_period = posting_date.month

        gl_entry = GeneralLedger(
            transaction_date=transaction_date,
            posting_date=posting_date,
            account_id=account_id,
            debit_amount=debit_amount,
            credit_amount=credit_amount,
            transaction_type=transaction_type,
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            journal_entry_id=journal_entry_id,
            description=description,
            branch_code=branch_code,
            fiscal_year=fiscal_year,
            fiscal_period=fiscal_period,
            created_by=created_by,
        )
        self.db.add(gl_entry)
        return gl_entry

    def update_account_balances(self, account_ids: List[int], from_date: Optional[date] = None) -> None:
        """
        Recalculate running balances for GL entries on specified accounts (Step 6).
        Updates the 'balance' column on each GL entry based on account normal_balance.

        When ``from_date`` is supplied the walk is seeded from the last entry
        strictly before that date and only entries on/after it are recomputed —
        turning an O(all-history) rewrite on every posting into O(entries in the
        affected date range). Falls back to a full recompute for an account whose
        seed entry has no stored balance yet, so first-ever posts stay correct.
        """
        for account_id in account_ids:
            account = self.db.query(ChartOfAccounts).filter(
                ChartOfAccounts.id == account_id
            ).first()
            if not account:
                continue

            running_balance = Decimal("0")
            effective_from = from_date
            if effective_from is not None:
                prior = self.db.query(GeneralLedger).filter(
                    GeneralLedger.account_id == account_id,
                    GeneralLedger.posting_date < effective_from,
                ).order_by(
                    GeneralLedger.posting_date.desc(), GeneralLedger.id.desc()
                ).first()
                if prior is None or prior.balance is None:
                    # No usable seed — recompute the whole account.
                    effective_from = None
                else:
                    running_balance = Decimal(str(prior.balance))

            entries_q = self.db.query(GeneralLedger).filter(
                GeneralLedger.account_id == account_id
            )
            if effective_from is not None:
                entries_q = entries_q.filter(GeneralLedger.posting_date >= effective_from)
            entries = entries_q.order_by(GeneralLedger.posting_date, GeneralLedger.id).all()

            for entry in entries:
                debit = Decimal(str(entry.debit_amount or 0))
                credit = Decimal(str(entry.credit_amount or 0))

                if account.normal_balance == "Debit":
                    running_balance += debit - credit
                else:
                    running_balance += credit - debit

                entry.balance = running_balance

        self.db.commit()

    def list_gl_entries(self, filters: schemas.GLListFilter) -> Tuple[List[dict], int]:
        """List GL entries with account information."""
        query = self.db.query(
            GeneralLedger,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
            ChartOfAccounts.account_type,
        ).join(
            ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id
        )

        if filters.account_id:
            query = query.filter(GeneralLedger.account_id == filters.account_id)
        if filters.account_code:
            query = query.filter(ChartOfAccounts.account_code == filters.account_code)
        if filters.account_type:
            query = query.filter(ChartOfAccounts.account_type == filters.account_type)
        if filters.transaction_type:
            query = query.filter(GeneralLedger.transaction_type == filters.transaction_type)
        if filters.branch_code:
            query = query.filter(GeneralLedger.branch_code == filters.branch_code)
        elif filters.branch_codes:
            query = query.filter(or_(
                GeneralLedger.branch_code.in_(filters.branch_codes),
                GeneralLedger.branch_code.is_(None),
            ))
        if filters.fiscal_year:
            query = query.filter(GeneralLedger.fiscal_year == filters.fiscal_year)
        if filters.fiscal_period:
            query = query.filter(GeneralLedger.fiscal_period == filters.fiscal_period)
        if filters.date_from:
            query = query.filter(GeneralLedger.posting_date >= filters.date_from)
        if filters.date_to:
            query = query.filter(GeneralLedger.posting_date <= filters.date_to)
        if filters.reference_type:
            query = query.filter(GeneralLedger.reference_type == filters.reference_type)
        if filters.reference_no:
            query = query.filter(GeneralLedger.reference_no.ilike(f"%{filters.reference_no}%"))
        if filters.search:
            s = f"%{filters.search}%"
            query = query.filter(or_(
                GeneralLedger.description.ilike(s),
                GeneralLedger.reference_no.ilike(s),
                ChartOfAccounts.account_name.ilike(s),
                ChartOfAccounts.account_code.ilike(s),
            ))

        from app.common.pagination import fast_count
        total = fast_count(query)
        rows = query.order_by(
            GeneralLedger.posting_date.desc(),
            GeneralLedger.id.desc()
        ).offset(filters.skip).limit(filters.limit).all()

        results = []
        for gl, acc_code, acc_name, acc_type in rows:
            results.append({
                "id": gl.id,
                "transaction_date": gl.transaction_date,
                "posting_date": gl.posting_date,
                "account_id": gl.account_id,
                "debit_amount": gl.debit_amount,
                "credit_amount": gl.credit_amount,
                "balance": gl.balance,
                "transaction_type": gl.transaction_type,
                "reference_type": gl.reference_type,
                "reference_id": gl.reference_id,
                "reference_no": gl.reference_no,
                "journal_entry_id": gl.journal_entry_id,
                "description": gl.description,
                "branch_code": gl.branch_code,
                "fiscal_year": gl.fiscal_year,
                "fiscal_period": gl.fiscal_period,
                "created_by": gl.created_by,
                "created_at": gl.created_at,
                "account_code": acc_code,
                "account_name": acc_name,
                "account_type": acc_type,
            })

        return results, total

    @_high_precision
    def get_trial_balance(
        self,
        fiscal_year: int,
        fiscal_period: Optional[int] = None,
        as_of_date: Optional[date] = None,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
    ) -> schemas.TrialBalanceResponse:
        """Generate trial balance report (optionally for one branch / a branch scope).

        The branch is the posting's branch (general_ledger.branch_code, copied
        from journal_entries.branch_code when the JE posts).

        Balance-sheet accounts (Asset/Liability/Equity) are cumulative: they carry
        every prior year's postings. Revenue/Expense accounts show the selected
        year only; any prior-year profit that was never closed into equity is
        shown on a separate retained-earnings line so the TB still balances."""
        in_year = GeneralLedger.fiscal_year == fiscal_year
        if fiscal_period:
            in_year = and_(in_year, GeneralLedger.fiscal_period <= fiscal_period)
        query = self.db.query(
            GeneralLedger.account_id,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
            ChartOfAccounts.account_type,
            ChartOfAccounts.normal_balance,
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0).label("total_debit"),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0).label("total_credit"),
        ).join(
            ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id
        ).filter(
            or_(
                in_year,
                and_(
                    GeneralLedger.fiscal_year < fiscal_year,
                    ChartOfAccounts.account_type.in_(BALANCE_SHEET_TYPES),
                ),
            )
        )

        if as_of_date:
            query = query.filter(GeneralLedger.posting_date <= as_of_date)
        for crit in _branch_criteria(GeneralLedger.branch_code, branch_code, branch_codes):
            query = query.filter(crit)

        # Prior-year Revenue/Expense never closed into equity (no year-end close
        # run): it belongs in retained earnings on this year's TB.
        prior_pl = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
        ).join(
            ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id
        ).filter(
            GeneralLedger.fiscal_year < fiscal_year,
            ChartOfAccounts.account_type.in_(PROFIT_AND_LOSS_TYPES),
            *([GeneralLedger.posting_date <= as_of_date] if as_of_date else []),
            *_branch_criteria(GeneralLedger.branch_code, branch_code, branch_codes),
        ).first()

        query = query.group_by(
            GeneralLedger.account_id,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
            ChartOfAccounts.account_type,
            ChartOfAccounts.normal_balance,
        ).order_by(ChartOfAccounts.account_code)

        rows = query.all()

        accounts = []
        total_debit = Decimal("0")
        total_credit = Decimal("0")

        for row in rows:
            debit = Decimal(str(row.total_debit))
            credit = Decimal(str(row.total_credit))
            net = debit - credit

            accounts.append(schemas.GLAccountSummary(
                account_id=row.account_id,
                account_code=row.account_code,
                account_name=row.account_name,
                account_type=row.account_type,
                normal_balance=row.normal_balance,
                total_debit=debit,
                total_credit=credit,
                net_balance=net,
            ))
            total_debit += debit
            total_credit += credit

        prior_debit = Decimal(str(prior_pl[0])) if prior_pl else Decimal("0")
        prior_credit = Decimal(str(prior_pl[1])) if prior_pl else Decimal("0")
        if prior_debit != prior_credit:
            retained = self.db.query(ChartOfAccounts).filter(
                ChartOfAccounts.account_code == RETAINED_EARNINGS_CODE
            ).first()
            accounts.append(schemas.GLAccountSummary(
                account_id=retained.id if retained else 0,
                account_code=RETAINED_EARNINGS_CODE,
                account_name="Retained Earnings (prior-year profit not closed)",
                account_type="Equity",
                normal_balance="Credit",
                total_debit=prior_debit,
                total_credit=prior_credit,
                net_balance=prior_debit - prior_credit,
            ))
            total_debit += prior_debit
            total_credit += prior_credit

        return schemas.TrialBalanceResponse(
            as_of_date=as_of_date or tz.today(),
            fiscal_year=fiscal_year,
            fiscal_period=fiscal_period,
            accounts=accounts,
            total_debit=_cents(total_debit),
            total_credit=_cents(total_credit),
        )

    def get_account_ledger(
        self,
        account_id: int,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
    ) -> List[dict]:
        """Get all GL entries for a specific account with running balance.

        Dates are GL (posting) dates. When ``date_from`` is given, the running
        balance starts from the account's balance before that date, shown as an
        opening-balance row."""
        query = self.db.query(GeneralLedger).filter(
            GeneralLedger.account_id == account_id
        )
        if date_from:
            query = query.filter(GeneralLedger.posting_date >= date_from)
        if date_to:
            query = query.filter(GeneralLedger.posting_date <= date_to)

        entries = query.order_by(GeneralLedger.posting_date, GeneralLedger.id).all()

        # Get account normal balance
        account = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.id == account_id
        ).first()
        debit_normal = bool(account and account.normal_balance == "Debit")

        running_balance = Decimal("0")
        results = []
        if date_from:
            opening = self.db.query(
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
                func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
            ).filter(
                GeneralLedger.account_id == account_id,
                GeneralLedger.posting_date < date_from,
            ).first()
            o_debit, o_credit = Decimal(str(opening[0])), Decimal(str(opening[1]))
            running_balance = (o_debit - o_credit) if debit_normal else (o_credit - o_debit)
            results.append({
                "id": 0,
                "transaction_date": date_from,
                "posting_date": date_from,
                "debit_amount": Decimal("0"),
                "credit_amount": Decimal("0"),
                "running_balance": running_balance,
                "transaction_type": "Opening Balance",
                "reference_type": None,
                "reference_no": None,
                "description": "Opening balance",
                "branch_code": None,
            })
        for entry in entries:
            if debit_normal:
                running_balance += (entry.debit_amount or Decimal("0")) - (entry.credit_amount or Decimal("0"))
            else:
                running_balance += (entry.credit_amount or Decimal("0")) - (entry.debit_amount or Decimal("0"))

            results.append({
                "id": entry.id,
                "transaction_date": entry.transaction_date,
                "posting_date": entry.posting_date,
                "debit_amount": entry.debit_amount,
                "credit_amount": entry.credit_amount,
                "running_balance": running_balance,
                "transaction_type": entry.transaction_type,
                "reference_type": entry.reference_type,
                "reference_no": entry.reference_no,
                "description": entry.description,
                "branch_code": entry.branch_code,
            })

        return results

    # ─────────────────────────────────────────────────────────────────────
    # Scenario 34: Income Statement & Balance Sheet
    # ─────────────────────────────────────────────────────────────────────

    def _gl_sums_by_account(self, key, criteria) -> Dict[int, Tuple[Decimal, Decimal]]:
        """Total debit/credit per account for the given GL criteria, scanned once.

        Report sections (revenue, cost of sales, expenses, assets ...) all read the same
        ledger slice; aggregating it once per request and sharing the result replaces one
        full-ledger scan per section. Memoised on this service instance (one per request).
        """
        memo = self.__dict__.setdefault("_gl_sums_memo", {})
        if key not in memo:
            rows = self.db.query(
                GeneralLedger.account_id,
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
                func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
            ).filter(*criteria).group_by(GeneralLedger.account_id).all()
            memo[key] = {r[0]: (Decimal(str(r[1])), Decimal(str(r[2]))) for r in rows}
        return memo[key]

    def _sum_accounts_by_type(
        self,
        account_type: str,
        fiscal_year: int,
        fiscal_period: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        category_filter: Optional[str] = None,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
    ) -> Tuple[List[schemas.IncomeStatementLineItem], Decimal]:
        """Sum GL entries for accounts of a given type, returning line items and total."""
        sums = self._gl_sums_by_account(
            ("is", fiscal_year, fiscal_period, date_from, date_to, branch_code, tuple(branch_codes or ())),
            [
                GeneralLedger.fiscal_year == fiscal_year,
                *([GeneralLedger.fiscal_period <= fiscal_period] if fiscal_period else []),
                *([GeneralLedger.posting_date >= date_from] if date_from else []),
                *([GeneralLedger.posting_date <= date_to] if date_to else []),
                *_branch_criteria(GeneralLedger.branch_code, branch_code, branch_codes),
                # Year-end closing entries zero the P&L accounts; the statement
                # reports the trading result, so they never count here.
                _not_closing(GeneralLedger.transaction_type),
            ],
        )
        # Inactive accounts are included: an account deactivated after it was
        # posted to still carries real income/expense (zero rows are skipped).
        query = self.db.query(
            ChartOfAccounts.id,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
            ChartOfAccounts.normal_balance,
        ).filter(
            ChartOfAccounts.account_type == account_type,
        )

        if category_filter:
            query = query.filter(ChartOfAccounts.account_category == category_filter)

        query = query.order_by(ChartOfAccounts.account_code)

        rows = query.all()
        items = []
        total = Decimal("0")
        for row in rows:
            debit, credit = sums.get(row.id, (Decimal("0"), Decimal("0")))
            # Sign by the SECTION (account type), not the account's own normal
            # balance: contra accounts (4030 Sales Returns, debit-normal
            # Revenue) must reduce revenue and contra-expenses must reduce
            # expenses, never add to them.
            if account_type == "Revenue":
                amount = credit - debit
            else:
                amount = debit - credit
            if amount != 0:
                items.append(schemas.IncomeStatementLineItem(
                    account_id=row.id,
                    account_code=row.account_code,
                    account_name=row.account_name,
                    amount=amount,
                ))
                total += amount

        return items, total

    @_high_precision
    def get_income_statement(
        self,
        fiscal_year: int,
        fiscal_period: Optional[int] = None,
        date_from: Optional[date] = None,
        date_to: Optional[date] = None,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
    ) -> schemas.IncomeStatementResponse:
        """
        Generate Income Statement (Profit & Loss).
        Revenue (4000s) - Cost of Sales (5100s) = Gross Profit
        Gross Profit - Operating Expenses (5xxx) = Operating Income
        Operating Income + Other Income - Other Expenses = Net Income
        """
        self.__dict__.pop("_gl_sums_memo", None)  # fresh read per report
        # Determine period dates
        period_start = date_from
        period_end = date_to
        if not period_start and not period_end:
            # Amounts are year-to-date (periods 1..N, or the whole year), so the
            # label runs from the first period's start to period N's end.
            periods = self.db.query(AccountingPeriod).filter(
                AccountingPeriod.fiscal_year == fiscal_year,
                *([AccountingPeriod.period_number <= fiscal_period] if fiscal_period else []),
            ).order_by(AccountingPeriod.period_number).all()
            if periods:
                period_start = periods[0].start_date
                period_end = periods[-1].end_date

        # Every section uses the same branch scope.
        _bs = {"branch_code": branch_code, "branch_codes": branch_codes}

        # Revenue accounts (type=Revenue)
        rev_items, rev_total = self._sum_accounts_by_type(
            "Revenue", fiscal_year, fiscal_period, date_from, date_to, **_bs
        )

        # Cost of Sales (Expense accounts with category "Cost of Sales" or code starts with 510)
        cos_items, cos_total = self._sum_accounts_by_type(
            "Expense", fiscal_year, fiscal_period, date_from, date_to,
            category_filter="Cost of Sales", **_bs,
        )
        # The chart categorises COGS accounts as "COGS"
        if not cos_items:
            cos_items, cos_total = self._sum_accounts_by_type(
                "Expense", fiscal_year, fiscal_period, date_from, date_to,
                category_filter="COGS", **_bs,
            )
        # If none found by category, try by account code pattern
        if not cos_items:
            all_exp_items, _ = self._sum_accounts_by_type(
                "Expense", fiscal_year, fiscal_period, date_from, date_to, **_bs
            )
            cos_items = [i for i in all_exp_items if i.account_code.startswith("510")]
            cos_total = sum(i.amount for i in cos_items)

        gross_profit = rev_total - cos_total

        # Operating Expenses (all Expense minus Cost of Sales)
        all_exp_items, all_exp_total = self._sum_accounts_by_type(
            "Expense", fiscal_year, fiscal_period, date_from, date_to, **_bs
        )
        cos_ids = {i.account_id for i in cos_items}
        opex_items = [i for i in all_exp_items if i.account_id not in cos_ids]
        opex_total = sum(i.amount for i in opex_items)

        operating_income = gross_profit - opex_total

        # Other Income: Revenue accounts with category "Other Income"
        other_inc_items, other_inc_total = self._sum_accounts_by_type(
            "Revenue", fiscal_year, fiscal_period, date_from, date_to,
            category_filter="Other Income", **_bs,
        )
        # If found, remove them from main revenue to avoid double-counting
        if other_inc_items:
            other_inc_ids = {i.account_id for i in other_inc_items}
            rev_items = [i for i in rev_items if i.account_id not in other_inc_ids]
            rev_total = sum(i.amount for i in rev_items)
            gross_profit = rev_total - cos_total
            operating_income = gross_profit - opex_total

        # Other Expenses: Expense accounts with category "Other Expense"
        other_exp_items, other_exp_total = self._sum_accounts_by_type(
            "Expense", fiscal_year, fiscal_period, date_from, date_to,
            category_filter="Other Expense", **_bs,
        )
        # If found, remove them from operating expenses to avoid double-counting
        if other_exp_items:
            other_exp_ids = {i.account_id for i in other_exp_items}
            opex_items = [i for i in opex_items if i.account_id not in other_exp_ids]
            opex_total = sum(i.amount for i in opex_items)
            operating_income = gross_profit - opex_total

        net_income = operating_income + other_inc_total - other_exp_total

        return schemas.IncomeStatementResponse(
            fiscal_year=fiscal_year,
            fiscal_period=fiscal_period,
            period_start=period_start,
            period_end=period_end,
            revenue=schemas.IncomeStatementSection(
                section_name="Revenue",
                items=rev_items,
                total=_cents(rev_total),
            ),
            cost_of_sales=schemas.IncomeStatementSection(
                section_name="Cost of Sales",
                items=cos_items,
                total=_cents(cos_total),
            ),
            gross_profit=_cents(gross_profit),
            operating_expenses=schemas.IncomeStatementSection(
                section_name="Operating Expenses",
                items=opex_items,
                total=_cents(opex_total),
            ),
            operating_income=_cents(operating_income),
            other_income=schemas.IncomeStatementSection(
                section_name="Other Income",
                items=other_inc_items,
                total=_cents(other_inc_total),
            ),
            other_expenses=schemas.IncomeStatementSection(
                section_name="Other Expenses",
                items=other_exp_items,
                total=_cents(other_exp_total),
            ),
            net_income=_cents(net_income),
            generated_at=tz.now(),
        )

    @_high_precision
    def get_balance_sheet(
        self,
        fiscal_year: int,
        as_of_date: Optional[date] = None,
        branch_code: Optional[str] = None,
        branch_codes: Optional[List[str]] = None,
    ) -> schemas.BalanceSheetResponse:
        """
        Generate Balance Sheet (Statement of Financial Position).
        Assets = Liabilities + Equity
        Includes current-year net income in equity section.
        """
        self.__dict__.pop("_gl_sums_memo", None)  # fresh read per report
        report_date = as_of_date or tz.today()
        bs_sums = self._gl_sums_by_account(
            ("bs", report_date, branch_code, tuple(branch_codes or ())),
            [
                GeneralLedger.posting_date <= report_date,
                *_branch_criteria(GeneralLedger.branch_code, branch_code, branch_codes),
            ],
        )

        def _build_section(
            section_name: str,
            account_type: str,
            category_filter: Optional[str] = None,
            exclude_categories: Optional[List[str]] = None,
            include_categories: Optional[List[str]] = None,
        ) -> schemas.BalanceSheetSection:
            """Build a balance sheet section from GL data up to as_of_date."""
            query = self.db.query(
                ChartOfAccounts.id,
                ChartOfAccounts.account_code,
                ChartOfAccounts.account_name,
                ChartOfAccounts.normal_balance,
                ChartOfAccounts.account_category,
                ChartOfAccounts.is_active,
            ).filter(
                ChartOfAccounts.account_type == account_type,
            )

            if category_filter:
                query = query.filter(ChartOfAccounts.account_category == category_filter)
            if include_categories:
                query = query.filter(ChartOfAccounts.account_category.in_(include_categories))
            if exclude_categories:
                # NULL-safe: SQL ``NOT IN`` is NULL for a NULL category, which
                # would drop uncategorised accounts from every section.
                query = query.filter(or_(
                    ChartOfAccounts.account_category.is_(None),
                    ~ChartOfAccounts.account_category.in_(exclude_categories),
                ))

            query = query.order_by(ChartOfAccounts.account_code)

            rows = query.all()
            items = []
            section_total = Decimal("0")
            for row in rows:
                d, c = bs_sums.get(row.id, (Decimal("0"), Decimal("0")))
                # Sign by account type (assets debit - credit, everything else
                # credit - debit) so contra accounts (e.g. accumulated
                # depreciation) reduce their section.
                if account_type == "Asset":
                    amt = d - c
                else:
                    amt = c - d
                if amt == 0 and not row.is_active:
                    continue
                items.append(schemas.IncomeStatementLineItem(
                    account_id=row.id,
                    account_code=row.account_code,
                    account_name=row.account_name,
                    amount=amt,
                ))
                section_total += amt

            return schemas.BalanceSheetSection(
                section_name=section_name,
                items=items,
                total=_cents(section_total),
            )

        # Non-current categories; EVERY other Asset/Liability account (Cash,
        # Bank, Receivable, Inventory, Payable, Tax, Customer ...) is current.
        nc_asset_cats = ["Fixed Asset", "Non-Current Asset", "Intangible Asset", "Other Asset"]
        nc_liab_cats = ["Long-term", "Long-term Liability", "Non-Current Liability", "Other Liability"]

        current_assets = _build_section("Current Assets", "Asset", exclude_categories=nc_asset_cats)
        non_current_assets = _build_section("Non-Current Assets", "Asset", include_categories=nc_asset_cats)
        total_assets = current_assets.total + non_current_assets.total

        current_liabilities = _build_section("Current Liabilities", "Liability", exclude_categories=nc_liab_cats)
        non_current_liabilities = _build_section("Non-Current Liabilities", "Liability", include_categories=nc_liab_cats)
        total_liabilities = current_liabilities.total + non_current_liabilities.total

        equity_section = _build_section("Equity", "Equity")

        # Earnings not yet closed into equity: sum of every Revenue (credit -
        # debit) and Expense (credit - debit, i.e. minus expense) account up to
        # the report date, all years. Closing entries zero these accounts, so
        # this is exact whether or not a year-end close was run.
        pl = self.db.query(
            ChartOfAccounts.account_type,
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
        ).join(
            GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id
        ).filter(
            ChartOfAccounts.account_type.in_(["Revenue", "Expense"]),
            GeneralLedger.posting_date <= report_date,
            *_branch_criteria(GeneralLedger.branch_code, branch_code, branch_codes),
        ).group_by(ChartOfAccounts.account_type).all()
        earnings = sum(
            (Decimal(str(c)) - Decimal(str(d))) for _t, c, d in pl
        ) if pl else Decimal("0")
        if earnings != 0:
            equity_section.items.append(schemas.IncomeStatementLineItem(
                account_id=0,
                account_code="----",
                account_name="Current Year Net Income (unposted)",
                amount=earnings,
            ))
            equity_section.total += earnings

        equity_section.total = _cents(equity_section.total)
        total_assets = _cents(total_assets)
        total_liabilities = _cents(total_liabilities)
        total_equity = equity_section.total
        total_le = _cents(total_liabilities + total_equity)
        is_balanced = total_assets == total_le

        return schemas.BalanceSheetResponse(
            as_of_date=report_date,
            fiscal_year=fiscal_year,
            current_assets=current_assets,
            non_current_assets=non_current_assets,
            total_assets=total_assets,
            current_liabilities=current_liabilities,
            non_current_liabilities=non_current_liabilities,
            total_liabilities=total_liabilities,
            equity=equity_section,
            total_equity=total_equity,
            total_liabilities_and_equity=total_le,
            is_balanced=is_balanced,
            generated_at=tz.now(),
        )

    # ─────────────────────────────────────────────────────────────────────
    # Scenario 35: Audit Trail & Correction
    # ─────────────────────────────────────────────────────────────────────

    def get_audit_trail(
        self, filters: schemas.AuditTrailFilter
    ) -> schemas.AuditTrailResponse:
        """
        Query full audit trail across JE and GL entries.
        Returns a unified, time-ordered view of all accounting activities.
        """
        # Never materialise the whole ledger: the requested page lies within the top
        # (skip + limit) rows of each source, so fetch only that many from each, merge,
        # and build response objects for the final page only. Totals come from COUNT(*).
        window = filters.skip + filters.limit
        candidates = []  # (entry_date, created_at, source_rank, position, kind, row)
        total = 0

        # ── Part A: Journal Entries ──
        if not filters.entry_type or filters.entry_type == "JE":
            je_query = self.db.query(JournalEntry)
            if filters.date_from:
                je_query = je_query.filter(JournalEntry.entry_date >= filters.date_from)
            if filters.date_to:
                je_query = je_query.filter(JournalEntry.entry_date <= filters.date_to)
            if filters.transaction_type:
                je_query = je_query.filter(JournalEntry.entry_type == filters.transaction_type)
            if filters.created_by:
                je_query = je_query.filter(JournalEntry.created_by == filters.created_by)
            if not filters.include_reversed:
                je_query = je_query.filter(JournalEntry.is_reversed == False)
            if filters.search:
                s = f"%{filters.search}%"
                je_query = je_query.filter(or_(
                    JournalEntry.journal_entry_no.ilike(s),
                    JournalEntry.description.ilike(s),
                ))

            total += je_query.order_by(None).with_entities(func.count(JournalEntry.id)).scalar() or 0
            je_rows = je_query.order_by(
                JournalEntry.entry_date.desc(),
                JournalEntry.created_at.desc().nullslast(),
                JournalEntry.id.desc(),
            ).limit(window).all()
            for pos, je in enumerate(je_rows):
                candidates.append((je.entry_date, je.created_at or datetime.min, 0, pos, "JE", je))

        # ── Part B: GL Entries ──
        if not filters.entry_type or filters.entry_type == "GL":
            gl_query = self.db.query(
                GeneralLedger,
                ChartOfAccounts.account_code,
                ChartOfAccounts.account_name,
            ).join(
                ChartOfAccounts, GeneralLedger.account_id == ChartOfAccounts.id
            )
            if filters.date_from:
                gl_query = gl_query.filter(GeneralLedger.posting_date >= filters.date_from)
            if filters.date_to:
                gl_query = gl_query.filter(GeneralLedger.posting_date <= filters.date_to)
            if filters.account_id:
                gl_query = gl_query.filter(GeneralLedger.account_id == filters.account_id)
            if filters.account_code:
                gl_query = gl_query.filter(ChartOfAccounts.account_code == filters.account_code)
            if filters.transaction_type:
                gl_query = gl_query.filter(GeneralLedger.transaction_type == filters.transaction_type)
            if filters.created_by:
                gl_query = gl_query.filter(GeneralLedger.created_by == filters.created_by)
            if filters.search:
                s = f"%{filters.search}%"
                gl_query = gl_query.filter(or_(
                    GeneralLedger.description.ilike(s),
                    GeneralLedger.reference_no.ilike(s),
                    ChartOfAccounts.account_name.ilike(s),
                ))

            total += gl_query.order_by(None).with_entities(func.count(GeneralLedger.id)).scalar() or 0
            gl_rows = gl_query.order_by(
                GeneralLedger.transaction_date.desc(),
                GeneralLedger.created_at.desc().nullslast(),
                GeneralLedger.id.desc(),
            ).limit(window).all()
            for pos, (gl, acc_code, acc_name) in enumerate(gl_rows):
                candidates.append((gl.transaction_date, gl.created_at or datetime.min, 1, pos, "GL", (gl, acc_code, acc_name)))

        # Date desc, then created_at desc; ties keep JE-before-GL, then per-source order.
        candidates.sort(key=lambda c: (c[0], c[1], -c[2], -c[3]), reverse=True)

        items = []
        for _d, _c, _rank, _pos, kind, row in candidates[filters.skip : filters.skip + filters.limit]:
            if kind == "JE":
                je = row
                items.append(schemas.AuditTrailEntry(
                    id=je.id,
                    entry_type="JE",
                    entry_no=je.journal_entry_no,
                    entry_date=je.entry_date,
                    posting_date=je.posting_date,
                    description=je.description,
                    debit_amount=je.total_debit or Decimal("0"),
                    credit_amount=je.total_credit or Decimal("0"),
                    status=je.status,
                    transaction_type=je.entry_type,
                    is_reversed=je.is_reversed or False,
                    reversed_by_je_id=je.reversed_by_je_id,
                    created_by=je.created_by,
                    created_at=je.created_at,
                    posted_by=je.posted_by,
                    posted_at=je.posted_at,
                ))
            else:
                gl, acc_code, acc_name = row
                items.append(schemas.AuditTrailEntry(
                    id=gl.id,
                    entry_type="GL",
                    entry_no=gl.reference_no,
                    entry_date=gl.transaction_date,
                    posting_date=gl.posting_date,
                    description=gl.description,
                    account_code=acc_code,
                    account_name=acc_name,
                    debit_amount=gl.debit_amount or Decimal("0"),
                    credit_amount=gl.credit_amount or Decimal("0"),
                    transaction_type=gl.transaction_type,
                    reference_type=gl.reference_type,
                    reference_no=gl.reference_no,
                    created_by=gl.created_by,
                    created_at=gl.created_at,
                ))

        return schemas.AuditTrailResponse(
            items=items,
            total=total,
            date_from=filters.date_from,
            date_to=filters.date_to,
        )

    def correct_journal_entry(
        self, je_id: int, data: schemas.CorrectionRequest, corrected_by: int
    ) -> schemas.CorrectionResponse:
        """
        Correction workflow: reverse the original posted JE and create a new correct entry.
        Atomic operation — both the reversal and correction are created together.
        """
        je_service = JournalEntryService(self.db)

        # Step 1: Lock and fetch the original — prevents concurrent correction
        self.db.query(JournalEntry).filter(JournalEntry.id == je_id).with_for_update().first()
        original_je = je_service.get_journal_entry(je_id)
        if original_je.status != "posted":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Can only correct posted journal entries. Current status: '{original_je.status}'"
            )
        if original_je.is_reversed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Journal entry has already been reversed"
            )

        correction_date = data.correction_date or tz.today()

        # One transaction: either the original is reversed AND the corrected
        # entry is posted, or nothing changes (no reversed original left behind
        # with a stray draft when the corrected lines are rejected).
        savepoint = self.db.begin_nested()
        try:
            reversal_je = je_service.reverse_journal_entry(
                je_id=je_id,
                reversed_by=corrected_by,
                reason=f"Correction: {data.reason}",
                reversal_date=correction_date,
                commit=False,
            )

            # Step 2: Create and post the corrected JE. The endpoint requires
            # approver rights, so the correction is approved by its author.
            corrected_je = je_service.create_journal_entry(
                schemas.JournalEntryCreate(
                    entry_date=correction_date,
                    posting_date=correction_date,
                    entry_type="Adjustment",
                    description=data.description or f"Correction of {original_je.journal_entry_no}: {data.reason}",
                    branch_code=original_je.branch_code,
                    lines=data.corrected_lines,
                ),
                created_by=corrected_by,
                commit=False,
            )
            corrected_je.status = "approved"
            corrected_je.approved_by = corrected_by
            corrected_je.approved_at = tz.now()
            self.db.flush()
            corrected_je = je_service.post_journal_entry(
                corrected_je.id, posted_by=corrected_by, commit=False
            )
        except Exception:
            savepoint.rollback()
            raise
        savepoint.commit()
        self.db.commit()
        _refresh_balances(self.db, [*original_je.lines, *corrected_je.lines], correction_date)

        return schemas.CorrectionResponse(
            original_je_id=original_je.id,
            original_je_no=original_je.journal_entry_no,
            reversal_je_id=reversal_je.id,
            reversal_je_no=reversal_je.journal_entry_no,
            correction_je_id=corrected_je.id,
            correction_je_no=corrected_je.journal_entry_no,
            message=f"Correction complete: Original {original_je.journal_entry_no} reversed, "
                    f"correction {corrected_je.journal_entry_no} posted.",
        )


# =============================================================================
# ACCOUNTING PERIOD SERVICE
# =============================================================================

class AccountingPeriodService:
    def __init__(self, db: Session):
        self.db = db

    def generate_periods(self, data: schemas.GeneratePeriodsRequest) -> List[AccountingPeriod]:
        """Generate 12 monthly periods for a fiscal year."""
        import calendar

        existing = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.fiscal_year == data.fiscal_year
        ).count()
        if existing > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Accounting periods for fiscal year {data.fiscal_year} already exist"
            )

        months = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ]

        periods = []
        for i in range(12):
            month_index = ((data.start_month - 1 + i) % 12)
            year = data.fiscal_year if month_index >= data.start_month - 1 else data.fiscal_year + 1
            month_num = month_index + 1
            _, last_day = calendar.monthrange(year, month_num)

            period = AccountingPeriod(
                fiscal_year=data.fiscal_year,
                period_number=i + 1,
                period_name=f"{months[month_index]} {year}",
                start_date=date(year, month_num, 1),
                end_date=date(year, month_num, last_day),
                status="open",
            )
            self.db.add(period)
            periods.append(period)

        self.db.commit()
        for p in periods:
            self.db.refresh(p)
        return periods

    def list_periods(self, filters: schemas.AccountingPeriodListFilter) -> List[AccountingPeriod]:
        query = self.db.query(AccountingPeriod)
        if filters.fiscal_year:
            query = query.filter(AccountingPeriod.fiscal_year == filters.fiscal_year)
        if filters.status:
            query = query.filter(AccountingPeriod.status == filters.status)
        return query.order_by(AccountingPeriod.fiscal_year.desc(), AccountingPeriod.period_number).all()

    def get_period(self, period_id: int) -> AccountingPeriod:
        period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.id == period_id
        ).first()
        if not period:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Accounting period with id {period_id} not found"
            )
        return period

    def close_period(self, period_id: int, closed_by: int, force: bool = False) -> AccountingPeriod:
        # Lock row to prevent concurrent status mutation
        self.db.query(AccountingPeriod).filter(AccountingPeriod.id == period_id).with_for_update().first()
        period = self.get_period(period_id)
        if period.status != "open":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Period is already '{period.status}'"
            )

        # Pre-close reconciliation: never close over unposted JEs or an unbalanced
        # GL — this is what makes a closed period trustworthy. ``force`` allows an
        # explicit admin override.
        if not force:
            recon = self.run_reconciliation_check(period.fiscal_year, period.period_number)
            if not recon.is_ready_to_close:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Cannot close period — reconciliation failed: " + "; ".join(recon.errors),
                )

        period.status = "closed"
        period.closed_by = closed_by
        period.closed_at = tz.now()
        log_audit(
            self.db, user_id=closed_by or 0, action="close",
            entity_type="accounting_period", entity_id=period.id,
            changes={"status": "closed", "fiscal_year": period.fiscal_year, "period_number": period.period_number},
        )
        self.db.commit()
        self.db.refresh(period)
        return period

    def reopen_period(self, period_id: int, reopened_by: int = None) -> AccountingPeriod:
        # Lock row to prevent concurrent status mutation
        self.db.query(AccountingPeriod).filter(AccountingPeriod.id == period_id).with_for_update().first()
        period = self.get_period(period_id)
        if period.status == "locked":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot reopen a locked period"
            )
        log_audit(
            self.db, user_id=reopened_by or 0, action="reopen",
            entity_type="accounting_period", entity_id=period.id,
            changes={"status": "open", "previous_closed_by": period.closed_by, "fiscal_year": period.fiscal_year, "period_number": period.period_number},
        )
        period.status = "open"
        period.closed_by = None
        period.closed_at = None
        self.db.commit()
        self.db.refresh(period)
        return period

    def lock_period(self, period_id: int, locked_by: int = None) -> AccountingPeriod:
        # Lock row to prevent concurrent status mutation
        self.db.query(AccountingPeriod).filter(AccountingPeriod.id == period_id).with_for_update().first()
        period = self.get_period(period_id)
        if period.status != "closed":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Period must be closed before locking"
            )
        period.status = "locked"
        log_audit(
            self.db, user_id=locked_by or 0, action="lock",
            entity_type="accounting_period", entity_id=period.id,
            changes={"status": "locked", "fiscal_year": period.fiscal_year, "period_number": period.period_number},
        )
        self.db.commit()
        self.db.refresh(period)
        return period

    # ─────────────────────────────────────────────────────────────────────
    # Scenario 34: Reconciliation Check & Year-End Closing
    # ─────────────────────────────────────────────────────────────────────

    @_high_precision
    def run_reconciliation_check(
        self, fiscal_year: int, fiscal_period: int
    ) -> schemas.ReconciliationCheckResponse:
        """
        Pre-close reconciliation: verifies all JEs are posted and debits == credits
        for a given fiscal year/period.
        """
        errors = []
        warnings = []

        # 1. Check for unposted JEs in this period
        unposted = self.db.query(JournalEntry).filter(
            JournalEntry.fiscal_year == fiscal_year,
            JournalEntry.fiscal_period == fiscal_period,
            JournalEntry.status.notin_(["posted", "reversed"]),
        ).all()
        unposted_ids = [je.id for je in unposted]
        if unposted_ids:
            errors.append(
                f"{len(unposted_ids)} unposted journal entries found: IDs {unposted_ids}"
            )

        # 2. Verify GL debit == credit for this period
        gl_totals = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
        ).filter(
            GeneralLedger.fiscal_year == fiscal_year,
            GeneralLedger.fiscal_period == fiscal_period,
        ).first()

        total_debit = _cents(Decimal(str(gl_totals[0]))) if gl_totals else Decimal("0")
        total_credit = _cents(Decimal(str(gl_totals[1]))) if gl_totals else Decimal("0")
        is_balanced = total_debit == total_credit

        if not is_balanced:
            errors.append(
                f"GL is not balanced: total debit={total_debit}, total credit={total_credit}, "
                f"difference={abs(total_debit - total_credit)}"
            )

        # 3. Check for submitted (pending approval) JEs
        submitted_count = self.db.query(func.count(JournalEntry.id)).filter(
            JournalEntry.fiscal_year == fiscal_year,
            JournalEntry.fiscal_period == fiscal_period,
            JournalEntry.status == "submitted",
        ).scalar() or 0
        if submitted_count:
            warnings.append(f"{submitted_count} journal entries are pending approval")

        # 4. Check period exists and is open
        period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.fiscal_year == fiscal_year,
            AccountingPeriod.period_number == fiscal_period,
        ).first()
        if not period:
            # A period that does not exist cannot be closed.
            errors.append(f"No accounting period record found for {fiscal_year}-{fiscal_period}")
        elif period.status != "open":
            warnings.append(f"Period is already '{period.status}'")

        # 5. Automatic GL postings that failed in this period are missing from
        #    the ledger: the period's books are incomplete until they are retried.
        from .accounting_models import GLPostingFailure
        from sqlalchemy import Date as _SADate, cast as _sa_cast, extract as _sa_extract

        failure_date = func.coalesce(
            GLPostingFailure.entry_date, _sa_cast(GLPostingFailure.last_attempt_at, _SADate)
        )
        pf_q = self.db.query(func.count(GLPostingFailure.id)).filter(
            GLPostingFailure.status == "pending"
        )
        if period:
            pf_q = pf_q.filter(failure_date >= period.start_date, failure_date <= period.end_date)
        else:
            pf_q = pf_q.filter(
                _sa_extract("year", failure_date) == fiscal_year,
                _sa_extract("month", failure_date) == fiscal_period,
            )
        pending_failures = int(pf_q.scalar() or 0)
        if pending_failures:
            errors.append(
                f"{pending_failures} automatic GL posting(s) for this period failed and are "
                f"pending retry (see GL posting failures)"
            )

        return schemas.ReconciliationCheckResponse(
            fiscal_year=fiscal_year,
            fiscal_period=fiscal_period,
            is_ready_to_close=len(errors) == 0,
            total_debit=total_debit,
            total_credit=total_credit,
            is_balanced=is_balanced,
            unposted_je_count=len(unposted_ids),
            unposted_je_ids=unposted_ids,
            warnings=warnings,
            errors=errors,
        )

    def create_year_end_closing_entries(
        self, data: schemas.YearEndCloseRequest, closed_by: int
    ) -> schemas.YearEndCloseResponse:
        """
        Create year-end closing journal entries:
        1. Close all Revenue accounts → 3200 Current Year Profit/Loss
        2. Close all Expense accounts → 3200 Current Year Profit/Loss
        3. Transfer 3200 → 3100 Retained Earnings
        """
        fiscal_year = data.fiscal_year
        warnings = []
        je_service = JournalEntryService(self.db)

        # The close is dated on the last day of the fiscal year, which is the
        # last period's end when periods exist (a year starting in April ends
        # in March), else 31 December.
        last_period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.fiscal_year == fiscal_year
        ).order_by(AccountingPeriod.period_number.desc()).first()
        closing_date = data.closing_date or (
            last_period.end_date if last_period else date(fiscal_year, 12, 31)
        )
        if je_service._get_fiscal_period(closing_date)[0] != fiscal_year:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Closing date {closing_date} is not in fiscal year {fiscal_year}",
            )

        # Get key accounts
        retained_earnings = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_code == "3100"
        ).first()
        current_year_pl = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_code == "3200"
        ).first()

        if not retained_earnings:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account 3100 (Retained Earnings) not found. Please seed COA first."
            )
        if not current_year_pl:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Account 3200 (Current Year Profit/Loss) not found. Please seed COA first."
            )

        # Check that this hasn't been done already
        existing_close = self.db.query(JournalEntry).filter(
            JournalEntry.fiscal_year == fiscal_year,
            JournalEntry.entry_type == "Closing",
            JournalEntry.status.in_(["posted", "approved", "draft"]),
        ).first()
        if existing_close:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Year-end closing entries already exist for fiscal year {fiscal_year} "
                       f"(JE #{existing_close.journal_entry_no}). Reverse them first if re-closing."
            )

        # All three closing entries or none: a failure rolls back the savepoint.
        savepoint = self.db.begin_nested()
        try:
            result = self._post_year_end_closing(
                je_service, fiscal_year, closing_date, retained_earnings, current_year_pl,
                closed_by, warnings,
            )
        except Exception:
            savepoint.rollback()
            raise
        savepoint.commit()
        self.db.commit()
        touched = self.db.query(JournalEntryLine).filter(
            JournalEntryLine.journal_entry_id.in_(
                [i for i in (result.revenue_close_je_id, result.expense_close_je_id,
                             result.retained_earnings_je_id) if i]
            )
        ).all()
        _refresh_balances(self.db, touched, closing_date)
        return result

    def _post_year_end_closing(
        self, je_service, fiscal_year, closing_date, retained_earnings, current_year_pl,
        closed_by, warnings,
    ) -> schemas.YearEndCloseResponse:
        """Build and post the closing entries in the caller's transaction."""

        # ── Step 1: Sum all Revenue accounts for the year ──
        revenue_accounts = self.db.query(
            ChartOfAccounts.id,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
        ).filter(ChartOfAccounts.account_type == "Revenue").all()

        revenue_balances = {}
        total_revenue = Decimal("0")
        for acc in revenue_accounts:
            result = self.db.query(
                func.coalesce(func.sum(GeneralLedger.credit_amount), 0) -
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0)
            ).filter(
                GeneralLedger.account_id == acc.id,
                GeneralLedger.fiscal_year == fiscal_year,
            ).scalar()
            balance = Decimal(str(result)) if result else Decimal("0")
            if balance != 0:
                revenue_balances[acc.id] = balance
                total_revenue += balance

        # ── Step 2: Sum all Expense accounts for the year ──
        expense_accounts = self.db.query(
            ChartOfAccounts.id,
            ChartOfAccounts.account_code,
            ChartOfAccounts.account_name,
        ).filter(ChartOfAccounts.account_type == "Expense").all()

        expense_balances = {}
        total_expenses = Decimal("0")
        for acc in expense_accounts:
            result = self.db.query(
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
                func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
            ).filter(
                GeneralLedger.account_id == acc.id,
                GeneralLedger.fiscal_year == fiscal_year,
            ).scalar()
            balance = Decimal(str(result)) if result else Decimal("0")
            if balance != 0:
                expense_balances[acc.id] = balance
                total_expenses += balance

        net_income = total_revenue - total_expenses

        revenue_je_id = None
        expense_je_id = None
        retained_je_id = None

        def _create_and_post(description, lines):
            je = je_service.create_journal_entry(
                schemas.JournalEntryCreate(
                    entry_date=closing_date,
                    posting_date=closing_date,
                    entry_type="Closing",
                    description=description,
                    lines=lines,
                ),
                created_by=closed_by,
                commit=False,
            )
            # Closing entries are system-generated: no approval workflow.
            je.status = "approved"
            self.db.flush()
            return je_service.post_journal_entry(je.id, posted_by=closed_by, commit=False)

        # ── Step 3: Create Revenue Closing JE ──
        if revenue_balances:
            rev_lines = []
            line_num = 0
            for acc_id, balance in revenue_balances.items():
                line_num += 1
                # Debit Revenue (reduce credit balance) → zeroes out revenue
                rev_lines.append(schemas.JournalEntryLineCreate(
                    line_number=line_num,
                    account_id=acc_id,
                    debit_amount=balance,
                    credit_amount=Decimal("0"),
                    description="Year-end close: transfer revenue to P/L",
                ))
            # Credit 3200 Current Year P/L
            line_num += 1
            rev_lines.append(schemas.JournalEntryLineCreate(
                line_number=line_num,
                account_id=current_year_pl.id,
                debit_amount=Decimal("0"),
                credit_amount=total_revenue,
                description="Year-end close: revenue transferred to Current Year P/L",
            ))

            rev_je = _create_and_post(
                f"Year-end closing: Revenue accounts → Current Year P/L (FY{fiscal_year})", rev_lines
            )
            revenue_je_id = rev_je.id

        # ── Step 4: Create Expense Closing JE ──
        if expense_balances:
            exp_lines = []
            line_num = 0
            # Debit 3200 Current Year P/L
            line_num += 1
            exp_lines.append(schemas.JournalEntryLineCreate(
                line_number=line_num,
                account_id=current_year_pl.id,
                debit_amount=total_expenses,
                credit_amount=Decimal("0"),
                description="Year-end close: expenses transferred to Current Year P/L",
            ))
            for acc_id, balance in expense_balances.items():
                line_num += 1
                # Credit Expense (reduce debit balance) → zeroes out expense
                exp_lines.append(schemas.JournalEntryLineCreate(
                    line_number=line_num,
                    account_id=acc_id,
                    debit_amount=Decimal("0"),
                    credit_amount=balance,
                    description="Year-end close: transfer expense to P/L",
                ))

            exp_je = _create_and_post(
                f"Year-end closing: Expense accounts → Current Year P/L (FY{fiscal_year})", exp_lines
            )
            expense_je_id = exp_je.id

        # ── Step 5: Transfer 3200 → 3100 Retained Earnings ──
        if net_income != 0:
            ret_lines = []
            if net_income > 0:
                # Profit: Debit 3200, Credit 3100
                ret_lines = [
                    schemas.JournalEntryLineCreate(
                        line_number=1,
                        account_id=current_year_pl.id,
                        debit_amount=net_income,
                        credit_amount=Decimal("0"),
                        description="Transfer net income to Retained Earnings",
                    ),
                    schemas.JournalEntryLineCreate(
                        line_number=2,
                        account_id=retained_earnings.id,
                        debit_amount=Decimal("0"),
                        credit_amount=net_income,
                        description="Net income transferred to Retained Earnings",
                    ),
                ]
            else:
                # Loss: Debit 3100, Credit 3200
                loss = abs(net_income)
                ret_lines = [
                    schemas.JournalEntryLineCreate(
                        line_number=1,
                        account_id=retained_earnings.id,
                        debit_amount=loss,
                        credit_amount=Decimal("0"),
                        description="Net loss transferred from Retained Earnings",
                    ),
                    schemas.JournalEntryLineCreate(
                        line_number=2,
                        account_id=current_year_pl.id,
                        debit_amount=Decimal("0"),
                        credit_amount=loss,
                        description="Transfer net loss to Retained Earnings",
                    ),
                ]

            ret_je = _create_and_post(
                f"Year-end closing: Current Year P/L → Retained Earnings (FY{fiscal_year})", ret_lines
            )
            retained_je_id = ret_je.id
        else:
            warnings.append("Net income is zero — no retained earnings transfer needed")

        if not revenue_balances and not expense_balances:
            warnings.append("No revenue or expense GL entries found for this fiscal year")

        return schemas.YearEndCloseResponse(
            fiscal_year=fiscal_year,
            closing_date=closing_date,
            revenue_close_je_id=revenue_je_id,
            expense_close_je_id=expense_je_id,
            net_income=net_income,
            retained_earnings_je_id=retained_je_id,
            message=f"Year-end closing completed for FY{fiscal_year}. Net income: {net_income}",
            warnings=warnings,
        )


# =============================================================================
# CASH FLOW SERVICE
# =============================================================================

def _attach_cfs_user_names(db: Session, statements: List) -> None:
    """Resolve created_by/updated_by/prepared_by/approved_by ids to display
    names for a batch of CashFlowStatement rows."""
    from app.auth.models import User
    fields = ("created_by", "updated_by", "prepared_by", "approved_by")
    user_ids = {getattr(s, f, None) for s in statements for f in fields} - {None}
    name_map = {}
    if user_ids:
        users = db.query(User).filter(User.id.in_(user_ids)).all()
        name_map = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in users
        }
    for s in statements:
        s.created_by_name = name_map.get(getattr(s, "created_by", None))
        s.updated_by_name = name_map.get(getattr(s, "updated_by", None))
        s.prepared_by_name = name_map.get(getattr(s, "prepared_by", None))
        s.approved_by_name = name_map.get(getattr(s, "approved_by", None))


class CashFlowService:
    """
    Enhanced Cash Flow Statement service (Scenario 36).

    Features:
    - Standard category seeding (13 categories: OP-001..FN-004)
    - Indirect-method auto-generation from GL data
    - Manual line add/update/delete for financing activities
    - Recalculate section totals after manual changes
    - Formatted report output with sections and cash composition
    - GL reconciliation verification
    - Statement regeneration (delete+recreate for drafts)
    """

    # ── Standard categories seed data ─────────────────────────────────────
    STANDARD_CATEGORIES = [
        # Operating Activities
        ("OP-001", "Net Income", "Operating", "Net Income (from Income Statement)",
         10, True, '["3200"]', "Net income for the period calculated from revenue minus expenses"),
        ("OP-002", "Depreciation & Amortisation", "Operating", "Add: Depreciation & Amortisation",
         20, True, '["5170"]', "Non-cash depreciation expense added back"),
        ("OP-010", "Accounts Receivable Changes", "Operating", "(Increase)/Decrease in Accounts Receivable",
         30, False, '["1110"]', "Change in trade receivables (increase = cash outflow)"),
        ("OP-011", "Inventory Changes", "Operating", "(Increase)/Decrease in Inventory",
         40, False, '["1210", "1220", "1230"]', "Change in inventory and goods in transit (increase = cash outflow)"),
        ("OP-020", "Accounts Payable Changes", "Operating", "Increase/(Decrease) in Accounts Payable",
         50, True, '["2010"]', "Change in trade creditors (increase = cash inflow)"),
        ("OP-021", "Payroll Liabilities Changes", "Operating", "Increase/(Decrease) in Payroll Liabilities",
         60, True, '["2110", "2120", "2130"]', "Change in salaries, EPF, ETF payable"),
        ("OP-022", "Gift Voucher Liabilities Changes", "Operating", "Increase/(Decrease) in Gift Voucher Liabilities",
         70, True, '["2510"]', "Change in gift vouchers outstanding"),
        ("OP-090", "Other Working Capital Changes", "Operating", "Change in Other Current Assets & Liabilities",
         90, True, '[]', "All other current assets and liabilities (advances, deposits, tax, payroll deductions)"),
        # Investing Activities
        ("IN-001", "Fixed Asset Purchases", "Investing", "Purchase of Property, Plant & Equipment",
         10, False, '["1310", "1320"]', "Cash paid for equipment and furniture purchases"),
        ("IN-002", "Fixed Asset Sales", "Investing", "Proceeds from Sale of Fixed Assets",
         20, True, '["1310", "1320"]', "Cash received from sale of equipment and furniture"),
        # Financing Activities
        ("FN-001", "Owner Contributions", "Financing", "Capital Contributions from Owner",
         10, True, '["3000"]', "Cash invested by owner into the business"),
        ("FN-002", "Owner Withdrawals", "Financing", "Withdrawals/Drawings by Owner",
         20, False, '["3000"]', "Cash withdrawn by owner from the business"),
        ("FN-003", "Loan Proceeds", "Financing", "Proceeds from Borrowings",
         30, True, '["2300"]', "Cash received from new loans and borrowings"),
        ("FN-004", "Loan Repayments", "Financing", "Repayment of Borrowings",
         40, False, '["2300"]', "Cash paid to repay loans and borrowings"),
    ]

    def __init__(self, db: Session):
        self.db = db

    # ── Seed ──────────────────────────────────────────────────────────────

    def seed_standard_categories(self) -> dict:
        """Seed the 13 standard cash flow categories. Skips already-existing codes."""
        created = 0
        skipped = 0
        all_cats = []

        for (code, name, section, line_item, order, is_inflow,
             mapping, desc) in self.STANDARD_CATEGORIES:
            existing = self.db.query(CashFlowCategory).filter(
                CashFlowCategory.category_code == code
            ).first()
            if existing:
                skipped += 1
                all_cats.append(existing)
                continue

            cat = CashFlowCategory(
                category_code=code,
                category_name=name,
                section=section,
                line_item=line_item,
                display_order=order,
                is_inflow=is_inflow,
                account_mapping=mapping,
                description=desc,
                is_active=True,
            )
            self.db.add(cat)
            self.db.flush()
            created += 1
            all_cats.append(cat)

        self.db.commit()
        for c in all_cats:
            self.db.refresh(c)

        return {
            "created": created,
            "skipped": skipped,
            "categories": all_cats,
            "message": f"Seeded {created} categories, skipped {skipped} existing",
        }

    # ── Categories CRUD ───────────────────────────────────────────────────

    def create_category(self, data: schemas.CashFlowCategoryCreate) -> CashFlowCategory:
        existing = self.db.query(CashFlowCategory).filter(
            CashFlowCategory.category_code == data.category_code
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Category code '{data.category_code}' already exists"
            )

        category = CashFlowCategory(**data.model_dump())
        self.db.add(category)
        self.db.commit()
        self.db.refresh(category)
        return category

    def update_category(self, category_id: int, data: schemas.CashFlowCategoryUpdate) -> CashFlowCategory:
        category = self.db.query(CashFlowCategory).filter(
            CashFlowCategory.id == category_id
        ).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        for key, value in data.model_dump(exclude_none=True).items():
            setattr(category, key, value)
        self.db.commit()
        self.db.refresh(category)
        return category

    def list_categories(self, section: Optional[str] = None) -> List[CashFlowCategory]:
        query = self.db.query(CashFlowCategory)
        if section:
            query = query.filter(CashFlowCategory.section == section)
        return query.order_by(CashFlowCategory.section, CashFlowCategory.display_order).all()

    def delete_category(self, category_id: int) -> bool:
        category = self.db.query(CashFlowCategory).filter(
            CashFlowCategory.id == category_id
        ).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {category_id} not found"
            )
        used = self.db.query(CashFlowStatementLine).filter(
            CashFlowStatementLine.category_id == category_id
        ).count()
        if used > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Category is used in {used} statement lines and cannot be deleted"
            )
        self.db.delete(category)
        self.db.commit()
        return True

    # ── Statement Generation ──────────────────────────────────────────────

    def _generate_statement_no(self, fiscal_year: int, fiscal_period: int) -> str:
        return f"CFS-{fiscal_year}-{fiscal_period:02d}"

    def _resolve_period_dates(self, fiscal_year: int, fiscal_period: int):
        """Resolve start/end dates from accounting periods or calendar."""
        period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.fiscal_year == fiscal_year,
            AccountingPeriod.period_number == fiscal_period,
        ).first()

        if period:
            return period.start_date, period.end_date

        import calendar
        _, last_day = calendar.monthrange(fiscal_year, fiscal_period)
        return date(fiscal_year, fiscal_period, 1), date(fiscal_year, fiscal_period, last_day)

    def _get_cash_account_ids(self) -> List[int]:
        """Get all active Cash and Bank account IDs."""
        accounts = self.db.query(ChartOfAccounts.id).filter(
            ChartOfAccounts.account_category.in_(["Cash", "Bank"]),
            ChartOfAccounts.is_active == True,
        ).all()
        return [a.id for a in accounts]

    def _compute_cash_balances(self, cash_account_ids: List[int], start_date: date, end_date: date):
        """Compute opening and closing cash balances from GL."""
        opening_cash = Decimal("0")
        closing_cash = Decimal("0")

        if not cash_account_ids:
            return opening_cash, closing_cash

        # Opening: net balance before period start
        opening_result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(cash_account_ids),
            GeneralLedger.posting_date < start_date,
        ).scalar()
        opening_cash = Decimal(str(opening_result)) if opening_result else Decimal("0")

        # Period change
        period_result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(cash_account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).scalar()
        period_change = Decimal(str(period_result)) if period_result else Decimal("0")
        closing_cash = opening_cash + period_change

        return opening_cash, closing_cash

    def generate_statement(
        self, data: schemas.CashFlowStatementCreate, prepared_by: int
    ) -> CashFlowStatement:
        """Generate a cash flow statement for a fiscal period using the indirect method."""
        # Advisory lock to prevent duplicate CFS statements for the same period
        from sqlalchemy import text as _text
        lock_key = f"CFS-{data.fiscal_year}-{data.fiscal_period}"
        self.db.execute(_text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": lock_key})

        # Check if already exists (now safe under lock)
        existing = self.db.query(CashFlowStatement).filter(
            CashFlowStatement.fiscal_year == data.fiscal_year,
            CashFlowStatement.fiscal_period == data.fiscal_period,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cash flow statement already exists for {data.fiscal_year}-{data.fiscal_period}"
            )

        start_date, end_date = self._resolve_period_dates(data.fiscal_year, data.fiscal_period)
        cash_account_ids = self._get_cash_account_ids()
        opening_cash, closing_cash = self._compute_cash_balances(
            cash_account_ids, start_date, end_date
        )

        # Get active categories
        categories = self.db.query(CashFlowCategory).filter(
            CashFlowCategory.is_active == True
        ).order_by(CashFlowCategory.section, CashFlowCategory.display_order).all()

        operating_total = Decimal("0")
        investing_total = Decimal("0")
        financing_total = Decimal("0")
        lines = []
        line_num = 0

        for cat in categories:
            line_num += 1
            amount = self._calculate_category_amount(cat, start_date, end_date)

            if cat.section == "Operating":
                operating_total += amount
            elif cat.section == "Investing":
                investing_total += amount
            elif cat.section == "Financing":
                financing_total += amount

            lines.append(CashFlowStatementLine(
                category_id=cat.id,
                line_number=line_num,
                line_description=cat.line_item,
                amount=amount,
                is_calculated=True,
                calculation_source=f"Auto: {cat.category_code} from GL accounts {cat.account_mapping}",
                reference_accounts=cat.account_mapping,
            ))

        net_change = operating_total + investing_total + financing_total

        statement = CashFlowStatement(
            statement_no=self._generate_statement_no(data.fiscal_year, data.fiscal_period),
            fiscal_year=data.fiscal_year,
            fiscal_period=data.fiscal_period,
            period_start_date=start_date,
            period_end_date=end_date,
            opening_cash_balance=opening_cash,
            closing_cash_balance=closing_cash,
            net_cash_from_operating=operating_total,
            net_cash_from_investing=investing_total,
            net_cash_from_financing=financing_total,
            net_change_in_cash=net_change,
            status="draft",
            method=data.method,
            notes=data.notes,
            prepared_by=prepared_by,
        )
        self.db.add(statement)
        self.db.flush()

        for line in lines:
            line.cash_flow_statement_id = statement.id
            self.db.add(line)

        log_audit(
            self.db, user_id=prepared_by or 0, action="create",
            entity_type="cash_flow_statement", entity_id=statement.id,
            changes={"fiscal_year": statement.fiscal_year, "fiscal_period": statement.fiscal_period},
        )

        self.db.commit()
        self.db.refresh(statement)
        _attach_cfs_user_names(self.db, [statement])
        return statement

    def regenerate_statement(
        self, statement_id: int, prepared_by: int
    ) -> CashFlowStatement:
        """Delete a draft statement and re-generate it with fresh GL data."""
        statement = self.get_statement(statement_id)
        if statement.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot regenerate statement in '{statement.status}' status – only drafts"
            )
        fy = statement.fiscal_year
        fp = statement.fiscal_period
        method = statement.method
        notes = statement.notes

        # Delete existing
        self.db.query(CashFlowStatementLine).filter(
            CashFlowStatementLine.cash_flow_statement_id == statement.id
        ).delete()
        self.db.delete(statement)
        self.db.commit()

        # Re-generate
        return self.generate_statement(
            schemas.CashFlowStatementCreate(
                fiscal_year=fy,
                fiscal_period=fp,
                method=method,
                notes=notes,
            ),
            prepared_by=prepared_by,
        )

    # ── Indirect-Method Calculation Engine ────────────────────────────────

    def _calculate_category_amount(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """
        Calculate the amount for a cash flow category using the indirect method.

        Logic per category code:
        - OP-001 (Net Income):   Revenue credits – Expense debits for the period
        - OP-002 (Depreciation): Sum of depreciation expense (always positive add-back)
        - OP-010..OP-022 (Working Capital): Balance change = end_balance – start_balance,
          sign adjusted: asset increase is negative (cash used), liability increase is positive
        - IN-001 (Asset Purchases): Debits to asset accounts (outflow, negative)
        - IN-002 (Asset Sales): Credits to asset accounts (inflow, positive)
        - FN-001..FN-004: Direct GL movement on mapped accounts
        - Fallback: Generic debit/credit sum with is_inflow flag
        """
        code = category.category_code

        # --- OP-001: Net Income (indirect method start) ---
        if code == "OP-001":
            return self._calc_net_income(start_date, end_date)

        # --- OP-090: every other current asset / liability (residual) ---
        if code == "OP-090":
            return self._calc_other_working_capital(start_date, end_date)

        # --- OP-002: Depreciation add-back (non-cash) ---
        if code == "OP-002":
            return self._calc_depreciation(category, start_date, end_date)

        # --- OP-010..OP-022: Working capital changes ---
        if code.startswith("OP-0") and code >= "OP-010":
            return self._calc_working_capital_change(category, start_date, end_date)

        # --- IN-001: Fixed asset purchases (outflow) ---
        if code == "IN-001":
            return self._calc_asset_purchases(category, start_date, end_date)

        # --- IN-002: Fixed asset sales (inflow) ---
        if code == "IN-002":
            return self._calc_asset_sales(category, start_date, end_date)

        # --- FN-xxx: Financing activities (generic GL movement) ---
        if code.startswith("FN-"):
            return self._calc_financing(category, start_date, end_date)

        # --- Fallback: generic calculation ---
        return self._calc_generic(category, start_date, end_date)

    def _parse_account_codes(self, category: CashFlowCategory) -> List[str]:
        """Parse the JSON account_mapping into a list of account codes."""
        if not category.account_mapping:
            return []
        import json
        try:
            codes = json.loads(category.account_mapping)
            return codes if isinstance(codes, list) else []
        except (json.JSONDecodeError, TypeError):
            return []

    def _get_account_ids(self, account_codes: List[str]) -> List[int]:
        """Resolve account codes to IDs, including every sub-account of a header
        (postings land on the leaves, e.g. loans on 2310 under header 2300)."""
        if not account_codes:
            return []
        ids = {a.id for a in self.db.query(ChartOfAccounts.id).filter(
            ChartOfAccounts.account_code.in_(account_codes)
        ).all()}
        frontier = set(ids)
        while frontier:
            children = {a.id for a in self.db.query(ChartOfAccounts.id).filter(
                ChartOfAccounts.parent_account_id.in_(frontier)
            ).all()} - ids
            ids |= children
            frontier = children
        return sorted(ids)

    def _calc_net_income(self, start_date: date, end_date: date) -> Decimal:
        """
        Net income for the period = Revenue (credits – debits) – Expenses
        (debits – credits), by account type, inactive accounts included and
        year-end closing entries excluded (they zero P&L, they are not trading).
        """
        rows = self.db.query(
            ChartOfAccounts.account_type,
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
            - func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
        ).join(
            GeneralLedger, GeneralLedger.account_id == ChartOfAccounts.id
        ).filter(
            ChartOfAccounts.account_type.in_(PROFIT_AND_LOSS_TYPES),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
            _not_closing(GeneralLedger.transaction_type),
        ).group_by(ChartOfAccounts.account_type).all()
        # credit - debit summed over Revenue and Expense is exactly Revenue - Expenses.
        return sum((Decimal(str(net)) for _t, net in rows), Decimal("0"))

    def _calc_other_working_capital(self, start_date: date, end_date: date) -> Decimal:
        """Change in every current asset / liability that no active category maps
        (cash, fixed assets and long-term debt excluded), so the indirect method
        adds up to the actual change in cash."""
        mapped: set = set()
        for cat in self.db.query(CashFlowCategory).filter(CashFlowCategory.is_active == True).all():
            mapped.update(self._get_account_ids(self._parse_account_codes(cat)))
        excluded_categories = ["Cash", "Bank", "Fixed Asset", "Non-Current Asset", "Intangible Asset",
                               "Long-term", "Long-term Liability", "Non-Current Liability"]
        candidates = self.db.query(ChartOfAccounts.id).filter(
            ChartOfAccounts.account_type.in_(["Asset", "Liability"]),
            or_(ChartOfAccounts.account_category.is_(None),
                ~ChartOfAccounts.account_category.in_(excluded_categories)),
        ).all()
        account_ids = [a.id for a in candidates if a.id not in mapped]
        if not account_ids:
            return Decimal("0")
        change = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0)
            - func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).scalar()
        # Debit-side growth (asset up / liability down) uses cash.
        return -Decimal(str(change or 0))

    def _calc_depreciation(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """Depreciation is always a positive add-back (non-cash expense)."""
        account_codes = self._parse_account_codes(category)
        account_ids = self._get_account_ids(account_codes)
        if not account_ids:
            return Decimal("0")

        result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).scalar()
        amount = Decimal(str(result)) if result else Decimal("0")
        return abs(amount)  # Always positive add-back

    def _calc_working_capital_change(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """
        Working capital change = ending_balance – beginning_balance.

        For current ASSETS (is_inflow=False): increase in asset = cash used (negative)
        For current LIABILITIES (is_inflow=True): increase in liability = cash source (positive)
        """
        account_codes = self._parse_account_codes(category)
        account_ids = self._get_account_ids(account_codes)
        if not account_ids:
            return Decimal("0")

        # Beginning balance (all GL entries before period start)
        beg_result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date < start_date,
        ).scalar()
        beginning_balance = Decimal(str(beg_result)) if beg_result else Decimal("0")

        # Ending balance (all GL entries up to and including period end)
        end_result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date <= end_date,
        ).scalar()
        ending_balance = Decimal(str(end_result)) if end_result else Decimal("0")

        change = ending_balance - beginning_balance

        if category.is_inflow:
            # Liability accounts: credit normal balance, so debit-credit is negative
            # when liability increases.  We want: increase → positive cash impact.
            # debit-credit change for a liability: if credits increase, change is negative.
            # So negate: –(negative) = positive.
            return -change
        else:
            # Asset accounts: debit normal balance, so debit-credit is positive
            # when asset increases.  Increase in asset = cash used → negative.
            return -change

    def _calc_asset_purchases(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """Fixed asset purchases = sum of debits to asset accounts (outflow → negative)."""
        account_codes = self._parse_account_codes(category)
        account_ids = self._get_account_ids(account_codes)
        if not account_ids:
            return Decimal("0")

        result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).scalar()
        amount = Decimal(str(result)) if result else Decimal("0")
        return -amount  # Cash outflow

    def _calc_asset_sales(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """Fixed asset sales = sum of credits to asset accounts (inflow → positive)."""
        account_codes = self._parse_account_codes(category)
        account_ids = self._get_account_ids(account_codes)
        if not account_ids:
            return Decimal("0")

        result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).scalar()
        amount = Decimal(str(result)) if result else Decimal("0")
        return amount  # Cash inflow

    def _calc_financing(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """
        Financing: generic GL movement on mapped accounts.
        is_inflow=True → inflows (credits for equity/liability accounts)
        is_inflow=False → outflows (debits for equity/liability accounts)
        """
        account_codes = self._parse_account_codes(category)
        account_ids = self._get_account_ids(account_codes)
        if not account_ids:
            return Decimal("0")

        result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0).label("d"),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0).label("c"),
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).first()

        total_debit = Decimal(str(result.d)) if result else Decimal("0")
        total_credit = Decimal(str(result.c)) if result else Decimal("0")

        # Gross flows: the inflow line takes the credits (contribution, loan
        # received) and the outflow line the debits (drawings, repayment), so a
        # pair of categories on the same account never counts one movement twice.
        if category.is_inflow:
            return total_credit
        return -total_debit

    def _calc_generic(
        self, category: CashFlowCategory, start_date: date, end_date: date
    ) -> Decimal:
        """Fallback: simple debit/credit sum with is_inflow flag."""
        account_codes = self._parse_account_codes(category)
        account_ids = self._get_account_ids(account_codes)
        if not account_ids:
            return Decimal("0")

        result = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0).label("d"),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0).label("c"),
        ).filter(
            GeneralLedger.account_id.in_(account_ids),
            GeneralLedger.posting_date >= start_date,
            GeneralLedger.posting_date <= end_date,
        ).first()

        total_debit = Decimal(str(result.d)) if result else Decimal("0")
        total_credit = Decimal(str(result.c)) if result else Decimal("0")

        if category.is_inflow:
            return total_debit - total_credit
        else:
            return total_credit - total_debit

    # ── Manual Lines ──────────────────────────────────────────────────────

    def add_manual_line(
        self, statement_id: int, data: schemas.CashFlowManualLineCreate
    ) -> CashFlowStatementLine:
        """Add a manual (non-calculated) line to a draft cash flow statement."""
        statement = self.get_statement(statement_id)
        if statement.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Can only add manual lines to draft statements"
            )

        # Validate category exists
        category = self.db.query(CashFlowCategory).filter(
            CashFlowCategory.id == data.category_id
        ).first()
        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Category with id {data.category_id} not found"
            )

        # Next line number
        max_line = self.db.query(
            func.coalesce(func.max(CashFlowStatementLine.line_number), 0)
        ).filter(
            CashFlowStatementLine.cash_flow_statement_id == statement_id
        ).scalar()

        line = CashFlowStatementLine(
            cash_flow_statement_id=statement_id,
            category_id=data.category_id,
            line_number=max_line + 1,
            line_description=data.line_description,
            amount=data.amount,
            is_calculated=False,
            calculation_source="Manual entry",
            notes=data.notes,
        )
        self.db.add(line)
        self.db.commit()
        self.db.refresh(line)

        # Recalculate totals
        self._recalculate_statement_totals(statement_id)

        # Reload with category relationship
        line = self.db.query(CashFlowStatementLine).options(
            joinedload(CashFlowStatementLine.category)
        ).filter(CashFlowStatementLine.id == line.id).first()

        return line

    def update_manual_line(
        self, statement_id: int, line_id: int, data: schemas.CashFlowManualLineUpdate
    ) -> CashFlowStatementLine:
        """Update a manual line on a draft cash flow statement."""
        statement = self.get_statement(statement_id)
        if statement.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Can only update lines on draft statements"
            )

        line = self.db.query(CashFlowStatementLine).filter(
            CashFlowStatementLine.id == line_id,
            CashFlowStatementLine.cash_flow_statement_id == statement_id,
        ).first()
        if not line:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Line {line_id} not found on statement {statement_id}"
            )
        if line.is_calculated:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot update an auto-calculated line. Use regenerate instead."
            )

        for key, value in data.model_dump(exclude_none=True).items():
            setattr(line, key, value)
        self.db.commit()
        self.db.refresh(line)

        self._recalculate_statement_totals(statement_id)

        # Reload with category relationship
        line = self.db.query(CashFlowStatementLine).options(
            joinedload(CashFlowStatementLine.category)
        ).filter(CashFlowStatementLine.id == line.id).first()

        return line

    def delete_manual_line(self, statement_id: int, line_id: int) -> bool:
        """Delete a manual line from a draft cash flow statement."""
        statement = self.get_statement(statement_id)
        if statement.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Can only delete lines from draft statements"
            )

        line = self.db.query(CashFlowStatementLine).filter(
            CashFlowStatementLine.id == line_id,
            CashFlowStatementLine.cash_flow_statement_id == statement_id,
        ).first()
        if not line:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Line {line_id} not found on statement {statement_id}"
            )
        if line.is_calculated:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete an auto-calculated line. Use regenerate instead."
            )

        self.db.delete(line)
        self.db.commit()

        self._recalculate_statement_totals(statement_id)
        return True

    def _recalculate_statement_totals(self, statement_id: int):
        """Recalculate section totals and net change after manual line changes."""
        statement = self.db.query(CashFlowStatement).filter(
            CashFlowStatement.id == statement_id
        ).first()
        if not statement:
            return

        lines = self.db.query(CashFlowStatementLine).options(
            joinedload(CashFlowStatementLine.category)
        ).filter(
            CashFlowStatementLine.cash_flow_statement_id == statement_id
        ).all()

        operating = Decimal("0")
        investing = Decimal("0")
        financing = Decimal("0")

        for line in lines:
            section = line.category.section if line.category else ""
            if section == "Operating":
                operating += line.amount
            elif section == "Investing":
                investing += line.amount
            elif section == "Financing":
                financing += line.amount

        statement.net_cash_from_operating = operating
        statement.net_cash_from_investing = investing
        statement.net_cash_from_financing = financing
        statement.net_change_in_cash = operating + investing + financing
        self.db.commit()

    def recalculate_totals(self, statement_id: int) -> CashFlowStatement:
        """Public API to recalculate totals and return the updated statement."""
        self._recalculate_statement_totals(statement_id)
        return self.get_statement(statement_id)

    # ── Formatted Report ──────────────────────────────────────────────────

    def generate_report(self, statement_id: int) -> dict:
        """
        Generate a formatted cash flow report with sections, subtotals,
        cash composition, and supplemental disclosures.
        """
        statement = self.get_statement(statement_id)

        lines = self.db.query(CashFlowStatementLine).options(
            joinedload(CashFlowStatementLine.category)
        ).filter(
            CashFlowStatementLine.cash_flow_statement_id == statement_id
        ).order_by(CashFlowStatementLine.line_number).all()

        def section_data(section_name: str) -> dict:
            section_lines = [l for l in lines if l.category and l.category.section == section_name]
            items = []
            subtotal = Decimal("0")
            for sl in sorted(section_lines, key=lambda x: x.line_number):
                items.append({
                    "line_number": sl.line_number,
                    "line_description": sl.line_description,
                    "amount": float(sl.amount),
                    "is_calculated": sl.is_calculated,
                    "category_code": sl.category.category_code if sl.category else None,
                    "notes": sl.notes,
                })
                subtotal += sl.amount
            return {"section_name": section_name, "lines": items, "subtotal": float(subtotal)}

        operating = section_data("Operating")
        investing = section_data("Investing")
        financing = section_data("Financing")

        # Cash composition breakdown
        cash_accounts = self._get_cash_account_breakdown(statement.period_end_date)

        # Supplemental notes
        suppl_parts = []
        if statement.notes:
            suppl_parts.append(statement.notes)
        recon_diff = (
            statement.opening_cash_balance + statement.net_change_in_cash
        ) - statement.closing_cash_balance
        if recon_diff != 0:
            suppl_parts.append(
                f"Note: Calculated closing cash differs from GL closing by {recon_diff}. "
                "Review manual entries or GL postings."
            )

        return {
            "statement_no": statement.statement_no,
            "fiscal_year": statement.fiscal_year,
            "fiscal_period": statement.fiscal_period,
            "period_start_date": statement.period_start_date,
            "period_end_date": statement.period_end_date,
            "method": statement.method,
            "status": statement.status,
            "operating_activities": operating,
            "investing_activities": investing,
            "financing_activities": financing,
            "net_increase_in_cash": float(statement.net_change_in_cash or 0),
            "opening_cash_balance": float(statement.opening_cash_balance),
            "closing_cash_balance": float(statement.closing_cash_balance),
            "cash_accounts_breakdown": cash_accounts,
            "supplemental_notes": "; ".join(suppl_parts) if suppl_parts else None,
            "prepared_by": statement.prepared_by,
            "approved_by": statement.approved_by,
            "approved_at": statement.approved_at,
            "generated_at": tz.now(),
        }

    def _get_cash_account_breakdown(self, as_of_date: date) -> List[dict]:
        """Get individual cash/bank account balances as of a date."""
        accounts = self.db.query(ChartOfAccounts).filter(
            ChartOfAccounts.account_category.in_(["Cash", "Bank"]),
            ChartOfAccounts.is_active == True,
        ).all()

        breakdown = []
        for acct in accounts:
            bal = self.db.query(
                func.coalesce(func.sum(GeneralLedger.debit_amount), 0) -
                func.coalesce(func.sum(GeneralLedger.credit_amount), 0)
            ).filter(
                GeneralLedger.account_id == acct.id,
                GeneralLedger.posting_date <= as_of_date,
            ).scalar()
            balance = Decimal(str(bal)) if bal else Decimal("0")
            breakdown.append({
                "account_id": acct.id,
                "account_code": acct.account_code,
                "account_name": acct.account_name,
                "gl_balance": float(balance),
            })
        return breakdown

    # ── GL Reconciliation ─────────────────────────────────────────────────

    def reconcile_with_gl(self, statement_id: int) -> dict:
        """
        Verify the cash flow statement reconciles with GL cash balances.
        Checks:
        1. opening + net_change == closing (internal consistency)
        2. closing_cash_balance matches actual GL balance at period end
        """
        statement = self.get_statement(statement_id)

        cash_account_ids = self._get_cash_account_ids()
        _, gl_cash_balance = self._compute_cash_balances(
            cash_account_ids, statement.period_start_date, statement.period_end_date
        )

        calculated_closing = statement.opening_cash_balance + (statement.net_change_in_cash or Decimal("0"))
        stmt_vs_calc_diff = statement.closing_cash_balance - calculated_closing
        stmt_vs_gl_diff = statement.closing_cash_balance - gl_cash_balance

        warnings = []
        if stmt_vs_calc_diff != 0:
            warnings.append(
                f"Opening ({statement.opening_cash_balance}) + Net Change ({statement.net_change_in_cash}) "
                f"= {calculated_closing}, but statement closing is {statement.closing_cash_balance} "
                f"(diff: {stmt_vs_calc_diff})"
            )
        if stmt_vs_gl_diff != 0:
            warnings.append(
                f"Statement closing cash ({statement.closing_cash_balance}) differs from "
                f"GL cash balance ({gl_cash_balance}) by {stmt_vs_gl_diff}"
            )

        is_reconciled = (stmt_vs_calc_diff == 0) and (stmt_vs_gl_diff == 0)

        cash_breakdown = self._get_cash_account_breakdown(statement.period_end_date)

        return {
            "statement_id": statement.id,
            "statement_no": statement.statement_no,
            "fiscal_year": statement.fiscal_year,
            "fiscal_period": statement.fiscal_period,
            "opening_cash_balance": float(statement.opening_cash_balance),
            "closing_cash_balance": float(statement.closing_cash_balance),
            "net_change_in_cash": float(statement.net_change_in_cash or 0),
            "calculated_closing": float(calculated_closing),
            "gl_cash_balance": float(gl_cash_balance),
            "cash_accounts": cash_breakdown,
            "statement_vs_calculated_diff": float(stmt_vs_calc_diff),
            "statement_vs_gl_diff": float(stmt_vs_gl_diff),
            "is_reconciled": is_reconciled,
            "warnings": warnings,
        }

    # ── Statement CRUD ────────────────────────────────────────────────────

    def get_statement(self, statement_id: int) -> CashFlowStatement:
        statement = self.db.query(CashFlowStatement).options(
            joinedload(CashFlowStatement.lines).joinedload(CashFlowStatementLine.category)
        ).filter(CashFlowStatement.id == statement_id).first()
        if not statement:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Cash flow statement with id {statement_id} not found"
            )
        _attach_cfs_user_names(self.db, [statement])
        return statement

    def list_statements(self, filters: schemas.CashFlowStatementListFilter) -> List[CashFlowStatement]:
        query = self.db.query(CashFlowStatement)
        if filters.fiscal_year:
            query = query.filter(CashFlowStatement.fiscal_year == filters.fiscal_year)
        if filters.fiscal_period:
            query = query.filter(CashFlowStatement.fiscal_period == filters.fiscal_period)
        if filters.status:
            query = query.filter(CashFlowStatement.status == filters.status)
        statements = query.order_by(
            CashFlowStatement.fiscal_year.desc(),
            CashFlowStatement.fiscal_period.desc()
        ).all()
        _attach_cfs_user_names(self.db, statements)
        return statements

    def finalize_statement(self, statement_id: int, finalized_by: Optional[int] = None) -> CashFlowStatement:
        # Lock row to prevent concurrent status mutation
        self.db.query(CashFlowStatement).filter(CashFlowStatement.id == statement_id).with_for_update().first()
        statement = self.get_statement(statement_id)
        if statement.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot finalize statement in '{statement.status}' status"
            )
        statement.status = "final"
        log_audit(
            self.db, user_id=finalized_by or 0, action="finalize",
            entity_type="cash_flow_statement", entity_id=statement.id,
            changes={"status": "final"},
        )
        self.db.commit()
        self.db.refresh(statement)
        _attach_cfs_user_names(self.db, [statement])
        return statement

    def approve_statement(self, statement_id: int, approved_by: int) -> CashFlowStatement:
        # Lock row to prevent concurrent status mutation
        self.db.query(CashFlowStatement).filter(CashFlowStatement.id == statement_id).with_for_update().first()
        statement = self.get_statement(statement_id)
        if statement.status != "final":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve statement in '{statement.status}' status. Must be finalized first."
            )
        statement.status = "approved"
        statement.approved_by = approved_by
        statement.approved_at = tz.now()
        log_audit(
            self.db, user_id=approved_by or 0, action="approve",
            entity_type="cash_flow_statement", entity_id=statement.id,
            changes={"status": "approved"},
        )
        self.db.commit()
        self.db.refresh(statement)
        _attach_cfs_user_names(self.db, [statement])
        return statement

    def delete_statement(self, statement_id: int, deleted_by: Optional[int] = None) -> bool:
        # Lock row to prevent concurrent status mutation
        self.db.query(CashFlowStatement).filter(CashFlowStatement.id == statement_id).with_for_update().first()
        statement = self.get_statement(statement_id)
        if statement.status != "draft":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete statement in '{statement.status}' status"
            )
        log_audit(
            self.db, user_id=deleted_by or 0, action="delete",
            entity_type="cash_flow_statement", entity_id=statement_id,
            changes={"fiscal_year": statement.fiscal_year, "fiscal_period": statement.fiscal_period},
        )
        self.db.delete(statement)
        self.db.commit()
        return True


# =============================================================================
# DASHBOARD SERVICE
# =============================================================================

class AccountingDashboardService:
    def __init__(self, db: Session):
        self.db = db

    def get_stats(self) -> schemas.AccountingDashboardStats:
        today = tz.today()

        total_accounts = self.db.query(func.count(ChartOfAccounts.id)).scalar() or 0
        active_accounts = self.db.query(func.count(ChartOfAccounts.id)).filter(
            ChartOfAccounts.is_active == True
        ).scalar() or 0

        total_je = self.db.query(func.count(JournalEntry.id)).scalar() or 0
        draft_je = self.db.query(func.count(JournalEntry.id)).filter(
            JournalEntry.status == "draft"
        ).scalar() or 0
        posted_je = self.db.query(func.count(JournalEntry.id)).filter(
            JournalEntry.status == "posted"
        ).scalar() or 0

        total_gl = self.db.query(func.count(GeneralLedger.id)).scalar() or 0

        open_periods = self.db.query(func.count(AccountingPeriod.id)).filter(
            AccountingPeriod.status == "open"
        ).scalar() or 0
        closed_periods = self.db.query(func.count(AccountingPeriod.id)).filter(
            AccountingPeriod.status.in_(["closed", "locked"])
        ).scalar() or 0

        # Current period
        current_period = self.db.query(AccountingPeriod).filter(
            AccountingPeriod.start_date <= today,
            AccountingPeriod.end_date >= today,
        ).first()

        current_fy = current_period.fiscal_year if current_period else today.year
        current_fp = current_period.period_number if current_period else today.month

        # GL totals for current year
        gl_totals = self.db.query(
            func.coalesce(func.sum(GeneralLedger.debit_amount), 0),
            func.coalesce(func.sum(GeneralLedger.credit_amount), 0),
        ).filter(GeneralLedger.fiscal_year == current_fy).first()

        return schemas.AccountingDashboardStats(
            total_accounts=total_accounts,
            active_accounts=active_accounts,
            total_journal_entries=total_je,
            draft_journal_entries=draft_je,
            posted_journal_entries=posted_je,
            total_gl_entries=total_gl,
            open_periods=open_periods,
            closed_periods=closed_periods,
            current_fiscal_year=current_fy,
            current_fiscal_period=current_fp,
            total_debit=Decimal(str(gl_totals[0])) if gl_totals else Decimal("0"),
            total_credit=Decimal(str(gl_totals[1])) if gl_totals else Decimal("0"),
        )
