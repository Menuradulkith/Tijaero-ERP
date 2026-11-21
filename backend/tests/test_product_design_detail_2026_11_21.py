"""Product Design Detail (2026-11-21): after the Design Brief is confirmed, the spec per line (Quantity (M),
colour, size, design URL) plus special and packing / loading instructions. Same lifecycle as the brief:
draft -> confirmed (locked for good) or rejected (reason; editable, saving returns it to draft)."""
import pytest

from tests.test_product_design_brief_2026_11_20 import B, _line, make_item  # noqa: F401


def _brief_url(p):
    return f"{B}/products/{p.id}/design-brief"


def _url(p):
    return f"{B}/products/{p.id}/design-detail"


def _confirmed_brief(c, p, *items):
    b = c.put(_brief_url(p), json={"expected_version": None, "lines": [_line(i, brief=f"brief {i.id}") for i in items]})
    assert b.status_code == 200, b.text
    r = c.post(f"{_brief_url(p)}/confirm", json={"expected_version": b.json()["version"]})
    assert r.status_code == 200, r.text


def _dline(item, **kw):
    return {"material_id": item.id, "quantity": 5, "colour": "Black", "size": "50x30mm",
            "design_url": "https://example.com/art.pdf", **kw}


def _save(c, p, lines, version=None, **kw):
    return c.put(_url(p), json={"expected_version": version, "lines": lines, **kw})


def test_needs_a_confirmed_brief(superclient, make_product, make_item):
    p, tag = make_product(), make_item()
    assert superclient.get(_url(p)).json() is None
    r = _save(superclient, p, [_dline(tag)])
    assert r.status_code == 400 and "Design Brief" in r.json()["detail"]
    b = superclient.put(_brief_url(p), json={"expected_version": None, "lines": [_line(tag)]})  # draft only
    assert b.status_code == 200
    assert _save(superclient, p, [_dline(tag)]).status_code == 400


def test_full_lifecycle_and_lock(superclient, make_product, make_item):
    p, tag, sticker, bag = make_product(), make_item("TAG"), make_item("STICKER"), make_item("BAG")
    _confirmed_brief(superclient, p, tag, sticker)

    # Brief lines plus an extra item: a brief item keeps the confirmed brief's text (the client's is ignored);
    # the extra item takes its own brief.
    r = _save(superclient, p, [_dline(tag, quantity=2.5, brief="client text"), _dline(bag, colour="Kraft", brief="Kraft bag")],
              special_instructions="Use matte lamination", packing_instructions="100 pcs per bundle")
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "draft" and d["special_instructions"] == "Use matte lamination"
    assert d["packing_instructions"] == "100 pcs per bundle"
    first, extra = d["lines"]
    assert (first["item_code"], first["brief"], first["quantity"], first["size"]) == (
        tag.item_code, f"brief {tag.id}", 2.5, "50x30mm")
    assert extra["brief"] == "Kraft bag" and extra["colour"] == "Kraft"

    r = superclient.post(f"{_url(p)}/reject", json={"expected_version": d["version"], "reason": "Wrong size"})
    assert r.status_code == 200 and r.json()["status"] == "rejected" and r.json()["reject_reason"] == "Wrong size"
    d = _save(superclient, p, [_dline(tag, size="60x40mm")], version=r.json()["version"]).json()
    assert d["status"] == "draft" and d["lines"][0]["size"] == "60x40mm"

    r = superclient.post(f"{_url(p)}/confirm", json={"expected_version": d["version"]})
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["status"] == "confirmed" and d["confirmed_by_name"]
    assert _save(superclient, p, [_dline(tag)], version=d["version"]).status_code == 409
    assert superclient.post(f"{_url(p)}/reject", json={"expected_version": d["version"], "reason": "x"}).status_code == 409


def test_confirm_needs_a_line_and_fresh_version(superclient, make_product, make_item):
    p, tag = make_product(), make_item()
    _confirmed_brief(superclient, p, tag)
    d = _save(superclient, p, []).json()
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": d["version"]}).status_code == 400
    assert _save(superclient, p, [_dline(tag)]).status_code == 409  # stale: detail already exists


@pytest.mark.parametrize("bad", [
    {"quantity": 0}, {"quantity": -1}, {"quantity": None}, {"design_url": "not a link"}, {"colour": "x" * 121},
])
def test_line_validation(superclient, make_product, make_item, bad):
    p, tag = make_product(), make_item()
    _confirmed_brief(superclient, p, tag)
    assert _save(superclient, p, [{**_dline(tag), **bad}]).status_code == 422


def test_colour_size_design_url_and_brief_are_optional(superclient, make_product, make_item):
    p, tag, extra = make_product(), make_item(), make_item()
    _confirmed_brief(superclient, p, tag)
    r = _save(superclient, p, [{"material_id": tag.id, "quantity": 1},
                               {"material_id": extra.id, "quantity": 2, "colour": " ", "size": "", "design_url": ""}])
    assert r.status_code == 200, r.text
    for line in r.json()["lines"]:
        assert (line["colour"], line["size"], line["design_url"]) == (None, None, None)
    assert r.json()["lines"][1]["brief"] is None


def test_duplicate_and_inactive_items(db, superclient, make_product, make_item):
    p, tag, off = make_product(), make_item(), make_item(active=False)
    _confirmed_brief(superclient, p, tag)
    assert _save(superclient, p, [_dline(tag), _dline(tag)]).status_code == 400
    r = _save(superclient, p, [_dline(off)])
    assert r.status_code == 400 and off.item_code in r.json()["detail"]
    tag.active = False  # an item from the brief may stay even after it is made inactive
    db.flush()
    assert _save(superclient, p, [_dline(tag)]).status_code == 200


def test_permissions(api, make_user, make_product, make_item, superclient):
    p, tag = make_product(), make_item()
    _confirmed_brief(superclient, p, tag)
    _, view_token = make_user(permissions=[("products", "view")])
    c = api(view_token)
    assert c.get(_url(p)).status_code == 200
    assert _save(c, p, [_dline(tag)]).status_code == 403
    assert c.post(f"{_url(p)}/confirm", json={}).status_code == 403
