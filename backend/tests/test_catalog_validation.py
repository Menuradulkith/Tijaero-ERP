"""Product catalog (products, categories, brands, price tiers): validation, uniqueness, route fixes."""
import uuid

import pytest
from sqlalchemy.exc import IntegrityError

B = "/api/v1/inventory"


def _u() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def cat(superclient):
    r = superclient.post(f"{B}/categories/", json={"name": f"QA Cat {_u()}", "category_code": f"QC{_u()}"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def brand(superclient):
    r = superclient.post(f"{B}/brands/", json={"brand_name": f"QA Brand {_u()}", "brand_code": _u()[:4]})
    assert r.status_code == 201, r.text
    return r.json()


def _prod(cat, brand, **kw):
    u = _u()
    return {
        "name": f"QA Prod {u}", "item_code": f"QP{u}", "item_type": "inventory", "unit_of_measure": "pcs",
        "cost_price": 100, "selling_price": 150, "category_id": cat["id"], "items_brand_id": brand["id"], **kw,
    }


@pytest.fixture
def product(superclient, cat, brand):
    r = superclient.post(f"{B}/products/", json=_prod(cat, brand))
    assert r.status_code == 201, r.text
    return r.json()


# ================================================================ the poisoned-catalog bug
class TestNegativePricesAndPoisonedRows:
    @pytest.mark.parametrize("field", ["website_price", "selling_price", "minimum_selling_price"])
    def test_negative_prices_are_rejected_before_anything_is_saved(self, superclient, cat, brand, field):
        body = _prod(cat, brand, **{field: -5})
        assert superclient.post(f"{B}/products/", json=body).status_code == 422
        # nothing was committed by the failed request
        assert superclient.get(f"{B}/products/search", params={"q": body["item_code"]}).json() == []

    @pytest.mark.parametrize("field", ["cost_price", "website_price", "selling_price", "minimum_selling_price"])
    def test_prices_above_the_column_limit_are_422_not_500(self, superclient, cat, brand, field):
        body = _prod(cat, brand)
        body.update({"cost_price": 1, "selling_price": 2})
        body[field] = 1e61
        assert superclient.post(f"{B}/products/", json=body).status_code == 422

    def test_update_rejects_negative_and_huge_prices(self, superclient, product):
        for body in ({"website_price": -1}, {"selling_price": -1}, {"cost_price": 1e61}, {"minimum_selling_price": -1}):
            assert superclient.put(f"{B}/products/{product['id']}", json=body).status_code == 422, body

    def test_one_legacy_bad_row_no_longer_breaks_the_list(self, superclient, db, product):
        """A row that predates the validation (negative website price on the product AND its tier) must
        still serialize — before, the strict response model made the whole list return 500."""
        from app.modules.products.models import Product
        from app.modules.products.price_tier_models import ProductPriceTier

        p = db.query(Product).filter(Product.id == product["id"]).first()
        p.website_price = -5
        for t in db.query(ProductPriceTier).filter(ProductPriceTier.product_id == p.id).all():
            t.website_price = -5
        db.flush()
        assert superclient.get(f"{B}/products/{p.id}").status_code == 200
        assert superclient.get(f"{B}/products/", params={"skip": 0, "limit": 1000}).status_code == 200
        assert superclient.get(f"{B}/products/search", params={"q": p.item_code}).status_code == 200


# ================================================================ ledger import
def test_sales_ledger_integration_imports():
    """`from app.modules.products.models import ProductPriceTier` raised ImportError, so every
    sales invoice failed to post to the general ledger."""
    import app.modules.sales.accounting_integration as ai
    from app.modules.products.price_tier_models import ProductPriceTier

    assert ai.ProductPriceTier is ProductPriceTier


# ================================================================ blank / whitespace / trim
class TestNamesAndCodes:
    @pytest.mark.parametrize("value", ["", "   "])
    def test_blank_values_rejected(self, superclient, cat, brand, value):
        for field in ("name", "item_code"):
            assert superclient.post(f"{B}/products/", json=_prod(cat, brand, **{field: value})).status_code == 422
        assert superclient.post(f"{B}/categories/", json={"name": value, "category_code": "x"}).status_code == 422
        assert superclient.post(f"{B}/categories/", json={"name": "x", "category_code": value}).status_code == 422
        assert superclient.post(f"{B}/brands/", json={"brand_name": value, "brand_code": "x"}).status_code == 422
        assert superclient.post(f"{B}/brands/", json={"brand_name": "x", "brand_code": value}).status_code == 422

    def test_values_are_trimmed(self, superclient, cat, brand):
        u = _u()
        p = superclient.post(f"{B}/products/", json=_prod(cat, brand, name=f"  Trim {u} ", item_code=f" T{u} ")).json()
        assert p["name"] == f"Trim {u}" and p["item_code"] == f"T{u}"

    def test_item_code_with_trailing_space_is_a_duplicate(self, superclient, cat, brand, product):
        r = superclient.post(f"{B}/products/", json=_prod(cat, brand, item_code=product["item_code"] + " "))
        assert r.status_code in (400, 409)
        r = superclient.post(f"{B}/products/", json=_prod(cat, brand, item_code=product["item_code"].lower()))
        assert r.status_code in (400, 409)

    def test_category_and_brand_variants_with_spaces_are_duplicates(self, superclient, cat, brand):
        assert superclient.post(f"{B}/categories/", json={"name": f" {cat['name'].upper()} ", "category_code": f"X{_u()}"}).status_code == 409
        assert superclient.post(f"{B}/categories/", json={"name": f"N{_u()}", "category_code": f"{cat['category_code'].lower()} "}).status_code == 409
        assert superclient.post(f"{B}/brands/", json={"brand_name": f" {brand['brand_name'].lower()}", "brand_code": _u()[:4]}).status_code == 409
        assert superclient.post(f"{B}/brands/", json={"brand_name": f"N{_u()}", "brand_code": f" {brand['brand_code'].upper()}"}).status_code == 409

    def test_length_limits(self, superclient, cat, brand):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, name="n" * 256)).status_code == 422
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, description="d" * 5001)).status_code == 422
        assert superclient.post(f"{B}/categories/", json={"name": "x", "category_code": "y", "description": "d" * 5001}).status_code == 422
        assert superclient.post(f"{B}/brands/", json={"brand_name": "x", "brand_code": "ABCDE"}).status_code == 422

    @pytest.mark.parametrize("bad", ["", "  ", "<script>x</script>", "a;b", "x" * 31])
    def test_item_type_must_be_a_short_safe_identifier(self, superclient, cat, brand, bad):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, item_type=bad)).status_code == 422

    @pytest.mark.parametrize("ok", ["inventory", "service", "general", "Finished Goods"])
    def test_existing_item_types_still_work(self, superclient, cat, brand, ok):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, item_type=ok)).status_code == 201

    @pytest.mark.parametrize("bad", ["", "  ", "<b>", "u" * 21])
    def test_unit_of_measure_validated(self, superclient, cat, brand, bad):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, unit_of_measure=bad)).status_code == 422


class TestUpdateNulls:
    @pytest.mark.parametrize("body", [{"name": None}, {"name": ""}, {"cost_price": None}, {"active": None}, {"category_id": None}, {"item_type": ""}])
    def test_product_update_rejects_null_and_blank(self, superclient, product, body):
        assert superclient.put(f"{B}/products/{product['id']}", json=body).status_code == 422

    @pytest.mark.parametrize("body", [{"name": None}, {"category_code": "   "}, {"category_code": None}, {"active": None}])
    def test_category_update_rejects_null_and_blank(self, superclient, cat, body):
        assert superclient.put(f"{B}/categories/{cat['id']}", json=body).status_code == 422

    @pytest.mark.parametrize("body", [{"brand_name": None}, {"brand_code": " "}, {"brand_code": None}, {"active": None}])
    def test_brand_update_rejects_null_and_blank(self, superclient, brand, body):
        assert superclient.put(f"{B}/brands/{brand['id']}", json=body).status_code == 422

    def test_clearing_optional_text_with_blank_is_fine(self, superclient, product):
        r = superclient.put(f"{B}/products/{product['id']}", json={"description": "", "model": ""})
        assert r.status_code == 200


# ================================================================ price rules
class TestPriceRules:
    def test_minimum_price_may_not_exceed_selling_price_on_create(self, superclient, cat, brand):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, selling_price=100, minimum_selling_price=500)).status_code == 422

    def test_minimum_price_history_endpoint_enforces_selling_and_cost(self, superclient, product):
        url = f"{B}/products/{product['id']}/minimum-prices"
        assert superclient.post(url, json={"minimum_price": 100000}).status_code == 400   # above selling (150)
        assert superclient.post(url, json={"minimum_price": 50}).status_code == 400       # below cost (100)
        assert superclient.post(url, json={"minimum_price": 120}).status_code == 201
        assert superclient.post(url, json={"minimum_price": 1e61}).status_code == 422

    def test_lowering_selling_price_below_the_minimum_is_rejected(self, superclient, product):
        superclient.post(f"{B}/products/{product['id']}/minimum-prices", json={"minimum_price": 140})
        r = superclient.put(f"{B}/products/{product['id']}", json={"selling_price": 120})
        assert r.status_code == 400 and "greater than the selling price" in r.json()["detail"]

    def test_selling_below_cost_still_rejected(self, superclient, cat, brand):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, cost_price=100, selling_price=50)).status_code == 400

    def test_website_active_requires_a_website_price(self, superclient, cat, brand, product):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, website_active=True)).status_code == 422
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, website_active=True, website_price=200)).status_code == 201
        assert superclient.put(f"{B}/products/{product['id']}", json={"website_active": True}).status_code == 400
        assert superclient.put(f"{B}/products/{product['id']}", json={"website_active": True, "website_price": 200}).status_code == 200

    def test_image_url_cannot_be_set_on_create(self, superclient, cat, brand):
        p = superclient.post(f"{B}/products/", json=_prod(cat, brand, image_url="javascript:alert(1)")).json()
        assert p["image_url"] is None


class TestPriceTierInput:
    def _tier(self, **kw):
        return {"cost_price": 100, "minimum_selling_price": 120, "selling_price": 150, **kw}

    def test_tier_prices_are_bounded(self, superclient, product):
        url = f"{B}/products/{product['id']}/price-tiers"
        for body in (self._tier(selling_price=1e61), self._tier(website_price=-1), self._tier(remark="r" * 501)):
            assert superclient.post(url, json=body).status_code == 422
        assert superclient.post(url, json=self._tier()).status_code == 201

    def test_tier_update_rejects_null_cost_and_null_active(self, superclient, product):
        tier = superclient.get(f"{B}/products/{product['id']}/price-tiers").json()[0]
        url = f"{B}/products/{product['id']}/price-tiers/{tier['id']}"
        assert superclient.put(url, json={"cost_price": None}).status_code == 422
        assert superclient.put(url, json={"is_active": None}).status_code == 422
        assert superclient.put(url, json={"remark": "ok"}).status_code == 200


# ================================================================ references
class TestInactiveReferences:
    def test_cannot_create_a_product_in_an_inactive_category_or_brand(self, superclient, cat, brand):
        superclient.put(f"{B}/categories/{cat['id']}", json={"active": False})
        r = superclient.post(f"{B}/products/", json=_prod(cat, brand))
        assert r.status_code == 400 and "inactive" in r.json()["detail"].lower()

    def test_cannot_create_a_product_in_an_inactive_brand(self, superclient, cat, brand):
        superclient.put(f"{B}/brands/{brand['id']}", json={"active": False})
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand)).status_code == 400

    def test_existing_assignment_to_a_deactivated_category_does_not_block_other_edits(self, superclient, cat, brand, product):
        superclient.put(f"{B}/categories/{cat['id']}", json={"active": False})
        assert superclient.put(f"{B}/products/{product['id']}", json={"description": "still editable"}).status_code == 200

    def test_moving_a_product_into_an_inactive_category_is_rejected(self, superclient, product):
        other = superclient.post(f"{B}/categories/", json={"name": f"QA Off {_u()}", "category_code": f"QO{_u()}"}).json()
        superclient.put(f"{B}/categories/{other['id']}", json={"active": False})
        assert superclient.put(f"{B}/products/{product['id']}", json={"category_id": other["id"]}).status_code == 400


# ================================================================ ids, routes, search
class TestIdsAndRoutes:
    @pytest.mark.parametrize("bad", [0, -1, 2**31, 2**40])
    def test_out_of_range_ids_are_422(self, superclient, bad):
        for path in (f"/products/{bad}", f"/categories/{bad}", f"/brands/{bad}", f"/products/{bad}/price-tiers", f"/products/1/price-tiers/{bad}"):
            assert superclient.get(f"{B}{path}").status_code == 422, path
        assert superclient.put(f"{B}/products/{bad}", json={"name": "x"}).status_code == 422
        assert superclient.put(f"{B}/categories/{bad}", json={"name": "x"}).status_code == 422
        assert superclient.put(f"{B}/brands/{bad}", json={"brand_name": "x"}).status_code == 422

    def test_category_and_brand_ids_inside_a_product_body_are_bounded(self, superclient, cat, brand):
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, category_id=2**40)).status_code == 422

    def test_unknown_in_range_id_is_404(self, superclient):
        assert superclient.get(f"{B}/products/2147483647").status_code == 404

    def test_export_csv_route_is_reachable_and_neutralises_formulas(self, superclient, cat, brand):
        u = _u()
        superclient.post(f"{B}/products/", json=_prod(cat, brand, name='=HYPERLINK("http://evil","x")', item_code=f"CSV{u}", description="@SUM(1+1)"))
        r = superclient.get(f"{B}/products/export-csv", params={"active_only": False})
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
        row = next(line for line in r.text.splitlines() if f"CSV{u}" in line)
        assert "'=HYPERLINK" in row and "'@SUM" in row
        assert ",=HYPERLINK" not in row and ',"=HYPERLINK' not in row

    def test_search_treats_percent_and_underscore_literally(self, superclient, product):
        assert superclient.get(f"{B}/products/search", params={"q": "%"}).json() == []
        assert superclient.get(f"{B}/products/search", params={"q": "_"}).json() == []
        found = superclient.get(f"{B}/products/search", params={"q": product["item_code"][2:6]}).json()
        assert any(p["id"] == product["id"] for p in found)


# ================================================================ authorization (unchanged behaviour, pinned)
class TestAuthorization:
    def test_read_only_user_cannot_write(self, client, api, make_user, cat, brand, product):
        _, token = make_user(permissions=[("products", "view"), ("categories", "view"), ("brands", "view")])
        c = api(token)
        assert c.get(f"{B}/products/").status_code == 200
        assert c.post(f"{B}/products/", json=_prod(cat, brand)).status_code == 403
        assert c.put(f"{B}/products/{product['id']}", json={"description": "x"}).status_code == 403
        assert c.post(f"{B}/categories/", json={"name": "x", "category_code": "y"}).status_code == 403
        assert c.post(f"{B}/brands/", json={"brand_name": "x", "brand_code": "y"}).status_code == 403
        assert c.post(f"{B}/products/{product['id']}/minimum-prices", json={"minimum_price": 120}).status_code == 403


# ================================================================ database backstop
class TestDatabaseIndexes:
    def _collides(self, db, obj):
        try:
            with db.begin_nested():
                db.add(obj)
                db.flush()
        except IntegrityError:
            return True
        return False

    def test_category_and_brand_variants_collide_at_the_database(self, db):
        from app.core import timezone as tz
        from app.modules.products.models import Category, ItemsBrand

        u = _u()
        db.add(Category(name=f"Idx {u}", category_code=f"IC{u}", active=True, created_date=tz.now()))
        db.add(ItemsBrand(brand_name=f"Idx {u}", brand_code=u[:3], active=True))
        db.flush()
        assert self._collides(db, Category(name=f" IDX {u} ", category_code=f"other{u}", active=True, created_date=tz.now()))
        assert self._collides(db, Category(name=f"other{u}", category_code=f" ic{u}", active=True, created_date=tz.now()))
        assert self._collides(db, ItemsBrand(brand_name=f" idx {u}", brand_code=u[3:6], active=True))
        assert self._collides(db, ItemsBrand(brand_name=f"other{u}", brand_code=f" {u[:3].upper()}", active=True))

    def test_product_variants_collide_at_the_database(self, db):
        from app.core import timezone as tz
        from app.modules.products.models import Category, ItemsBrand, Product

        u0 = _u()
        category = Category(name=f"IdxP {u0}", category_code=f"IP{u0}", active=True, created_date=tz.now())
        brand_row = ItemsBrand(brand_name=f"IdxP {u0}", brand_code=u0[:4], active=True)
        db.add_all([category, brand_row])
        db.flush()
        cat = {"id": category.id}
        brand = {"id": brand_row.id}

        def make(**kw):
            u = _u()
            base = dict(name=f"P{u}", item_code=f"C{u}", item_type="inventory", unit_of_measure="pcs", website_active=False, active=True,
                        cost_price=1, selling_price=2, category_id=cat["id"], items_brand_id=brand["id"],
                        created_date=tz.today(), added_date=tz.now())
            base.update(kw)
            return Product(**base)

        first = make()
        db.add(first)
        db.flush()
        assert self._collides(db, make(name=f" {first.name.upper()} "))
        assert self._collides(db, make(item_code=f" {first.item_code.lower()}"))
