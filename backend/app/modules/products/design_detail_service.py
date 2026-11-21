"""Product Design Detail rules (same lifecycle as the Design Brief).

* Can only be saved once the product's Design Brief is confirmed.
* One detail per product, created on its first save; lines start from the brief's (the client prefills
  them) and items can be added / removed. A line from the brief keeps the confirmed brief's text
  (copied server-side); an item added here takes its own (optional) brief.
* Draft / rejected can be edited (saving a rejected detail moves it back to draft).
* Confirm (draft only, at least one line) locks it for good. Reject (draft only) needs a reason.
* Every write takes the version token from the last read (no version + detail exists = stale).
"""
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from app.common.concurrency import version_token
from app.core import timezone as tz
from app.modules.materials.models import Material
from app.modules.products.design_brief_schemas import DesignBriefConfirm, DesignBriefReject
from app.modules.products.design_brief_service import _bad_request, _conflict, design_brief_service
from app.modules.products.design_detail_models import ProductDesignDetail, ProductDesignDetailLine
from app.modules.products.design_detail_schemas import DesignDetailSave


class DesignDetailService:
    def _detail(self, db: Session, product_id: int) -> Optional[ProductDesignDetail]:
        return (
            db.query(ProductDesignDetail)
            .options(joinedload(ProductDesignDetail.lines))
            .filter(ProductDesignDetail.product_id == product_id)
            .first()
        )

    def _ensure_fresh(self, detail: Optional[ProductDesignDetail], expected_version: Optional[str]) -> None:
        current = version_token(detail.updated_at) if detail else None
        if current != expected_version:
            raise _conflict("The design detail was changed by someone else since you loaded it. Refresh and try again.")

    def _result(self, db: Session, product_id: int) -> Optional[ProductDesignDetail]:
        return design_brief_service._attach_names(db, self._detail(db, product_id))

    def _confirmed_brief(self, db: Session, product_id: int):
        brief = design_brief_service._brief(db, product_id)
        if brief is None or brief.status != "confirmed":
            raise _bad_request("Confirm the Design Brief before you fill in the Design Detail.")
        return brief

    # ── reads ──────────────────────────────────────────────────────────────
    def get(self, db: Session, product_id: int) -> Optional[ProductDesignDetail]:
        design_brief_service._lock_product(db, product_id, lock=False)
        return self._result(db, product_id)

    # ── writes ─────────────────────────────────────────────────────────────
    def save(self, db: Session, product_id: int, data: DesignDetailSave, user_id: int) -> ProductDesignDetail:
        design_brief_service._lock_product(db, product_id, lock=True)
        brief = self._confirmed_brief(db, product_id)
        detail = self._detail(db, product_id)
        self._ensure_fresh(detail, data.expected_version)
        if detail and detail.status == "confirmed":
            raise _conflict("This design detail is confirmed and locked. It can no longer be changed.")

        ids = [line.material_id for line in data.lines]
        if len(ids) != len(set(ids)):
            raise _bad_request("An item can be added to the design detail only once.")
        items = {
            m.id: m
            for m in db.query(Material).options(joinedload(Material.category)).filter(Material.id.in_(ids)).all()
        } if ids else {}
        missing = [i for i in ids if i not in items]
        if missing:
            raise _bad_request(f"Item(s) not found: {', '.join(map(str, missing))}")
        brief_text = {line.material_id: line.brief for line in brief.lines}
        kept = {line.material_id for line in detail.lines} if detail else set()
        # Items from the brief (or already on the detail) may stay even if made inactive since.
        inactive = [
            items[i].item_code for i in ids if not items[i].active and i not in kept and i not in brief_text
        ]
        if inactive:
            raise _bad_request(f"Inactive item(s) cannot be added: {', '.join(inactive)}")

        now = tz.now()
        if detail is None:
            detail = ProductDesignDetail(product_id=product_id, status="draft", created_by=user_id, created_at=now)
            db.add(detail)
        else:
            detail.lines.clear()
            db.flush()
        detail.special_instructions = data.special_instructions or None
        detail.packing_instructions = data.packing_instructions or None
        detail.status = "draft"
        detail.updated_by = user_id
        detail.updated_at = now
        for order, line in enumerate(data.lines):
            item = items[line.material_id]
            detail.lines.append(ProductDesignDetailLine(
                material_id=item.id, item_code=item.item_code, item_name=item.name,
                category_id=item.category_id, category_name=item.category.name if item.category else None,
                brief=brief_text[item.id] if item.id in brief_text else (line.brief or None),
                quantity=line.quantity, colour=line.colour or None, size=line.size or None,
                design_url=line.design_url or None, sort_order=order,
                created_by=user_id, updated_by=user_id, created_at=now, updated_at=now,
            ))
        db.commit()
        return self._result(db, product_id)

    def _pending(self, db: Session, product_id: int, expected_version: Optional[str], action: str):
        design_brief_service._lock_product(db, product_id, lock=True)
        detail = self._detail(db, product_id)
        if detail is None:
            raise _bad_request(f"Save the design detail before you {action} it.")
        self._ensure_fresh(detail, expected_version)
        if detail.status == "confirmed":
            raise _conflict("This design detail is already confirmed and locked.")
        if detail.status != "draft":
            raise _bad_request(f"Only a draft design detail can be {action}ed. Edit and save it first.")
        return detail

    def confirm(self, db: Session, product_id: int, data: DesignBriefConfirm, user_id: int) -> ProductDesignDetail:
        detail = self._pending(db, product_id, data.expected_version, "confirm")
        if not detail.lines:
            raise _bad_request("Add at least one item before you confirm the design detail.")
        now = tz.now()
        detail.status = "confirmed"
        detail.confirmed_by = user_id
        detail.confirmed_at = now
        detail.updated_by = user_id
        detail.updated_at = now
        db.commit()
        return self._result(db, product_id)

    def reject(self, db: Session, product_id: int, data: DesignBriefReject, user_id: int) -> ProductDesignDetail:
        detail = self._pending(db, product_id, data.expected_version, "reject")
        now = tz.now()
        detail.status = "rejected"
        detail.rejected_by = user_id
        detail.rejected_at = now
        detail.reject_reason = data.reason
        detail.updated_by = user_id
        detail.updated_at = now
        db.commit()
        return self._result(db, product_id)


design_detail_service = DesignDetailService()
