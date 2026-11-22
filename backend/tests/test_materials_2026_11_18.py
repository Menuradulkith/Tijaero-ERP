"""Material master (/materials): own categories, CRUD, paging/search, minimum prices,
supplier links, image validation, permissions and activity history."""
import uuid

import pytest

from tests.conftest import product_master_ids

M = "/api/v1/materials"
INV = "/api/v1/inventory"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32


def _u() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def cat(superclient):
    """A MATERIAL category (materials don't use the product catalog's categories)."""
    r = superclient.post(f"{M}/categories/", json={"name": f"QA MatCat {_u()}"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def product_cat(superclient):
    r = superclient.post(f"{INV}/categories/", json={"name": f"QA ProdCat {_u()}"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def brand(superclient):
    r = superclient.post(f"{INV}/brands/", json={"brand_name": f"QA MatBrand {_u()}"})
    assert r.status_code == 201, r.text
    return r.json()


def _body(cat, brand, **kw):
    return {
        "name": f"QA Material {_u()}", "item_type": "stock_item", "tracking_type": "batch", "unit_of_measure": "kg",
        "cost_price": 100, "selling_price": 150, "category_id": cat["id"], "items_brand_id": brand["id"],
        "inventory_valuation_method": "fifo", "stock_issuing_method": "fefo", "product_family": "QA Family", **kw,
    }


@pytest.fixture
def material(superclient, cat, brand):
    r = superclient.post(f"{M}/items/", json=_body(cat, brand))
    assert r.status_code == 201, r.text
    return r.json()


class TestCrud:
    def test_create_returns_product_shaped_row(self, superclient, cat, brand):
        r = superclient.post(f"{M}/items/", json=_body(cat, brand, minimum_selling_price=120, model="M-1"))
        assert r.status_code == 201, r.text
        m = r.json()
        assert m["item_code"].startswith("MAT")
        assert m["tracking_type"] == "batch" and m["unit_of_measure"] == "kg"
        assert m["minimum_selling_price"] == 120
        for key in ("version", "price_tiers", "category_name", "brand_name", "preferred_supplier_name",
                    "created_by_name", "added_date", "created_date", "image_url"):
            assert key in m

    def test_get_and_update(self, superclient, material):
        got = superclient.get(f"{M}/items/{material['id']}")
        assert got.status_code == 200 and got.json()["name"] == material["name"]
        r = superclient.put(f"{M}/items/{material['id']}",
                            json={"description": "updated", "expected_version": material["version"]})
        assert r.status_code == 200, r.text
        assert r.json()["description"] == "updated"
        # the old version token is now stale
        stale = superclient.put(f"{M}/items/{material['id']}",
                                json={"description": "again", "expected_version": material["version"]})
        assert stale.status_code == 409

    def test_not_found_and_bounded_ids(self, superclient):
        assert superclient.get(f"{M}/items/{2 ** 31 - 1}").status_code == 404
        assert superclient.get(f"{M}/items/0").status_code == 422

    def test_duplicate_name_is_refused(self, superclient, cat, brand, material):
        dup = superclient.post(f"{M}/items/", json=_body(cat, brand, name=f"  {material['name'].upper()} "))
        assert dup.status_code == 409
        other = superclient.post(f"{M}/items/", json=_body(cat, brand)).json()
        assert superclient.put(f"{M}/items/{other['id']}", json={"name": material["name"]}).status_code == 409

    def test_item_codes_are_unique_and_not_client_set(self, superclient, cat, brand, material):
        r = superclient.post(f"{M}/items/", json=_body(cat, brand, item_code=material["item_code"]))
        assert r.status_code == 201
        assert r.json()["item_code"] != material["item_code"]

    def test_name_can_match_a_product(self, superclient, cat, product_cat, brand):
        # separate catalogs: a material may share a product's name (and brand). A non-stock product, since a
        # stocked one now creates its own item of that name (central stock phase 2).
        name = f"QA Shared {_u()}"
        p = superclient.post(f"{INV}/products/", json=_body(product_cat, brand, name=name, tracking_type="serial", item_type="service",
                                                                  **product_master_ids(superclient)))
        assert p.status_code == 201, p.text
        assert superclient.post(f"{M}/items/", json=_body(cat, brand, name=name)).status_code == 201

    @pytest.mark.parametrize("field,value", [
        ("name", "   "), ("cost_price", -1), ("selling_price", 1e61), ("tracking_type", "lot"),
        ("tax_rate", 101), ("category_id", 0),
    ])
    def test_field_validation(self, superclient, cat, brand, field, value):
        assert superclient.post(f"{M}/items/", json=_body(cat, brand, **{field: value})).status_code == 422

    def test_business_rules(self, superclient, cat, brand, material):
        assert superclient.post(f"{M}/items/", json=_body(cat, brand, selling_price=50)).status_code == 400
        assert superclient.post(f"{M}/items/", json=_body(cat, brand, minimum_selling_price=90)).status_code == 400
        assert superclient.put(f"{M}/items/{material['id']}", json={"website_active": True}).status_code == 400

    def test_inactive_category_is_refused(self, superclient, cat, brand):
        assert superclient.put(f"{M}/categories/{cat['id']}", json={"active": False}).status_code == 200
        assert superclient.post(f"{M}/items/", json=_body(cat, brand)).status_code == 400


class TestMaterialCategories:
    def test_create_get_and_code(self, superclient):
        r = superclient.post(f"{M}/categories/", json={"name": f"  QA MC {_u()}  ", "memo": "m", "category_code": "X"})
        assert r.status_code == 201, r.text
        c = r.json()
        assert c["name"] == c["name"].strip() and c["category_code"].startswith("MCAT")
        for key in ("version", "created_date", "created_at", "updated_at", "created_by_name", "active"):
            assert key in c
        assert superclient.get(f"{M}/categories/{c['id']}").json()["name"] == c["name"]
        assert superclient.get(f"{M}/categories/{2 ** 31 - 1}").status_code == 404

    def test_duplicate_name_refused(self, superclient, cat):
        assert superclient.post(f"{M}/categories/", json={"name": f" {cat['name'].upper()} "}).status_code == 409
        other = superclient.post(f"{M}/categories/", json={"name": f"QA MC {_u()}"}).json()
        assert superclient.put(f"{M}/categories/{other['id']}", json={"name": cat["name"]}).status_code == 409

    def test_name_can_match_a_product_category(self, superclient, product_cat):
        r = superclient.post(f"{M}/categories/", json={"name": product_cat["name"]})
        assert r.status_code == 201, r.text

    def test_update_and_stale_version(self, superclient, cat):
        r = superclient.put(f"{M}/categories/{cat['id']}", json={"memo": "new", "expected_version": cat["version"]})
        assert r.status_code == 200 and r.json()["memo"] == "new"
        stale = superclient.put(f"{M}/categories/{cat['id']}", json={"memo": "x", "expected_version": cat["version"]})
        assert stale.status_code == 409
        assert superclient.put(f"{M}/categories/{cat['id']}", json={"name": None}).status_code == 422

    def test_in_use_category_stays_active(self, superclient, cat, material):
        assert superclient.put(f"{M}/categories/{cat['id']}", json={"active": False}).status_code == 400

    def test_list_paged_and_search(self, superclient, cat, product_cat):
        rows = superclient.get(f"{M}/categories/", params={"limit": 100000}).json()
        ids = [r["id"] for r in rows]
        assert cat["id"] in ids
        page = superclient.get(f"{M}/categories/paged", params={"q": cat["name"], "sort_by": "category_code"}).json()
        assert [r["id"] for r in page["items"]] == [cat["id"]] and page["total"] == 1
        # product categories are a different list
        assert superclient.get(f"{M}/categories/paged", params={"q": product_cat["name"]}).json()["total"] == 0
        assert superclient.get(f"{M}/categories/paged", params={"active": True, "order": "desc"}).status_code == 200

    def test_product_category_is_refused_for_a_material(self, superclient, product_cat, brand, material):
        r = superclient.post(f"{M}/items/", json=_body(product_cat, brand))
        assert r.status_code == 400, r.text
        assert superclient.put(f"{M}/items/{material['id']}", json={"category_id": product_cat["id"]}).status_code == 400

    def test_material_category_is_not_a_product_category(self, superclient, cat, brand):
        r = superclient.post(f"{INV}/products/", json=_body(cat, brand, tracking_type="serial"))
        assert r.status_code != 201

    def test_permissions_and_activity_log(self, api, make_user, superclient, cat):
        superclient.put(f"{M}/categories/{cat['id']}", json={"memo": "audited"})
        log = superclient.get("/api/v1/common/activity-log", params={"entity_type": "material_category", "entity_id": cat["id"]})
        assert log.status_code == 200
        assert {"create", "update"} <= {e["action"] for e in log.json()}
        _, token = make_user(permissions=[("categories", "view"), ("categories", "create")])
        c = api(token)
        assert c.get(f"{M}/categories/").status_code == 403
        assert c.post(f"{M}/categories/", json={"name": f"QA MC {_u()}"}).status_code == 403
        _, token = make_user(permissions=[("materials", "view")])
        c = api(token)
        assert c.get(f"{M}/categories/paged").status_code == 200
        assert c.post(f"{M}/categories/", json={"name": f"QA MC {_u()}"}).status_code == 403
        assert c.put(f"{M}/categories/{cat['id']}", json={"memo": "x"}).status_code == 403


class TestListing:
    def test_paged_search_and_filters(self, superclient, cat, material):
        r = superclient.get(f"{M}/items/paged", params={"q": material["item_code"], "category_id": cat["id"], "size": 10})
        assert r.status_code == 200
        page = r.json()
        assert page["total"] == 1 and page["items"][0]["id"] == material["id"]
        assert page["items"][0]["category_name"] == cat["name"]
        assert page["items"][0]["brand_name"]
        sorted_page = superclient.get(f"{M}/items/paged", params={"sort_by": "name", "order": "desc"})
        assert sorted_page.status_code == 200

    def test_search_is_literal(self, superclient, material):
        hits = superclient.get(f"{M}/items/search", params={"q": material["name"]}).json()
        assert [h["id"] for h in hits] == [material["id"]]
        for row in superclient.get(f"{M}/items/search", params={"q": "%"}).json():
            assert "%" in (row["name"] + row["item_code"] + (row["model"] or ""))

    def test_list_and_csv(self, superclient, material):
        rows = superclient.get(f"{M}/items/", params={"limit": 100000}).json()
        assert material["id"] in [r["id"] for r in rows]
        csv = superclient.get(f"{M}/items/export-csv")
        assert csv.status_code == 200 and material["item_code"] in csv.text


class TestMinimumPrices:
    def test_history_current_and_delete(self, superclient, material):
        url = f"{M}/items/{material['id']}/minimum-prices"
        assert superclient.get(f"{url}/current").json() is None
        assert superclient.post(url, json={"minimum_price": 90}).status_code == 400  # below cost
        assert superclient.post(url, json={"minimum_price": 200}).status_code == 400  # above selling
        created = superclient.post(url, json={"minimum_price": 120})
        assert created.status_code == 201, created.text
        assert created.json()["material_id"] == material["id"]
        assert superclient.get(f"{url}/current").json()["minimum_price"] == 120
        assert len(superclient.get(url).json()) == 1
        assert superclient.get(f"{M}/items/{material['id']}").json()["minimum_selling_price"] == 120
        assert superclient.delete(f"{M}/minimum-prices/{created.json()['id']}").status_code == 200
        assert superclient.get(f"{url}/current").json() is None


class TestSuppliers:
    def test_link_list_update_and_single_preferred(self, superclient, material, make_supplier):
        s1, s2 = make_supplier(), make_supplier()
        url = f"{M}/items/{material['id']}/suppliers"
        a = superclient.post(url, json={"supplier_id": s1.id, "cost_price": 95, "is_preferred": True})
        assert a.status_code == 201, a.text
        assert a.json()["material_item_code"] == material["item_code"]
        assert a.json()["supplier_company_name"] == s1.company_name
        assert superclient.post(url, json={"supplier_id": s1.id, "cost_price": 95}).status_code == 400
        b = superclient.post(url, json={"supplier_id": s2.id, "cost_price": 90, "is_preferred": True}).json()
        links = superclient.get(url).json()
        assert [l["is_preferred"] for l in links if l["id"] == a.json()["id"]] == [False]
        assert links[0]["id"] == b["id"]
        assert superclient.get(f"{M}/items/{material['id']}").json()["preferred_supplier_name"] == s2.company_name
        upd = superclient.put(f"{url}/{a.json()['id']}", json={"supplier_sku": "SKU-1", "minimum_order_qty": 5})
        assert upd.status_code == 200 and upd.json()["supplier_sku"] == "SKU-1"
        paged = superclient.get(f"{M}/items/paged", params={"supplier_id": s1.id}).json()
        assert [r["id"] for r in paged["items"]] == [material["id"]]

    def test_link_validation(self, superclient, material, make_supplier):
        url = f"{M}/items/{material['id']}/suppliers"
        s = make_supplier()
        assert superclient.post(url, json={"supplier_id": s.id, "cost_price": 0}).status_code == 422
        assert superclient.post(url, json={"supplier_id": 2 ** 31 - 1, "cost_price": 5}).status_code == 404
        link = superclient.post(url, json={"supplier_id": s.id, "cost_price": 5}).json()
        assert superclient.put(f"{url}/{link['id']}", json={"cost_price": None}).status_code == 422
        assert superclient.put(f"{M}/items/{2 ** 31 - 1}/suppliers/{link['id']}", json={"active": False}).status_code == 404


class TestImage:
    def test_bad_image_is_refused(self, superclient, material):
        url = f"{M}/items/{material['id']}/image"
        assert superclient.post(url, files={"file": ("x.txt", b"hello", "text/plain")}).status_code == 400
        assert superclient.post(url, files={"file": ("x.png", b"not a png", "image/png")}).status_code == 400
        assert superclient.get(f"{M}/items/{material['id']}").json()["image_url"] is None

    def test_upload_and_remove(self, superclient, material):
        r = superclient.post(f"{M}/items/{material['id']}/image", files={"file": ("x.png", PNG, "image/png")})
        assert r.status_code == 200, r.text
        assert r.json()["image_url"].startswith("materials/")
        removed = superclient.delete(f"{M}/items/{material['id']}/image")
        assert removed.status_code == 200 and removed.json()["image_url"] is None


class TestPermissions:
    def test_user_without_materials_permission_gets_403(self, api, make_user, material):
        _, token = make_user(permissions=[("products", "view")])
        c = api(token)
        assert c.get(f"{M}/items/").status_code == 403
        assert c.get(f"{M}/items/{material['id']}").status_code == 403
        assert c.put(f"{M}/items/{material['id']}", json={"description": "x"}).status_code == 403

    def test_view_only_user_cannot_write(self, api, make_user, cat, brand, material):
        _, token = make_user(permissions=[("materials", "view")])
        c = api(token)
        assert c.get(f"{M}/items/paged").status_code == 200
        assert c.post(f"{M}/items/", json=_body(cat, brand)).status_code == 403
        assert c.post(f"{M}/items/{material['id']}/minimum-prices", json={"minimum_price": 120}).status_code == 403


class TestActivityLog:
    def test_create_and_update_show_in_activity_history(self, superclient, material):
        superclient.put(f"{M}/items/{material['id']}", json={"description": "audited"})
        r = superclient.get("/api/v1/common/activity-log", params={"entity_type": "material", "entity_id": material["id"]})
        assert r.status_code == 200, r.text
        actions = [e["action"] for e in r.json()]
        assert "create" in actions and "update" in actions

    def test_activity_history_needs_materials_view(self, api, make_user, material):
        _, token = make_user(permissions=[("products", "view")])
        r = api(token).get("/api/v1/common/activity-log", params={"entity_type": "material", "entity_id": material["id"]})
        assert r.status_code == 403


class TestMaterialMasterFields:
    """General section extras: valuation/issuing method and product family are mandatory."""

    @pytest.mark.parametrize("field", ["inventory_valuation_method", "stock_issuing_method", "product_family"])
    def test_mandatory_on_create(self, superclient, cat, brand, field):
        body = _body(cat, brand)
        body.pop(field)
        assert superclient.post(f"{M}/items/", json=body).status_code == 422

    @pytest.mark.parametrize("field", ["inventory_valuation_method", "stock_issuing_method", "product_family"])
    def test_cannot_be_cleared(self, superclient, material, field):
        assert superclient.put(f"{M}/items/{material['id']}", json={field: None}).status_code == 422

    def test_all_fields_saved(self, superclient, cat, brand):
        r = superclient.post(f"{M}/items/", json=_body(
            cat, brand, inventory_valuation_method="weighted_average", stock_issuing_method="fifo",
            unit_dimensions="120 x 60 x 40 mm", hs_code="7208.10", required_certificate="ISO 9001",
            colour="Blue", design_url="https://example.com/drawing.pdf",
        ))
        assert r.status_code == 201, r.text
        m = r.json()
        assert m["inventory_valuation_method"] == "weighted_average"
        assert m["stock_issuing_method"] == "fifo"
        assert (m["unit_dimensions"], m["hs_code"], m["required_certificate"], m["colour"], m["design_url"]) == (
            "120 x 60 x 40 mm", "7208.10", "ISO 9001", "Blue", "https://example.com/drawing.pdf")
        # stored as the plain code, not the enum's repr
        assert superclient.get(f"{M}/items/{m['id']}").json()["inventory_valuation_method"] == "weighted_average"

    @pytest.mark.parametrize("field,value", [
        ("inventory_valuation_method", "random"), ("stock_issuing_method", "lifo"),
        ("design_url", "ftp://x"), ("hs_code", "abc"), ("product_family", "   "),
    ])
    def test_bad_values_rejected(self, superclient, cat, brand, field, value):
        assert superclient.post(f"{M}/items/", json=_body(cat, brand, **{field: value})).status_code == 422


class TestItemTypeBrandUomToggles:
    """Item Catalog: Stock Item / Expense only, brand optional, UOM mandatory, two toggles."""

    @pytest.mark.parametrize("item_type", ["stock_item", "expense"])
    def test_allowed_item_types(self, superclient, cat, brand, item_type):
        r = superclient.post(f"{M}/items/", json=_body(cat, brand, item_type=item_type))
        assert r.status_code == 201, r.text
        assert r.json()["item_type"] == item_type

    @pytest.mark.parametrize("item_type", ["inventory", "service", "raw"])
    def test_other_item_types_rejected(self, superclient, cat, brand, item_type):
        assert superclient.post(f"{M}/items/", json=_body(cat, brand, item_type=item_type)).status_code == 422

    def test_brand_optional_and_clearable(self, superclient, cat, brand, material):
        body = _body(cat, brand)
        body.pop("items_brand_id")
        r = superclient.post(f"{M}/items/", json=body)
        assert r.status_code == 201, r.text
        created = r.json()
        assert created["items_brand_id"] is None
        # a brandless item still shows in the paged list
        page = superclient.get(f"{M}/items/paged", params={"q": created["name"]}).json()
        assert [i["id"] for i in page["items"]] == [created["id"]]
        # an existing brand can be cleared
        r = superclient.put(f"{M}/items/{material['id']}", json={"items_brand_id": None})
        assert r.status_code == 200, r.text
        assert r.json()["items_brand_id"] is None

    def test_uom_mandatory(self, superclient, cat, brand, material):
        body = _body(cat, brand)
        body.pop("unit_of_measure")
        assert superclient.post(f"{M}/items/", json=body).status_code == 422
        assert superclient.put(f"{M}/items/{material['id']}", json={"unit_of_measure": None}).status_code == 422

    def test_toggles_default_off_and_save(self, superclient, cat, brand, material):
        assert (material["check_for_availability"], material["design_required"]) == (False, False)
        r = superclient.post(f"{M}/items/", json=_body(cat, brand, check_for_availability=True, design_required=True))
        assert r.status_code == 201, r.text
        assert (r.json()["check_for_availability"], r.json()["design_required"]) == (True, True)
        r = superclient.put(f"{M}/items/{material['id']}", json={"design_required": True})
        assert r.json()["design_required"] is True
        assert superclient.put(f"{M}/items/{material['id']}", json={"design_required": None}).status_code == 422


class TestNameSpacesCollapsed:
    """QA 2026-11-20: names differing only by inner double spaces were stored as two records."""

    def test_material_category_double_space_is_a_duplicate(self, superclient):
        name = f"QA Space Cat {_u()}"
        first = superclient.post(f"{M}/categories/", json={"name": name})
        assert first.status_code == 201, first.text
        dup = superclient.post(f"{M}/categories/", json={"name": name.replace(" ", "  ")})
        assert dup.status_code in (400, 409), dup.text

    def test_product_category_double_space_is_a_duplicate(self, superclient):
        name = f"QA Space PCat {_u()}"
        assert superclient.post(f"{INV}/categories/", json={"name": name}).status_code == 201
        dup = superclient.post(f"{INV}/categories/", json={"name": f"  {name.replace(' ', '   ')}  "})
        assert dup.status_code in (400, 409), dup.text

    def test_names_are_stored_with_single_spaces(self, superclient, cat, brand):
        r = superclient.post(f"{M}/items/", json=_body(cat, brand, name=f"QA  Mat \t Spaces {_u()}"))
        assert r.status_code == 201, r.text
        assert "  " not in r.json()["name"] and "\t" not in r.json()["name"]
        b = superclient.post(f"{INV}/brands/", json={"brand_name": f"QA   Brand {_u()}"})
        assert b.status_code == 201, b.text
        assert "  " not in b.json()["brand_name"]


class TestCostPriceOptional:
    """Item cost price is optional (0 = not set); a supplier link's cost price stays required."""

    def test_item_without_cost_price(self, superclient, cat, brand):
        body = _body(cat, brand)
        body.pop("cost_price")
        body.pop("selling_price")
        r = superclient.post(f"{M}/items/", json=body)
        assert r.status_code == 201, r.text
        assert float(r.json()["cost_price"]) == 0

    def test_supplier_cost_price_still_required(self, superclient, material):
        sup = superclient.get("/api/v1/purchasing/suppliers", params={"limit": 1}).json()[0]
        r = superclient.post(f"{M}/items/{material['id']}/suppliers", json={"supplier_id": sup["id"]})
        assert r.status_code == 422
        r = superclient.post(f"{M}/items/{material['id']}/suppliers", json={"supplier_id": sup["id"], "cost_price": 0})
        assert r.status_code == 422
