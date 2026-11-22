"""Activity history for the product documents (Design Brief, Design Detail, BOM
Structure). Entries are logged on entity types product_design_brief /
product_design_detail / product_bom_structure with entity_id = the product id.
A save records the changed header fields and the added / removed / changed
lines (by item; BOM steps by operation number and their materials by step and
item); confirm and reject record the status change (and the reason)."""
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.common.audit import diff_changes, diff_line_items, log_audit

STATUS_LABEL = {"draft": "Draft", "confirmed": "Confirmed", "rejected": "Rejected"}


def _item(code: Optional[str], name: Optional[str]) -> str:
    return " - ".join(p for p in (code, name) if p)


def brief_lines(brief) -> List[dict]:
    return [{"key": line.material_id, "label": _item(line.item_code, line.item_name), "brief": line.brief}
            for line in (brief.lines if brief else [])]


def detail_lines(detail) -> List[dict]:
    return [{"key": line.material_id, "label": _item(line.item_code, line.item_name), "brief": line.brief,
             "quantity": line.quantity, "colour": line.colour, "size": line.size, "design_url": line.design_url}
            for line in (detail.lines if detail else [])]


def bom_lines(structure) -> List[dict]:
    """Steps keyed by operation number, materials by step name and item."""
    rows: List[dict] = []
    for i, step in enumerate(structure.steps if structure else []):
        wc = step.work_center
        rows.append({"key": f"Op {(i + 1) * 10}", "label": f"Op {(i + 1) * 10} - {step.name}", "step": step.name,
                     "work_center": f"{wc.code} - {wc.name}" if wc else None, "setup_minutes": step.setup_minutes,
                     "run_minutes_per_unit": step.minutes_per_unit, "workers": step.workers,
                     "move_minutes": step.move_minutes, "outside_unit_cost": step.outside_unit_cost,
                     "instructions": step.instructions})
        for m in step.materials:
            rows.append({"key": f"{step.name} / {m.item_code}", "label": f"{step.name}: {_item(m.item_code, m.item_name)}",
                         "quantity": m.quantity, "scrap_pct": m.scrap_pct, "notes": m.notes})
    return rows


BRIEF_FIELDS = ("brief",)
DETAIL_FIELDS = ("quantity", "colour", "size", "design_url", "brief")
BOM_STEP_FIELDS = ("step", "work_center", "setup_minutes", "run_minutes_per_unit", "workers", "move_minutes",
                   "outside_unit_cost", "instructions")
BOM_MATERIAL_FIELDS = ("quantity", "scrap_pct", "notes")


def log_save(db: Session, user_id: int, entity_type: str, product_id: int, created: bool,
             header_before: Dict, header_after: Dict, lines_before: List[dict], lines_after: List[dict],
             tracked, items_label: str) -> None:
    """One history entry for a save: header field changes plus line changes."""
    labels = {r["key"]: r["label"] for r in [*lines_before, *lines_after]}
    if entity_type == "product_bom_structure":
        steps = lambda rows: [r for r in rows if "step" in r]  # noqa: E731
        mats = lambda rows: [r for r in rows if "step" not in r]  # noqa: E731
        item_changes = (diff_line_items(steps(lines_before), steps(lines_after), "key", BOM_STEP_FIELDS)
                        + diff_line_items(mats(lines_before), mats(lines_after), "key", BOM_MATERIAL_FIELDS))
    else:
        item_changes = diff_line_items(lines_before, lines_after, "key", tracked)
    for change in item_changes:
        change["product_name"] = labels.get(change["key"], str(change["key"]))
    header = diff_changes(header_before, header_after)
    if not created and not header and not item_changes:
        return
    changes: dict = {"fields": list(header.get("fields", [])), "values": header.get("values", {})}
    if item_changes:
        changes["fields"].append("items")
        changes["item_changes"] = item_changes
        changes["items_label"] = items_label
    log_audit(db, user_id=user_id or 0, action="create" if created else "update", entity_type=entity_type,
              entity_id=product_id, changes=changes)


def log_status(db: Session, user_id: int, entity_type: str, product_id: int, old_status: str, new_status: str,
               reason: Optional[str] = None) -> None:
    values = {"status": {"old": STATUS_LABEL.get(old_status, old_status), "new": STATUS_LABEL.get(new_status, new_status)}}
    if reason:
        values["reason"] = {"old": None, "new": reason}
    log_audit(db, user_id=user_id or 0, action="confirm" if new_status == "confirmed" else "reject",
              entity_type=entity_type, entity_id=product_id, changes={"fields": list(values), "values": values})
