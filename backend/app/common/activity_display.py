"""Make activity-history entries readable: linked records are shown by name
("Category: Shirts -> Trousers") instead of by id ("Category Id: 12 -> 14"),
and an image change reads "image added / replaced / removed" instead of a
file path. Applied when the history is read, so it also covers older rows;
a record deleted since shows as "#<id>"."""
from typing import Dict, List, Optional, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

# field -> (display field, table, label SQL). category_id depends on the entity (items have their own categories).
_REFS: Dict[str, Tuple[str, str, str]] = {
    "items_brand_id": ("brand", "items_brand", "brand_name"),
    "product_type_id": ("product_type", "product_types", "name"),
    "hs_code_id": ("hs_code", "hs_codes", "code || coalesce(' - ' || description, '')"),
    "country_id": ("country", "country", "name"),
    "billing_country_id": ("billing_country", "country", "name"),
    "shipping_country_id": ("shipping_country", "country", "name"),
    "material_id": ("item", "materials", "item_code || ' - ' || name"),
    "supplier_id": ("supplier", "supplier", "company_name"),
    "work_center_id": ("work_center", "mfg_work_centers", "code || ' - ' || name"),
}
_IMAGE_FIELDS = {"image_url": "image", "logo_path": "logo"}


def _ref(entity_type: str, field: str) -> Optional[Tuple[str, str, str]]:
    if field == "category_id":
        table = "material_categories" if entity_type == "material" else "category"
        return ("category", table, "name")
    return _REFS.get(field)


def _ids(value) -> List[int]:
    if isinstance(value, bool):
        return []
    if isinstance(value, int):
        return [value]
    if isinstance(value, str) and value.isdigit():
        return [int(value)]
    return []


def readable(db: Session, entity_type: str, changes_list: List[Optional[dict]]) -> List[Optional[dict]]:
    """Return copies of the entries' `changes` with ids replaced by names."""
    wanted: Dict[Tuple[str, str], set] = {}
    for ch in changes_list:
        for field, v in ((ch or {}).get("values") or {}).items():
            ref = _ref(entity_type, field)
            if ref and isinstance(v, dict):
                for side in ("old", "new"):
                    wanted.setdefault((ref[1], ref[2]), set()).update(_ids(v.get(side)))
    names: Dict[Tuple[str, str], Dict[int, str]] = {}
    for (table, label), ids in wanted.items():
        if not ids:
            continue
        rows = db.execute(text(f"select id, {label} from {table} where id = any(:ids)"), {"ids": list(ids)}).fetchall()
        names[(table, label)] = {r[0]: r[1] for r in rows}

    out = []
    for ch in changes_list:
        if not ch or not isinstance(ch.get("values"), dict):
            out.append(ch)
            continue
        values, fields = {}, []
        for field in ch.get("fields") or list(ch["values"].keys()):
            v = ch["values"].get(field)
            ref = _ref(entity_type, field)
            if ref and isinstance(v, dict):
                lookup = names.get((ref[1], ref[2]), {})

                def name(x):
                    ids = _ids(x)
                    return (lookup.get(ids[0]) or f"#{ids[0]}") if ids else x

                field, v = ref[0], {"old": name(v.get("old")), "new": name(v.get("new"))}
            elif field in _IMAGE_FIELDS and isinstance(v, dict):
                old, new = v.get("old"), v.get("new")
                field = _IMAGE_FIELDS[field]
                v = {"old": "Previous image" if old else None,
                     "new": ("New image" if old else "Image added") if new else ("Image removed" if old else None)}
            fields.append(field)
            values[field] = v
        out.append({**ch, "fields": fields if ch.get("fields") is not None else ch.get("fields"), "values": values})
    return out
