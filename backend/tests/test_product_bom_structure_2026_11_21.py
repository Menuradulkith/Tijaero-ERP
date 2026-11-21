"""Product BOM Structure (2026-11-21): the steps a product goes through until it is packed, each with the
materials used in it. Draft -> confirmed (locked) or rejected; multi-level through other products' structures."""
import pytest

from tests.test_product_design_brief_2026_11_20 import B, make_item  # noqa: F401


def _url(p):
    return f"{B}/products/{p.id}/bom-structure"


def _step(name, *materials, **kw):
    return {"name": name, "materials": list(materials), **kw}


def _mat(item, quantity=1, **kw):
    return {"material_id": item.id, "quantity": quantity, **kw}


def _detail(db, product, *items, status="confirmed"):
    """Give the product a Design Detail (confirmed by default) holding these items."""
    from app.modules.products.design_detail_models import ProductDesignDetail, ProductDesignDetailLine

    detail = ProductDesignDetail(product_id=product.id, status=status)
    for order, item in enumerate(items):
        detail.lines.append(ProductDesignDetailLine(
            material_id=item.id, item_code=item.item_code, item_name=item.name, quantity=1, sort_order=order,
        ))
    db.add(detail)
    db.flush()


def _save(c, p, steps, version=None, notes=None):
    return c.put(_url(p), json={"expected_version": version, "notes": notes, "steps": steps})


def test_empty_until_first_save(superclient, make_product):
    p = make_product()
    assert superclient.get(_url(p)).json() is None
    assert superclient.get(f"{B}/products/99999999/bom-structure").status_code == 404


def test_full_lifecycle_and_lock(db, superclient, make_product, make_item):
    p = make_product()
    fabric, thread, tag, bag = make_item("FABRIC"), make_item("THREAD"), make_item("TAG"), make_item("BAG")
    _detail(db, p, fabric, thread, tag, bag)
    r = _save(superclient, p, [
        _step("Cutting", _mat(fabric, 1.25, scrap_pct=5), work_area="Cutting room", minutes_per_unit=3.5),
        _step("Sewing", _mat(thread, 0.05), instructions="Double stitch"),
        _step("Inspection"),
        _step("Packing", _mat(tag, 1), _mat(bag, 1, notes="One per piece")),
    ], notes="Standard process")
    assert r.status_code == 200, r.text
    s = r.json()
    assert s["status"] == "draft" and s["notes"] == "Standard process" and s["version"]
    assert [st["name"] for st in s["steps"]] == ["Cutting", "Sewing", "Inspection", "Packing"]
    cut = s["steps"][0]
    assert (cut["work_area"], cut["minutes_per_unit"], cut["sort_order"]) == ("Cutting room", 3.5, 0)
    m = cut["materials"][0]
    assert (m["item_code"], m["category_name"], m["quantity"], m["scrap_pct"]) == (
        fabric.item_code, fabric.category.name, 1.25, 5)
    assert s["steps"][2]["materials"] == [] and s["steps"][3]["materials"][1]["notes"] == "One per piece"

    r = superclient.post(f"{_url(p)}/reject", json={"expected_version": s["version"], "reason": "Add washing"})
    assert r.status_code == 200 and r.json()["status"] == "rejected"
    r = _save(superclient, p, [_step("Cutting", _mat(fabric)), _step("Washing"), _step("Packing", _mat(tag))],
              version=r.json()["version"])
    assert r.status_code == 200 and r.json()["status"] == "draft"
    assert [st["name"] for st in r.json()["steps"]] == ["Cutting", "Washing", "Packing"]

    r = superclient.post(f"{_url(p)}/confirm", json={"expected_version": r.json()["version"]})
    assert r.status_code == 200 and r.json()["status"] == "confirmed" and r.json()["confirmed_by_name"]
    v = r.json()["version"]
    assert _save(superclient, p, [_step("X")], version=v).status_code == 409
    assert superclient.post(f"{_url(p)}/reject", json={"expected_version": v, "reason": "x"}).status_code == 409


def test_confirm_needs_a_step_and_fresh_version(superclient, make_product, make_item):
    p = make_product()
    s = _save(superclient, p, []).json()
    assert superclient.post(f"{_url(p)}/confirm", json={"expected_version": s["version"]}).status_code == 400
    assert _save(superclient, p, [_step("A")]).status_code == 409  # stale: structure already exists


@pytest.mark.parametrize("bad", [
    {"name": ""}, {"name": "   "}, {"name": "x" * 151}, {"minutes_per_unit": -1},
    {"materials": [{"material_id": 1, "quantity": 0}]}, {"materials": [{"material_id": 1, "quantity": -2}]},
    {"materials": [{"material_id": 1, "quantity": 1, "scrap_pct": 100}]},
    {"materials": [{"material_id": 1, "quantity": 1.23456}]},
])
def test_step_validation(superclient, make_product, bad):
    p = make_product()
    assert _save(superclient, p, [{"name": "Step", **bad}]).status_code == 422


def test_duplicate_unknown_inactive_and_own_item(db, superclient, make_product, make_item):
    p, tag, off = make_product(), make_item(), make_item(active=False)
    _detail(db, p, tag)
    r = _save(superclient, p, [_step("Packing", _mat(tag), _mat(tag))])
    assert r.status_code == 400 and "only once" in r.json()["detail"]
    # the same item in two different steps is fine
    assert _save(superclient, p, [_step("A", _mat(tag)), _step("B", _mat(tag))]).status_code == 200
    q = make_product()
    _detail(db, q, tag, off)
    assert _save(superclient, q, [_step("A", {"material_id": 99999999, "quantity": 1})]).status_code == 400
    r = _save(superclient, q, [_step("A", _mat(off))])
    assert r.status_code == 400 and off.item_code in r.json()["detail"]
    q.material_id = tag.id
    db.flush()
    r = _save(superclient, q, [_step("A", _mat(tag))])
    assert r.status_code == 400 and "own stock item" in r.json()["detail"]


def test_multi_level_nesting_and_loop_guard(db, superclient, make_product, make_item):
    """Shirt uses the 'collar' item; the Collar product (stocked as that item) has its own structure."""
    shirt, collar = make_product(), make_product()
    collar_item, shirt_item, fabric = make_item("SEMI"), make_item("FG"), make_item("FABRIC")
    collar.material_id, shirt.material_id = collar_item.id, shirt_item.id
    _detail(db, collar, fabric, shirt_item)
    _detail(db, shirt, collar_item, fabric)
    assert _save(superclient, collar, [_step("Collar cutting", _mat(fabric, 0.2))]).status_code == 200
    r = _save(superclient, shirt, [_step("Assembly", _mat(collar_item, 1), _mat(fabric, 1))])
    assert r.status_code == 200, r.text
    collar_line, fabric_line = r.json()["steps"][0]["materials"]
    sub = collar_line["sub_structure"]
    assert sub["product_id"] == collar.id and sub["product_name"] == collar.name
    assert sub["steps"][0]["name"] == "Collar cutting" and sub["steps"][0]["materials"][0]["material_id"] == fabric.id
    assert fabric_line["sub_structure"] is None

    # The collar can't now use the shirt's item: shirt -> collar -> shirt would be a loop.
    v = superclient.get(_url(collar)).json()["version"]
    r = _save(superclient, collar, [_step("Collar cutting", _mat(fabric, 0.2), _mat(shirt_item))], version=v)
    assert r.status_code == 400 and "loop" in r.json()["detail"]


def test_materials_only_from_confirmed_design_detail(db, superclient, make_product, make_item):
    p, q = make_product(), make_product()
    tag, other = make_item("TAG"), make_item("OTHER")
    r = _save(superclient, p, [_step("Packing", _mat(tag))])
    assert r.status_code == 400 and "Confirm the Design Detail" in r.json()["detail"]
    assert _save(superclient, p, [_step("Inspection")]).status_code == 200  # steps alone need no detail
    _detail(db, q, tag, status="draft")
    assert "Confirm the Design Detail" in _save(superclient, q, [_step("A", _mat(tag))]).json()["detail"]
    from app.modules.products.design_detail_models import ProductDesignDetail

    db.query(ProductDesignDetail).filter(ProductDesignDetail.product_id == q.id).update({"status": "confirmed"})
    db.flush()
    r = _save(superclient, q, [_step("A", _mat(tag), _mat(other))])
    assert r.status_code == 400 and other.item_code in r.json()["detail"] and tag.item_code not in r.json()["detail"]
    assert _save(superclient, q, [_step("A", _mat(tag))]).status_code == 200


def test_permissions(api, make_user, make_product):
    p = make_product()
    _, view_token = make_user(permissions=[("products", "view")])
    c = api(view_token)
    assert c.get(_url(p)).status_code == 200
    assert _save(c, p, [_step("A")]).status_code == 403
    assert c.post(f"{_url(p)}/confirm", json={}).status_code == 403
    _, none_token = make_user(permissions=[])
    assert api(none_token).get(_url(p)).status_code == 403
