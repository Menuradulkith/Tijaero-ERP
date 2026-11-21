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

# How deep nested sub-structures are returned (the save-time loop check keeps the tree finite anyway).
MAX_DEPTH = 5


def _num(v) -> Optional[float]:
    return None if v is None else float(v)


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
    def get(self, db: Session, product_id: int) -> Optional[dict]:
        product = design_brief_service._lock_product(db, product_id, lock=False)
        return self._result(db, product)

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

        now = tz.now()
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
            row = ProductBomStep(
                sort_order=step_order, name=step.name, work_area=step.work_area or None,
                minutes_per_unit=step.minutes_per_unit, instructions=step.instructions or None, **audit,
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
        db.commit()
        return self._result(db, product)


bom_structure_service = BomStructureService()
