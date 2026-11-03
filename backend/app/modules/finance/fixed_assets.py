"""
Fixed assets (finance blueprint phase E, IFS FaObject / FaMethod / DeprProposal).

* Asset classes give the cost account and the default depreciation.
* Registering an asset can also book its purchase:
      Dr <class asset account> / Cr bank | cash | supplier | opening balance equity
  or record an asset that is already in the books (no entry).
* A monthly depreciation run posts, per branch,
      Dr 5170 Depreciation expense (asset's cost center) / Cr 1330 Accumulated depreciation
  straight-line = (cost - salvage) / life months; declining = book value x rate / 12.
  An asset never goes below its salvage value. Only the latest run can be reversed.
* Selling or scrapping removes the asset at book value:
      Dr 1330 accumulated, Dr bank/cash proceeds, Cr asset account cost, gain or loss for the rest.
"""
from __future__ import annotations

import calendar
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core import timezone as tz

from . import accounting_schemas as schemas
from .accounting_models import AssetClass, ChartOfAccounts, DepreciationLine, DepreciationRun, FixedAsset
from .posting_rules import POSTING_TYPES, posting_ref

POSTING_TYPES_ACCUM_DEFAULT = POSTING_TYPES["ACCUM_DEPRECIATION"].default_account

CENT = Decimal("0.01")
METHODS = ("straight_line", "declining")
# ChartOfAccounts.account_category values that hold long-term assets (same list the balance sheet uses).
FIXED_ASSET_CATEGORIES = ("Fixed Asset", "Non-Current Asset", "Intangible Asset", "Other Asset")
RECEIVED_INTO = {"bank": "BANK", "cash": "CASH"}
# How a newly registered asset was paid for -> the account credited.
FUNDING = {
    "bank": "BANK",
    "cash": "CASH",
    "supplier": "AP_TRADE",
    "opening": "OPENING_BALANCE_EQUITY",
}


def _d(v) -> Decimal:
    return Decimal(str(v or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _month_end(year: int, month: int) -> date:
    return date(year, month, calendar.monthrange(year, month)[1])


def _next_month_start(d: date) -> date:
    return date(d.year + (d.month == 12), 1 if d.month == 12 else d.month + 1, 1)


def monthly_depreciation(asset: FixedAsset) -> Decimal:
    """This month's depreciation for an active asset, capped at what is left above salvage."""
    cost, salvage, acc = _d(asset.cost), _d(asset.salvage_value), _d(asset.accumulated_depreciation)
    remaining = cost - salvage - acc
    if remaining <= 0:
        return Decimal("0")
    if asset.depreciation_method == "declining":
        amount = (cost - acc) * Decimal(str(asset.declining_rate or 0)) / Decimal("1200")
    else:
        amount = (cost - salvage) / Decimal(max(int(asset.useful_life_months or 1), 1))
    return min(_d(amount), remaining)


class FixedAssetService:
    def __init__(self, db: Session):
        self.db = db

    # ─── Classes ──────────────────────────────────────────────────────────
    def list_classes(self) -> List[AssetClass]:
        return self.db.query(AssetClass).order_by(AssetClass.is_active.desc(), AssetClass.code).all()

    def _check_class(self, account_id: int, method: str, rate) -> None:
        acc = self.db.query(ChartOfAccounts).filter(ChartOfAccounts.id == account_id).first()
        if acc is None or not acc.is_active or acc.account_type != "Asset":
            raise _bad("Choose an active asset account for the asset's cost.")
        if self.db.query(ChartOfAccounts.id).filter(ChartOfAccounts.parent_account_id == acc.id,
                                                    ChartOfAccounts.is_active.is_(True)).first():
            raise _bad(f"{acc.account_code} is a heading account; choose one under it.")
        from .posting_rules import PostingRuleResolver

        accum = {POSTING_TYPES_ACCUM_DEFAULT, PostingRuleResolver(self.db).resolve("ACCUM_DEPRECIATION")}
        if acc.account_category not in FIXED_ASSET_CATEGORIES or acc.account_code in accum:
            raise _bad(
                f"{acc.account_code} {acc.account_name} is not a fixed-asset account. Choose the account that "
                "holds what the assets cost (like 1310 Equipment) - not cash, bank, stock or accumulated depreciation."
            )
        if method not in METHODS:
            raise _bad("Method must be straight_line or declining.")
        if method == "declining" and not (rate and Decimal(str(rate)) > 0):
            raise _bad("A declining-balance class needs a yearly rate above 0%.")

    def create_class(self, data: schemas.AssetClassCreate, user_id: int) -> AssetClass:
        code = data.code.strip().upper()
        if self.db.query(AssetClass.id).filter(func.upper(AssetClass.code) == code).first():
            raise _bad(f"Asset class {code} already exists.")
        self._check_class(data.asset_account_id, data.depreciation_method, data.declining_rate)
        c = AssetClass(code=code, name=data.name.strip(), asset_account_id=data.asset_account_id,
                       depreciation_method=data.depreciation_method, useful_life_months=data.useful_life_months,
                       declining_rate=data.declining_rate, description=data.description, is_active=True,
                       created_by=user_id)
        self.db.add(c)
        self.db.commit()
        self.db.refresh(c)
        return c

    def update_class(self, class_id: int, data: schemas.AssetClassUpdate, user_id: int) -> AssetClass:
        c = self.db.query(AssetClass).filter(AssetClass.id == class_id).first()
        if c is None:
            raise _bad("Asset class not found", status.HTTP_404_NOT_FOUND)
        fields = data.model_dump(exclude_unset=True)
        if "asset_account_id" in fields and fields["asset_account_id"] != c.asset_account_id:
            if self.db.query(FixedAsset.id).filter(FixedAsset.asset_class_id == c.id).first():
                raise _bad("Assets already use this class, so its cost account can't change.")
        for k, v in fields.items():
            setattr(c, k, v)
        self._check_class(c.asset_account_id, c.depreciation_method, c.declining_rate)
        c.updated_by = user_id
        self.db.commit()
        self.db.refresh(c)
        return c

    # ─── Assets ───────────────────────────────────────────────────────────
    def _next_no(self) -> str:
        prefix = "FA-"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": prefix})
        last = (
            self.db.query(FixedAsset.asset_no).filter(FixedAsset.asset_no.like(f"{prefix}%"))
            .order_by(func.length(FixedAsset.asset_no).desc(), FixedAsset.asset_no.desc()).first()
        )
        seq = int(last[0][len(prefix):]) + 1 if last and last[0][len(prefix):].isdigit() else 1
        return f"{prefix}{seq:05d}"

    def _post(self, *, reference_id: int, reference_no: str, lines, on: date, description: str,
              branch_code: Optional[str], user_id: int, marker: str, reference_type: str = "FixedAsset"):
        from .gl_posting_service import GLPostingService

        result = GLPostingService(self.db).post(
            reference_type=reference_type, reference_id=reference_id, reference_no=reference_no, lines=lines,
            entry_date=on, description=description, branch_code=branch_code, user_id=user_id,
            transaction_type="FixedAsset", je_prefix="JE-FA", source_module="finance", marker=marker,
            record_failure=False,
        )
        if not result.posted:
            self.db.rollback()
            raise _bad(f"The entry could not be posted: {result.error_message}")
        return result.journal_entry

    def register(self, data: schemas.FixedAssetCreate, user_id: int) -> FixedAsset:
        cls = self.db.query(AssetClass).filter(AssetClass.id == data.asset_class_id).first()
        if cls is None or not cls.is_active:
            raise _bad("Choose an active asset class.")
        cost, salvage = _d(data.cost), _d(data.salvage_value)
        if cost <= 0:
            raise _bad("The cost must be more than zero.")
        if salvage < 0 or salvage >= cost:
            raise _bad("The value at the end of its life must be less than the cost.")
        if data.acquisition_date > tz.today():
            raise _bad("The purchase date can't be in the future.", status.HTTP_400_BAD_REQUEST)
        if data.funding not in ("existing", *FUNDING):
            raise _bad("Say how the asset was paid for.")
        if data.funding != "existing":
            # the purchase is booked on this date, so it must be in an open period
            # (an asset already in the books posts nothing and may be years old)
            from .posting_dates import check_posting_date, require_open_period

            check_posting_date(self.db, data.acquisition_date, "The purchase date")
            require_open_period(self.db, data.acquisition_date, "The purchase date")
        if data.depreciation_start and data.depreciation_start < data.acquisition_date:
            raise _bad("Depreciation can't start before the asset was bought.")
        method = data.depreciation_method or cls.depreciation_method
        if method not in METHODS:
            raise _bad("Method must be straight_line or declining.")
        rate = data.declining_rate if data.declining_rate is not None else cls.declining_rate
        if method == "declining" and not (rate and Decimal(str(rate)) > 0):
            raise _bad("A declining-balance asset needs a yearly rate above 0%.")
        asset = FixedAsset(
            asset_no=self._next_no(), name=data.name.strip(), asset_class_id=cls.id, branch_code=data.branch_code,
            cost_center_id=data.cost_center_id, serial_no=data.serial_no, location=data.location,
            acquisition_date=data.acquisition_date, cost=cost, salvage_value=salvage,
            useful_life_months=data.useful_life_months or cls.useful_life_months, depreciation_method=method,
            declining_rate=rate,
            # bought mid-month: depreciation starts the next month
            depreciation_start=data.depreciation_start or (
                _next_month_start(data.acquisition_date) if data.acquisition_date.day > 1 else data.acquisition_date
            ),
            accumulated_depreciation=_d(data.accumulated_depreciation), status="active", notes=data.notes,
            created_by=user_id,
        )
        if asset.accumulated_depreciation > cost - salvage:
            raise _bad("Depreciation already taken can't be more than cost minus end-of-life value.")
        self.db.add(asset)
        self.db.flush()
        if data.funding != "existing":
            label = f"{asset.asset_no} {asset.name}"
            lines = [
                {"account_code": cls.asset_account.account_code, "debit": cost, "credit": Decimal("0"),
                 "description": f"Asset bought - {label}"},
                {"account_code": posting_ref(FUNDING[data.funding]), "debit": Decimal("0"), "credit": cost,
                 "description": f"Asset bought - {label}"},
            ]
            if asset.accumulated_depreciation > 0 and data.funding == "opening":
                # an asset brought in part-depreciated: its accumulated depreciation comes with it
                acc = asset.accumulated_depreciation
                lines[1]["credit"] = cost - acc
                lines.append({"account_code": posting_ref("ACCUM_DEPRECIATION"), "debit": Decimal("0"),
                              "credit": acc, "description": f"Depreciation already taken - {label}"})
            je = self._post(reference_id=asset.id, reference_no=asset.asset_no, lines=lines,
                            on=asset.acquisition_date, description=f"Fixed asset acquired | {label}",
                            branch_code=asset.branch_code, user_id=user_id, marker=f"FA Acquire {asset.id}")
            asset.acquisition_journal_entry_id = je.id
        self.db.commit()
        self.db.refresh(asset)
        return asset

    def list_assets(self, status_filter: Optional[str] = None, branch_codes: Optional[List[str]] = None) -> List[FixedAsset]:
        q = self.db.query(FixedAsset)
        if status_filter:
            q = q.filter(FixedAsset.status == status_filter)
        if branch_codes is not None:
            q = q.filter(FixedAsset.branch_code.in_(branch_codes))
        return q.order_by(FixedAsset.asset_no).all()

    def response(self, a: FixedAsset) -> schemas.FixedAssetResponse:
        book = _d(a.cost) - _d(a.accumulated_depreciation)
        return schemas.FixedAssetResponse(
            id=a.id, asset_no=a.asset_no, name=a.name, asset_class_id=a.asset_class_id,
            asset_class_name=a.asset_class.name if a.asset_class else None, branch_code=a.branch_code,
            cost_center_id=a.cost_center_id, serial_no=a.serial_no, location=a.location,
            acquisition_date=a.acquisition_date, cost=_d(a.cost), salvage_value=_d(a.salvage_value),
            useful_life_months=a.useful_life_months, depreciation_method=a.depreciation_method,
            declining_rate=a.declining_rate, depreciation_start=a.depreciation_start,
            accumulated_depreciation=_d(a.accumulated_depreciation), book_value=book,
            monthly_depreciation=monthly_depreciation(a) if a.status == "active" else Decimal("0"),
            status=a.status, disposal_date=a.disposal_date, disposal_proceeds=a.disposal_proceeds, notes=a.notes,
        )

    # ─── Depreciation ─────────────────────────────────────────────────────
    def preview(self, year: int, month: int) -> List[schemas.DepreciationPreviewLine]:
        end = _month_end(year, month)
        out = []
        for a in self.db.query(FixedAsset).filter(FixedAsset.status == "active", FixedAsset.depreciation_start <= end).all():
            amount = monthly_depreciation(a)
            if amount > 0:
                out.append(schemas.DepreciationPreviewLine(asset_id=a.id, asset_no=a.asset_no, name=a.name,
                                                           branch_code=a.branch_code, amount=amount))
        return out

    def run(self, year: int, month: int, user_id: int) -> DepreciationRun:
        if not (1 <= month <= 12):
            raise _bad("Month must be 1-12.")
        end = _month_end(year, month)
        if end > _month_end(tz.today().year, tz.today().month):
            raise _bad("Depreciation can't be run for a future month.")
        # Run during the current month: the month's charge is dated today, not on
        # the month-end still ahead, so today's balance sheet includes it.
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext('fa-depreciation-run'))"))
        if self.db.query(DepreciationRun.id).filter(DepreciationRun.period_year == year, DepreciationRun.period_month == month,
                                                    DepreciationRun.status == "posted").first():
            raise _bad(f"Depreciation for {year}-{month:02d} has already been posted.")
        later = self.db.query(DepreciationRun.id).filter(
            DepreciationRun.status == "posted",
            (DepreciationRun.period_year * 12 + DepreciationRun.period_month) > year * 12 + month).first()
        if later:
            raise _bad("A later month is already depreciated. Reverse it first to run an earlier month.")
        assets = (
            self.db.query(FixedAsset)
            .filter(FixedAsset.status == "active", FixedAsset.depreciation_start <= end)
            .with_for_update().all()
        )
        run = DepreciationRun(period_year=year, period_month=month, run_date=end, total=0, status="posted",
                              created_by=user_id)
        self.db.add(run)
        self.db.flush()
        by_branch: Dict[Optional[str], List] = {}
        for a in assets:
            amount = monthly_depreciation(a)
            if amount > 0:
                by_branch.setdefault(a.branch_code, []).append((a, amount))
        if not by_branch:
            self.db.rollback()
            raise _bad("Nothing to depreciate for this month.")
        total = Decimal("0")
        for branch, items in by_branch.items():
            lines = []
            for a, amount in items:
                lines.append({"account_code": posting_ref("DEPRECIATION_EXPENSE"), "debit": amount, "credit": Decimal("0"),
                              "description": f"Depreciation {year}-{month:02d} - {a.asset_no} {a.name}",
                              "cost_center": a.cost_center_id})
                lines.append({"account_code": posting_ref("ACCUM_DEPRECIATION"), "debit": Decimal("0"), "credit": amount,
                              "description": f"Depreciation {year}-{month:02d} - {a.asset_no}"})
            # A run's id is not an asset id: its own reference type keeps the two apart.
            je = self._post(reference_type="DepreciationRun", reference_id=run.id, reference_no=f"DEP-{year}-{month:02d}", lines=lines, on=min(end, tz.today()),
                            description=f"Depreciation {year}-{month:02d}" + (f" | {branch}" if branch else ""),
                            branch_code=branch, user_id=user_id, marker=f"FA Depreciation run {run.id} {branch or '-'}")
            for a, amount in items:
                run.lines.append(DepreciationLine(asset_id=a.id, amount=amount, journal_entry_id=je.id, created_by=user_id))
                a.accumulated_depreciation = _d(a.accumulated_depreciation) + amount
                if _d(a.cost) - _d(a.salvage_value) - _d(a.accumulated_depreciation) <= 0:
                    a.status = "fully_depreciated"
                total += amount
        run.total = total
        self.db.commit()
        self.db.refresh(run)
        return run

    def list_runs(self) -> List[DepreciationRun]:
        return self.db.query(DepreciationRun).order_by(DepreciationRun.period_year.desc(),
                                                       DepreciationRun.period_month.desc(), DepreciationRun.id.desc()).all()

    def reverse_run(self, run_id: int, user_id: int) -> DepreciationRun:
        from .accounting_service import JournalEntryService

        run = self.db.query(DepreciationRun).filter(DepreciationRun.id == run_id).with_for_update().first()
        if run is None:
            raise _bad("Depreciation run not found", status.HTTP_404_NOT_FOUND)
        if run.status != "posted":
            raise _bad("This run is already reversed.")
        latest = self.db.query(DepreciationRun).filter(DepreciationRun.status == "posted").order_by(
            DepreciationRun.period_year.desc(), DepreciationRun.period_month.desc()).first()
        if latest.id != run.id:
            raise _bad("Only the latest month's depreciation can be reversed.")
        if any(l.asset.status in ("sold", "scrapped") for l in run.lines):
            raise _bad("An asset in this run has been sold or scrapped since; its depreciation can't be undone.")
        je_svc = JournalEntryService(self.db)
        for je_id in {l.journal_entry_id for l in run.lines if l.journal_entry_id}:
            je_svc.reverse_journal_entry(je_id, reversed_by=user_id, reason=f"Depreciation {run.period_year}-{run.period_month:02d} reversed",
                                         # today: the run posted on or before today, and a
                                         # reversal is never dated in the future
                                         reversal_date=tz.today(), commit=False)
        for l in run.lines:
            l.asset.accumulated_depreciation = _d(l.asset.accumulated_depreciation) - _d(l.amount)
            if l.asset.status == "fully_depreciated":
                l.asset.status = "active"
        run.status = "reversed"
        self.db.commit()
        self.db.refresh(run)
        return run

    # ─── Disposal ─────────────────────────────────────────────────────────
    def dispose(self, asset_id: int, data: schemas.FixedAssetDispose, user_id: int,
                allowed_branches: Optional[List[str]] = None) -> FixedAsset:
        a = self.db.query(FixedAsset).filter(FixedAsset.id == asset_id).with_for_update().first()
        if a is None:
            raise _bad("Asset not found", status.HTTP_404_NOT_FOUND)
        if allowed_branches is not None and a.branch_code not in allowed_branches:
            raise _bad(f"Access denied to branch: {a.branch_code}", status.HTTP_403_FORBIDDEN)
        if a.status not in ("active", "fully_depreciated"):
            raise _bad(f"This asset is already {a.status}.")
        on = data.disposal_date or tz.today()
        from .posting_dates import check_posting_date

        check_posting_date(self.db, on, "The disposal date")
        if on < a.acquisition_date:
            raise _bad("The disposal date must be between the purchase date and today.")
        if data.kind not in ("sold", "scrapped"):
            raise _bad("Choose sold or scrapped.")
        if data.kind == "scrapped" and _d(data.proceeds) != 0:
            raise _bad("A scrapped asset brings in no money. If it was sold, choose sold and enter the price.")
        proceeds = _d(data.proceeds) if data.kind == "sold" else Decimal("0")
        if data.kind == "sold" and proceeds <= 0:
            raise _bad("Enter what the asset was sold for.")
        if data.kind == "sold" and data.received_into not in RECEIVED_INTO:
            raise _bad("Say where the sale money went: bank or cash.")
        cost, acc = _d(a.cost), _d(a.accumulated_depreciation)
        result = proceeds - (cost - acc)
        label = f"{a.asset_no} {a.name}"
        lines = [
            {"account_code": a.asset_class.asset_account.account_code, "debit": Decimal("0"), "credit": cost,
             "description": f"Asset {data.kind} - {label}"},
        ]
        if acc > 0:
            lines.append({"account_code": posting_ref("ACCUM_DEPRECIATION"), "debit": acc, "credit": Decimal("0"),
                          "description": f"Depreciation cleared - {label}"})
        if proceeds > 0:
            lines.append({"account_code": posting_ref(RECEIVED_INTO[data.received_into]),
                          "debit": proceeds, "credit": Decimal("0"), "description": f"Sale proceeds - {label}"})
        if result > 0:
            lines.append({"account_code": posting_ref("ASSET_DISPOSAL_GAIN"), "debit": Decimal("0"), "credit": result,
                          "description": f"Gain on disposal - {label}", "cost_center": a.cost_center_id})
        elif result < 0:
            lines.append({"account_code": posting_ref("ASSET_DISPOSAL_LOSS"), "debit": -result, "credit": Decimal("0"),
                          "description": f"Loss on disposal - {label}", "cost_center": a.cost_center_id})
        je = self._post(reference_id=a.id, reference_no=a.asset_no, lines=lines, on=on,
                        description=f"Fixed asset {data.kind} | {label}", branch_code=a.branch_code,
                        user_id=user_id, marker=f"FA Dispose {a.id}")
        a.status = data.kind
        a.disposal_date = on
        a.disposal_proceeds = proceeds
        a.disposal_journal_entry_id = je.id
        if data.notes:
            a.notes = ((a.notes + "\n") if a.notes else "") + data.notes
        self.db.commit()
        self.db.refresh(a)
        return a
