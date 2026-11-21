"""Material requirements planning, reordering rules and firming planned orders.

MRP nets demand against supply per (Item Catalog item, branch) — an order can only draw
stock of its own branch — and explodes planned production through BOMs level by level
(central stock phase 4: BOMs, stock, purchase lines and reorder rules are all per item;
a quotation line's demand is for the item its product sells):

  demand   open quotation lines not yet ordered, components still to be issued to open
           production orders, components of planned production of parent items
  supply   free stock, open purchase orders not yet received, open production orders
  rule     min / max stock level (reordering rule)

  projected = supply - demand
  suggested = (max or min) - projected  when projected < min (0 without a rule),
              rounded up to the rule's multiple

Supply that is earmarked to a quotation line (quote-linked PO lines, make-to-order
production orders, stock reserved for a line) is left out on both sides, so it is never
counted twice. Items are processed in low-level-code order (a component after every
item that uses it) so dependent demand is complete before an item is netted.

Planned orders are not stored: firming turns selected suggestions into purchase orders
(one per supplier, through the normal PO approval) or draft production orders.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
from typing import Dict, List, Optional, Tuple

from pydantic import ValidationError
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import Branch
from app.common.audit import log_audit
from app.common.enums import BOMStatus, ProductionOrderStatus as PS, StockStatus
from app.core import timezone as tz
from app.modules.inventory.models import SalesStock
from app.modules.manufacturing import models as m
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.items import get_item, item_standard_cost, single_products
from app.modules.manufacturing.service import (
    OPEN_PO_STATUSES,
    OPEN_STATUSES,
    ProductionOrderService,
    _active_bom_items,
    _bad,
    _free_stock_filter,
    _money,
    _not_found,
    _units_needed,
)
from app.modules.materials.models import Material
from app.modules.products.models import Product

D = Decimal
Key = Tuple[int, str]  # (material_id, branch_code)

# Quotations whose open lines count as demand: signed off and not closed
CLOSED_QUOTE_STATUSES = ("rejected", "cancelled", "revised", "expired", "completed", "so_created")
OPEN_QUOTE_ITEM_STATUSES = ("pending", "procurement", "mo_created")


def default_boms(db: Session, material_ids) -> Dict[int, m.MfgBOM]:
    """The BOM planning uses per item: the default active one, else the latest active."""
    material_ids = list({i for i in material_ids if i})
    if not material_ids:
        return {}
    out: Dict[int, m.MfgBOM] = {}
    rows = (db.query(m.MfgBOM).filter(m.MfgBOM.material_id.in_(material_ids), m.MfgBOM.status == BOMStatus.ACTIVE)
            .order_by(m.MfgBOM.is_default.desc(), m.MfgBOM.id.desc()).all())
    for b in rows:
        out.setdefault(b.material_id, b)
    return out


def quote_coverage(db: Session, quote_item_ids) -> Dict[int, int]:
    """Units of each quotation line already covered by make-to-order production:
    open production orders still to produce plus produced stock still reserved for it."""
    ids = list(set(quote_item_ids))
    if not ids:
        return {}
    O = m.MfgProductionOrder
    out: Dict[int, int] = defaultdict(int)
    for qid, planned, produced in (db.query(O.quote_item_id, O.planned_quantity, O.produced_quantity)
                                   .filter(O.quote_item_id.in_(ids), O.status.in_(OPEN_STATUSES))):
        out[qid] += max(planned - produced, 0)
    for qid, qty in (db.query(SalesStock.reserved_for_quote_item_id, func.coalesce(func.sum(SalesStock.quantity), 0))
                     .filter(SalesStock.reserved_for_quote_item_id.in_(ids), SalesStock.status == StockStatus.RESERVED,
                             SalesStock.is_active.is_(True), SalesStock.production_order_id.isnot(None))
                     .group_by(SalesStock.reserved_for_quote_item_id)):
        out[qid] += int(qty)
    return out


def _round_up(qty: int, multiple: int) -> int:
    multiple = max(multiple or 1, 1)
    return int(math.ceil(qty / multiple) * multiple)


# ═══════════════════════════ reordering rules ═══════════════════════════
class ReorderRuleService:
    def __init__(self, db: Session):
        self.db = db

    def _outs(self, rules: List[m.MfgReorderRule]) -> List[dict]:
        from app.modules.purchasing.models import Supplier
        sup_ids = {r.preferred_supplier_id for r in rules if r.preferred_supplier_id}
        names = dict(self.db.query(Supplier.id, Supplier.company_name).filter(Supplier.id.in_(sup_ids)).all()) if sup_ids else {}
        stock: Dict[Key, int] = {}
        mids = list({r.material_id for r in rules if r.material_id})
        if mids:
            branches = list({r.branch_code for r in rules})
            for mid, branch, qty in (self.db.query(SalesStock.material_id, SalesStock.branch_code,
                                                   func.coalesce(func.sum(SalesStock.quantity), 0))
                                     .filter(*_free_stock_filter(mids, branches))
                                     .group_by(SalesStock.material_id, SalesStock.branch_code)):
                stock[(mid, branch)] = int(qty)
        manufactured = _active_bom_items(self.db, mids)
        linked = single_products(self.db, mids)
        out = []
        for r in rules:
            on_hand = stock.get((r.material_id, r.branch_code), 0)
            item = r.item
            p = r.product or linked.get(r.material_id)
            out.append(dict(
                id=r.id, material_id=r.material_id, material_item_code=item.item_code if item else None,
                material_name=item.name if item else None,
                product_id=p.id if p else None, product_name=p.name if p else None,
                product_code=p.item_code if p else None,
                unit_of_measure=(item.unit_of_measure if item else None) or (p.unit_of_measure if p else None),
                is_manufactured=r.material_id in manufactured, branch_code=r.branch_code,
                min_quantity=r.min_quantity, max_quantity=r.max_quantity, multiple_quantity=r.multiple_quantity,
                preferred_supplier_id=r.preferred_supplier_id, preferred_supplier_name=names.get(r.preferred_supplier_id),
                active=r.active, on_hand_quantity=on_hand, below_minimum=r.active and on_hand < r.min_quantity,
                created_at=r.created_at, updated_at=r.updated_at,
            ))
        return out

    def list(self, *, q: Optional[str] = None, branch_codes: Optional[List[str]] = None,
             active: Optional[bool] = None) -> List[dict]:
        query = self.db.query(m.MfgReorderRule).outerjoin(Material, Material.id == m.MfgReorderRule.material_id)
        if q:
            like = f"%{q.strip()}%"
            query = query.filter((Material.name.ilike(like)) | (Material.item_code.ilike(like)))
        if branch_codes is not None:
            query = query.filter(m.MfgReorderRule.branch_code.in_(branch_codes))
        if active is not None:
            query = query.filter(m.MfgReorderRule.active.is_(active))
        return self._outs(query.order_by(Material.name, m.MfgReorderRule.branch_code).all())

    def get(self, rule_id: int) -> m.MfgReorderRule:
        rule = self.db.query(m.MfgReorderRule).filter(m.MfgReorderRule.id == rule_id).first()
        if not rule:
            raise _not_found("Reordering rule")
        return rule

    def _check_supplier(self, supplier_id: Optional[int]):
        if supplier_id:
            from app.modules.purchasing.models import Supplier
            if not self.db.query(Supplier.id).filter(Supplier.id == supplier_id).first():
                raise _bad("Supplier does not exist")

    def create(self, data: s.ReorderRuleIn, user_id: int) -> dict:
        get_item(self.db, data.material_id)
        if not self.db.query(Branch.id).filter(Branch.branch_code == data.branch_code).first():
            raise _bad(f"Branch '{data.branch_code}' does not exist")
        self._check_supplier(data.preferred_supplier_id)
        if self.db.query(m.MfgReorderRule.id).filter(m.MfgReorderRule.material_id == data.material_id,
                                                     m.MfgReorderRule.branch_code == data.branch_code).first():
            raise _bad("This item already has a reordering rule for the branch")
        rule = m.MfgReorderRule(**data.model_dump(), created_by=user_id, updated_by=user_id)
        self.db.add(rule)
        self.db.flush()
        log_audit(self.db, user_id, "create", "reorder_rule", rule.id, data.model_dump())
        self.db.commit()
        return self._outs([rule])[0]

    def update(self, rule_id: int, data: s.ReorderRuleUpdate, user_id: int) -> dict:
        rule = self.get(rule_id)
        changes = data.model_dump(exclude_unset=True)
        if "preferred_supplier_id" in changes:
            self._check_supplier(changes["preferred_supplier_id"])
        for k, v in changes.items():
            if k in ("min_quantity", "multiple_quantity", "active") and v is None:
                continue
            setattr(rule, k, v)
        if rule.max_quantity is not None and rule.max_quantity < rule.min_quantity:
            raise _bad("Maximum quantity cannot be below the minimum")
        rule.updated_by = user_id
        log_audit(self.db, user_id, "update", "reorder_rule", rule.id, {k: str(v) for k, v in changes.items()})
        self.db.commit()
        return self._outs([rule])[0]

    def delete(self, rule_id: int, user_id: int) -> None:
        rule = self.get(rule_id)
        log_audit(self.db, user_id, "delete", "reorder_rule", rule.id,
                  {"material_id": rule.material_id, "product_id": rule.product_id})
        self.db.delete(rule)
        self.db.commit()


# ═══════════════════════════ MRP ═══════════════════════════
class MrpService:
    def __init__(self, db: Session):
        self.db = db

    # ---- demand ----
    def _quote_demand(self, branch_codes) -> Dict[Key, List[dict]]:
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        q = (self.db.query(SalesQuoteItem, SalesQuote).join(SalesQuote, SalesQuote.id == SalesQuoteItem.quote_id)
             .filter(SalesQuote.approval.is_(True), SalesQuote.status.notin_(CLOSED_QUOTE_STATUSES),
                     SalesQuoteItem.item_status.in_(OPEN_QUOTE_ITEM_STATUSES)))
        if branch_codes is not None:
            q = q.filter(SalesQuote.branch_code.in_(branch_codes))
        rows = q.all()
        covered = quote_coverage(self.db, [qi.id for qi, _ in rows])
        items = dict(self.db.query(Product.id, Product.material_id)
                     .filter(Product.id.in_({qi.product_id for qi, _ in rows}), Product.material_id.isnot(None))
                     .all()) if rows else {}
        out: Dict[Key, List[dict]] = defaultdict(list)
        for qi, quote in rows:
            mid = items.get(qi.product_id)
            if not mid:   # a service / non-stock product: nothing to make or buy
                continue
            remaining = qi.quantity - (qi.converted_qty or 0) - covered.get(qi.id, 0)
            if remaining > 0:
                out[(mid, quote.branch_code)].append(dict(
                    source_type="quotation", reference=quote.quote_no, document_id=quote.id, quantity=remaining,
                    need_date=quote.expected_delivery_date or quote.valid_until))
        return out

    def _production_demand(self, branch_codes) -> Dict[Key, List[dict]]:
        O, MAT = m.MfgProductionOrder, m.MfgProductionOrderMaterial
        q = self.db.query(MAT, O).join(O, O.id == MAT.order_id).filter(O.status.in_(OPEN_STATUSES))
        if branch_codes is not None:
            q = q.filter(O.branch_code.in_(branch_codes))
        out: Dict[Key, List[dict]] = defaultdict(list)
        for mat, o in q.all():
            if not mat.material_id:
                continue
            remaining = max(mat.required_quantity - mat.issued_quantity, 0)
            if remaining > 0:
                out[(mat.material_id, o.branch_code)].append(dict(
                    source_type="production_order", reference=o.order_no, document_id=o.id, quantity=remaining,
                    need_date=o.planned_start_date))
        return out

    # ---- supply ----
    def _free_stock(self, mids, branches) -> Dict[Key, int]:
        """Free stock per item and branch: every stock row of the item, item-only rows included."""
        if not mids:
            return {}
        return {(mid, b): int(qty) for mid, b, qty in (
            self.db.query(SalesStock.material_id, SalesStock.branch_code, func.coalesce(func.sum(SalesStock.quantity), 0))
            .filter(*_free_stock_filter(mids, branches)).group_by(SalesStock.material_id, SalesStock.branch_code))}

    def _on_order(self, mids, branches) -> Dict[Key, int]:
        """Unreceived units on open purchase orders per item (purchase lines buy items since
        central stock phase 3), leaving out lines bought for a quotation line."""
        from app.modules.purchasing.models import GoodReceivedItems, PurchasingOrder, PurchasingOrderItems as POI
        if not mids:
            return {}
        from sqlalchemy import and_, or_
        # A line without an item (made before phase 3 and not backfilled) counts for its product's item
        item_col = func.coalesce(POI.material_id, Product.material_id)
        q = (self.db.query(PurchasingOrder.branch_code, POI.id, POI.quantity, item_col)
             .join(PurchasingOrder, PurchasingOrder.id == POI.purchasingorders_id)
             .outerjoin(Product, and_(POI.material_id.is_(None), Product.id == POI.product_id))
             .filter(or_(POI.material_id.in_(list(mids)),
                         and_(POI.material_id.is_(None), Product.material_id.in_(list(mids)))),
                     PurchasingOrder.status.in_(OPEN_PO_STATUSES), POI.quote_item_id.is_(None)))
        if branches is not None:
            q = q.filter(PurchasingOrder.branch_code.in_(branches))
        lines = q.all()
        if not lines:
            return {}
        received = dict(self.db.query(GoodReceivedItems.purchasing_order_items_id,
                                      func.coalesce(func.sum(GoodReceivedItems.quantity), 0))
                        .filter(GoodReceivedItems.purchasing_order_items_id.in_([l.id for l in lines]),
                                GoodReceivedItems.active.is_(True))
                        .group_by(GoodReceivedItems.purchasing_order_items_id).all())
        out: Dict[Key, int] = defaultdict(int)
        for branch, line_id, qty, mid in lines:
            out[(mid, branch)] += max(int(qty) - int(received.get(line_id, 0)), 0)
        return out

    def _in_production(self, mids, branches) -> Dict[Key, int]:
        """Units still to come from open production orders, leaving out make-to-order
        orders whose quotation line is still open (they are already netted on the line)."""
        from sqlalchemy import or_
        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
        if not mids:
            return {}
        O = m.MfgProductionOrder
        q = (self.db.query(O.material_id, O.branch_code, O.planned_quantity, O.produced_quantity)
             .outerjoin(SalesQuoteItem, SalesQuoteItem.id == O.quote_item_id)
             .outerjoin(SalesQuote, SalesQuote.id == SalesQuoteItem.quote_id)
             .filter(O.material_id.in_(list(mids)), O.status.in_(OPEN_STATUSES),
                     or_(O.quote_item_id.is_(None), SalesQuoteItem.item_status.notin_(OPEN_QUOTE_ITEM_STATUSES),
                         SalesQuote.status.in_(CLOSED_QUOTE_STATUSES), SalesQuote.approval.isnot(True))))
        if branches is not None:
            q = q.filter(O.branch_code.in_(branches))
        out: Dict[Key, int] = defaultdict(int)
        for mid, branch, planned, produced in q:
            out[(mid, branch)] += max(planned - produced, 0)
        return out

    def _suppliers(self, mids) -> Dict[int, tuple]:
        """Preferred (else cheapest) active supplier per item from its Suppliers tab:
        (id, name, cost, lead days)."""
        from app.modules.materials.models import MaterialSupplier
        from app.modules.purchasing.models import Supplier
        if not mids:
            return {}
        rows = (self.db.query(MaterialSupplier.material_id, Supplier.id, Supplier.company_name,
                              MaterialSupplier.is_preferred, MaterialSupplier.cost_price, Supplier.lead_time_days)
                .join(Supplier, Supplier.id == MaterialSupplier.supplier_id)
                .filter(MaterialSupplier.material_id.in_(list(mids)), MaterialSupplier.active.is_(True),
                        Supplier.active.is_(True)).all())
        best: Dict[int, tuple] = {}
        for pid, sid, name, preferred, cost, lead in rows:
            key = (0 if preferred else 1, D(str(cost or 0)))
            if pid not in best or key < best[pid][0]:
                best[pid] = (key, (sid, name, D(str(cost or 0)), lead or 0))
        return {pid: v[1] for pid, v in best.items()}

    # ---- run ----
    def run(self, *, branch_codes: Optional[List[str]] = None, shortages_only: bool = False) -> List[dict]:
        quote_dem = self._quote_demand(branch_codes)
        prod_dem = self._production_demand(branch_codes)
        rq = self.db.query(m.MfgReorderRule).filter(m.MfgReorderRule.active.is_(True))
        if branch_codes is not None:
            rq = rq.filter(m.MfgReorderRule.branch_code.in_(branch_codes))
        rules: Dict[Key, m.MfgReorderRule] = {(r.material_id, r.branch_code): r for r in rq.all() if r.material_id}

        keys = set(quote_dem) | set(prod_dem) | set(rules)
        # Every item reachable through BOMs of manufactured items, with its low-level code
        boms: Dict[int, m.MfgBOM] = {}
        llc: Dict[int, int] = {pid: 0 for pid, _ in keys}
        frontier = set(llc)
        while frontier:
            found = default_boms(self.db, [p for p in frontier if p not in boms])
            boms.update(found)
            nxt = set()
            for pid in frontier:
                bom = boms.get(pid)
                for item in (bom.items if bom else []):
                    if item.material_id and item.material_id not in llc:
                        llc[item.material_id] = 0
                        nxt.add(item.material_id)
            frontier = nxt
        for _ in range(len(llc)):  # longest path; bounded so a bad loop cannot spin forever
            changed = False
            for pid, bom in boms.items():
                for item in bom.items:
                    if item.material_id and llc[item.material_id] < llc[pid] + 1:
                        llc[item.material_id] = llc[pid] + 1
                        changed = True
            if not changed:
                break

        pids = list(llc)
        branches = sorted({b for _, b in keys}) if branch_codes is None else list(branch_codes)
        on_hand = self._free_stock(pids, branches)
        on_order = self._on_order(pids, branches)
        in_prod = self._in_production(pids, branches)
        suppliers = self._suppliers(pids)
        products = {i.id: i for i in self.db.query(Material).filter(Material.id.in_(pids)).all()} if pids else {}
        linked = single_products(self.db, pids)
        planned: Dict[Key, List[dict]] = defaultdict(list)
        today = tz.today()

        out = []
        for level in sorted(set(llc.values())):
            level_keys = sorted({k for k in keys | set(planned) if llc.get(k[0]) == level})
            for key in level_keys:
                pid, branch = key
                sources = quote_dem.get(key, []) + prod_dem.get(key, []) + planned.get(key, [])
                qd = sum(x["quantity"] for x in quote_dem.get(key, []))
                pd = sum(x["quantity"] for x in prod_dem.get(key, []))
                dd = sum(x["quantity"] for x in planned.get(key, []))
                demand = qd + pd + dd
                rule = rules.get(key)
                supply = on_hand.get(key, 0) + on_order.get(key, 0) + in_prod.get(key, 0)
                projected = supply - demand
                minimum = rule.min_quantity if rule else 0
                suggested = 0
                if projected < minimum:
                    target = max(rule.max_quantity or 0, minimum) if rule else 0
                    suggested = _round_up(target - projected, rule.multiple_quantity if rule else 1)
                if rule and projected < minimum:
                    sources = sources + [dict(source_type="reorder", reference=f"Min {minimum}", document_id=rule.id,
                                              quantity=minimum, need_date=today)]
                if demand == 0 and not rule:
                    continue

                bom = boms.get(pid)
                need_by = min((x["need_date"] for x in sources if x.get("need_date")), default=today)
                product = products.get(pid)
                if bom:
                    action = "produce"
                    units = max(suggested, 1)
                    mins = sum(D(str(o.setup_minutes)) + D(str(o.run_minutes)) * units for o in bom.operations)
                    lead = int(math.ceil(mins / D(480))) if mins else 0
                    unit_cost = item_standard_cost(self.db, product)
                    sup = None
                    if suggested:
                        out_qty = D(str(bom.output_quantity or 1))
                        for item in bom.items:
                            if not item.material_id:
                                continue
                            per_unit = (D(str(item.quantity)) / out_qty).quantize(D("0.000001"))
                            planned[(item.material_id, branch)].append(dict(
                                source_type="planned", reference=f"Planned {product.item_code if product else pid}",
                                document_id=None, quantity=_units_needed(per_unit, item.scrap_pct, suggested),
                                need_date=need_by - timedelta(days=lead)))
                else:
                    action = "purchase"
                    sup = suppliers.get(pid)
                    if rule and rule.preferred_supplier_id and (not sup or sup[0] != rule.preferred_supplier_id):
                        from app.modules.purchasing.models import Supplier
                        rs = self.db.query(Supplier).filter(Supplier.id == rule.preferred_supplier_id).first()
                        if rs:
                            sup = (rs.id, rs.company_name, sup[2] if sup else D("0"), rs.lead_time_days or 0)
                    lead = sup[3] if sup else 0
                    unit_cost = sup[2] if sup and sup[2] > 0 else item_standard_cost(self.db, product)

                if shortages_only and not suggested:
                    continue
                one = linked.get(pid)
                out.append(dict(
                    material_id=pid, material_item_code=product.item_code if product else None,
                    material_name=product.name if product else None, branch_code=branch,
                    product_id=one.id if one else None, product_name=product.name if product else str(pid),
                    product_code=product.item_code if product else "", unit_of_measure=product.unit_of_measure if product else None,
                    is_manufactured=bool(bom), bom_id=bom.id if bom else None, low_level_code=level,
                    quote_demand=qd, production_demand=pd, planned_demand=dd, total_demand=demand,
                    on_hand_quantity=on_hand.get(key, 0), on_order_quantity=on_order.get(key, 0),
                    in_production_quantity=in_prod.get(key, 0),
                    min_quantity=rule.min_quantity if rule else None, max_quantity=rule.max_quantity if rule else None,
                    projected_quantity=projected, suggested_quantity=suggested,
                    suggested_action=action if suggested else None,
                    preferred_supplier_id=sup[0] if sup else None, preferred_supplier_name=sup[1] if sup else None,
                    lead_time_days=lead, unit_cost=_money(unit_cost), suggested_value=_money(D(str(unit_cost)) * suggested),
                    need_by_date=need_by, order_by_date=need_by - timedelta(days=lead),
                    demand_sources=sorted(sources, key=lambda x: (x.get("need_date") or date.max, x["reference"])),
                ))
        out.sort(key=lambda r: (0 if r["suggested_quantity"] else 1, r["order_by_date"] or date.max,
                                r["low_level_code"], r["product_name"], r["branch_code"]))
        return out

    # ---- firming ----
    def _line_items(self, lines, user_id: int) -> None:
        """Lines that sent a product instead of an item get the product's item."""
        from app.modules.purchasing.items import ensure_product_item
        for line in lines:
            if line.material_id:
                continue
            product = self.db.query(Product).filter(Product.id == line.product_id).first()
            if product is None:
                raise _bad(f"Product #{line.product_id} does not exist")
            line.material_id = ensure_product_item(self.db, product, user_id)
            if not line.material_id:
                raise _bad(f"'{product.name}' has no Item Catalog item; link it to an item first")

    def create_purchase_orders(self, data: s.MrpPurchaseIn, user_id: int) -> dict:
        from app.modules.purchasing import schemas as ps
        from app.modules.purchasing.items import NO_SUPPLIER_LINK, supplier_link
        from app.modules.purchasing.service import PurchasingOrderService

        today = tz.today()
        expected = max(data.expected_date or today, today)
        from app.modules.purchasing.models import Supplier

        self._line_items(data.lines, user_id)
        supplier_ids = {line.supplier_id for line in data.lines}
        material_ids = {line.material_id for line in data.lines}
        known_suppliers = {i for (i,) in self.db.query(Supplier.id).filter(Supplier.id.in_(supplier_ids)).all()}
        known_items = {i.id: i for i in self.db.query(Material).filter(Material.id.in_(material_ids)).all()}
        for line in data.lines:
            if line.material_id not in known_items:
                raise _bad(f"Item #{line.material_id} does not exist")
            if line.supplier_id not in known_suppliers:
                raise _bad(f"Supplier #{line.supplier_id} does not exist")
        groups: Dict[int, list] = defaultdict(list)
        for line in data.lines:
            groups[line.supplier_id].append(line)
        orders = []
        for supplier_id, lines in groups.items():
            items = []
            for line in lines:
                item = known_items[line.material_id]
                link = supplier_link(self.db, supplier_id, item.id)
                if link is None:
                    sname = self.db.query(Supplier.company_name).filter(Supplier.id == supplier_id).scalar()
                    raise _bad(f"Supplier '{sname}' has no active price for '{item.name}'. {NO_SUPPLIER_LINK}.")
                price = line.unit_price
                if price is None:
                    price = D(str(link.cost_price)) if link.cost_price else item_standard_cost(self.db, item)
                if not price or price <= 0:
                    raise _bad(f"Enter a unit price for '{item.name}': it has no supplier price or cost")
                items.append(ps.PurchasingOrderItemCreate(material_id=item.id, quantity=line.quantity,
                                                          unit_price=price, warrenty_month="0", remark="Planned by MRP"))
            try:
                orders.append(ps.PurchasingOrderCreate(
                    branch_code=data.branch_code, purchasing_order_date=today,
                    good_received_note_date=expected, required_date=expected,
                    remarks="Raised from material requirements planning (MRP)", first_suppliers_id=supplier_id, items=items))
            except ValidationError as exc:
                raise _bad("; ".join(e["msg"].removeprefix("Value error, ") for e in exc.errors()))
        _batch, created = PurchasingOrderService(self.db).create_order_batch(orders, created_by=user_id)
        return {"documents": [dict(id=o.id, number=o.purchasing_order_no, supplier_id=o.first_suppliers_id,
                                   lines=len(o.items or [])) for o in created]}

    def create_production_orders(self, data: s.MrpProduceIn, user_id: int) -> dict:
        svc = ProductionOrderService(self.db)
        self._line_items(data.lines, user_id)
        created = []
        for line in data.lines:
            order = svc._create(s.ProductionOrderIn(
                material_id=line.material_id, bom_id=line.bom_id, branch_code=data.branch_code,
                planned_quantity=line.quantity, planned_start_date=line.planned_start_date,
                planned_end_date=line.planned_end_date, priority=data.priority,
                remark="Planned by MRP"), user_id)
            created.append(order)
        self.db.commit()
        return {"documents": [dict(id=o.id, number=o.order_no, material_id=o.material_id, quantity=o.planned_quantity)
                              for o in created]}


# ═══════════════════════════ make-to-order from quotations ═══════════════════════════
def quote_demand_lines(db: Session, *, branch_codes: Optional[List[str]] = None, q: Optional[str] = None,
                       manufactured_only: bool = True) -> List[dict]:
    """Open lines of approved quotations, with what is left to produce for each."""
    from app.modules.customers.models import Customer
    from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
    query = (db.query(SalesQuoteItem, SalesQuote).join(SalesQuote, SalesQuote.id == SalesQuoteItem.quote_id)
             .join(Product, Product.id == SalesQuoteItem.product_id)
             .filter(SalesQuote.approval.is_(True), SalesQuote.status.notin_(CLOSED_QUOTE_STATUSES),
                     SalesQuoteItem.item_status.in_(OPEN_QUOTE_ITEM_STATUSES)))
    if branch_codes is not None:
        query = query.filter(SalesQuote.branch_code.in_(branch_codes))
    if q:
        like = f"%{q.strip()}%"
        query = query.filter((SalesQuote.quote_no.ilike(like)) | (Product.name.ilike(like)) | (Product.item_code.ilike(like)))
    rows = query.order_by(SalesQuote.id.desc(), SalesQuoteItem.id).all()
    # A quoted product is made through the item it sells
    manufactured = _active_bom_items(db, [qi.product.material_id for qi, _ in rows if qi.product])
    in_prod = quote_coverage(db, [qi.id for qi, _ in rows])
    customers = dict(db.query(Customer.id, Customer.customer_name).filter(Customer.id.in_({qt.customer_id for _, qt in rows})).all()) if rows else {}
    out = []
    for qi, quote in rows:
        p = qi.product
        item = p.material if p is not None and p.material_id else None
        has_bom = bool(item) and item.id in manufactured
        if manufactured_only and not has_bom:
            continue
        remaining = max(qi.quantity - (qi.converted_qty or 0) - in_prod.get(qi.id, 0), 0)
        out.append(dict(
            quote_item_id=qi.id, quote_id=quote.id, quote_no=quote.quote_no, quote_status=quote.status,
            customer_name=customers.get(quote.customer_id), branch_code=quote.branch_code, product_id=qi.product_id,
            product_name=p.name if p else None, product_code=p.item_code if p else None,
            material_id=item.id if item else None, material_item_code=item.item_code if item else None,
            material_name=item.name if item else None,
            unit_of_measure=(item.unit_of_measure if item else None) or (p.unit_of_measure if p else None),
            quantity=qi.quantity, ordered_quantity=qi.converted_qty or 0,
            in_production_quantity=in_prod.get(qi.id, 0), remaining_quantity=remaining, item_status=qi.item_status,
            expected_delivery_date=quote.expected_delivery_date, valid_until=quote.valid_until,
            has_bom=has_bom,
        ))
    return out
