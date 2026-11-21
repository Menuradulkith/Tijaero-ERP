"""Product Design Brief (2026-11-20): Item Catalog items a product needs, grouped by category, each with
its brief. Draft -> confirmed (locked for good) or rejected (reason; editable, saving returns it to draft)."""
import uuid
from datetime import date, datetime

import pytest

from app.modules.materials.models import Material, MaterialCategory

B = "/api/v1/inventory"


def _u(p):
    return f"{p}_{uuid.uuid4().hex[:8]}"


@pytest.fixture
def make_item(db):
    cats = {}

    def _make(category="TAG", active=True):
        if category not in cats:
            cats[category] = MaterialCategory(name=_u(category), category_code=_u("MC"), active=True,
                                              created_date=datetime.utcnow())
            db.add(cats[category])
            db.flush()
        m = Material(name=_u("Item"), item_code=_u("MAT"), item_type="stock_item", website_active=False,
                     active=active, cost_price=10, created_date=date.today(), category_id=cats[category].id,
                     added_date=datetime.utcnow(), unit_of_measure="pcs")
        db.add(m)
        db.flush()
        return m

    return _make


def _url(p):
    return f"{B}/products/{p.id}/design-brief"


def _save(c, p, lines, version=None, notes=None):
    return c.put(_url(p), json={"expected_version": version, "notes": notes, "lines": lines})


def _line(item, brief="Woven tag, 40x20mm, black on white", **kw):
    return {"material_id": item.id, "brief": brief, **kw}


def test_empty_until_first_save(superclient, make_product):
    p = make_product()
    r = superclient.get(_url(p))
    assert r.status_code == 200 and r.json() is None
    assert superclient.get(f"{B}/products/99999999/design-brief").status_code == 404


def test_item_options_lists_active_items_with_category(superclient, make_item):
    tag, off = make_item("TAG"), make_item("TAG", active=False)
    r = superclient.get(f"{B}/design-brief/item-options")
    assert r.status_code == 200, r.text
    by_id = {o["id"]: o for o in r.json()}
    assert tag.id in by_id and off.id not in by_id
    assert by_id[tag.id]["category_name"] == tag.category.name and by_id[tag.id]["item_code"] == tag.item_code


def test_full_lifecycle_save_reject_resave_confirm_lock(superclient, make_product, make_item):
    p = make_product()
    tag, sticker, bag = make_item("TAG"), make_item("STICKER"), make_item("BAG")

    r = _save(superclient, p, [_line(tag, reference_url="https://example.com/a.pdf"),
                               _line(sticker, brief="Barcode sticker")], notes="Spring range")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "draft" and b["notes"] == "Spring range" and b["version"]
    first = b["lines"][0]
    assert (first["item_code"], first["category_name"], first["sort_order"]) == (tag.item_code, tag.category.name, 0)
    assert "quantity" not in first and "reference_url" not in first  # removed fields are ignored / not returned

    r = superclient.post(f"{_url(p)}/reject", json={"expected_version": b["version"], "reason": "Wrong colour"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "rejected" and b["reject_reason"] == "Wrong colour" and b["rejected_by_name"]

    # A rejected brief can't be confirmed as-is; it must be edited (back to draft) first.
    r = superclient.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]})
    assert r.status_code == 400 and "draft" in r.json()["detail"]

    r = _save(superclient, p, [_line(tag), _line(bag, brief="Kraft bag, logo front")], version=b["version"])
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "draft" and [line["material_id"] for line in b["lines"]] == [tag.id, bag.id]
    assert b["reject_reason"] == "Wrong colour"  # last rejection stays visible

    r = superclient.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["status"] == "confirmed" and b["confirmed_at"] and b["confirmed_by_name"]

    # Locked for good: no save, no reject, no second confirm.
    assert _save(superclient, p, [_line(tag)], version=b["version"]).status_code == 409
    assert superclient.post(f"{_url(p)}/reject", json={"expected_version": b["version"], "reason": "x"}).status_code == 409
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]}).status_code == 409


def test_confirmed_brief_keeps_its_item_snapshot(db, superclient, make_product, make_item):
    p, tag = make_product(), make_item("TAG")
    b = _save(superclient, p, [_line(tag)]).json()
    superclient.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]})
    old_name = tag.name
    tag.name = "Renamed in catalog"
    db.flush()
    assert superclient.get(_url(p)).json()["lines"][0]["item_name"] == old_name


def test_confirm_needs_a_line(superclient, make_product):
    p = make_product()
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": None}).status_code == 400
    b = _save(superclient, p, []).json()
    r = superclient.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]})
    assert r.status_code == 400 and "at least one item" in r.json()["detail"]


def test_stale_version_is_refused(superclient, make_product, make_item):
    p, tag = make_product(), make_item()
    b = _save(superclient, p, [_line(tag)]).json()
    # A second "first save" (client thought there was no brief) must not overwrite.
    assert _save(superclient, p, [_line(tag)]).status_code == 409
    newer = _save(superclient, p, [_line(tag, brief="v2")], version=b["version"]).json()
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]}).status_code == 409
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": newer["version"]}).status_code == 200


def test_brief_text_is_optional(superclient, make_product, make_item):
    p, tag, sticker = make_product(), make_item(), make_item()
    r = _save(superclient, p, [{"material_id": tag.id}, {"material_id": sticker.id, "brief": "   "}])
    assert r.status_code == 200, r.text
    assert [line["brief"] for line in r.json()["lines"]] == [None, None]
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": r.json()["version"]}).status_code == 200


def test_line_validation(superclient, make_product, make_item):
    p, tag = make_product(), make_item()
    assert _save(superclient, p, [_line(tag, brief="x" * 2001)]).status_code == 422


def test_duplicate_unknown_and_inactive_items(superclient, make_product, make_item):
    p, tag, off = make_product(), make_item(), make_item(active=False)
    r = _save(superclient, p, [_line(tag), _line(tag)])
    assert r.status_code == 400 and "only once" in r.json()["detail"]
    assert _save(superclient, p, [{"material_id": 99999999, "brief": "x"}]).status_code == 400
    r = _save(superclient, p, [_line(off)])
    assert r.status_code == 400 and off.item_code in r.json()["detail"]


def test_item_made_inactive_later_can_stay_on_the_brief(db, superclient, make_product, make_item):
    p, tag = make_product(), make_item()
    b = _save(superclient, p, [_line(tag)]).json()
    tag.active = False
    db.flush()
    r = _save(superclient, p, [_line(tag, brief="still needed")], version=b["version"])
    assert r.status_code == 200, r.text


def test_reject_needs_reason(superclient, make_product, make_item):
    p, tag = make_product(), make_item()
    b = _save(superclient, p, [_line(tag)]).json()
    assert superclient.post(f"{_url(p)}/reject", json={"expected_version": b["version"], "reason": "  "}).status_code == 422


def test_permissions(api, make_user, make_product, make_item):
    p, tag = make_product(), make_item()
    _, view_token = make_user(permissions=[("products", "view")])
    c = api(view_token)
    assert c.get(_url(p)).status_code == 200
    assert c.get(f"{B}/design-brief/item-options").status_code == 200
    assert _save(c, p, [_line(tag)]).status_code == 403
    assert c.post(f"{_url(p)}/confirm", json={}).status_code == 403
    assert c.post(f"{_url(p)}/reject", json={"reason": "x"}).status_code == 403

    _, edit_token = make_user(permissions=[("products", "view"), ("products", "update")])
    c = api(edit_token)
    b = _save(c, p, [_line(tag)]).json()
    assert c.post(f"{_url(p)}/confirm", json={"expected_version": b["version"]}).status_code == 200

    _, none_token = make_user(permissions=[])
    assert api(none_token).get(_url(p)).status_code == 403
