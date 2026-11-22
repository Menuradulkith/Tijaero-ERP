"""Product BOM Structure rules (same lifecycle as the Design Brief / Detail).

* One structure per product, created on its first save; the steps are kept in the order sent.
* Draft / rejected can be edited (saving a rejected structure moves it back to draft).
* Confirm (draft only, at least one step) locks it for good. Reject (draft only) needs a reason.
* Materials can only be items of the product's confirmed Design Detail.
* Every write takes the version token from the last read (no version + structure exists = stale).
* Multi-level: a material that is another product's stock item, when that product has its own
  structure, is returned with that structure nested (read-only). A save that would make a product
  contain itself (directly or through such nested structures) is refused, so the tree has no loops.
"""
from typing import Dict, List, Optional, Set

from sqlalchemy.orm import Session, joinedload, selectinload

from app.common.concurrency import version_token
from app.core import timezone as tz
from app.modules.materials.models import Material
from app.modules.products.bom_structure_models import ProductBomMaterial, ProductBomStep, ProductBomStructure
from app.modules.products.bom_structure_schemas import BomStructureSave
from app.modules.products.design_brief_schemas import DesignBriefConfirm, DesignBriefReject
from app.modules.products.design_brief_service import _bad_request, _conflict, design_brief_service
from app.modules.products import doc_history

# How deep nested sub-structures are returned (the save-time loop check keeps the tree finite anyway).
MAX_DEPTH = 5


def _num(v) -> Optional[float]:
    return None if v is None else float(v)


def _work_center(wc) -> Optional[dict]:
    if wc is None:
        return None
    return {
        "id": wc.id, "code": wc.code, "name": wc.name, "active": bool(wc.active), "is_outside": bool(wc.is_outside),
        "capacity": int(wc.capacity or 1), "efficiency_pct": float(wc.efficiency_pct or 100),
        "working_hours_per_day": float(wc.working_hours_per_day or 8),
        "labor_rate_per_hour": float(wc.labor_rate_per_hour or 0),
        "overhead_rate_per_hour": float(wc.overhead_rate_per_hour or 0),
    }


class BomStructureService:
    def _structure(self, db: Session, product_id: int) -> Optional[ProductBomStructure]:
        return (
            db.query(ProductBomStructure)
            .options(selectinload(ProductBomStructure.steps).selectinload(ProductBomStep.materials))
            .filter(ProductBomStructure.product_id == product_id)
            .first()
        )

    def _ensure_fresh(self, structure: Optional[ProductBomStructure], expected_version: Optional[str]) -> None:
        current = version_token(structure.updated_at) if structure else None
        if current != expected_version:
            raise _conflict(
                "The BOM structure was changed by someone else since you loaded it. Refresh and try again."
            )

    def _design_detail_items(self, db: Session, product_id: int) -> Optional[Set[int]]:
        """Item ids of the product's confirmed Design Detail (None when it is not confirmed)."""
        from app.modules.products.design_detail_models import ProductDesignDetail, ProductDesignDetailLine

        detail = db.query(ProductDesignDetail).filter(ProductDesignDetail.product_id == product_id).first()
        if detail is None or detail.status != "confirmed":
            return None
        rows = db.query(ProductDesignDetailLine.material_id).filter(ProductDesignDetailLine.detail_id == detail.id)
        return {r[0] for r in rows}

    def _check_work_centers(self, db: Session, data: BomStructureSave, structure) -> Dict[int, object]:
        """The steps' work centers: they must exist; an inactive one may only stay where it already was."""
        from app.modules.manufacturing.models import MfgWorkCenter

        ids = {s.work_center_id for s in data.steps if s.work_center_id}
        if not ids:
            return {}
        found = {w.id: w for w in db.query(MfgWorkCenter).filter(MfgWorkCenter.id.in_(ids)).all()}
        missing = sorted(i for i in ids if i not in found)
        if missing:
            raise _bad_request(f"Work center(s) not found: {', '.join(map(str, missing))}")
        kept = {s.work_center_id for s in structure.steps} if structure else set()
        inactive = sorted(found[i].code for i in ids if not found[i].active and i not in kept)
        if inactive:
            raise _bad_request(f"Inactive work center(s) cannot be used: {', '.join(inactive)}")
        return found

    # ── multi-level ────────────────────────────────────────────────────────
    def _structure_for_item(self, db: Session, material_id: int, exclude_product_id: int):
        """The structure of a product that is stocked as this item (confirmed first, then oldest product)."""
        from app.modules.products.models import Product

        rows = (
            db.query(Product, ProductBomStructure)
            .join(ProductBomStructure, ProductBomStructure.product_id == Product.id)
            .filter(Product.material_id == material_id, Product.id != exclude_product_id)
            .all()
        )
        if not rows:
            return None
        rows.sort(key=lambda r: (r[1].status != "confirmed", r[0].id))
        return rows[0]

    def _would_loop(self, db: Session, product_id: int, own_item: Optional[int], material_ids: List[int]) -> bool:
        if own_item is None:
            return False  # nothing can contain a product that has no stock item
        seen: Set[int] = set()
        stack = list(material_ids)
        while stack:
            item = stack.pop()
            if item == own_item:
                return True
            if item in seen:
                continue
            seen.add(item)
            found = self._structure_for_item(db, item, exclude_product_id=product_id)
            if found:
                structure = self._structure(db, found[0].id)
                stack.extend(m.material_id for step in structure.steps for m in step.materials)
        return False

    def _serialize_steps(self, db: Session, steps, product_id: int, depth: int, path: Set[int]) -> List[dict]:
        out = []
        for step in steps:
            materials = []
            for m in step.materials:
                sub = None
                if depth < MAX_DEPTH and m.material_id not in path:
                    found = self._structure_for_item(db, m.material_id, exclude_product_id=product_id)
                    if found:
                        product, _ = found
                        nested = self._structure(db, product.id)
                        sub = {
                            "product_id": product.id, "product_code": product.item_code, "product_name": product.name,
                            "status": nested.status,
                            "steps": self._serialize_steps(db, nested.steps, product.id, depth + 1, path | {m.material_id}),
                        }
                materials.append({
                    "id": m.id, "material_id": m.material_id, "item_code": m.item_code, "item_name": m.item_name,
                    "category_id": m.category_id, "category_name": m.category_name,
                    "unit_of_measure": m.unit_of_measure, "quantity": float(m.quantity),
                    "scrap_pct": float(m.scrap_pct or 0), "notes": m.notes, "sort_order": m.sort_order,
                    "sub_structure": sub,
                })
            out.append({
                "id": step.id, "sort_order": step.sort_order, "name": step.name, "work_area": step.work_area,
                "minutes_per_unit": _num(step.minutes_per_unit), "instructions": step.instructions,
                "work_center_id": step.work_center_id, "work_center": _work_center(step.work_center),
                "setup_minutes": _num(step.setup_minutes), "move_minutes": _num(step.move_minutes),
                "workers": step.workers, "outside_unit_cost": _num(step.outside_unit_cost),
                "materials": materials,
            })
        return out

    def _result(self, db: Session, product) -> Optional[dict]:
        structure = self._structure(db, product.id)
        if structure is None:
            return None
        design_brief_service._attach_names(db, structure)
        path = {product.material_id} if product.material_id else set()
        return {
            "id": structure.id, "product_id": structure.product_id, "status": structure.status,
            "notes": structure.notes,
            "steps": self._serialize_steps(db, structure.steps, product.id, 1, path),
            "confirmed_by_name": structure.confirmed_by_name, "confirmed_at": structure.confirmed_at,
            "rejected_by_name": structure.rejected_by_name, "rejected_at": structure.rejected_at,
            "reject_reason": structure.reject_reason,
            "created_by_name": structure.created_by_name, "updated_by_name": structure.updated_by_name,
            "created_at": structure.created_at, "updated_at": structure.updated_at,
        }

    # ── reads ──────────────────────────────────────────────────────────────
    def work_centers(self, db: Session) -> List[dict]:
        """Active Manufacturing work centers a routing step can use."""
        from app.modules.manufacturing.models import MfgWorkCenter

        rows = db.query(MfgWorkCenter).filter(MfgWorkCenter.active.is_(True)).order_by(MfgWorkCenter.code).all()
        return [_work_center(w) for w in rows]

    def get(self, db: Session, product_id: int) -> Optional[dict]:
        product = design_brief_service._lock_product(db, product_id, lock=False)
        return self._result(db, product)

    def page(self, db: Session, *, page: int, size: int, q: Optional[str] = None, status: Optional[str] = None,
             sort_by: Optional[str] = None, order: str = "desc") -> dict:
        """Server-side paged list of every product's BOM Structure (newest change first by default)."""
        from sqlalchemy import func, or_

        from app.auth.models import User
        from app.modules.products.models import Category, Product
        from app.modules.products.repository import _like_pattern, _order

        steps = (
            db.query(
                ProductBomStep.structure_id.label("sid"),
                func.count(ProductBomStep.id).label("steps"),
                func.sum(ProductBomStep.minutes_per_unit).label("minutes"),
            )
            .group_by(ProductBomStep.structure_id)
            .subquery()
        )
        mats = (
            db.query(ProductBomStep.structure_id.label("sid"), func.count(ProductBomMaterial.id).label("mats"))
            .join(ProductBomMaterial, ProductBomMaterial.step_id == ProductBomStep.id)
            .group_by(ProductBomStep.structure_id)
            .subquery()
        )
        step_count = func.coalesce(steps.c.steps, 0)
        mat_count = func.coalesce(mats.c.mats, 0)

        base = db.query(ProductBomStructure).join(Product, Product.id == ProductBomStructure.product_id)
        pat = _like_pattern(q)
        if pat:
            base = base.filter(or_(Product.item_code.ilike(pat, escape="\\"), Product.name.ilike(pat, escape="\\")))

        counts = dict(base.with_entities(ProductBomStructure.status, func.count(ProductBomStructure.id))
                      .group_by(ProductBomStructure.status).all())
        if status:
            base = base.filter(ProductBomStructure.status == status)
        total = base.with_entities(func.count(ProductBomStructure.id)).scalar() or 0

        sorts = {
            "product_code": (Product.item_code, True), "product_name": (Product.name, True),
            "category_name": (Category.name, True), "status": (ProductBomStructure.status, False),
            "step_count": (step_count, False), "material_count": (mat_count, False),
            "total_minutes": (steps.c.minutes, False), "created_at": (ProductBomStructure.created_at, False),
            "updated_at": (ProductBomStructure.updated_at, False),
            "confirmed_at": (ProductBomStructure.confirmed_at, False),
        }
        col, is_text = sorts.get(sort_by or "", sorts["updated_at"])
        direction = order if sort_by in sorts else "desc"
        rows = (
            base.outerjoin(Category, Category.id == Product.category_id)
            .outerjoin(steps, steps.c.sid == ProductBomStructure.id)
            .outerjoin(mats, mats.c.sid == ProductBomStructure.id)
            .with_entities(ProductBomStructure, Product, Category.name, step_count, mat_count, steps.c.minutes)
            .order_by(_order(col, direction, is_text).nulls_last(), ProductBomStructure.id.desc())
            .offset(page * size)
            .limit(size)
            .all()
        )

        user_ids = {u for s, *_ in rows for u in (s.created_by, s.updated_by, s.confirmed_by) if u}
        names = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in (db.query(User).filter(User.id.in_(user_ids)).all() if user_ids else [])
        }
        items = [
            {
                "id": s.id, "product_id": p.id, "product_code": p.item_code, "product_name": p.name,
                "product_active": bool(p.active), "category_name": cat, "status": s.status,
                "step_count": int(n_steps), "material_count": int(n_mats), "total_minutes": _num(minutes),
                "created_by_name": names.get(s.created_by), "created_at": s.created_at,
                "updated_by_name": names.get(s.updated_by), "updated_at": s.updated_at,
                "confirmed_by_name": names.get(s.confirmed_by), "confirmed_at": s.confirmed_at,
            }
            for s, p, cat, n_steps, n_mats, minutes in rows
        ]
        return {
            "items": items, "total": total, "page": page, "size": size, "pages": -(-total // size),
            "counts": {"all": sum(counts.values()), **counts},
        }

    # ── writes ─────────────────────────────────────────────────────────────
    def save(self, db: Session, product_id: int, data: BomStructureSave, user_id: int) -> dict:
        product = design_brief_service._lock_product(db, product_id, lock=True)
        structure = self._structure(db, product_id)
        self._ensure_fresh(structure, data.expected_version)
        if structure and structure.status == "confirmed":
            raise _conflict("This BOM structure is confirmed and locked. It can no longer be changed.")

        for index, step in enumerate(data.steps, start=1):
            ids = [m.material_id for m in step.materials]
            if len(ids) != len(set(ids)):
                raise _bad_request(f"Step {index} ({step.name}): an item can be added to a step only once.")
        all_ids = {m.material_id for step in data.steps for m in step.materials}
        items: Dict[int, Material] = {
            m.id: m
            for m in db.query(Material).options(joinedload(Material.category)).filter(Material.id.in_(all_ids)).all()
        } if all_ids else {}
        missing = sorted(i for i in all_ids if i not in items)
        if missing:
            raise _bad_request(f"Item(s) not found: {', '.join(map(str, missing))}")
        if all_ids:
            allowed = self._design_detail_items(db, product_id)
            if allowed is None:
                raise _bad_request("Confirm the Design Detail first. BOM materials come from its items.")
            outside = sorted(items[i].item_code for i in all_ids if i not in allowed)
            if outside:
                raise _bad_request(
                    f"Only items in the confirmed Design Detail can be used as materials: {', '.join(outside)}"
                )
        kept = {m.material_id for step in structure.steps for m in step.materials} if structure else set()
        inactive = sorted(items[i].item_code for i in all_ids if not items[i].active and i not in kept)
        if inactive:
            raise _bad_request(f"Inactive item(s) cannot be added: {', '.join(inactive)}")
        if product.material_id is not None and product.material_id in all_ids:
            raise _bad_request("A product cannot use its own stock item as a material.")
        if self._would_loop(db, product_id, product.material_id, list(all_ids)):
            raise _bad_request(
                "This would create a loop: one of the materials is made from this product "
                "(through another product's BOM structure)."
            )
        work_centers = self._check_work_centers(db, data, structure)

        now = tz.now()
        created = structure is None
        lines_before = doc_history.bom_lines(structure)
        header_before = {} if created else {"notes": structure.notes, "status": doc_history.STATUS_LABEL.get(structure.status)}
        if structure is None:
            structure = ProductBomStructure(product_id=product_id, status="draft", created_by=user_id, created_at=now)
            db.add(structure)
        else:
            structure.steps.clear()
            db.flush()
        structure.notes = data.notes or None
        structure.status = "draft"
        structure.updated_by = user_id
        structure.updated_at = now
        audit = dict(created_by=user_id, updated_by=user_id, created_at=now, updated_at=now)
        for step_order, step in enumerate(data.steps):
            wc = work_centers.get(step.work_center_id) if step.work_center_id else None
            row = ProductBomStep(
                sort_order=step_order, name=step.name, work_area=step.work_area or None,
                minutes_per_unit=step.minutes_per_unit, instructions=step.instructions or None,
                work_center_id=wc.id if wc else None, work_center=wc, setup_minutes=step.setup_minutes,
                move_minutes=step.move_minutes, workers=step.workers,
                # A cost per unit only means something for an outside work center.
                outside_unit_cost=step.outside_unit_cost if wc is not None and wc.is_outside else None,
                **audit,
            )
            for order, line in enumerate(step.materials):
                item = items[line.material_id]
                row.materials.append(ProductBomMaterial(
                    material_id=item.id, item_code=item.item_code, item_name=item.name,
                    category_id=item.category_id, category_name=item.category.name if item.category else None,
                    unit_of_measure=item.unit_of_measure, quantity=line.quantity, scrap_pct=line.scrap_pct,
                    notes=line.notes or None, sort_order=order, **audit,
                ))
            structure.steps.append(row)
        header_after = {"notes": structure.notes}
        if not created:
            header_after["status"] = "Draft"
        doc_history.log_save(db, user_id, "product_bom_structure", product_id, created, header_before, header_after,
                             lines_before, doc_history.bom_lines(structure), (), "Steps & materials")
        db.commit()
        db.expire_all()
        return self._result(db, product)

    def _pending(self, db: Session, product_id: int, expected_version: Optional[str], action: str):
        product = design_brief_service._lock_product(db, product_id, lock=True)
        structure = self._structure(db, product_id)
        if structure is None:
            raise _bad_request(f"Save the BOM structure before you {action} it.")
        self._ensure_fresh(structure, expected_version)
        if structure.status == "confirmed":
            raise _conflict("This BOM structure is already confirmed and locked.")
        if structure.status != "draft":
            raise _bad_request(f"Only a draft BOM structure can be {action}ed. Edit and save it first.")
        return product, structure

    def confirm(self, db: Session, product_id: int, data: DesignBriefConfirm, user_id: int) -> dict:
        product, structure = self._pending(db, product_id, data.expected_version, "confirm")
        if not structure.steps:
            raise _bad_request("Add at least one step before you confirm the BOM structure.")
        now = tz.now()
        structure.status = "confirmed"
        structure.confirmed_by = user_id
        structure.confirmed_at = now
        structure.updated_by = user_id
        structure.updated_at = now
        doc_history.log_status(db, user_id, "product_bom_structure", product_id, "draft", "confirmed")
        db.commit()
        return self._result(db, product)

    def reject(self, db: Session, product_id: int, data: DesignBriefReject, user_id: int) -> dict:
        product, structure = self._pending(db, product_id, data.expected_version, "reject")
        now = tz.now()
        structure.status = "rejected"
        structure.rejected_by = user_id
        structure.rejected_at = now
        structure.reject_reason = data.reason
        structure.updated_by = user_id
        structure.updated_at = now
        doc_history.log_status(db, user_id, "product_bom_structure", product_id, "draft", "rejected", data.reason)
        db.commit()
        return self._result(db, product)


bom_structure_service = BomStructureService()
