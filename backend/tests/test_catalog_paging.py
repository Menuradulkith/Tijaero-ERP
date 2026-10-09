"""Server-side paging for products / categories / brands."""
import uuid

import pytest

B = "/api/v1/inventory"


def _u() -> str:
    return uuid.uuid4().hex[:8]


@pytest.fixture
def seeded(superclient):
    tag = _u()
    cat = superclient.post(f"{B}/categories/", json={"name": f"PG Cat {tag}", "category_code": f"PC{tag}"}).json()
    cat2 = superclient.post(f"{B}/categories/", json={"name": f"PG Cat2 {tag}", "category_code": f"PD{tag}"}).json()
    brand = superclient.post(f"{B}/brands/", json={"brand_name": f"PG Brand {tag}", "brand_code": tag[:4]}).json()
    for i in range(7):
        r = superclient.post(f"{B}/products/", json={
            "name": f"PG Prod {tag} {i}", "item_code": f"PG{tag}{i}", "item_type": "inventory", "unit_of_measure": "pcs",
            "cost_price": 10 + i, "selling_price": 20 + i,
            "category_id": (cat if i < 5 else cat2)["id"], "items_brand_id": brand["id"],
        })
        assert r.status_code == 201, r.text
    return {"tag": tag, "cat": cat, "cat2": cat2, "brand": brand}


def _get(c, path, **params):
    r = c.get(f"{B}/{path}/paged", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def test_pages_cover_all_rows_without_overlap(superclient, seeded):
    q = seeded["tag"]
    p0 = _get(superclient, "products", q=q, size=3, page=0)
    assert p0["total"] == 7 and p0["pages"] == 3 and len(p0["items"]) == 3
    seen = []
    for pg in range(3):
        seen += [x["item_code"] for x in _get(superclient, "products", q=q, size=3, page=pg)["items"]]
    assert len(seen) == 7 and len(set(seen)) == 7 and seen == sorted(seen)
    assert _get(superclient, "products", q=q, size=3, page=3)["items"] == []


def test_product_rows_carry_category_and_brand_names(superclient, seeded):
    row = _get(superclient, "products", q=seeded["tag"], size=1)["items"][0]
    assert row["category_name"] == seeded["cat"]["name"]
    assert row["brand_name"] == seeded["brand"]["brand_name"]


def test_filters_and_sort(superclient, seeded):
    q = seeded["tag"]
    assert _get(superclient, "products", q=q, category_id=seeded["cat2"]["id"])["total"] == 2
    assert _get(superclient, "products", q=q, brand_id=seeded["brand"]["id"])["total"] == 7
    desc = _get(superclient, "products", q=q, sort_by="selling_price", order="desc", size=2)["items"]
    assert [x["selling_price"] for x in desc] == [26, 25]
    inactive = _get(superclient, "products", q=q, active="false")
    assert inactive["total"] == 0


def test_search_is_literal_and_bad_params_are_rejected(superclient, seeded):
    assert _get(superclient, "products", q="%")["total"] == _get(superclient, "products", q="%25%25zz")["total"] == 0
    for bad in ({"size": 0}, {"size": 201}, {"page": -1}, {"order": "sideways"}):
        assert superclient.get(f"{B}/products/paged", params=bad).status_code == 422
    # unknown sort column falls back to the default instead of erroring / injecting
    assert superclient.get(f"{B}/products/paged", params={"sort_by": "id; drop table products"}).status_code == 200


def test_categories_and_brands_paged(superclient, seeded):
    tag = seeded["tag"]
    c = _get(superclient, "categories", q=tag, size=1)
    assert c["total"] == 2 and c["pages"] == 2 and len(c["items"]) == 1
    assert _get(superclient, "categories", q=tag, active="false")["total"] == 0
    b = _get(superclient, "brands", q=seeded["brand"]["brand_name"])
    assert b["total"] == 1 and b["items"][0]["id"] == seeded["brand"]["id"]
    # route order: "paged" is not swallowed by /{id}
    assert superclient.get(f"{B}/categories/paged").status_code == 200


def test_unfiltered_total_matches_full_list(superclient, seeded):
    # regression: count(*) lost its FROM clause when no filter referenced the table
    for path in ("categories", "brands", "products"):
        full = superclient.get(f"{B}/{path}/", params={"limit": 100000, "active_only": False}).json()
        assert _get(superclient, path, size=1)["total"] == len(full), path
