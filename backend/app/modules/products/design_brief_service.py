"""Product Design Brief rules.

* One brief per product, created on its first save.
* Draft / rejected briefs can be edited; saving a rejected brief moves it back to draft.
* Confirm (draft only, at least one line) locks the brief for good: no edit, no reject, no un-confirm.
* Reject (draft only) needs a reason.
* Every write takes the brief's version token from the last read, so nobody confirms or
  overwrites a brief that changed since they loaded it (no version + brief exists = stale).
"""
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.orm import Session, joinedload

from app.common.concurrency import version_token
from app.core import timezone as tz
from app.modules.materials.models import Material
from app.modules.products.design_brief_models import ProductDesignBrief, ProductDesignBriefLine
from app.modules.products.design_brief_schemas import DesignBriefConfirm, DesignBriefReject, DesignBriefSave
from app.modules.products import doc_history


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


class DesignBriefService:
    def _lock_product(self, db: Session, product_id: int, lock: bool):
        from app.modules.products.models import Product

        query = db.query(Product).filter(Product.id == product_id)
        if lock:
            # Serializes brief writes per product (first save creates the brief).
            query = query.with_for_update(key_share=True)
        product = query.first()
        if not product:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Product with id {product_id} not found")
        return product

    def _brief(self, db: Session, product_id: int) -> Optional[ProductDesignBrief]:
        return (
            db.query(ProductDesignBrief)
            .options(joinedload(ProductDesignBrief.lines))
            .filter(ProductDesignBrief.product_id == product_id)
            .first()
        )

    def _ensure_fresh(self, brief: Optional[ProductDesignBrief], expected_version: Optional[str]) -> None:
        current = version_token(brief.updated_at) if brief else None
        if current != expected_version:
            raise _conflict("The design brief was changed by someone else since you loaded it. Refresh and try again.")

    def _attach_names(self, db: Session, brief: Optional[ProductDesignBrief]) -> Optional[ProductDesignBrief]:
        if brief is None:
            return None
        from app.auth.models import User

        ids = {i for i in (brief.created_by, brief.updated_by, brief.confirmed_by, brief.rejected_by) if i}
        names = {
            u.id: (f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username)
            for u in (db.query(User).filter(User.id.in_(ids)).all() if ids else [])
        }
        brief.created_by_name = names.get(brief.created_by)
        brief.updated_by_name = names.get(brief.updated_by)
        brief.confirmed_by_name = names.get(brief.confirmed_by)
        brief.rejected_by_name = names.get(brief.rejected_by)
        return brief

    # ── reads ──────────────────────────────────────────────────────────────
    def get(self, db: Session, product_id: int) -> Optional[ProductDesignBrief]:
        self._lock_product(db, product_id, lock=False)
        return self._attach_names(db, self._brief(db, product_id))

    def item_options(self, db: Session) -> List[dict]:
        items = (
            db.query(Material)
            .options(joinedload(Material.category))
            .filter(Material.active.is_(True))
            .order_by(Material.item_code)
            .all()
        )
        return [
            {
                "id": m.id, "item_code": m.item_code, "name": m.name, "category_id": m.category_id,
                "category_name": m.category.name if m.category else None, "unit_of_measure": m.unit_of_measure,
                "colour": m.colour, "unit_dimensions": m.unit_dimensions, "design_required": bool(m.design_required),
            }
            for m in items
        ]

    # ── writes ─────────────────────────────────────────────────────────────
    def save(self, db: Session, product_id: int, data: DesignBriefSave, user_id: int) -> ProductDesignBrief:
        self._lock_product(db, product_id, lock=True)
        brief = self._brief(db, product_id)
        self._ensure_fresh(brief, data.expected_version)
        if brief and brief.status == "confirmed":
            raise _conflict("This design brief is confirmed and locked. It can no longer be changed.")

        ids = [line.material_id for line in data.lines]
        if len(ids) != len(set(ids)):
            raise _bad_request("An item can be added to the design brief only once.")
        items = {
            m.id: m
            for m in db.query(Material).options(joinedload(Material.category)).filter(Material.id.in_(ids)).all()
        } if ids else {}
        missing = [i for i in ids if i not in items]
        if missing:
            raise _bad_request(f"Item(s) not found: {', '.join(map(str, missing))}")
        kept = {line.material_id for line in brief.lines} if brief else set()
        inactive = [items[i].item_code for i in ids if not items[i].active and i not in kept]
        if inactive:
            raise _bad_request(f"Inactive item(s) cannot be added: {', '.join(inactive)}")

        now = tz.now()
        created = brief is None
        lines_before = doc_history.brief_lines(brief)
        header_before = {} if created else {"notes": brief.notes, "status": doc_history.STATUS_LABEL.get(brief.status)}
        if brief is None:
            brief = ProductDesignBrief(product_id=product_id, status="draft", created_by=user_id, created_at=now)
            db.add(brief)
        else:
            brief.lines.clear()
            db.flush()
        brief.notes = data.notes or None
        brief.status = "draft"
        brief.updated_by = user_id
        brief.updated_at = now
        for order, line in enumerate(data.lines):
            item = items[line.material_id]
            brief.lines.append(ProductDesignBriefLine(
                material_id=item.id, item_code=item.item_code, item_name=item.name,
                category_id=item.category_id, category_name=item.category.name if item.category else None,
                brief=line.brief or None, sort_order=order,
                created_by=user_id, updated_by=user_id, created_at=now, updated_at=now,
            ))
        doc_history.log_save(db, user_id, "product_design_brief", product_id, created, header_before,
                             {"notes": brief.notes, "status": "Draft"} if not created else {"notes": brief.notes},
                             lines_before, doc_history.brief_lines(brief), doc_history.BRIEF_FIELDS, "Items")
        db.commit()
        return self._attach_names(db, self._brief(db, product_id))

    def _pending_brief(self, db: Session, product_id: int, expected_version: Optional[str], action: str):
        self._lock_product(db, product_id, lock=True)
        brief = self._brief(db, product_id)
        if brief is None:
            raise _bad_request(f"Save the design brief before you {action} it.")
        self._ensure_fresh(brief, expected_version)
        if brief.status == "confirmed":
            raise _conflict("This design brief is already confirmed and locked.")
        if brief.status != "draft":
            raise _bad_request(f"Only a draft design brief can be {action}ed. Edit and save it first.")
        return brief

    def confirm(self, db: Session, product_id: int, data: DesignBriefConfirm, user_id: int) -> ProductDesignBrief:
        brief = self._pending_brief(db, product_id, data.expected_version, "confirm")
        if not brief.lines:
            raise _bad_request("Add at least one item before you confirm the design brief.")
        now = tz.now()
        brief.status = "confirmed"
        brief.confirmed_by = user_id
        brief.confirmed_at = now
        brief.updated_by = user_id
        brief.updated_at = now
        doc_history.log_status(db, user_id, "product_design_brief", product_id, "draft", "confirmed")
        db.commit()
        return self._attach_names(db, self._brief(db, product_id))

    def reject(self, db: Session, product_id: int, data: DesignBriefReject, user_id: int) -> ProductDesignBrief:
        brief = self._pending_brief(db, product_id, data.expected_version, "reject")
        now = tz.now()
        brief.status = "rejected"
        brief.rejected_by = user_id
        brief.rejected_at = now
        brief.reject_reason = data.reason
        brief.updated_by = user_id
        brief.updated_at = now
        doc_history.log_status(db, user_id, "product_design_brief", product_id, "draft", "rejected", data.reason)
        db.commit()
        return self._attach_names(db, self._brief(db, product_id))


design_brief_service = DesignBriefService()
