"""Stock counts (central stock phase 5): count the available stock of a branch and post
the differences to the stock ledger and the GL.

Mounted at /api/v1/inventory/stock-counts.

Flow: ``POST /`` snapshots every available stock row of the branch (optionally one
location / one item category) as a line with its system quantity and issue unit cost;
users enter counted quantities (``PUT /{id}/lines``) and add stock found that the
system did not know (``POST /{id}/lines``); ``POST /{id}/post`` adjusts stock:

* the difference is taken against the row's *current* quantity — a row sold or moved
  since the snapshot counts as 0 — so a count never re-adds what a sale already took;
* a decrease writes the units off (status ``adjusted_out``; a partly missing lot is
  split first), an increase raises the lot or creates a new stock row (found lines);
* every movement is a ``count_adjustment`` in the stock ledger with the count number
  as reference; weighted-average items re-average on gains (ledger hook);
* one journal entry: gains Dr Inventory / Cr Stock count gains, losses Dr Stock count
  losses / Cr Inventory, valued at each line's unit cost.

Stock rows hold whole units, so counted quantities must be whole numbers.
"""

from __future__ import annotations

import logging
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, case, func, or_, text
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_user, get_user_branch_filter
from app.auth.models import Branch, User
from app.auth.rbac import Permissions, require_permission, user_has_permission
from app.common.audit import log_audit
from app.common.enums import StockStatus
from app.core import timezone as tz
from app.db.session import get_db
from app.modules.common.models import Locations
from app.modules.inventory.costing import default_item_cost, issue_unit_cost
from app.modules.inventory.ledger import stock_reference
from app.modules.inventory.lots import split_lot
from app.modules.inventory.models import SalesStock, StockCount, StockCountLine
from app.modules.materials.models import Material, MaterialCategory
from app.utils.csv_export import build_csv_response

logger = logging.getLogger(__name__)
router = APIRouter()

CENT = Decimal("0.01")
COUNTING, POSTED, CANCELLED = "counting", "posted", "cancelled"
_STATUSES = (COUNTING, POSTED, CANCELLED)


# ─────────────────────────────── schemas ───────────────────────────────
_Qty = Field(None, ge=0, max_digits=18, decimal_places=3)


class StockCountCreate(BaseModel):
    branch_code: str = Field(..., min_length=1, max_length=200)
    location_id: Optional[int] = None
    category_id: Optional[int] = None
    remark: Optional[str] = Field(None, max_length=2000)


class StockCountLineUpdate(BaseModel):
    id: int
    counted_quantity: Optional[Decimal] = _Qty
    remark: Optional[str] = Field(None, max_length=1000)


class StockCountLinesUpdate(BaseModel):
    lines: List[StockCountLineUpdate] = Field(..., max_length=5000)


class StockCountFoundLine(BaseModel):
    material_id: int
    location_id: int
    counted_quantity: Decimal = Field(..., gt=0, max_digits=18, decimal_places=3)
    batch_no: Optional[str] = Field(None, max_length=100)
    barcode: Optional[str] = Field(None, max_length=200)
    expiry_date: Optional[date] = None
    unit_cost: Optional[Decimal] = Field(None, ge=0, max_digits=18, decimal_places=2)

    @field_validator("batch_no", "barcode")
    @classmethod
    def _strip(cls, v):
        v = (v or "").strip()
        return v or None


class StockCountCancel(BaseModel):
    reason: str = Field(..., min_length=1, max_length=1000)

    @field_validator("reason")
    @classmethod
    def _reason(cls, v):
        if not v.strip():
            raise ValueError("Enter the reason for cancelling the count")
        return v.strip()


# ─────────────────────────────── helpers ───────────────────────────────
def _bad(detail: str, code: int = status.HTTP_422_UNPROCESSABLE_ENTITY) -> HTTPException:
    return HTTPException(status_code=code, detail=detail)


def _check_branch(branch_code: str, user_branches: Optional[List[str]]) -> None:
    if user_branches is not None and branch_code not in user_branches:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {branch_code}")


def _whole(qty: Optional[Decimal], what: str = "Counted quantity") -> None:
    if qty is not None and qty != qty.to_integral_value():
        raise _bad(f"{what} must be a whole number: stock is kept in whole units")


def _money(value) -> Decimal:
    return Decimal(str(value or 0)).quantize(CENT, ROUND_HALF_UP)


def _is_serial(line: StockCountLine, tracking: Optional[str]) -> bool:
    return bool(line.barcode) or tracking == "serial"


def _get(db: Session, count_id: int, user_branches, *, lock: bool = False) -> StockCount:
    query = db.query(StockCount).filter(StockCount.id == count_id)
    if lock:
        query = query.with_for_update()
    count = query.first()
    if count is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stock count not found")
    _check_branch(count.branch_code, user_branches)
    return count


def _require_counting(count: StockCount) -> None:
    if count.status != COUNTING:
        raise _bad(f"Stock count {count.count_no} is {count.status}; only a count in progress can be changed",
                   status.HTTP_409_CONFLICT)


def _next_count_no(db: Session, branch_code: str) -> str:
    prefix = f"SC-{branch_code or 'HQ'}-{str(tz.year())[-2:]}"
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:p))"), {"p": prefix})
    last = (db.query(StockCount.count_no).filter(StockCount.count_no.like(f"{prefix}%"))
            .order_by(StockCount.id.desc()).first())
    seq = 1
    if last:
        try:
            seq = int(last[0][len(prefix):]) + 1
        except ValueError:
            seq = 1
    return f"{prefix}{seq:05d}"


def _line_difference(count: StockCount, line: StockCountLine) -> Optional[Decimal]:
    if count.status == POSTED:
        return line.difference
    if line.counted_quantity is None:
        return None
    return Decimal(line.counted_quantity) - Decimal(line.system_quantity or 0)


def _diff_sql():
    """Line difference in SQL (posted counts: what was posted; else counted - system)."""
    return case(
        (StockCount.status == POSTED, StockCountLine.difference),
        else_=StockCountLine.counted_quantity - StockCountLine.system_quantity,
    )


def _stats(db: Session, count_ids: List[int]) -> Dict[int, dict]:
    if not count_ids:
        return {}
    diff = _diff_sql()
    value = diff * StockCountLine.unit_cost
    rows = (
        db.query(
            StockCountLine.count_id,
            func.count(StockCountLine.id),
            func.count(StockCountLine.counted_quantity),
            func.count(case((and_(diff.isnot(None), diff != 0), 1))),
            func.coalesce(func.sum(case((diff > 0, value), else_=0)), 0),
            func.coalesce(func.sum(case((diff < 0, -value), else_=0)), 0),
        )
        .join(StockCount, StockCount.id == StockCountLine.count_id)
        .filter(StockCountLine.count_id.in_(count_ids))
        .group_by(StockCountLine.count_id)
        .all()
    )
    return {r[0]: dict(line_count=r[1], counted_count=r[2], difference_count=r[3],
                       gain_value=_money(r[4]), loss_value=_money(r[5])) for r in rows}


def _names(db: Session, ids) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    out = {}
    for u in db.query(User.id, User.first_name, User.last_name, User.username).filter(User.id.in_(ids)):
        out[u.id] = " ".join(p for p in (u.first_name, u.last_name) if p) or u.username
    return out


def _headers(db: Session, counts: List[StockCount], show_cost: bool) -> List[dict]:
    from app.modules.finance.accounting_models import JournalEntry

    stats = _stats(db, [c.id for c in counts])
    names = _names(db, [c.created_by for c in counts] + [c.posted_by for c in counts])
    branches = dict(db.query(Branch.branch_code, Branch.branch_name).filter(
        Branch.branch_code.in_({c.branch_code for c in counts})).all()) if counts else {}
    loc_ids = {c.location_id for c in counts if c.location_id}
    locations = dict(db.query(Locations.id, Locations.name).filter(Locations.id.in_(loc_ids)).all()) if loc_ids else {}
    cat_ids = {c.category_id for c in counts if c.category_id}
    categories = dict(db.query(MaterialCategory.id, MaterialCategory.name).filter(
        MaterialCategory.id.in_(cat_ids)).all()) if cat_ids else {}
    je_ids = {c.journal_entry_id for c in counts if c.journal_entry_id}
    journals = dict(db.query(JournalEntry.id, JournalEntry.journal_entry_no).filter(
        JournalEntry.id.in_(je_ids)).all()) if je_ids else {}
    out = []
    for c in counts:
        st = stats.get(c.id, dict(line_count=0, counted_count=0, difference_count=0,
                                  gain_value=Decimal("0.00"), loss_value=Decimal("0.00")))
        out.append({
            "id": c.id,
            "count_no": c.count_no,
            "branch_code": c.branch_code,
            "branch_name": branches.get(c.branch_code),
            "location_id": c.location_id,
            "location_name": locations.get(c.location_id),
            "category_id": c.category_id,
            "category_name": categories.get(c.category_id),
            "status": c.status,
            "remark": c.remark,
            "created_by_name": names.get(c.created_by),
            "created_at": c.created_at,
            "posted_by_name": names.get(c.posted_by),
            "posted_at": c.posted_at,
            "cancel_reason": c.cancel_reason,
            "journal_entry_id": c.journal_entry_id,
            "journal_entry_no": journals.get(c.journal_entry_id),
            "line_count": st["line_count"],
            "counted_count": st["counted_count"],
            "difference_count": st["difference_count"],
            "gain_value": st["gain_value"] if show_cost else None,
            "loss_value": st["loss_value"] if show_cost else None,
            "net_value": (st["gain_value"] - st["loss_value"]) if show_cost else None,
        })
    return out


def _full(db: Session, count: StockCount, show_cost: bool) -> dict:
    out = _headers(db, [count], show_cost)[0]
    lines = (
        db.query(StockCountLine, Material.item_code, Material.name, Material.unit_of_measure,
                 Material.tracking_type, Locations.name)
        .join(Material, Material.id == StockCountLine.material_id)
        .outerjoin(Locations, Locations.id == StockCountLine.location_id)
        .filter(StockCountLine.count_id == count.id)
        .order_by(Material.item_code, Locations.name, StockCountLine.batch_no, StockCountLine.barcode,
                  StockCountLine.id)
        .all()
    )
    items = []
    for line, code, name, uom, tracking, loc_name in lines:
        diff = _line_difference(count, line)
        items.append({
            "id": line.id,
            "stock_id": line.stock_id,
            "material_id": line.material_id,
            "material_item_code": code,
            "material_name": name,
            "unit_of_measure": uom,
            "tracking_type": tracking,
            "location_id": line.location_id,
            "location_name": loc_name,
            "batch_no": line.batch_no,
            "barcode": line.barcode,
            "expiry_date": line.expiry_date,
            "system_quantity": line.system_quantity,
            "counted_quantity": line.counted_quantity,
            "difference": diff,
            "unit_cost": line.unit_cost if show_cost else None,
            "difference_value": (_money(diff * Decimal(line.unit_cost)) if diff is not None else None)
            if show_cost else None,
            "is_found": bool(line.is_found),
            "remark": line.remark,
        })
    out["lines"] = items
    return out


def _show_cost(user: User) -> bool:
    return user_has_permission(user, *Permissions.COST_PRICE_VIEW)


# ─────────────────────────────── list / get ───────────────────────────────
_view = Depends(require_permission(*Permissions.STOCK_COUNT_VIEW))
_create = Depends(require_permission(*Permissions.STOCK_COUNT_CREATE))
_post = Depends(require_permission(*Permissions.STOCK_COUNT_POST))


@router.get("/", dependencies=[_view])
def list_stock_counts(
    branch_code: Optional[str] = Query(None, max_length=200),
    status_: Optional[str] = Query(None, alias="status"),
    search: Optional[str] = Query(None, max_length=100),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    query = db.query(StockCount)
    if branch_code:
        _check_branch(branch_code, user_branches)
        query = query.filter(StockCount.branch_code == branch_code)
    elif user_branches is not None:
        query = query.filter(StockCount.branch_code.in_(user_branches))
    if status_:
        if status_ not in _STATUSES:
            raise _bad(f"status must be one of: {', '.join(_STATUSES)}")
        query = query.filter(StockCount.status == status_)
    if search and search.strip():
        like = f"%{search.strip()}%"
        query = query.filter(or_(StockCount.count_no.ilike(like), StockCount.remark.ilike(like)))
    total = query.count()
    counts = query.order_by(StockCount.id.desc()).offset(skip).limit(limit).all()
    return {"items": _headers(db, counts, _show_cost(current_user)), "total": total}


@router.get("/{count_id}", dependencies=[_view])
def get_stock_count(
    count_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    return _full(db, _get(db, count_id, user_branches), _show_cost(current_user))


@router.get("/{count_id}/export-csv", dependencies=[_view])
def export_stock_count(
    count_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    count = _get(db, count_id, user_branches)
    data = _full(db, count, False)
    return build_csv_response(
        filename=f"stock_count_{count.count_no}",
        headers=["Item Code", "Item", "Location", "Batch", "Barcode", "Expiry", "System Qty", "Counted Qty"],
        rows=[[l["material_item_code"], l["material_name"], l["location_name"], l["batch_no"], l["barcode"],
               l["expiry_date"], l["system_quantity"], l["counted_quantity"]] for l in data["lines"]],
    )


# ─────────────────────────────── create ───────────────────────────────
@router.post("/", status_code=status.HTTP_201_CREATED, dependencies=[_create])
def create_stock_count(
    body: StockCountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    branch_code = body.branch_code.strip()
    _check_branch(branch_code, user_branches)
    if not db.query(Branch.id).filter(Branch.branch_code == branch_code).first():
        raise _bad(f"Branch '{branch_code}' not found")
    if body.location_id:
        loc = db.get(Locations, body.location_id)
        if loc is None or loc.branch_code != branch_code:
            raise _bad("The location does not belong to this branch")
    if body.category_id and not db.get(MaterialCategory, body.category_id):
        raise _bad("Item category not found")

    # One open count per branch / location scope: serialise starts per branch
    db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:k))"), {"k": f"stock_count:{branch_code}"})
    overlap = db.query(StockCount).filter(StockCount.branch_code == branch_code, StockCount.status == COUNTING)
    if body.location_id:
        overlap = overlap.filter(or_(StockCount.location_id.is_(None), StockCount.location_id == body.location_id))
    open_count = overlap.order_by(StockCount.id).first()
    if open_count:
        raise _bad(f"Stock count {open_count.count_no} is still open for this branch"
                   f"{' / location' if open_count.location_id else ''}; post or cancel it first",
                   status.HTTP_409_CONFLICT)

    rows_q = (
        db.query(SalesStock)
        .join(Material, Material.id == SalesStock.material_id)
        .filter(SalesStock.branch_code == branch_code, SalesStock.status == StockStatus.AVAILABLE.value,
                SalesStock.is_active.is_(True))
    )
    if body.location_id:
        rows_q = rows_q.filter(SalesStock.location_id == body.location_id)
    if body.category_id:
        rows_q = rows_q.filter(Material.category_id == body.category_id)
    rows = rows_q.order_by(Material.item_code, SalesStock.location_id, SalesStock.batch_no, SalesStock.id).all()
    if not rows:
        raise _bad("There is no available stock to count for this branch"
                   f"{', location' if body.location_id else ''}{' and category' if body.category_id else ''}")

    count = StockCount(
        count_no=_next_count_no(db, branch_code), branch_code=branch_code, location_id=body.location_id,
        category_id=body.category_id, status=COUNTING, remark=(body.remark or "").strip() or None,
        created_by=current_user.id, created_at=tz.now(),
    )
    db.add(count)
    db.flush()
    for row in rows:
        db.add(StockCountLine(
            count_id=count.id, stock_id=row.id, material_id=row.material_id, location_id=row.location_id,
            batch_no=row.batch_no, barcode=row.barcode, expiry_date=row.expiry_date,
            system_quantity=Decimal(1 if row.barcode else (row.quantity or 0)),
            unit_cost=_money(issue_unit_cost(db, row)), is_found=False,
        ))
    log_audit(db, user_id=current_user.id, action="create", entity_type="stock_count", entity_id=count.id,
              changes={"count_no": count.count_no, "branch_code": branch_code, "location_id": body.location_id,
                       "category_id": body.category_id, "lines": len(rows)})
    db.commit()
    return _full(db, count, _show_cost(current_user))


# ─────────────────────────────── counting ───────────────────────────────
@router.put("/{count_id}/lines", dependencies=[_create])
def save_counts(
    count_id: int,
    body: StockCountLinesUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    count = _get(db, count_id, user_branches, lock=True)
    _require_counting(count)
    ids = [l.id for l in body.lines]
    if len(set(ids)) != len(ids):
        raise _bad("Each line can appear only once")
    lines = {l.id: l for l in db.query(StockCountLine).filter(
        StockCountLine.count_id == count.id, StockCountLine.id.in_(ids))} if ids else {}
    missing = [i for i in ids if i not in lines]
    if missing:
        raise _bad(f"Line(s) {', '.join(map(str, missing))} are not on this count")
    tracking = dict(db.query(Material.id, Material.tracking_type).filter(
        Material.id.in_({l.material_id for l in lines.values()})).all()) if lines else {}
    for upd in body.lines:
        line = lines[upd.id]
        qty = upd.counted_quantity
        _whole(qty)
        if qty is not None and _is_serial(line, tracking.get(line.material_id)) and qty not in (0, 1):
            raise _bad(f"Serial {line.barcode or 'unit'}: count 1 (found) or 0 (missing)")
        line.counted_quantity = qty
        if "remark" in upd.model_fields_set:
            line.remark = (upd.remark or "").strip() or None
    db.commit()
    return _full(db, count, _show_cost(current_user))


@router.post("/{count_id}/lines", dependencies=[_create])
def add_found_line(
    count_id: int,
    body: StockCountFoundLine,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    count = _get(db, count_id, user_branches, lock=True)
    _require_counting(count)
    item = db.get(Material, body.material_id)
    if item is None:
        raise _bad("Item not found")
    if item.item_type != "stock_item":
        raise _bad(f"'{item.name}' is not a stock item")
    if count.category_id and item.category_id != count.category_id:
        raise _bad(f"'{item.name}' is not in this count's item category")
    loc = db.get(Locations, body.location_id)
    if loc is None or loc.branch_code != count.branch_code:
        raise _bad("The location does not belong to this count's branch")
    if count.location_id and body.location_id != count.location_id:
        raise _bad("This count covers one location only")
    _whole(body.counted_quantity)
    barcode = body.barcode
    if item.tracking_type == "serial":
        if not barcode:
            raise _bad("A serial item needs its serial number (barcode)")
        if body.counted_quantity != 1:
            raise _bad("A serial unit is counted as 1")
        taken = db.query(SalesStock.id).filter(SalesStock.barcode == barcode).first()
        dup = db.query(StockCountLine.id).filter(StockCountLine.count_id == count.id,
                                                 StockCountLine.barcode == barcode).first()
        if taken or dup:
            raise _bad(f"Serial {barcode} already exists in stock" if taken else f"Serial {barcode} is already on this count",
                       status.HTTP_409_CONFLICT)
    else:
        barcode = None  # only serial units carry a barcode
    unit_cost = body.unit_cost if body.unit_cost is not None else default_item_cost(db, item.id)
    db.add(StockCountLine(
        count_id=count.id, stock_id=None, material_id=item.id, location_id=body.location_id,
        batch_no=body.batch_no, barcode=barcode, expiry_date=body.expiry_date, system_quantity=Decimal("0"),
        counted_quantity=body.counted_quantity, unit_cost=_money(unit_cost), is_found=True,
    ))
    db.commit()
    return _full(db, count, _show_cost(current_user))


@router.delete("/{count_id}/lines/{line_id}", dependencies=[_create])
def delete_found_line(
    count_id: int,
    line_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    count = _get(db, count_id, user_branches, lock=True)
    _require_counting(count)
    line = db.query(StockCountLine).filter(StockCountLine.id == line_id, StockCountLine.count_id == count.id).first()
    if line is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Line not found on this count")
    if not line.is_found:
        raise _bad("Only lines added during the count can be removed; count a missing line as 0")
    db.delete(line)
    db.commit()
    return _full(db, count, _show_cost(current_user))


# ─────────────────────────────── post / cancel ───────────────────────────────
def _linked_product(db: Session, material_id: int) -> Optional[int]:
    from app.modules.products.models import Product

    ids = [r[0] for r in db.query(Product.id).filter(Product.material_id == material_id).limit(2)]
    return ids[0] if len(ids) == 1 else None


def _post_gl(db: Session, count: StockCount, gain: Decimal, loss: Decimal, user_id: int) -> Optional[int]:
    from app.modules.finance.gl_posting_service import GLPostingService
    from app.modules.finance.posting_rules import posting_ref

    if gain <= 0 and loss <= 0:
        return None
    zero = Decimal("0")
    lines = []
    if gain > 0:
        lines += [
            {"account_code": posting_ref("INVENTORY"), "debit": gain, "credit": zero,
             "description": f"Stock found at count {count.count_no}"},
            {"account_code": posting_ref("STOCK_COUNT_GAIN"), "debit": zero, "credit": gain,
             "description": f"Stock count gain {count.count_no}"},
        ]
    if loss > 0:
        lines += [
            {"account_code": posting_ref("STOCK_COUNT_LOSS"), "debit": loss, "credit": zero,
             "description": f"Stock count loss {count.count_no}"},
            {"account_code": posting_ref("INVENTORY"), "debit": zero, "credit": loss,
             "description": f"Stock missing at count {count.count_no}"},
        ]
    result = GLPostingService(db).post(
        reference_type="StockCount", reference_id=count.id, reference_no=count.count_no, lines=lines,
        entry_date=tz.today(), description=f"Auto GL - Stock count | {count.count_no} | gain {gain} | loss {loss}",
        branch_code=count.branch_code, user_id=user_id or 0, transaction_type="StockMovement",
        je_prefix="JE-STK", source_module="inventory", marker=f"StockCount {count.id}", record_failure=False,
    )
    if result.failed:
        raise _bad(f"The journal entry could not be posted: {result.error_message}")
    return result.journal_entry.id if result.journal_entry is not None else None


@router.post("/{count_id}/post", dependencies=[_post])
def post_stock_count(
    count_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    count = _get(db, count_id, user_branches, lock=True)
    if count.status == POSTED:
        raise _bad(f"Stock count {count.count_no} is already posted", status.HTTP_409_CONFLICT)
    _require_counting(count)
    lines = db.query(StockCountLine).filter(StockCountLine.count_id == count.id).order_by(StockCountLine.id).all()
    left = sum(1 for l in lines if l.counted_quantity is None)
    if left:
        raise _bad(f"Count every line before posting ({left} left)")
    items = {m.id: m for m in db.query(Material).filter(Material.id.in_({l.material_id for l in lines}))}

    gain = loss = Decimal("0")
    now = tz.now()
    with stock_reference(db, "stock_count", count.id, count.count_no):
        for line in lines:
            item = items[line.material_id]
            serial = _is_serial(line, item.tracking_type)
            row = (db.query(SalesStock).filter(SalesStock.id == line.stock_id).with_for_update().first()
                   if line.stock_id else None)
            still_here = (row is not None and row.status == StockStatus.AVAILABLE.value and row.is_active
                          and row.branch_code == count.branch_code and row.location_id == line.location_id)
            current = Decimal(1 if (still_here and serial) else (row.quantity if still_here else 0))
            counted = Decimal(line.counted_quantity)
            diff = counted - current
            line.posted_current_quantity = current
            line.difference = diff
            unit_cost = Decimal(line.unit_cost or 0)
            if diff < 0:  # units missing: write them off
                take = int(-diff)
                part = row if take >= row.quantity else split_lot(db, row, take)
                part.status = StockStatus.ADJUSTED_OUT.value
                part.is_active = False
                loss += unit_cost * take
            elif diff > 0:  # units found
                add = int(diff)
                if still_here and not serial:
                    row.quantity += add
                else:
                    if serial and line.barcode and db.query(SalesStock.id).filter(
                            SalesStock.barcode == line.barcode, SalesStock.id != (line.stock_id or 0)).first():
                        raise _bad(f"Serial {line.barcode} already exists in stock; it cannot be added again")
                    if serial and row is not None:
                        raise _bad(f"Serial {line.barcode or row.id} is no longer available (now {row.status}); "
                                   f"recount it as 0 or sort out the unit first")
                    new = SalesStock(
                        material_id=item.id, product_id=_linked_product(db, item.id),
                        branch_code=count.branch_code, location_id=line.location_id,
                        batch_no=line.batch_no, expiry_date=line.expiry_date,
                        barcode=line.barcode if serial else None, quantity=1 if serial else add,
                        unit_cost=unit_cost, status=StockStatus.AVAILABLE.value, is_active=True,
                        added_date=now, stock_count_id=count.id, created_by=current_user.id,
                        updated_by=current_user.id,
                    )
                    db.add(new)
                    db.flush()
                    if line.stock_id is None:
                        line.stock_id = new.id
                gain += unit_cost * add
            db.flush()  # line by line, so a weighted-average item re-averages in count order
    gain, loss = _money(gain), _money(loss)
    count.journal_entry_id = _post_gl(db, count, gain, loss, current_user.id)
    count.status = POSTED
    count.posted_by = current_user.id
    count.posted_at = now
    log_audit(db, user_id=current_user.id, action="post", entity_type="stock_count", entity_id=count.id,
              changes={"count_no": count.count_no, "gain_value": str(gain), "loss_value": str(loss),
                       "journal_entry_id": count.journal_entry_id})
    db.commit()
    return _full(db, count, _show_cost(current_user))


@router.post("/{count_id}/cancel", dependencies=[_post])
def cancel_stock_count(
    count_id: int,
    body: StockCountCancel,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter),
):
    count = _get(db, count_id, user_branches, lock=True)
    _require_counting(count)
    count.status = CANCELLED
    count.cancelled_by = current_user.id
    count.cancel_reason = body.reason
    log_audit(db, user_id=current_user.id, action="cancel", entity_type="stock_count", entity_id=count.id,
              changes={"count_no": count.count_no, "reason": body.reason})
    db.commit()
    return _full(db, count, _show_cost(current_user))
