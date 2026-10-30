"""Manufacturing services: work centers, BOMs, production orders (lifecycle, material
issue / return / backflush, output receipt, job-card time), job cards, MRP, dashboard.

Lifecycle (ProductionOrderStatus):

    draft --release--> released --(first issue / output / time, or start)--> in_progress
          --complete--> completed --close--> closed          draft|released --cancel--> cancelled

Quantities on stock rows are whole units, so a BOM line's requirement for an order is
rounded up: ceil(quantity per unit x (1 + scrap %) x units).
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Dict, Iterable, List, Optional

from fastapi import HTTPException, status
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.auth.models import Branch, User
from app.common.audit import log_audit
from app.common.enums import (
    BOMStatus,
    MaterialIssueMethod,
    ProductionOrderStatus as PS,
    PurchaseOrderStatus,
    StockStatus,
    TrackingType,
)
from app.core import timezone as tz
from app.core.concurrency import next_document_number
from app.modules.inventory.lots import FEFO_ORDER, take_units, units_in
from app.modules.inventory.models import CompanyAssets, SalesStock
from app.modules.manufacturing import models as m
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.gl import ManufacturingGL
from app.modules.products.models import Product

D = Decimal
CENT = D("0.01")
OPEN_STATUSES = (PS.DRAFT, PS.RELEASED, PS.IN_PROGRESS)
ACTIVE_STATUSES = (PS.RELEASED, PS.IN_PROGRESS)
OPEN_PO_STATUSES = (
    PurchaseOrderStatus.PENDING_APPROVAL, PurchaseOrderStatus.PENDING,
    PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.PARTIALLY_COMPLETED,
)


def _bad(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _not_found(label: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{label} not found")


def _money(v) -> Decimal:
    return D(str(v or 0)).quantize(CENT, rounding=ROUND_HALF_UP)


def _units_needed(per_unit, scrap_pct, units) -> int:
    """Whole units a component line needs for ``units`` of output (rounded up)."""
    raw = D(str(per_unit)) * (1 + D(str(scrap_pct or 0)) / 100) * D(units)
    return int(math.ceil(raw.quantize(D("0.000001"))))


def _op_minutes(setup, run_per_unit, units, efficiency_pct) -> Decimal:
    eff = D(str(efficiency_pct or 100)) / 100
    return ((D(str(setup or 0)) + D(str(run_per_unit or 0)) * D(units)) / eff).quantize(CENT, rounding=ROUND_HALF_UP)


def _rate_cost(minutes, rate) -> Decimal:
    return _money(D(str(minutes or 0)) / 60 * D(str(rate or 0)))


def standard_cost(product: Optional[Product]) -> Decimal:
    """The cost inventory moves at: the latest active price tier's cost (what a sale
    relieves inventory at, see SalesAccountingIntegration), else Product.cost_price."""
    if product is None:
        return D("0")
    tiers = [t for t in (product.price_tiers or []) if t.is_active]
    if tiers:
        return _money(max(tiers, key=lambda t: (t.created_at or datetime.min, t.id)).cost_price)
    return _money(product.cost_price)


def _user_names(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in db.query(User).filter(User.id.in_(ids)).all()}


def _location_names(db: Session, ids: Iterable[Optional[int]]) -> Dict[int, str]:
    from app.modules.common.models import Locations
    ids = {i for i in ids if i}
    if not ids:
        return {}
    return {l.id: l.name for l in db.query(Locations).filter(Locations.id.in_(ids)).all()}


def _free_stock_filter(product_ids, branch_codes: Optional[List[str]]):
    f = [SalesStock.product_id.in_(product_ids), SalesStock.status == StockStatus.AVAILABLE,
         SalesStock.is_active.is_(True), SalesStock.reserved_for_quote_item_id.is_(None)]
    if branch_codes is not None:
        f.append(SalesStock.branch_code.in_(branch_codes))
    return f


def free_stock(db: Session, product_ids: Iterable[int], branch_codes: Optional[List[str]]) -> Dict[int, int]:
    """Unreserved available units per product in the given branches (None = all)."""
    product_ids = list(set(product_ids))
    if not product_ids:
        return {}
    rows = (db.query(SalesStock.product_id, func.coalesce(func.sum(SalesStock.quantity), 0))
            .filter(*_free_stock_filter(product_ids, branch_codes))
            .group_by(SalesStock.product_id).all())
    return {pid: int(q) for pid, q in rows}


def _active_bom_products(db: Session, product_ids: Iterable[int]) -> set:
    product_ids = list(set(product_ids))
    if not product_ids:
        return set()
    return {pid for (pid,) in db.query(m.MfgBOM.product_id)
            .filter(m.MfgBOM.product_id.in_(product_ids), m.MfgBOM.status == BOMStatus.ACTIVE).distinct()}


# ═══════════════════════════ work centers ═══════════════════════════
class WorkCenterService:
    def __init__(self, db: Session):
        self.db = db

    def _load(self, ids=None) -> Dict[int, tuple]:
        q = (self.db.query(m.MfgProductionOrderOperation.work_center_id,
                           func.sum(func.greatest(m.MfgProductionOrderOperation.planned_minutes
                                                  - m.MfgProductionOrderOperation.actual_minutes, 0)),
                           func.count(m.MfgProductionOrderOperation.id))
             .join(m.MfgProductionOrder, m.MfgProductionOrder.id == m.MfgProductionOrderOperation.order_id)
             .filter(m.MfgProductionOrder.status.in_(ACTIVE_STATUSES),
                     m.MfgProductionOrderOperation.status != "completed"))
        if ids is not None:
            q = q.filter(m.MfgProductionOrderOperation.work_center_id.in_(ids))
        return {wc: (D(str(mins or 0)), int(n)) for wc, mins, n in q.group_by(m.MfgProductionOrderOperation.work_center_id)}

    def _out(self, wc: m.MfgWorkCenter, load: Dict[int, tuple]) -> dict:
        data = s.WorkCenterOut.model_validate(wc).model_dump()
        mins, n = load.get(wc.id, (D("0"), 0))
        data.update(open_load_minutes=mins.quantize(CENT), open_operations=n)
        return data

    def list(self, q: Optional[str] = None, active: Optional[bool] = None,
             branch_codes: Optional[List[str]] = None) -> List[dict]:
        query = self.db.query(m.MfgWorkCenter)
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(or_(m.MfgWorkCenter.code.ilike(like), m.MfgWorkCenter.name.ilike(like)))
        if active is not None:
            query = query.filter(m.MfgWorkCenter.active.is_(active))
        if branch_codes is not None:
            # Centers not tied to a branch are shared by every branch
            query = query.filter(or_(m.MfgWorkCenter.branch_code.is_(None), m.MfgWorkCenter.branch_code.in_(branch_codes)))
        rows = query.order_by(m.MfgWorkCenter.code).all()
        load = self._load([r.id for r in rows])
        return [self._out(r, load) for r in rows]

    def get(self, wc_id: int) -> m.MfgWorkCenter:
        wc = self.db.query(m.MfgWorkCenter).filter(m.MfgWorkCenter.id == wc_id).first()
        if not wc:
            raise _not_found("Work center")
        return wc

    def get_out(self, wc_id: int) -> dict:
        return self._out(self.get(wc_id), self._load([wc_id]))

    def _check(self, code: Optional[str], branch_code: Optional[str], exclude_id: Optional[int] = None):
        if code:
            q = self.db.query(m.MfgWorkCenter.id).filter(func.lower(func.btrim(m.MfgWorkCenter.code)) == code.strip().lower())
            if exclude_id:
                q = q.filter(m.MfgWorkCenter.id != exclude_id)
            if q.first():
                raise _bad(f"Work center code '{code}' is already used")
        if branch_code and not self.db.query(Branch.id).filter(Branch.branch_code == branch_code).first():
            raise _bad(f"Branch '{branch_code}' does not exist")

    def create(self, data: s.WorkCenterIn, user_id: int) -> dict:
        self._check(data.code, data.branch_code)
        wc = m.MfgWorkCenter(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(wc)
        self.db.flush()
        log_audit(self.db, user_id, "create", "work_center", wc.id, {"code": wc.code})
        self.db.commit()
        return self.get_out(wc.id)

    def update(self, wc_id: int, data: s.WorkCenterUpdate, user_id: int) -> dict:
        wc = self.get(wc_id)
        changes = data.model_dump(exclude_unset=True)
        if "code" in changes and changes["code"] is None:
            changes.pop("code")
        if "name" in changes and changes["name"] is None:
            changes.pop("name")
        self._check(changes.get("code"), changes.get("branch_code"), exclude_id=wc.id)
        for k, v in changes.items():
            setattr(wc, k, v)
        wc.updated_by = user_id
        log_audit(self.db, user_id, "update", "work_center", wc.id, {k: str(v) for k, v in changes.items()})
        self.db.commit()
        return self.get_out(wc.id)

    def delete(self, wc_id: int, user_id: int) -> None:
        wc = self.get(wc_id)
        used = (self.db.query(m.MfgBOMOperation.id).filter(m.MfgBOMOperation.work_center_id == wc.id).first()
                or self.db.query(m.MfgProductionOrderOperation.id)
                .filter(m.MfgProductionOrderOperation.work_center_id == wc.id).first())
        if used:
            raise _bad("This work center is used by a BOM or a production order; deactivate it instead.")
        log_audit(self.db, user_id, "delete", "work_center", wc.id, {"code": wc.code})
        self.db.delete(wc)
        self.db.commit()


# ═══════════════════════════ BOMs ═══════════════════════════
class BOMService:
    def __init__(self, db: Session):
        self.db = db

    def _query(self):
        return self.db.query(m.MfgBOM).options(
            selectinload(m.MfgBOM.items).selectinload(m.MfgBOMItem.product).selectinload(Product.price_tiers),
            selectinload(m.MfgBOM.operations))

    def get(self, bom_id: int) -> m.MfgBOM:
        bom = self._query().filter(m.MfgBOM.id == bom_id).first()
        if not bom:
            raise _not_found("BOM")
        return bom

    def rollup(self, bom: m.MfgBOM) -> dict:
        """Cost of ``bom.output_quantity`` units at current component costs and work-center rates."""
        out_qty = D(str(bom.output_quantity or 1))
        material = D("0")
        items = []
        manufactured = _active_bom_products(self.db, [i.product_id for i in bom.items])
        for i in bom.items:
            cost = standard_cost(i.product)
            line = _money(D(str(i.quantity)) * (1 + D(str(i.scrap_pct or 0)) / 100) * cost)
            material += line
            items.append(dict(
                id=i.id, sequence=i.sequence, product_id=i.product_id,
                product_name=i.product.name if i.product else None,
                product_code=i.product.item_code if i.product else None,
                unit_of_measure=i.product.unit_of_measure if i.product else None,
                quantity=i.quantity, scrap_pct=i.scrap_pct, issue_method=i.issue_method, remark=i.remark,
                unit_cost=_money(cost), line_cost=line, is_manufactured=i.product_id in manufactured,
            ))
        labor = overhead = D("0")
        ops = []
        for o in bom.operations:
            wc = o.work_center
            mins = _op_minutes(o.setup_minutes, o.run_minutes, out_qty, wc.efficiency_pct if wc else 100)
            lc = _rate_cost(mins, wc.labor_rate_per_hour if wc else 0)
            oc = _rate_cost(mins, wc.overhead_rate_per_hour if wc else 0)
            labor += lc
            overhead += oc
            ops.append(dict(
                id=o.id, sequence=o.sequence, name=o.name, work_center_id=o.work_center_id,
                work_center_code=wc.code if wc else None, work_center_name=wc.name if wc else None,
                setup_minutes=o.setup_minutes, run_minutes=o.run_minutes, description=o.description,
                labor_cost=lc, overhead_cost=oc,
            ))
        total = _money(material + labor + overhead)
        return dict(items=items, operations=ops, material_cost=_money(material), labor_cost=_money(labor),
                    overhead_cost=_money(overhead), total_cost=total, unit_cost=_money(total / out_qty))

    def _out(self, bom: m.MfgBOM, with_lines: bool = True) -> dict:
        r = self.rollup(bom)
        p = bom.product
        data = dict(
            id=bom.id, bom_no=bom.bom_no, product_id=bom.product_id,
            product_name=p.name if p else None, product_code=p.item_code if p else None,
            unit_of_measure=p.unit_of_measure if p else None,
            product_cost_price=standard_cost(p),
            version=bom.version, output_quantity=bom.output_quantity, status=bom.status,
            is_default=bom.is_default, description=bom.description,
            item_count=len(bom.items), operation_count=len(bom.operations),
            material_cost=r["material_cost"], labor_cost=r["labor_cost"], overhead_cost=r["overhead_cost"],
            total_cost=r["total_cost"], unit_cost=r["unit_cost"],
            created_at=bom.created_at, updated_at=bom.updated_at,
        )
        if with_lines:
            data.update(items=r["items"], operations=r["operations"])
        return data

    def list(self, q: Optional[str] = None, status_: Optional[str] = None, product_id: Optional[int] = None) -> List[dict]:
        query = self._query().join(Product, Product.id == m.MfgBOM.product_id)
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(or_(m.MfgBOM.bom_no.ilike(like), Product.name.ilike(like), Product.item_code.ilike(like)))
        if status_:
            query = query.filter(m.MfgBOM.status == status_)
        if product_id:
            query = query.filter(m.MfgBOM.product_id == product_id)
        return [self._out(b, with_lines=False) for b in query.order_by(m.MfgBOM.id.desc()).all()]

    def get_out(self, bom_id: int) -> dict:
        return self._out(self.get(bom_id))

    # ---- validation ----
    def _product(self, product_id: int, label: str = "Product") -> Product:
        p = self.db.query(Product).filter(Product.id == product_id).first()
        if not p:
            raise _bad(f"{label} #{product_id} does not exist")
        return p

    def _validate_lines(self, product_id: int, items: List[s.BOMItemIn], operations: List[s.BOMOperationIn]):
        seen = set()
        for i in items:
            if i.product_id == product_id:
                raise _bad("A BOM cannot use the product it makes as a component")
            if i.product_id in seen:
                raise _bad("Each component can appear only once in a BOM; combine the quantities")
            seen.add(i.product_id)
            comp = self._product(i.product_id, "Component")
            if not comp.active:
                raise _bad(f"Component '{comp.name}' is inactive")
        for o in operations:
            wc = self.db.query(m.MfgWorkCenter).filter(m.MfgWorkCenter.id == o.work_center_id).first()
            if not wc:
                raise _bad(f"Work center #{o.work_center_id} does not exist")
            if not wc.active:
                raise _bad(f"Work center '{wc.code}' is inactive")

    def _version_taken(self, product_id: int, version: str, exclude_id: Optional[int] = None) -> bool:
        q = self.db.query(m.MfgBOM.id).filter(
            m.MfgBOM.product_id == product_id, func.lower(func.btrim(m.MfgBOM.version)) == version.strip().lower())
        if exclude_id:
            q = q.filter(m.MfgBOM.id != exclude_id)
        return q.first() is not None

    def _set_lines(self, bom: m.MfgBOM, items: List[s.BOMItemIn], operations: List[s.BOMOperationIn], user_id: int):
        bom.items = [m.MfgBOMItem(**i.model_dump(), created_by=user_id, updated_by=user_id) for i in items]
        bom.operations = [m.MfgBOMOperation(**o.model_dump(), created_by=user_id, updated_by=user_id) for o in operations]

    def _cycle_check(self, bom: m.MfgBOM):
        """Refuse a BOM whose components (through their active BOMs) lead back to its product."""
        target = bom.product_id
        stack = [i.product_id for i in bom.items]
        seen = set()
        while stack:
            pid = stack.pop()
            if pid == target:
                raise _bad("This BOM makes a loop: one of its components is (indirectly) made from this product")
            if pid in seen:
                continue
            seen.add(pid)
            comps = (self.db.query(m.MfgBOMItem.product_id).join(m.MfgBOM, m.MfgBOM.id == m.MfgBOMItem.bom_id)
                     .filter(m.MfgBOM.product_id == pid, m.MfgBOM.status == BOMStatus.ACTIVE).all())
            stack.extend(c for (c,) in comps)

    # ---- commands ----
    def create(self, data: s.BOMIn, user_id: int) -> dict:
        product = self._product(data.product_id)
        if not product.active:
            raise _bad(f"Product '{product.name}' is inactive")
        self._validate_lines(product.id, data.items, data.operations)
        if self._version_taken(product.id, data.version):
            raise _bad(f"'{product.name}' already has a BOM version '{data.version}'")
        bom = m.MfgBOM(
            bom_no=next_document_number(self.db, m.MfgBOM.bom_no, "BOM-", 6),
            product_id=product.id, version=data.version, output_quantity=data.output_quantity,
            description=data.description, status=BOMStatus.DRAFT, is_default=False,
            created_by=user_id, updated_by=user_id,
        )
        self._set_lines(bom, data.items, data.operations, user_id)
        self.db.add(bom)
        self.db.flush()
        log_audit(self.db, user_id, "create", "bom", bom.id, {"bom_no": bom.bom_no, "version": bom.version})
        self.db.commit()
        return self.get_out(bom.id)

    def update(self, bom_id: int, data: s.BOMUpdate, user_id: int) -> dict:
        bom = self.get(bom_id)
        if bom.status != BOMStatus.DRAFT:
            raise _bad("Only a draft BOM can be changed; copy it to a new version instead")
        changes = data.model_dump(exclude_unset=True)
        if changes.get("version"):
            if self._version_taken(bom.product_id, changes["version"], exclude_id=bom.id):
                raise _bad(f"This product already has a BOM version '{changes['version']}'")
            bom.version = changes["version"]
        if changes.get("output_quantity") is not None:
            bom.output_quantity = changes["output_quantity"]
        if "description" in changes:
            bom.description = changes["description"]
        if data.items is not None or data.operations is not None:
            items = data.items if data.items is not None else [s.BOMItemIn.model_validate(i, from_attributes=True) for i in bom.items]
            ops = data.operations if data.operations is not None else [
                s.BOMOperationIn.model_validate(o, from_attributes=True) for o in bom.operations]
            self._validate_lines(bom.product_id, items, ops)
            self._set_lines(bom, items, ops, user_id)
        bom.updated_by = user_id
        log_audit(self.db, user_id, "update", "bom", bom.id, {"fields": sorted(changes)})
        self.db.commit()
        return self.get_out(bom.id)

    def activate(self, bom_id: int, user_id: int) -> dict:
        bom = self.get(bom_id)
        if bom.status != BOMStatus.DRAFT:
            raise _bad(f"Only a draft BOM can be activated (this one is {bom.status})")
        if not bom.items:
            raise _bad("A BOM needs at least one component")
        self._cycle_check(bom)
        bom.status = BOMStatus.ACTIVE
        has_default = self.db.query(m.MfgBOM.id).filter(
            m.MfgBOM.product_id == bom.product_id, m.MfgBOM.status == BOMStatus.ACTIVE,
            m.MfgBOM.is_default.is_(True), m.MfgBOM.id != bom.id).first()
        bom.is_default = not has_default
        bom.updated_by = user_id
        log_audit(self.db, user_id, "activate", "bom", bom.id, {"is_default": bom.is_default})
        self.db.commit()
        return self.get_out(bom.id)

    def set_default(self, bom_id: int, user_id: int) -> dict:
        bom = self.get(bom_id)
        if bom.status != BOMStatus.ACTIVE:
            raise _bad("Only an active BOM can be the default")
        (self.db.query(m.MfgBOM).filter(m.MfgBOM.product_id == bom.product_id, m.MfgBOM.id != bom.id)
         .update({m.MfgBOM.is_default: False}, synchronize_session="fetch"))
        self.db.flush()
        bom.is_default = True
        bom.updated_by = user_id
        log_audit(self.db, user_id, "set_default", "bom", bom.id, {})
        self.db.commit()
        return self.get_out(bom.id)

    def archive(self, bom_id: int, user_id: int) -> dict:
        bom = self.get(bom_id)
        if bom.status != BOMStatus.ACTIVE:
            raise _bad("Only an active BOM can be archived")
        bom.status = BOMStatus.ARCHIVED
        bom.is_default = False
        bom.updated_by = user_id
        log_audit(self.db, user_id, "archive", "bom", bom.id, {})
        self.db.commit()
        return self.get_out(bom.id)

    def copy(self, bom_id: int, data: s.BOMCopyIn, user_id: int) -> dict:
        src = self.get(bom_id)
        if self._version_taken(src.product_id, data.version):
            raise _bad(f"This product already has a BOM version '{data.version}'")
        new = m.MfgBOM(
            bom_no=next_document_number(self.db, m.MfgBOM.bom_no, "BOM-", 6),
            product_id=src.product_id, version=data.version, output_quantity=src.output_quantity,
            description=src.description, status=BOMStatus.DRAFT, is_default=False,
            created_by=user_id, updated_by=user_id,
        )
        self._set_lines(new,
                        [s.BOMItemIn.model_validate(i, from_attributes=True) for i in src.items],
                        [s.BOMOperationIn.model_validate(o, from_attributes=True) for o in src.operations], user_id)
        self.db.add(new)
        self.db.flush()
        log_audit(self.db, user_id, "copy", "bom", new.id, {"from": src.bom_no})
        self.db.commit()
        return self.get_out(new.id)

    def delete(self, bom_id: int, user_id: int) -> None:
        bom = self.get(bom_id)
        if bom.status != BOMStatus.DRAFT:
            raise _bad("Only a draft BOM can be deleted; archive an active one")
        if self.db.query(m.MfgProductionOrder.id).filter(m.MfgProductionOrder.bom_id == bom.id).first():
            raise _bad("This BOM is used by a production order")
        log_audit(self.db, user_id, "delete", "bom", bom.id, {"bom_no": bom.bom_no})
        self.db.delete(bom)
        self.db.commit()

    def update_product_cost(self, bom_id: int, user_id: int) -> dict:
        """Cost roll-up -> the product's standard cost: Product.cost_price and the cost of
        its active price tiers (the cost a sale relieves inventory at)."""
        bom = self.get(bom_id)
        if bom.status != BOMStatus.ACTIVE:
            raise _bad("Only an active BOM can set the product's cost")
        unit_cost = self.rollup(bom)["unit_cost"]
        if unit_cost <= 0:
            raise _bad("The rolled-up cost is zero; set component costs or work-center rates first")
        product = bom.product
        old = standard_cost(product)
        product.cost_price = unit_cost
        tiers = [t for t in product.price_tiers if t.is_active]
        for t in tiers:
            t.cost_price = unit_cost
        log_audit(self.db, user_id, "update_cost", "products", product.id,
                  {"cost_price": [str(old), str(unit_cost)], "bom_no": bom.bom_no, "price_tiers": [t.id for t in tiers]})
        self.db.commit()
        return self.get_out(bom.id)


# ═══════════════════════════ production orders ═══════════════════════════
class ProductionOrderService:
    def __init__(self, db: Session):
        self.db = db
        self.gl = ManufacturingGL(db)

    # ---- reads ----
    def _query(self):
        return self.db.query(m.MfgProductionOrder).options(
            selectinload(m.MfgProductionOrder.materials), selectinload(m.MfgProductionOrder.operations))

    def get(self, order_id: int, lock: bool = False) -> m.MfgProductionOrder:
        if lock:
            # lock the header row only, then load the lines
            if not self.db.query(m.MfgProductionOrder.id).filter(m.MfgProductionOrder.id == order_id).with_for_update().first():
                raise _not_found("Production order")
        order = self._query().filter(m.MfgProductionOrder.id == order_id).first()
        if not order:
            raise _not_found("Production order")
        return order

    def _out(self, o: m.MfgProductionOrder, detail: bool = False, names: Optional[dict] = None,
             locations: Optional[dict] = None, boms: Optional[dict] = None) -> dict:
        p = o.product
        names = names if names is not None else _user_names(self.db, [o.created_by, o.released_by])
        locations = locations if locations is not None else _location_names(self.db, [o.location_id])
        bom = (boms or {}).get(o.bom_id) or (o.bom if detail or boms is None else None)
        planned_total = _money(D(str(o.planned_material_cost)) + D(str(o.planned_labor_cost)) + D(str(o.planned_overhead_cost)))
        actual_total = _money(D(str(o.actual_material_cost)) + D(str(o.actual_labor_cost)) + D(str(o.actual_overhead_cost)))
        done = o.produced_quantity or 0
        data = dict(
            id=o.id, order_no=o.order_no, product_id=o.product_id,
            product_name=p.name if p else None, product_code=p.item_code if p else None,
            unit_of_measure=p.unit_of_measure if p else None, tracking_type=p.tracking_type if p else None,
            bom_id=o.bom_id, bom_no=bom.bom_no if bom else None, bom_version=bom.version if bom else None,
            branch_code=o.branch_code, location_id=o.location_id, location_name=locations.get(o.location_id),
            planned_quantity=o.planned_quantity, produced_quantity=done, scrapped_quantity=o.scrapped_quantity or 0,
            progress_pct=(D(done) * 100 / D(o.planned_quantity)).quantize(D("0.1")) if o.planned_quantity else D("0"),
            planned_start_date=o.planned_start_date, planned_end_date=o.planned_end_date,
            actual_start_at=o.actual_start_at, actual_end_at=o.actual_end_at,
            priority=o.priority, status=o.status,
            is_late=o.status in OPEN_STATUSES and o.planned_end_date < tz.today(),
            source_reference=o.source_reference, remark=o.remark, cancel_reason=o.cancel_reason,
            **self._quote_ref(o),
            standard_unit_cost=o.standard_unit_cost,
            planned_material_cost=o.planned_material_cost, planned_labor_cost=o.planned_labor_cost,
            planned_overhead_cost=o.planned_overhead_cost, planned_total_cost=planned_total,
            actual_material_cost=o.actual_material_cost, actual_labor_cost=o.actual_labor_cost,
            actual_overhead_cost=o.actual_overhead_cost, actual_total_cost=actual_total,
            output_value=o.output_value,
            wip_balance=D("0") if o.status == PS.CLOSED else _money(actual_total - D(str(o.output_value))),
            variance_amount=o.variance_amount,
            released_at=o.released_at, released_by_name=names.get(o.released_by),
            closed_at=o.closed_at, created_by_name=names.get(o.created_by),
            created_at=o.created_at, updated_at=o.updated_at,
        )
        if detail:
            avail = free_stock(self.db, [x.product_id for x in o.materials], [o.branch_code])
            mats = []
            short = partial = False
            for x in o.materials:
                remaining = max(x.required_quantity - x.issued_quantity, 0)
                available = avail.get(x.product_id, 0)
                shortage = max(remaining - available, 0)
                if shortage:
                    short = True
                    partial = partial or available > 0
                mats.append(dict(
                    id=x.id, sequence=x.sequence, product_id=x.product_id,
                    product_name=x.product.name if x.product else None,
                    product_code=x.product.item_code if x.product else None,
                    unit_of_measure=x.product.unit_of_measure if x.product else None,
                    tracking_type=x.product.tracking_type if x.product else None,
                    quantity_per_unit=x.quantity_per_unit, scrap_pct=x.scrap_pct,
                    required_quantity=x.required_quantity, issued_quantity=x.issued_quantity,
                    remaining_quantity=remaining, issue_method=x.issue_method, unit_cost=x.unit_cost,
                    available_quantity=available, shortage_quantity=shortage,
                ))
            data["materials"] = mats
            if all(x["remaining_quantity"] == 0 for x in mats):
                data["material_status"] = "issued"
            else:
                data["material_status"] = "shortage" if short and not partial else ("partial" if short else "ready")
            data["operations"] = [dict(
                id=op.id, sequence=op.sequence, name=op.name, work_center_id=op.work_center_id,
                work_center_code=op.work_center.code if op.work_center else None,
                work_center_name=op.work_center.name if op.work_center else None,
                planned_minutes=op.planned_minutes, actual_minutes=op.actual_minutes,
                completed_quantity=op.completed_quantity, status=op.status,
                labor_rate_per_hour=op.labor_rate_per_hour, overhead_rate_per_hour=op.overhead_rate_per_hour,
                started_at=op.started_at, completed_at=op.completed_at,
            ) for op in o.operations]
        return data

    def _quote_ref(self, o: m.MfgProductionOrder) -> dict:
        if not o.quote_item_id or not o.quote_item:
            return dict(quote_item_id=o.quote_item_id, quote_id=None, quote_no=None, customer_name=None)
        quote = o.quote_item.quote
        return dict(quote_item_id=o.quote_item_id, quote_id=quote.id if quote else None,
                    quote_no=quote.quote_no if quote else None,
                    customer_name=quote.customer.customer_name if quote and quote.customer else None)

    def get_out(self, order_id: int) -> dict:
        return self._out(self.get(order_id), detail=True)

    def list(self, *, q: Optional[str] = None, status_: Optional[List[str]] = None, branch_code: Optional[str] = None,
             branch_codes: Optional[List[str]] = None, product_id: Optional[int] = None, late_only: bool = False,
             page: int = 1, size: int = 50) -> dict:
        query = self.db.query(m.MfgProductionOrder).join(Product, Product.id == m.MfgProductionOrder.product_id)
        if q:
            like = f"%{q.strip()}%"
            query = query.filter(or_(m.MfgProductionOrder.order_no.ilike(like), Product.name.ilike(like),
                                     Product.item_code.ilike(like), m.MfgProductionOrder.source_reference.ilike(like)))
        if status_:
            query = query.filter(m.MfgProductionOrder.status.in_(status_))
        if branch_code:
            query = query.filter(m.MfgProductionOrder.branch_code == branch_code)
        if branch_codes is not None:
            query = query.filter(m.MfgProductionOrder.branch_code.in_(branch_codes))
        if product_id:
            query = query.filter(m.MfgProductionOrder.product_id == product_id)
        if late_only:
            query = query.filter(m.MfgProductionOrder.status.in_(OPEN_STATUSES),
                                 m.MfgProductionOrder.planned_end_date < tz.today())
        total = query.count()
        rows = (query.order_by(m.MfgProductionOrder.id.desc()).offset((page - 1) * size).limit(size).all())
        return dict(items=self._many(rows), total=total, page=page, size=size, pages=math.ceil(total / size) if size else 1)

    def _many(self, rows: List[m.MfgProductionOrder]) -> List[dict]:
        names = _user_names(self.db, [r.created_by for r in rows] + [r.released_by for r in rows])
        locations = _location_names(self.db, [r.location_id for r in rows])
        bom_ids = {r.bom_id for r in rows}
        boms = {b.id: b for b in self.db.query(m.MfgBOM).filter(m.MfgBOM.id.in_(bom_ids)).all()} if bom_ids else {}
        return [self._out(r, names=names, locations=locations, boms=boms) for r in rows]

    # ---- building ----
    def _resolve_bom(self, product_id: int, bom_id: Optional[int]) -> m.MfgBOM:
        if bom_id:
            bom = BOMService(self.db).get(bom_id)
            if bom.product_id != product_id:
                raise _bad("The BOM is for a different product")
        else:
            bom = (BOMService(self.db)._query()
                   .filter(m.MfgBOM.product_id == product_id, m.MfgBOM.status == BOMStatus.ACTIVE)
                   .order_by(m.MfgBOM.is_default.desc(), m.MfgBOM.id.desc()).first())
            if not bom:
                raise _bad("This product has no active BOM; create and activate one first")
        if bom.status != BOMStatus.ACTIVE:
            raise _bad(f"BOM {bom.bom_no} is {bom.status}; only an active BOM can be used")
        return bom

    def _build_lines(self, order: m.MfgProductionOrder, bom: m.MfgBOM, user_id: int):
        """(Re)create the order's component and operation lines from the BOM at current costs and rates."""
        out_qty = D(str(bom.output_quantity or 1))
        units = order.planned_quantity
        mats, mat_cost = [], D("0")
        for i in bom.items:
            per_unit = (D(str(i.quantity)) / out_qty).quantize(D("0.000001"))
            required = _units_needed(per_unit, i.scrap_pct, units)
            cost = standard_cost(i.product)
            mat_cost += cost * required
            mats.append(m.MfgProductionOrderMaterial(
                sequence=i.sequence, product_id=i.product_id, quantity_per_unit=per_unit, scrap_pct=i.scrap_pct,
                required_quantity=required, issued_quantity=0, issue_method=i.issue_method, unit_cost=cost,
                created_by=user_id, updated_by=user_id))
        ops, labor, overhead = [], D("0"), D("0")
        for o in bom.operations:
            wc = o.work_center
            mins = _op_minutes(o.setup_minutes, o.run_minutes, units, wc.efficiency_pct)
            labor += _rate_cost(mins, wc.labor_rate_per_hour)
            overhead += _rate_cost(mins, wc.overhead_rate_per_hour)
            ops.append(m.MfgProductionOrderOperation(
                sequence=o.sequence, name=o.name, work_center_id=o.work_center_id, planned_minutes=mins,
                labor_rate_per_hour=wc.labor_rate_per_hour, overhead_rate_per_hour=wc.overhead_rate_per_hour,
                created_by=user_id, updated_by=user_id))
        order.materials = mats
        order.operations = ops
        order.planned_material_cost = _money(mat_cost)
        order.planned_labor_cost = _money(labor)
        order.planned_overhead_cost = _money(overhead)

    def _default_location(self, branch_code: str) -> Optional[int]:
        from app.modules.common.models import Locations
        loc = self.db.query(Locations.id).filter(Locations.branch_code == branch_code).order_by(Locations.id).first()
        return loc[0] if loc else None

    def _check_location(self, location_id: int, branch_code: str):
        from app.modules.common.models import Locations
        loc = self.db.query(Locations).filter(Locations.id == location_id).first()
        if not loc:
            raise _bad(f"Location #{location_id} does not exist")
        if loc.branch_code != branch_code:
            raise _bad("The output location must belong to the order's branch")

    # ---- commands ----
    def create(self, data: s.ProductionOrderIn, user_id: int) -> dict:
        order = self._create(data, user_id)
        self.db.commit()
        return self.get_out(order.id)

    def _create(self, data: s.ProductionOrderIn, user_id: int, quote_item_id: Optional[int] = None) -> m.MfgProductionOrder:
        """Build and flush a draft order (the caller commits)."""
        product = self.db.query(Product).filter(Product.id == data.product_id).first()
        if not product:
            raise _bad("Product does not exist")
        if not product.active:
            raise _bad(f"Product '{product.name}' is inactive")
        if not self.db.query(Branch.id).filter(Branch.branch_code == data.branch_code).first():
            raise _bad(f"Branch '{data.branch_code}' does not exist")
        bom = self._resolve_bom(product.id, data.bom_id)
        if data.location_id:
            self._check_location(data.location_id, data.branch_code)
        yy = str(tz.today().year)[-2:]
        order = m.MfgProductionOrder(
            order_no=next_document_number(self.db, m.MfgProductionOrder.order_no, f"MO-{data.branch_code}-{yy}", 6),
            product_id=product.id, bom_id=bom.id, branch_code=data.branch_code,
            location_id=data.location_id or self._default_location(data.branch_code),
            planned_quantity=data.planned_quantity, planned_start_date=data.planned_start_date,
            planned_end_date=data.planned_end_date, priority=data.priority,
            source_reference=data.source_reference, remark=data.remark, status=PS.DRAFT,
            quote_item_id=quote_item_id, created_by=user_id, updated_by=user_id,
        )
        self._build_lines(order, bom, user_id)
        self.db.add(order)
        self.db.flush()
        log_audit(self.db, user_id, "create", "production_order", order.id,
                  {"order_no": order.order_no, "quantity": order.planned_quantity, "bom_no": bom.bom_no,
                   "quote_item_id": quote_item_id})
        return order

    # ---- make-to-order ----
    def create_from_quote_item(self, data: s.FromQuoteIn, user_id: int) -> dict:
        """A production order for an open line of an approved quotation; its output is
        reserved for that line (as quote-linked purchase receipts are)."""
        from app.modules.manufacturing.planning import CLOSED_QUOTE_STATUSES, OPEN_QUOTE_ITEM_STATUSES, quote_coverage
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        from app.modules.sales.quotation_service import sales_quote_service

        qi = self.db.query(SalesQuoteItem).filter(SalesQuoteItem.id == data.quote_item_id).with_for_update().first()
        if not qi:
            raise _not_found("Quotation item")
        quote = self.db.query(SalesQuote).filter(SalesQuote.id == qi.quote_id).first()
        if not quote.approval or quote.status in CLOSED_QUOTE_STATUSES:
            raise _bad(f"Quotation {quote.quote_no} is not open and approved; production can only be raised for an approved quotation")
        if qi.item_status not in OPEN_QUOTE_ITEM_STATUSES:
            raise _bad(f"This quotation line is {qi.item_status.replace('_', ' ')} and cannot be produced")
        remaining = qi.quantity - (qi.converted_qty or 0) - quote_coverage(self.db, [qi.id]).get(qi.id, 0)
        if remaining <= 0:
            raise _bad("This quotation line is already fully covered by purchase or production orders")
        qty = data.quantity or remaining
        if qty > remaining:
            raise _bad(f"Only {remaining} unit(s) of this quotation line are left to produce")
        start = data.planned_start_date or tz.today()
        end = data.planned_end_date or max(start, quote.expected_delivery_date or start)
        order = self._create(s.ProductionOrderIn(
            product_id=qi.product_id, bom_id=data.bom_id, branch_code=quote.branch_code, location_id=data.location_id,
            planned_quantity=qty, planned_start_date=start, planned_end_date=end, priority=data.priority,
            source_reference=quote.quote_no, remark=data.remark), user_id, quote_item_id=qi.id)
        qi.item_status = "mo_created"
        sales_quote_service.recompute_quote_status(self.db, quote)
        log_audit(self.db, user_id, "production_order_created", "sales_quote", quote.id,
                  {"quote_item_id": qi.id, "order_no": order.order_no, "quantity": qty})
        self.db.commit()
        return self.get_out(order.id)

    def _release_quote_item(self, order: m.MfgProductionOrder) -> None:
        """A cancelled / deleted make-to-order order gives its quotation line back once
        no other production order covers it."""
        if not order.quote_item_id:
            return
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        from app.modules.sales.quotation_service import sales_quote_service
        qi = self.db.query(SalesQuoteItem).filter(SalesQuoteItem.id == order.quote_item_id).with_for_update().first()
        if not qi or qi.item_status != "mo_created":
            return
        others = (self.db.query(m.MfgProductionOrder.id)
                  .filter(m.MfgProductionOrder.quote_item_id == qi.id, m.MfgProductionOrder.id != order.id,
                          m.MfgProductionOrder.status != PS.CANCELLED).first())
        if others:
            return
        qi.item_status = "procurement" if (qi.converted_qty or 0) > 0 else "pending"
        quote = self.db.query(SalesQuote).filter(SalesQuote.id == qi.quote_id).first()
        if quote:
            sales_quote_service.recompute_quote_status(self.db, quote)

    def _units_to_reserve(self, order: m.MfgProductionOrder, qty: int) -> int:
        """How many of ``qty`` new units belong to the order's quotation line."""
        if not order.quote_item_id or qty <= 0:
            return 0
        from app.modules.manufacturing.planning import CLOSED_QUOTE_STATUSES
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        qi = self.db.query(SalesQuoteItem).filter(SalesQuoteItem.id == order.quote_item_id).with_for_update().first()
        if not qi or qi.item_status in ("cancelled", "so_created", "completed"):
            return 0
        quote = self.db.query(SalesQuote).filter(SalesQuote.id == qi.quote_id).first()
        if not quote or quote.status in CLOSED_QUOTE_STATUSES:
            return 0
        reserved = (self.db.query(func.coalesce(func.sum(SalesStock.quantity), 0))
                    .filter(SalesStock.reserved_for_quote_item_id == qi.id, SalesStock.status == StockStatus.RESERVED,
                            SalesStock.is_active.is_(True), SalesStock.production_order_id.isnot(None)).scalar() or 0)
        return max(min(qty, qi.quantity - (qi.converted_qty or 0) - int(reserved)), 0)

    def update(self, order_id: int, data: s.ProductionOrderUpdate, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        if order.status != PS.DRAFT:
            raise _bad("Only a draft production order can be changed")
        changes = data.model_dump(exclude_unset=True)
        rebuild = False
        if changes.get("bom_id") and changes["bom_id"] != order.bom_id:
            order.bom_id = self._resolve_bom(order.product_id, changes["bom_id"]).id
            rebuild = True
        if changes.get("planned_quantity") and changes["planned_quantity"] != order.planned_quantity:
            order.planned_quantity = changes["planned_quantity"]
            rebuild = True
        if changes.get("location_id"):
            self._check_location(changes["location_id"], order.branch_code)
            order.location_id = changes["location_id"]
        for k in ("planned_start_date", "planned_end_date", "priority"):
            if changes.get(k) is not None:
                setattr(order, k, changes[k])
        for k in ("source_reference", "remark"):
            if k in changes:
                setattr(order, k, changes[k])
        if order.planned_end_date < order.planned_start_date:
            raise _bad("Planned end date cannot be before the planned start date")
        if rebuild:
            self._build_lines(order, self._resolve_bom(order.product_id, order.bom_id), user_id)
        order.updated_by = user_id
        log_audit(self.db, user_id, "update", "production_order", order.id, {"fields": sorted(changes)})
        self.db.commit()
        return self.get_out(order.id)

    def delete(self, order_id: int, user_id: int) -> None:
        order = self.get(order_id, lock=True)
        if order.status != PS.DRAFT:
            raise _bad("Only a draft production order can be deleted; cancel it instead")
        log_audit(self.db, user_id, "delete", "production_order", order.id, {"order_no": order.order_no})
        self._release_quote_item(order)
        self.db.delete(order)
        self.db.commit()

    def release(self, order_id: int, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        if order.status != PS.DRAFT:
            raise _bad(f"Only a draft order can be released (this one is {order.status.replace('_', ' ')})")
        bom = self._resolve_bom(order.product_id, order.bom_id)
        # Costs and rates are fixed at release
        self._build_lines(order, bom, user_id)
        planned_total = D(str(order.planned_material_cost)) + D(str(order.planned_labor_cost)) + D(str(order.planned_overhead_cost))
        std = standard_cost(order.product)
        order.standard_unit_cost = std if std > 0 else _money(planned_total / order.planned_quantity)
        order.status = PS.RELEASED
        order.released_by = user_id
        order.released_at = tz.now()
        order.updated_by = user_id
        log_audit(self.db, user_id, "release", "production_order", order.id,
                  {"standard_unit_cost": str(order.standard_unit_cost)})
        self.db.commit()
        return self.get_out(order.id)

    def _ensure_running(self, order: m.MfgProductionOrder, action: str):
        if order.status not in ACTIVE_STATUSES:
            raise _bad(f"Cannot {action}: the order is {order.status.replace('_', ' ')} (release it first)")
        if order.status == PS.RELEASED:
            order.status = PS.IN_PROGRESS
            order.actual_start_at = order.actual_start_at or tz.now()

    def start(self, order_id: int, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        if order.status != PS.RELEASED:
            raise _bad("Only a released order can be started")
        self._ensure_running(order, "start")
        log_audit(self.db, user_id, "start", "production_order", order.id, {})
        self.db.commit()
        return self.get_out(order.id)

    # ---- stock movements ----
    def _consume(self, order: m.MfgProductionOrder, mat: m.MfgProductionOrderMaterial, qty: int,
                 txn_type: str, user_id: int, remark: Optional[str] = None) -> m.MfgMaterialTransaction:
        rows = (self.db.query(SalesStock)
                .filter(*_free_stock_filter([mat.product_id], [order.branch_code]))
                .order_by(*FEFO_ORDER).with_for_update().all())
        taken = take_units(self.db, rows, qty)
        got = units_in(taken)
        if got < qty:
            name = mat.product.name if mat.product else f"product #{mat.product_id}"
            raise _bad(f"Not enough '{name}' in branch {order.branch_code}: {qty} needed, {got} available")
        for row in taken:
            row.status = StockStatus.CONSUMED
            row.is_active = False
            row.consumed_by_production_order_id = order.id
        mat.issued_quantity += qty
        return self._txn(order, mat, txn_type, qty, user_id, remark)

    def _txn(self, order, mat, txn_type: str, qty: int, user_id: int, remark: Optional[str]) -> m.MfgMaterialTransaction:
        total = _money(D(str(mat.unit_cost)) * qty)
        txn = m.MfgMaterialTransaction(
            order_id=order.id, material_id=mat.id, product_id=mat.product_id, transaction_type=txn_type,
            quantity=qty, unit_cost=mat.unit_cost, total_cost=total, branch_code=order.branch_code,
            transaction_date=tz.now(), remark=remark, created_by=user_id, updated_by=user_id,
        )
        self.db.add(txn)
        self.db.flush()
        txn.order = order
        sign = -1 if txn_type == "return" else 1
        order.actual_material_cost = _money(D(str(order.actual_material_cost)) + sign * total)
        self.gl.post_material_transaction(txn, user_id)
        return txn

    def _material(self, order: m.MfgProductionOrder, material_id: int) -> m.MfgProductionOrderMaterial:
        mat = next((x for x in order.materials if x.id == material_id), None)
        if not mat:
            raise _bad(f"Material line #{material_id} is not on this order")
        return mat

    def issue_materials(self, order_id: int, data: s.MaterialMoveIn, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        self._ensure_running(order, "issue materials")
        for line in data.lines:
            mat = self._material(order, line.material_id)
            self._consume(order, mat, line.quantity, "issue", user_id, data.remark)
        log_audit(self.db, user_id, "issue_materials", "production_order", order.id,
                  {"lines": [[l.material_id, l.quantity] for l in data.lines]})
        self.db.commit()
        return self.get_out(order.id)

    def return_materials(self, order_id: int, data: s.MaterialMoveIn, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        if order.status not in (PS.RELEASED, PS.IN_PROGRESS, PS.COMPLETED):
            raise _bad(f"Cannot return materials: the order is {order.status.replace('_', ' ')}")
        for line in data.lines:
            mat = self._material(order, line.material_id)
            if line.quantity > mat.issued_quantity:
                raise _bad(f"Only {mat.issued_quantity} unit(s) of '{mat.product.name}' were issued to this order")
            rows = (self.db.query(SalesStock)
                    .filter(SalesStock.consumed_by_production_order_id == order.id,
                            SalesStock.product_id == mat.product_id, SalesStock.status == StockStatus.CONSUMED)
                    .order_by(SalesStock.id.desc()).with_for_update().all())
            taken = take_units(self.db, rows, line.quantity)
            if units_in(taken) < line.quantity:
                raise _bad(f"Only {units_in(taken)} consumed unit(s) of '{mat.product.name}' can still be returned")
            for row in taken:
                row.status = StockStatus.AVAILABLE
                row.is_active = True
                row.consumed_by_production_order_id = None
            mat.issued_quantity -= line.quantity
            self._txn(order, mat, "return", line.quantity, user_id, data.remark)
        log_audit(self.db, user_id, "return_materials", "production_order", order.id,
                  {"lines": [[l.material_id, l.quantity] for l in data.lines]})
        self.db.commit()
        return self.get_out(order.id)

    def _backflush(self, order: m.MfgProductionOrder, units_done: int, user_id: int):
        for mat in order.materials:
            if mat.issue_method != MaterialIssueMethod.BACKFLUSH:
                continue
            target = _units_needed(mat.quantity_per_unit, mat.scrap_pct, units_done)
            delta = target - mat.issued_quantity
            if delta > 0:
                self._consume(order, mat, delta, "backflush", user_id, "Backflushed on output")

    def _serials(self, order: m.MfgProductionOrder, qty: int, given: Optional[List[str]]) -> List[str]:
        if given:
            if len(given) != qty:
                raise _bad(f"Enter one serial number per good unit ({qty} needed, {len(given)} given)")
            serials = [x.strip() for x in given]
            if len(set(serials)) != len(serials):
                raise _bad("Serial numbers must be unique")
        else:
            start = (self.db.query(func.count(SalesStock.id))
                     .filter(SalesStock.production_order_id == order.id, SalesStock.barcode.isnot(None)).scalar() or 0)
            serials = [f"{order.order_no}-{start + n:04d}" for n in range(1, qty + 1)]
        clash = (self.db.query(SalesStock.barcode).filter(SalesStock.barcode.in_(serials)).first()
                 or self.db.query(CompanyAssets.barcode).filter(CompanyAssets.barcode.in_(serials)).first())
        if clash:
            raise _bad(f"Serial number '{clash[0]}' already exists")
        return serials

    def record_output(self, order_id: int, data: s.OutputIn, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        self._ensure_running(order, "record output")
        if order.produced_quantity + data.quantity > order.planned_quantity:
            left = order.planned_quantity - order.produced_quantity
            raise _bad(f"Only {left} more good unit(s) can be recorded on this order (planned {order.planned_quantity})")
        location_id = data.location_id or order.location_id
        if data.location_id:
            self._check_location(data.location_id, order.branch_code)
        units_done = order.produced_quantity + order.scrapped_quantity + data.quantity + data.scrap_quantity
        self._backflush(order, units_done, user_id)

        now = tz.now()
        output = m.MfgProductionOutput(
            order_id=order.id, quantity=data.quantity, scrap_quantity=data.scrap_quantity,
            batch_no=data.batch_no, expiry_date=data.expiry_date, unit_cost=order.standard_unit_cost,
            total_value=_money(D(str(order.standard_unit_cost)) * data.quantity), location_id=location_id,
            receipt_date=now, remark=data.remark, created_by=user_id, updated_by=user_id,
        )
        self.db.add(output)
        self.db.flush()
        output.order = order
        if data.quantity:
            tracking = order.product.tracking_type or TrackingType.SERIAL
            # Make-to-order output is reserved for the quotation line, the rest is free stock
            to_reserve = self._units_to_reserve(order, data.quantity)
            base = dict(product_id=order.product_id, branch_code=order.branch_code, location_id=location_id,
                        production_order_id=order.id, is_active=True,
                        added_date=now, created_by=user_id, updated_by=user_id)

            def _status(reserved: bool) -> dict:
                return (dict(status=StockStatus.RESERVED, reserved_for_quote_item_id=order.quote_item_id) if reserved
                        else dict(status=StockStatus.AVAILABLE))

            if tracking == TrackingType.SERIAL:
                for n, serial in enumerate(self._serials(order, data.quantity, data.serial_numbers)):
                    self.db.add(SalesStock(barcode=serial, quantity=1, **base, **_status(n < to_reserve)))
            else:
                batch = (data.batch_no or order.order_no) if tracking == TrackingType.BATCH else None
                expiry = data.expiry_date if tracking == TrackingType.BATCH else None
                for qty, reserved in ((to_reserve, True), (data.quantity - to_reserve, False)):
                    if qty > 0:
                        self.db.add(SalesStock(barcode=None, quantity=qty, batch_no=batch, expiry_date=expiry,
                                               **base, **_status(reserved)))
                if tracking == TrackingType.BATCH and not output.batch_no:
                    output.batch_no = batch
        elif data.serial_numbers:
            raise _bad("Serial numbers are only for good units")
        order.produced_quantity += data.quantity
        order.scrapped_quantity += data.scrap_quantity
        order.output_value = _money(D(str(order.output_value)) + D(str(output.total_value)))
        try:
            self.db.flush()
        except IntegrityError:
            self.db.rollback()
            raise _bad("A serial number is already in use")
        self.gl.post_output(output, user_id)
        log_audit(self.db, user_id, "record_output", "production_order", order.id,
                  {"quantity": data.quantity, "scrap": data.scrap_quantity, "output_id": output.id})
        self.db.commit()
        return self.get_out(order.id)

    def log_time(self, order_id: int, data: s.TimeLogIn, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        self._ensure_running(order, "log time")
        op = next((x for x in order.operations if x.id == data.operation_id), None)
        if not op:
            raise _bad("That operation is not on this order")
        if op.status == "completed":
            raise _bad(f"Operation '{op.name}' is already completed")
        if data.employee_id:
            from app.modules.employees.models import Employee
            if not self.db.query(Employee.id).filter(Employee.id == data.employee_id).first():
                raise _bad("Employee does not exist")
        minutes = data.minutes
        if minutes is None:
            minutes = D(str((data.end_time - data.start_time).total_seconds() / 60)).quantize(CENT)
        self._add_time(order, op, minutes, data.completed_quantity, user_id, employee_id=data.employee_id,
                       start=data.start_time, end=data.end_time, remark=data.remark)
        if data.complete_operation:
            op.status = "completed"
            op.completed_at = tz.now()
        log_audit(self.db, user_id, "log_time", "production_order", order.id,
                  {"operation": op.name, "minutes": str(minutes)})
        self.db.commit()
        return self.get_out(order.id)

    def _add_time(self, order, op, minutes: Decimal, qty: int, user_id: int, *, employee_id=None, start=None,
                  end=None, remark=None, is_auto: bool = False) -> m.MfgTimeLog:
        log = m.MfgTimeLog(
            order_id=order.id, operation_id=op.id, employee_id=employee_id, start_time=start, end_time=end,
            minutes=minutes, completed_quantity=qty, labor_cost=_rate_cost(minutes, op.labor_rate_per_hour),
            overhead_cost=_rate_cost(minutes, op.overhead_rate_per_hour), is_auto=is_auto, remark=remark,
            created_by=user_id, updated_by=user_id,
        )
        self.db.add(log)
        self.db.flush()
        log.order, log.operation = order, op
        op.actual_minutes = D(str(op.actual_minutes)) + minutes
        op.completed_quantity += qty
        if op.status == "pending":
            op.status = "in_progress"
            op.started_at = start or tz.now()
        order.actual_labor_cost = _money(D(str(order.actual_labor_cost)) + log.labor_cost)
        order.actual_overhead_cost = _money(D(str(order.actual_overhead_cost)) + log.overhead_cost)
        self.gl.post_time_log(log, user_id)
        return log

    def complete(self, order_id: int, user_id: int) -> dict:
        """Finish the order: operations with no time booked get their planned time
        (pro rata to the units done), every operation is marked completed."""
        order = self.get(order_id, lock=True)
        if order.status not in ACTIVE_STATUSES:
            raise _bad("Only a released or in-progress order can be completed")
        if order.produced_quantity == 0 and order.scrapped_quantity == 0:
            raise _bad("Record some output before completing the order, or cancel it")
        done = order.produced_quantity + order.scrapped_quantity
        share = min(D(done) / D(order.planned_quantity), D(1))
        now = tz.now()
        for op in order.operations:
            if op.status == "completed":
                continue
            if D(str(op.actual_minutes)) == 0 and D(str(op.planned_minutes)) > 0:
                self._add_time(order, op, (D(str(op.planned_minutes)) * share).quantize(CENT), done, user_id,
                               remark="Planned time booked on completion", is_auto=True)
            op.status = "completed"
            op.completed_at = now
        order.status = PS.COMPLETED
        order.actual_start_at = order.actual_start_at or now
        order.actual_end_at = now
        log_audit(self.db, user_id, "complete", "production_order", order.id,
                  {"produced": order.produced_quantity, "scrapped": order.scrapped_quantity})
        self.db.commit()
        return self.get_out(order.id)

    def close(self, order_id: int, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        if order.status != PS.COMPLETED:
            raise _bad("Only a completed order can be closed")
        actual = D(str(order.actual_material_cost)) + D(str(order.actual_labor_cost)) + D(str(order.actual_overhead_cost))
        order.variance_amount = _money(actual - D(str(order.output_value)))
        order.status = PS.CLOSED
        order.closed_by = user_id
        order.closed_at = tz.now()
        self.gl.post_variance(order, user_id)
        log_audit(self.db, user_id, "close", "production_order", order.id, {"variance": str(order.variance_amount)})
        self.db.commit()
        return self.get_out(order.id)

    def cancel(self, order_id: int, data: s.CancelIn, user_id: int) -> dict:
        order = self.get(order_id, lock=True)
        if order.status not in (PS.DRAFT, PS.RELEASED, PS.IN_PROGRESS):
            raise _bad(f"A {order.status.replace('_', ' ')} order cannot be cancelled")
        if any(x.issued_quantity for x in order.materials):
            raise _bad("Return the issued materials before cancelling the order")
        if order.produced_quantity or order.scrapped_quantity:
            raise _bad("Output has been recorded on this order; complete and close it instead")
        if self.db.query(m.MfgTimeLog.id).filter(m.MfgTimeLog.order_id == order.id).first():
            raise _bad("Time has been booked on this order; complete and close it instead")
        order.status = PS.CANCELLED
        order.cancel_reason = data.reason
        order.updated_by = user_id
        self._release_quote_item(order)
        log_audit(self.db, user_id, "cancel", "production_order", order.id, {"reason": data.reason})
        self.db.commit()
        return self.get_out(order.id)

    def activity(self, order_id: int) -> dict:
        order = self.get(order_id)
        txns = (self.db.query(m.MfgMaterialTransaction).filter(m.MfgMaterialTransaction.order_id == order.id)
                .order_by(m.MfgMaterialTransaction.id.desc()).all())
        outputs = (self.db.query(m.MfgProductionOutput).filter(m.MfgProductionOutput.order_id == order.id)
                   .order_by(m.MfgProductionOutput.id.desc()).all())
        logs = (self.db.query(m.MfgTimeLog).filter(m.MfgTimeLog.order_id == order.id)
                .order_by(m.MfgTimeLog.id.desc()).all())
        names = _user_names(self.db, [x.created_by for x in [*txns, *outputs, *logs]])
        locations = _location_names(self.db, [o.location_id for o in outputs])
        serials = defaultdict(list)
        for barcode, added in (self.db.query(SalesStock.barcode, SalesStock.added_date)
                               .filter(SalesStock.production_order_id == order.id, SalesStock.barcode.isnot(None))
                               .order_by(SalesStock.id)):
            serials[added].append(barcode)
        employees = {}
        emp_ids = {l.employee_id for l in logs if l.employee_id}
        if emp_ids:
            from app.modules.employees.models import Employee
            for e in self.db.query(Employee).filter(Employee.id.in_(emp_ids)).all():
                u = e.user
                employees[e.id] = (f"{u.first_name or ''} {u.last_name or ''}".strip() if u else None) or e.employee_id
        return dict(
            materials=[dict(
                id=t.id, order_id=t.order_id, material_id=t.material_id, product_id=t.product_id,
                product_name=t.product.name if t.product else None, product_code=t.product.item_code if t.product else None,
                transaction_type=t.transaction_type, quantity=t.quantity, unit_cost=t.unit_cost,
                total_cost=t.total_cost, transaction_date=t.transaction_date, remark=t.remark,
                created_by_name=names.get(t.created_by)) for t in txns],
            outputs=[dict(
                id=o.id, order_id=o.order_id, quantity=o.quantity, scrap_quantity=o.scrap_quantity,
                batch_no=o.batch_no, expiry_date=o.expiry_date, unit_cost=o.unit_cost, total_value=o.total_value,
                location_id=o.location_id, location_name=locations.get(o.location_id), receipt_date=o.receipt_date,
                remark=o.remark, serial_numbers=serials.get(o.receipt_date, []),
                created_by_name=names.get(o.created_by)) for o in outputs],
            time_logs=[dict(
                id=l.id, order_id=l.order_id, operation_id=l.operation_id,
                operation_name=l.operation.name if l.operation else None,
                work_center_name=l.operation.work_center.name if l.operation and l.operation.work_center else None,
                employee_id=l.employee_id, employee_name=employees.get(l.employee_id), start_time=l.start_time,
                end_time=l.end_time, minutes=l.minutes, completed_quantity=l.completed_quantity,
                labor_cost=l.labor_cost, overhead_cost=l.overhead_cost, is_auto=l.is_auto, remark=l.remark,
                created_at=l.created_at, created_by_name=names.get(l.created_by)) for l in logs],
        )


# ═══════════════════════════ job cards / MRP / dashboard ═══════════════════════════
class PlanningService:
    def __init__(self, db: Session):
        self.db = db

    def job_cards(self, *, work_center_id: Optional[int] = None, branch_codes: Optional[List[str]] = None,
                  include_completed: bool = False) -> List[dict]:
        O, OP = m.MfgProductionOrder, m.MfgProductionOrderOperation
        q = (self.db.query(OP, O).join(O, O.id == OP.order_id).filter(O.status.in_(ACTIVE_STATUSES)))
        if not include_completed:
            q = q.filter(OP.status != "completed")
        if work_center_id:
            q = q.filter(OP.work_center_id == work_center_id)
        if branch_codes is not None:
            q = q.filter(O.branch_code.in_(branch_codes))
        today = tz.today()
        prio = {"urgent": 0, "high": 1, "normal": 2, "low": 3}
        rows = q.all()
        rows.sort(key=lambda r: (prio.get(r[1].priority, 2), r[1].planned_start_date, r[1].id, r[0].sequence))
        return [dict(
            operation_id=op.id, order_id=o.id, order_no=o.order_no, order_status=o.status, priority=o.priority,
            branch_code=o.branch_code, product_name=o.product.name if o.product else None,
            product_code=o.product.item_code if o.product else None, planned_quantity=o.planned_quantity,
            produced_quantity=o.produced_quantity, planned_start_date=o.planned_start_date,
            planned_end_date=o.planned_end_date, is_late=o.planned_end_date < today, sequence=op.sequence,
            name=op.name, work_center_id=op.work_center_id,
            work_center_code=op.work_center.code if op.work_center else None,
            work_center_name=op.work_center.name if op.work_center else None, planned_minutes=op.planned_minutes,
            actual_minutes=op.actual_minutes, completed_quantity=op.completed_quantity, status=op.status,
            started_at=op.started_at,
        ) for op, o in rows]

    def dashboard(self, branch_codes: Optional[List[str]] = None) -> dict:
        O = m.MfgProductionOrder
        scope = [O.branch_code.in_(branch_codes)] if branch_codes is not None else []
        today = tz.today()
        counts = dict(self.db.query(O.status, func.count(O.id)).filter(*scope).group_by(O.status).all())
        open_orders = sum(counts.get(x, 0) for x in OPEN_STATUSES)
        late = (self.db.query(func.count(O.id))
                .filter(*scope, O.status.in_(OPEN_STATUSES), O.planned_end_date < today).scalar() or 0)
        wip = (self.db.query(func.coalesce(func.sum(
            O.actual_material_cost + O.actual_labor_cost + O.actual_overhead_cost - O.output_value), 0))
            .filter(*scope, O.status.in_((PS.RELEASED, PS.IN_PROGRESS, PS.COMPLETED))).scalar())

        Out = m.MfgProductionOutput
        month_start = today.replace(day=1)
        first = (month_start - timedelta(days=150)).replace(day=1)
        out_q = (self.db.query(Out.receipt_date, Out.quantity, Out.scrap_quantity, Out.total_value)
                 .join(O, O.id == Out.order_id).filter(*scope, Out.receipt_date >= datetime.combine(first, datetime.min.time())))
        months: Dict[str, list] = {}
        cursor = first
        while cursor <= month_start:
            months[cursor.strftime("%Y-%m")] = [0, D("0"), 0]
            cursor = (cursor + timedelta(days=32)).replace(day=1)
        for when, qty, scrap, value in out_q:
            k = when.strftime("%Y-%m")
            if k in months:
                months[k][0] += qty
                months[k][1] += D(str(value))
                months[k][2] += scrap
        this = months.get(month_start.strftime("%Y-%m"), [0, D("0"), 0])
        total_good = sum(v[0] for v in months.values())
        total_scrap = sum(v[2] for v in months.values())
        scrap_rate = (D(total_scrap) * 100 / D(total_good + total_scrap)).quantize(D("0.1")) if total_good + total_scrap else D("0")
        variance = (self.db.query(func.coalesce(func.sum(O.variance_amount), 0))
                    .filter(*scope, O.status == PS.CLOSED,
                            O.closed_at >= datetime.combine(month_start, datetime.min.time())).scalar())

        wc_service = WorkCenterService(self.db)
        load = wc_service._load()
        wcs = self.db.query(m.MfgWorkCenter).filter(m.MfgWorkCenter.active.is_(True)).order_by(m.MfgWorkCenter.code).all()
        wc_load = []
        for wc in wcs:
            mins, n = load.get(wc.id, (D("0"), 0))
            per_day = D(str(wc.working_hours_per_day)) * 60 * wc.capacity
            wc_load.append(dict(work_center_id=wc.id, code=wc.code, name=wc.name, open_load_minutes=mins.quantize(CENT),
                                capacity_minutes_per_day=per_day.quantize(CENT),
                                load_days=(mins / per_day).quantize(D("0.1")) if per_day else D("0"),
                                open_operations=n))

        orders = ProductionOrderService(self.db)
        upcoming = (self.db.query(O).filter(*scope, O.status.in_(OPEN_STATUSES), O.planned_end_date >= today)
                    .order_by(O.planned_start_date, O.id).limit(8).all())
        late_rows = (self.db.query(O).filter(*scope, O.status.in_(OPEN_STATUSES), O.planned_end_date < today)
                     .order_by(O.planned_end_date, O.id).limit(8).all())
        from app.modules.manufacturing.planning import MrpService
        shortages = len(MrpService(self.db).run(branch_codes=branch_codes, shortages_only=True))
        return dict(
            status_counts=[dict(status=k, count=counts.get(k, 0)) for k in
                           (PS.DRAFT, PS.RELEASED, PS.IN_PROGRESS, PS.COMPLETED, PS.CLOSED, PS.CANCELLED)],
            open_orders=open_orders, late_orders=late, wip_value=_money(wip),
            output_this_month=this[0], output_value_this_month=_money(this[1]), scrap_rate_pct=scrap_rate,
            material_shortages=shortages,
            active_boms=self.db.query(func.count(m.MfgBOM.id)).filter(m.MfgBOM.status == BOMStatus.ACTIVE).scalar() or 0,
            active_work_centers=len(wcs), variance_this_month=_money(variance),
            work_center_load=wc_load,
            monthly_output=[dict(month=k, quantity=v[0], value=_money(v[1]), scrap_quantity=v[2]) for k, v in months.items()],
            upcoming_orders=orders._many(upcoming), late_order_list=orders._many(late_rows),
        )
