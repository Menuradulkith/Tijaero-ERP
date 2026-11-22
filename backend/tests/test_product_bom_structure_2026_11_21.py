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


def test_list_page_search_filter_counts_and_sort(db, superclient, make_product, make_item):
    a, b, c = make_product(), make_product(), make_product()
    fabric, tag = make_item("FABRIC"), make_item("TAG")
    for p in (a, b, c):
        _detail(db, p, fabric, tag)
    _save(superclient, a, [_step("Cutting", _mat(fabric), minutes_per_unit=2), _step("Packing", _mat(tag))])
    sb = _save(superclient, b, [_step("Sewing", _mat(fabric), _mat(tag), minutes_per_unit=1.5)]).json()
    superclient.post(f"{_url(b)}/confirm", json={"expected_version": sb["version"]})
    _save(superclient, c, [])
    ids = {a.id, b.id, c.id}
    L = f"{B}/bom-structures/paged"

    def rows(**params):
        r = superclient.get(L, params={"size": 200, **params})
        assert r.status_code == 200, r.text
        return r.json()

    page = rows()
    mine = {r["product_id"]: r for r in page["items"] if r["product_id"] in ids}
    assert set(mine) == ids
    ra = mine[a.id]
    assert (ra["product_code"], ra["product_name"], ra["status"]) == (a.item_code, a.name, "draft")
    assert (ra["step_count"], ra["material_count"], ra["total_minutes"]) == (2, 2, 2.0)
    assert (mine[c.id]["step_count"], mine[c.id]["material_count"], mine[c.id]["total_minutes"]) == (0, 0, None)
    assert mine[b.id]["status"] == "confirmed" and mine[b.id]["confirmed_by_name"]
    assert ra["created_by_name"] and ra["updated_at"]
    assert page["counts"]["all"] == page["total"] >= 3

    # search by code; counts follow the search, the status filter narrows only the rows
    found = rows(q=b.item_code)
    assert [r["product_id"] for r in found["items"]] == [b.id] and found["counts"]["confirmed"] == 1
    assert rows(q=b.item_code, status="draft")["total"] == 0
    assert rows(q=b.item_code, status="draft")["counts"]["confirmed"] == 1
    assert all(r["status"] == "confirmed" for r in rows(status="confirmed")["items"])
    assert rows(q="%_nothing_%")["total"] == 0  # wildcards are literal

    # newest change first by default; explicit sort and paging
    assert rows()["items"][0]["product_id"] == c.id
    by_steps = [r["step_count"] for r in rows(sort_by="step_count", order="asc")["items"]]
    assert by_steps == sorted(by_steps)
    one = superclient.get(L, params={"size": 1, "page": 1}).json()
    assert len(one["items"]) == 1 and one["pages"] == one["total"]
    assert superclient.get(L, params={"status": "bogus"}).status_code == 422
    assert superclient.get(L, params={"size": 500}).status_code == 422


def _wc(db, code, **kw):
    from app.modules.manufacturing.models import MfgWorkCenter

    wc = MfgWorkCenter(code=code, name=f"QA {code}", capacity=kw.pop("capacity", 1), **kw)
    db.add(wc)
    db.flush()
    return wc


def test_routing_fields_work_centers_and_rules(db, superclient, make_product):
    import uuid

    tag = uuid.uuid4().hex[:6].upper()
    cut = _wc(db, f"QC{tag}", labor_rate_per_hour=600, overhead_rate_per_hour=300, efficiency_pct=80,
              working_hours_per_day=8, capacity=2)
    wash = _wc(db, f"QW{tag}", is_outside=True)
    old = _wc(db, f"QO{tag}", active=False)
    p = make_product()

    # the option list holds active centers only, with their rates
    opts = {w["id"]: w for w in superclient.get(f"{B}/bom-structures/work-centers").json()}
    assert cut.id in opts and wash.id in opts and old.id not in opts
    assert (opts[cut.id]["labor_rate_per_hour"], opts[cut.id]["efficiency_pct"], opts[cut.id]["capacity"]) == (
        600.0, 80.0, 2)

    r = _save(superclient, p, [
        _step("Cutting", work_center_id=cut.id, setup_minutes=15, minutes_per_unit=2.5, workers=2, move_minutes=30,
              outside_unit_cost=99),
        _step("Washing", work_center_id=wash.id, outside_unit_cost=12.5),
        _step("Packing"),
    ])
    assert r.status_code == 200, r.text
    c, w, k = r.json()["steps"]
    assert (c["work_center_id"], c["setup_minutes"], c["minutes_per_unit"], c["workers"], c["move_minutes"]) == (
        cut.id, 15.0, 2.5, 2, 30.0)
    assert c["outside_unit_cost"] is None  # only kept for an outside work center
    assert c["work_center"]["code"] == cut.code and c["work_center"]["overhead_rate_per_hour"] == 300.0
    assert w["work_center"]["is_outside"] and w["outside_unit_cost"] == 12.5
    assert k["work_center"] is None and k["workers"] is None

    v = r.json()["version"]
    bad = _save(superclient, p, [_step("X", work_center_id=99999999)], version=v)
    assert bad.status_code == 400 and "not found" in bad.json()["detail"]
    bad = _save(superclient, p, [_step("X", work_center_id=old.id)], version=v)
    assert bad.status_code == 400 and old.code in bad.json()["detail"]
    # a center that went inactive after it was chosen can stay
    cut.active = False
    db.flush()
    assert _save(superclient, p, [_step("Cutting", work_center_id=cut.id)], version=v).status_code == 200


@pytest.mark.parametrize("bad", [
    {"setup_minutes": -1}, {"move_minutes": -0.5}, {"workers": 0}, {"workers": 1001}, {"outside_unit_cost": -1},
    {"setup_minutes": 1.234}, {"work_center_id": 0},
])
def test_routing_validation(superclient, make_product, bad):
    assert _save(superclient, make_product(), [{"name": "Step", **bad}]).status_code == 422


def test_permissions(api, make_user, make_product):
    p = make_product()
    _, view_token = make_user(permissions=[("products", "view")])
    c = api(view_token)
    assert c.get(_url(p)).status_code == 200
    assert _save(c, p, [_step("A")]).status_code == 403
    assert c.post(f"{_url(p)}/confirm", json={}).status_code == 403
    assert c.get(f"{B}/bom-structures/paged").status_code == 200
    assert c.get(f"{B}/bom-structures/work-centers").status_code == 200
    _, none_token = make_user(permissions=[])
    assert api(none_token).get(_url(p)).status_code == 403
    assert api(none_token).get(f"{B}/bom-structures/paged").status_code == 403
    assert api(none_token).get(f"{B}/bom-structures/work-centers").status_code == 403
