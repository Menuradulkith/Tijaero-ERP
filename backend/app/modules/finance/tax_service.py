"""
VAT: tax codes, the tax ledger and the VAT return (finance blueprint phase B).

How a VAT amount reaches the ledger
-----------------------------------
A posting hook marks its VAT line with a ``tax`` dict::

    {"account_code": posting_ref("OUTPUT_VAT", tax_code="VAT"), "credit": 18, ...,
     "tax": {"direction": "output", "tax_code": "VAT", "rate": 18, "base": 100}}

``GLPostingService.post`` writes the GL rows and then one ``tax_transactions``
row per marked line (``record_tax_lines``). Output VAT counts credit - debit,
input VAT debit - credit, so a sale return or a cancelled supplier invoice is
a negative row. Reversing a journal entry by hand negates its tax rows
(``reverse_tax_rows``), so the ledger always matches the GL.

Settling VAT moves every unsettled row up to a date into VAT_SETTLEMENT
(2220): Dr output VAT, Cr input VAT, net to 2220.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Any, Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core import timezone as tz

from . import accounting_schemas as schemas
from .accounting_models import (
    ChartOfAccounts,
    GeneralLedger,
    JournalEntry,
    TaxCode,
    TaxSettlement,
    TaxTransaction,
)
from .posting_rules import POSTING_TYPES, PostingRuleResolver, posting_ref

CENT = Decimal("0.01")
DIRECTIONS = ("output", "input")
TAX_TYPES = ("standard", "zero_rated", "exempt")
APPLIES_TO = ("sales", "purchases", "both")
FALLBACK_TAX_CODE = "VAT"


def _d(value: Any) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT)


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


# ─── Tax code lookup (used by the posting hooks) ─────────────────────────────
def default_tax_code(db: Session, direction: str) -> str:
    flag = TaxCode.is_default_sales if direction == "output" else TaxCode.is_default_purchases
    row = db.query(TaxCode.code).filter(flag.is_(True), TaxCode.is_active.is_(True)).first()
    return row[0] if row else FALLBACK_TAX_CODE


def sales_tax_code_for_rate(db: Session, rate: Any) -> str:
    """The sales tax code for an invoice's tax rate: an active standard code
    with exactly that rate, else the default sales code (the row keeps the
    invoice's own rate, so the VAT return still shows it)."""
    rate = Decimal(str(rate or 0))
    row = (
        db.query(TaxCode.code)
        .filter(
            TaxCode.is_active.is_(True),
            TaxCode.tax_type == "standard",
            TaxCode.applies_to.in_(("sales", "both")),
            TaxCode.rate == rate,
        )
        .order_by(TaxCode.is_default_sales.desc(), TaxCode.code)
        .first()
    )
    return row[0] if row else default_tax_code(db, "output")


def vat_line(
    direction: str,
    tax_code: str,
    *,
    debit: Decimal,
    credit: Decimal,
    base: Decimal,
    rate: Any,
    description: str,
) -> Dict[str, Any]:
    """A GL line on the output / input VAT account that also feeds the tax ledger."""
    posting_type = "OUTPUT_VAT" if direction == "output" else "INPUT_VAT"
    return {
        "account_code": posting_ref(posting_type, tax_code=tax_code),
        "debit": debit,
        "credit": credit,
        "description": description,
        "tax": {
            "direction": direction,
            "tax_code": tax_code,
            "rate": str(rate) if rate is not None else None,
            "base": str(_d(base)),
        },
    }


# ─── Ledger writers (called by the gateway / JE reversal) ────────────────────
def record_tax_lines(
    db: Session,
    *,
    journal_entry: JournalEntry,
    lines: List[Dict[str, Any]],
    reference_type: Optional[str],
    reference_id: Optional[int],
    reference_no: Optional[str],
) -> None:
    for line in lines:
        tax = line.get("tax")
        if not tax or tax.get("direction") not in DIRECTIONS:
            continue
        debit, credit = _d(line.get("debit")), _d(line.get("credit"))
        amount = credit - debit if tax["direction"] == "output" else debit - credit
        if amount == 0:
            continue
        base = abs(_d(tax.get("base")))
        rate = tax.get("rate")
        db.add(TaxTransaction(
            transaction_date=journal_entry.entry_date,
            fiscal_year=journal_entry.fiscal_year,
            fiscal_period=journal_entry.fiscal_period,
            direction=tax["direction"],
            tax_code=(tax.get("tax_code") or FALLBACK_TAX_CODE)[:20],
            tax_rate=Decimal(str(rate)) if rate not in (None, "") else None,
            base_amount=base if amount > 0 else -base,
            tax_amount=amount,
            account_id=line["account_id"],
            reference_type=reference_type,
            reference_id=reference_id,
            reference_no=reference_no,
            branch_code=journal_entry.branch_code,
            journal_entry_id=journal_entry.id,
            created_by=journal_entry.created_by,
        ))


def reverse_tax_rows(db: Session, original: JournalEntry, reversal: JournalEntry) -> None:
    """Mirror the original entry's tax rows, negated, on the reversal entry."""
    for row in db.query(TaxTransaction).filter(TaxTransaction.journal_entry_id == original.id).all():
        db.add(TaxTransaction(
            transaction_date=reversal.entry_date,
            fiscal_year=reversal.fiscal_year,
            fiscal_period=reversal.fiscal_period,
            direction=row.direction,
            tax_code=row.tax_code,
            tax_rate=row.tax_rate,
            base_amount=-row.base_amount,
            tax_amount=-row.tax_amount,
            account_id=row.account_id,
            reference_type=row.reference_type,
            reference_id=row.reference_id,
            reference_no=row.reference_no,
            branch_code=row.branch_code,
            journal_entry_id=reversal.id,
            created_by=reversal.created_by,
        ))


# ─── Tax code setup ──────────────────────────────────────────────────────────
class TaxCodeService:
    def __init__(self, db: Session):
        self.db = db

    def list_codes(self, include_inactive: bool = True) -> List[TaxCode]:
        q = self.db.query(TaxCode)
        if not include_inactive:
            q = q.filter(TaxCode.is_active.is_(True))
        return q.order_by(TaxCode.is_active.desc(), TaxCode.code).all()

    def _validate(self, data, existing: Optional[TaxCode] = None) -> None:
        tax_type = data.tax_type if data.tax_type is not None else existing.tax_type
        rate = Decimal(str(data.rate)) if data.rate is not None else existing.rate
        if tax_type not in TAX_TYPES:
            raise _bad(f"Tax type must be one of {', '.join(TAX_TYPES)}.")
        applies = data.applies_to if data.applies_to is not None else existing.applies_to
        if applies not in APPLIES_TO:
            raise _bad(f"'Used for' must be one of {', '.join(APPLIES_TO)}.")
        if not (Decimal("0") <= rate <= Decimal("100")):
            raise _bad("Rate must be between 0 and 100.")
        if tax_type != "standard" and rate != 0:
            raise _bad("Zero-rated and exempt codes have a 0% rate.")
        if tax_type == "standard" and rate == 0:
            raise _bad("A standard-rate code needs a rate above 0%. Use zero-rated for 0%.")

    def _apply_defaults(self, code: TaxCode, data) -> None:
        if data.is_default_sales:
            if code.applies_to == "purchases":
                raise _bad("A purchases-only code cannot be the default for sales.")
            self.db.query(TaxCode).filter(TaxCode.id != code.id).update({TaxCode.is_default_sales: False})
            self.db.flush()
            code.is_default_sales = True
        elif data.is_default_sales is False:
            code.is_default_sales = False
        if data.is_default_purchases:
            if code.applies_to == "sales":
                raise _bad("A sales-only code cannot be the default for purchases.")
            self.db.query(TaxCode).filter(TaxCode.id != code.id).update({TaxCode.is_default_purchases: False})
            self.db.flush()
            code.is_default_purchases = True
        elif data.is_default_purchases is False:
            code.is_default_purchases = False

    def create(self, data: schemas.TaxCodeCreate, user_id: int) -> TaxCode:
        code_str = data.code.strip().upper()
        if not code_str:
            raise _bad("Code is required.")
        if self.db.query(TaxCode.id).filter(func.upper(TaxCode.code) == code_str).first():
            raise _bad(f"Tax code {code_str} already exists.")
        self._validate(data)
        code = TaxCode(
            code=code_str, name=data.name.strip(), rate=data.rate, tax_type=data.tax_type,
            applies_to=data.applies_to, description=data.description, is_active=True,
            is_default_sales=False, is_default_purchases=False, created_by=user_id,
        )
        self.db.add(code)
        self.db.flush()
        self._apply_defaults(code, data)
        self.db.commit()
        self.db.refresh(code)
        return code

    def update(self, code_id: int, data: schemas.TaxCodeUpdate, user_id: int) -> TaxCode:
        code = self.db.query(TaxCode).filter(TaxCode.id == code_id).first()
        if code is None:
            raise HTTPException(status_code=404, detail="Tax code not found")
        used = self.db.query(TaxTransaction.id).filter(TaxTransaction.tax_code == code.code).first() is not None
        if used and (
            (data.rate is not None and Decimal(str(data.rate)) != code.rate)
            or (data.tax_type is not None and data.tax_type != code.tax_type)
        ):
            raise _bad(
                f"{code.code} is already used on posted entries, so its rate and type can't change. "
                "Create a new code (e.g. VAT-2027) and make it the default instead."
            )
        self._validate(data, existing=code)
        for field in ("name", "rate", "tax_type", "applies_to", "description"):
            value = getattr(data, field)
            if value is not None:
                setattr(code, field, value.strip() if isinstance(value, str) else value)
        if data.is_active is not None:
            if not data.is_active and (code.is_default_sales or code.is_default_purchases) and not (
                data.is_default_sales is False and data.is_default_purchases is False
            ):
                raise _bad("Make another code the default before deactivating this one.")
            code.is_active = data.is_active
        self._apply_defaults(code, data)
        code.updated_by = user_id
        self.db.commit()
        self.db.refresh(code)
        return code


# ─── VAT return + settlement ─────────────────────────────────────────────────
class VatReturnService:
    def __init__(self, db: Session):
        self.db = db

    def _vat_account_ids(self) -> Dict[str, List[int]]:
        """Every account the OUTPUT_VAT / INPUT_VAT posting types can resolve to."""
        from .accounting_models import PostingRule

        out: Dict[str, List[int]] = {}
        for direction, ptype in (("output", "OUTPUT_VAT"), ("input", "INPUT_VAT")):
            codes = {POSTING_TYPES[ptype].default_account}
            rule = self.db.query(PostingRule).filter(PostingRule.posting_type == ptype).first()
            if rule:
                if rule.account:
                    codes.add(rule.account.account_code)
                codes |= {d.account.account_code for d in rule.details if d.account}
            out[direction] = [
                i for (i,) in self.db.query(ChartOfAccounts.id).filter(ChartOfAccounts.account_code.in_(codes)).all()
            ]
        return out

    def vat_return(self, date_from: date, date_to: date, branch_code: Optional[str] = None) -> schemas.VatReturnResponse:
        if date_from > date_to:
            raise _bad("'From' date is after 'to' date.")
        q = self.db.query(
            TaxTransaction.direction,
            TaxTransaction.tax_code,
            TaxTransaction.tax_rate,
            func.count(TaxTransaction.id),
            func.coalesce(func.sum(TaxTransaction.base_amount), 0),
            func.coalesce(func.sum(TaxTransaction.tax_amount), 0),
        ).filter(TaxTransaction.transaction_date.between(date_from, date_to))
        if branch_code:
            q = q.filter(TaxTransaction.branch_code == branch_code)
        rows = q.group_by(TaxTransaction.direction, TaxTransaction.tax_code, TaxTransaction.tax_rate).all()
        names = dict(self.db.query(TaxCode.code, TaxCode.name).all())
        lines = [
            schemas.VatReturnLine(
                direction=d, tax_code=c, tax_name=names.get(c, c),
                tax_rate=r, count=int(n), base_amount=_d(b), tax_amount=_d(t),
            )
            for d, c, r, n, b, t in sorted(rows, key=lambda x: (x[0] != "output", x[1], x[2] or 0))
        ]
        output_tax = sum((l.tax_amount for l in lines if l.direction == "output"), Decimal("0"))
        input_tax = sum((l.tax_amount for l in lines if l.direction == "input"), Decimal("0"))

        # GL cross-check: VAT account movement in the period vs. the tax ledger.
        # A difference means VAT posted outside the automatic flows (e.g. a manual journal).
        accounts = self._vat_account_ids()
        gl = {}
        for direction, ids in accounts.items():
            gq = self.db.query(
                func.coalesce(func.sum(GeneralLedger.credit_amount - GeneralLedger.debit_amount), 0)
            ).filter(
                GeneralLedger.account_id.in_(ids or [0]),
                GeneralLedger.transaction_date.between(date_from, date_to),
                func.coalesce(GeneralLedger.transaction_type, "") != "VatSettlement",
            )
            if branch_code:
                gq = gq.filter(GeneralLedger.branch_code == branch_code)
            net = _d(gq.scalar())
            gl[direction] = net if direction == "output" else -net
        unsettled_q = self.db.query(
            TaxTransaction.direction, func.coalesce(func.sum(TaxTransaction.tax_amount), 0)
        ).filter(TaxTransaction.settlement_id.is_(None), TaxTransaction.transaction_date <= date_to)
        if branch_code:
            unsettled_q = unsettled_q.filter(TaxTransaction.branch_code == branch_code)
        unsettled = {d: _d(v) for d, v in unsettled_q.group_by(TaxTransaction.direction).all()}
        warnings = []
        for direction, label in (("output", "sales"), ("input", "purchases")):
            ledger = output_tax if direction == "output" else input_tax
            diff = gl[direction] - ledger
            if abs(diff) > CENT:
                warnings.append(
                    f"The VAT {label} account moved {gl[direction]} in this period but the tax ledger shows "
                    f"{ledger} (difference {diff}). Usually a manual journal posted to the VAT account; "
                    "it is not on this return."
                )
        return schemas.VatReturnResponse(
            date_from=date_from, date_to=date_to, branch_code=branch_code, lines=lines,
            output_tax=_d(output_tax), input_tax=_d(input_tax), net_tax=_d(output_tax - input_tax),
            gl_output_tax=gl["output"], gl_input_tax=gl["input"],
            unsettled_output_tax=unsettled.get("output", Decimal("0")),
            unsettled_input_tax=unsettled.get("input", Decimal("0")),
            warnings=warnings,
        )

    def transactions(
        self, date_from: date, date_to: date, *, direction: Optional[str] = None,
        tax_code: Optional[str] = None, tax_rate: Optional[Decimal] = None, branch_code: Optional[str] = None,
        skip: int = 0, limit: int = 200,
    ) -> Dict[str, Any]:
        q = self.db.query(TaxTransaction, JournalEntry.journal_entry_no).join(
            JournalEntry, JournalEntry.id == TaxTransaction.journal_entry_id
        ).filter(TaxTransaction.transaction_date.between(date_from, date_to))
        if direction:
            q = q.filter(TaxTransaction.direction == direction)
        if tax_code:
            q = q.filter(TaxTransaction.tax_code == tax_code)
        if tax_rate is not None:
            q = q.filter(TaxTransaction.tax_rate == tax_rate)
        if branch_code:
            q = q.filter(TaxTransaction.branch_code == branch_code)
        total = q.count()
        rows = q.order_by(TaxTransaction.transaction_date.desc(), TaxTransaction.id.desc()).offset(skip).limit(limit).all()
        return {
            "total": total,
            "items": [
                schemas.TaxTransactionResponse(
                    id=t.id, transaction_date=t.transaction_date, direction=t.direction, tax_code=t.tax_code,
                    tax_rate=t.tax_rate, base_amount=t.base_amount, tax_amount=t.tax_amount,
                    reference_type=t.reference_type, reference_id=t.reference_id, reference_no=t.reference_no,
                    branch_code=t.branch_code, journal_entry_id=t.journal_entry_id, journal_entry_no=je_no,
                    settlement_id=t.settlement_id,
                )
                for t, je_no in rows
            ],
        }

    def list_settlements(self) -> List[TaxSettlement]:
        return self.db.query(TaxSettlement).order_by(TaxSettlement.date_to.desc(), TaxSettlement.id.desc()).all()

    def settle(self, data: schemas.VatSettlementCreate, user_id: int) -> TaxSettlement:
        """Clear every unsettled tax row dated up to ``date_to`` into VAT_SETTLEMENT."""
        from .gl_posting_service import GLPostingService

        settle_on = data.settlement_date or data.date_to
        if settle_on < data.date_to:
            raise _bad("The settlement date can't be before the end of the period.")
        rows = (
            self.db.query(TaxTransaction)
            .filter(TaxTransaction.settlement_id.is_(None), TaxTransaction.transaction_date <= data.date_to)
            .with_for_update()
            .all()
        )
        if not rows:
            raise _bad("There is no unsettled VAT up to this date.")
        # One clearing line per (direction, account) so split VAT accounts each clear exactly.
        sums: Dict[tuple, Decimal] = {}
        for r in rows:
            sums[(r.direction, r.account_id)] = sums.get((r.direction, r.account_id), Decimal("0")) + Decimal(r.tax_amount)
        codes = dict(self.db.query(ChartOfAccounts.id, ChartOfAccounts.account_code).filter(
            ChartOfAccounts.id.in_({k[1] for k in sums})).all())
        output_tax = sum((v for (d, _), v in sums.items() if d == "output"), Decimal("0"))
        input_tax = sum((v for (d, _), v in sums.items() if d == "input"), Decimal("0"))
        net = output_tax - input_tax

        count = self.db.query(func.count(TaxSettlement.id)).scalar() or 0
        settlement = TaxSettlement(
            settlement_no=f"VAT-{data.date_to.strftime('%Y%m')}-{count + 1:03d}",
            date_to=data.date_to, settlement_date=settle_on,
            output_tax=_d(output_tax), input_tax=_d(input_tax), net_tax=_d(net),
            notes=data.notes, created_by=user_id,
        )
        self.db.add(settlement)
        self.db.flush()

        lines: List[Dict[str, Any]] = []
        for (direction, account_id), amount in sorted(sums.items(), key=lambda kv: (kv[0][0], codes[kv[0][1]])):
            if amount == 0:
                continue
            # Output VAT carries a credit balance (debit it to clear); input VAT a debit balance.
            if direction == "output":
                dr, cr = (amount, Decimal("0")) if amount > 0 else (Decimal("0"), -amount)
            else:
                dr, cr = (Decimal("0"), amount) if amount > 0 else (-amount, Decimal("0"))
            lines.append({"account_code": codes[account_id], "debit": dr, "credit": cr,
                          "description": f"VAT {direction} cleared - {settlement.settlement_no}"})
        if net != 0:
            lines.append({
                "account_code": posting_ref("VAT_SETTLEMENT"),
                "debit": Decimal("0") if net > 0 else -net,
                "credit": net if net > 0 else Decimal("0"),
                "description": f"VAT {'payable' if net > 0 else 'refundable'} - {settlement.settlement_no}",
            })
        if len(lines) >= 2:
            result = GLPostingService(self.db).post(
                reference_type="TaxSettlement", reference_id=settlement.id, reference_no=settlement.settlement_no,
                lines=lines, entry_date=settle_on,
                description=f"VAT settlement {settlement.settlement_no} up to {data.date_to}",
                branch_code=None, user_id=user_id, transaction_type="VatSettlement",
                je_prefix="JE-VAT", source_module="finance", record_failure=False,
            )
            if not result.posted:
                self.db.rollback()
                raise _bad(f"The settlement could not be posted: {result.error_message}")
            settlement.journal_entry_id = result.journal_entry.id
        for r in rows:
            r.settlement_id = settlement.id
        self.db.commit()
        self.db.refresh(settlement)
        return settlement
