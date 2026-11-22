"""History for changes made outside a record's main form (contact persons, payment
methods, item-supplier links, minimum prices, price tiers): the endpoint takes a
column snapshot before and after the service call and writes one entry on the
parent record's Activity History (and on the other side of a link)."""
from types import SimpleNamespace
from typing import Any, Callable, Dict, Iterable, Optional

from sqlalchemy.orm import Session

from app.common.audit import log_related

_SKIP = {"id", "created_at", "updated_at", "created_by", "updated_by"}


def snap(db: Session, model, row_id: Optional[int], skip: Iterable[str] = ()) -> Dict[str, Any]:
    """Current column values of one row (fresh from the DB), without ids/audit columns."""
    if not row_id:
        return {}
    db.expire_all()
    row = db.get(model, row_id)
    if row is None:
        return {}
    leave_out = _SKIP | set(skip)
    return {c.name: getattr(row, c.name) for c in model.__table__.columns if c.name not in leave_out}


def record(db: Session, user, action: str, targets, summary: str,
           before: Optional[Dict[str, Any]] = None, after: Optional[Dict[str, Any]] = None) -> None:
    """Log on each (entity_type, entity_id[, summary]) target and commit. The change itself
    is already committed by the service; a failure here never undoes it."""
    for target in targets:
        entity_type, entity_id = target[0], target[1]
        if not entity_id:
            continue
        log_related(db, user.id if user else 0, action, entity_type, entity_id,
                    target[2] if len(target) > 2 else summary, before, after)
    try:
        db.commit()
    except Exception:  # history is best effort here; never fail the user's request
        db.rollback()

_LABELS = {
    "products": "item_code || ' - ' || name",
    "materials": "item_code || ' - ' || name",
    "supplier": "company_name",
    "customers": "customer_name",
}


def label(db: Session, table: str, row_id: Optional[int]) -> str:
    """Readable name of a linked record for a history summary ("ITM000012 - Shirt")."""
    if not row_id:
        return "-"
    from sqlalchemy import text

    value = db.execute(text(f"select {_LABELS[table]} from {table} where id = :i"), {"i": row_id}).scalar()
    return value or f"#{row_id}"


def logged(db: Session, user, action: str, entity_type: str, entity_id: int, model, run: Callable[[], Any],
           summary: Callable[[SimpleNamespace], str], row_id: Optional[int] = None,
           other: Optional[Callable[[SimpleNamespace], tuple]] = None, skip: Iterable[str] = ()):
    """Run a service call that adds (row_id None) or edits (row_id given) a related row and
    log it on the parent record (and on `other`, the record on the far side of a link)."""
    before = snap(db, model, row_id, skip) if row_id else None
    result = run()
    rid = row_id or getattr(result, "id", None)
    after = snap(db, model, rid, skip)
    row = SimpleNamespace(**after) if after else SimpleNamespace()
    try:
        targets = [(entity_type, entity_id, summary(row))]
        if other:
            targets.append(other(row))
        record(db, user, action, targets, targets[0][2], before, after)
    except Exception:  # never fail the user's request because of history
        db.rollback()
    return result
