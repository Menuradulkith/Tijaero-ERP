"""Central stock phase 2 (2026-11-20): products.material_id links a product to the Item Catalog item it
sells; stock rows carry the item and sales / quotations / availability find stock through the item."""
from datetime import date, timedelta

import pytest

from app.modules.inventory.models import SalesStock
from app.modules.materials.from_product import item_for_product
from app.modules.materials.models import Material
from app.modules.products.models import Product
from app.modules.sales.models import InvoiceItems
from app.modules.sales.quotation_schemas import QuoteTypeEnum, SalesQuoteCreate, SalesQuoteItemCreate
from app.modules.sales.quotation_service import SalesQuoteService
from tests.integration.test_workflows.test_grn_receive_cancel import P, _body as grn_body, world  # noqa: F401
from tests.test_catalog_validation import B, _prod, brand, cat  # noqa: F401
from tests.test_sales_orders import S, _body as so_body

W = "/api/v1/inventory/warehouse-stock"
M = "/api/v1/materials/items"


def _stock_ids(db, order):
    return [i.sales_stock_id for i in db.query(InvoiceItems).filter(InvoiceItems.invoice_id == order["id"])
            .order_by(InvoiceItems.id)]


def _link(db, *products):
    """One item for all the given products (built from the first one)."""
    item = item_for_product(db, products[0])
    for p in products:
        p.material_id = item.id
    db.flush()
    return item


@pytest.fixture
def shared(db, make_branch, make_customer, make_product, make_sales_stock):
    """Products A and B selling the same item; 3 units received as product A at a branch."""
    b = make_branch()
    a, other = make_product(), make_product()
    item = _link(db, a, other)
    units = [make_sales_stock(product=a, branch=b) for _ in range(3)]
    return dict(branch=b, customer=make_customer(), a=a, b=other, item=item, units=units)


# ───────────────────────────── product API ─────────────────────────────
class TestProductLink:
    def test_create_auto_creates_and_links_an_item(self, db, superclient, cat, brand):  # noqa: F811
        body = _prod(cat, brand, tracking_type="batch", unit_of_measure="kg", shelf_life_days=90, requires_qc=True,
                     over_receipt_tolerance_pct=5, tax_rate=8, required_certificate="ISO 9001", description="Desc")
        r = superclient.post(f"{B}/products/", json=body)
        assert r.status_code == 201, r.text
        p = r.json()
        assert p["material_id"] and p["material_item_code"].startswith("MAT") and p["material_name"] == body["name"]
        m = db.get(Material, p["material_id"])
        assert (m.name, m.item_type, m.unit_of_measure, m.tracking_type) == (body["name"], "stock_item", "kg", "batch")
        assert (m.shelf_life_days, m.requires_qc, float(m.over_receipt_tolerance_pct), float(m.tax_rate)) == (90, True, 5, 8)
        assert (float(m.cost_price), m.description, m.required_certificate, m.active) == (100, "Desc", "ISO 9001", True)
        assert m.category.name == cat["name"] and m.items_brand_id == brand["id"]
        assert m.product_family == "QA Family" and m.hs_code == p["hs_code"]
        assert (m.inventory_valuation_method, m.stock_issuing_method) == ("fifo", "fefo")
        # the list/paged responses carry the link too
        paged = superclient.get(f"{B}/products/paged", params={"q": body["name"]}).json()["items"]
        assert paged[0]["material_item_code"] == p["material_item_code"]

    def test_create_with_explicit_active_item_links_it(self, db, superclient, cat, brand, make_product):  # noqa: F811
        item = _link(db, make_product())
        before = db.query(Material).count()
        r = superclient.post(f"{B}/products/", json=_prod(cat, brand, material_id=item.id))
        assert r.status_code == 201, r.text
        assert r.json()["material_id"] == item.id and r.json()["material_name"] == item.name
        assert db.query(Material).count() == before

    def test_non_stock_product_gets_no_item(self, superclient, cat, brand):  # noqa: F811
        r = superclient.post(f"{B}/products/", json=_prod(cat, brand, item_type="service"))
        assert r.status_code == 201, r.text
        assert r.json()["material_id"] is None

    def test_inactive_or_unknown_item_is_refused(self, db, superclient, cat, brand, make_product):  # noqa: F811
        item = _link(db, make_product())
        item.active = False
        db.flush()
        r = superclient.post(f"{B}/products/", json=_prod(cat, brand, material_id=item.id))
        assert r.status_code == 400 and "inactive" in r.json()["detail"]
        assert superclient.post(f"{B}/products/", json=_prod(cat, brand, material_id=99999999)).status_code == 400

    def test_link_change_refused_while_stock_exists(self, db, superclient, make_product, make_sales_stock):
        p, other = make_product(), make_product()
        _link(db, p)
        new_item = _link(db, other)
        unit = make_sales_stock(product=p)
        for change in (new_item.id, None):
            r = superclient.put(f"{B}/products/{p.id}", json={"material_id": change})
            assert r.status_code == 400 and "has stock" in r.json()["detail"], r.text
        unit.is_active = False  # sold: no live stock any more
        db.flush()
        r = superclient.put(f"{B}/products/{p.id}", json={"material_id": new_item.id})
        assert r.status_code == 200, r.text
        assert r.json()["material_id"] == new_item.id
        r = superclient.put(f"{B}/products/{p.id}", json={"material_id": None})
        assert r.status_code == 200 and r.json()["material_id"] is None

    def test_material_get_lists_linked_products(self, db, superclient, shared):
        r = superclient.get(f"{M}/{shared['item'].id}")
        assert r.status_code == 200, r.text
        linked = {p["id"]: p for p in r.json()["linked_products"]}
        assert set(linked) == {shared["a"].id, shared["b"].id}
        assert linked[shared["a"].id]["item_code"] == shared["a"].item_code and linked[shared["a"].id]["active"]


# ───────────────────────────── stock rows ─────────────────────────────
def test_grn_receipt_sets_material_id(db, superclient, world):  # noqa: F811
    item = _link(db, world["products"]["none"])
    r = superclient.post(f"{P}/grn/receive", json=grn_body(world, [
        {"purchasing_order_items_id": world["items"]["none"].id, "quantity": 5}], supplier_invoice_no="INV-S142"))
    assert r.status_code == 201, r.text
    rows = db.query(SalesStock).filter(SalesStock.good_received_note_id == r.json()["grn"]["id"]).all()
    assert rows and all(row.material_id == item.id for row in rows)


# ───────────────────────────── selling through the item ─────────────────────────────
class TestAllocationByItem:
    def test_stock_received_as_a_is_sold_as_b(self, db, superclient, superuser, shared):
        r = superclient.post(S + "/", json=so_body((shared["branch"], shared["customer"], shared["b"]),
                                                  superuser[0].id, qty=2))
        assert r.status_code == 201, r.text
        sold = set(_stock_ids(db, r.json()))
        assert sold <= {u.id for u in shared["units"]} and len(sold) == 2
        assert all(i["product_id"] == shared["b"].id for i in r.json()["items"])

    def test_more_than_the_item_holds_is_refused(self, superclient, superuser, shared):
        r = superclient.post(S + "/", json=so_body((shared["branch"], shared["customer"], shared["b"]),
                                                  superuser[0].id, qty=4))
        assert r.status_code == 400, r.text

    def test_scanned_unit_must_be_stock_of_the_line_item(self, db, superclient, superuser, shared, make_sales_stock):
        foreign = make_sales_stock(branch=shared["branch"])  # another product, no shared item
        body = so_body((shared["branch"], shared["customer"], shared["b"]), superuser[0].id)
        body["items"][0]["barcode"] = shared["units"][0].barcode
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 201, r.text
        assert _stock_ids(db, r.json()) == [shared["units"][0].id]
        body["items"][0]["barcode"] = foreign.barcode
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 201, r.text
        assert _stock_ids(db, r.json()) == [None]  # not this line's item: no unit is taken

    def test_availability_endpoints_show_the_item_quantity(self, superclient, shared):
        bc = shared["branch"].branch_code
        rows = {r["id"]: r for r in superclient.get(S + "/available-products").json()}
        assert rows[shared["a"].id]["available_quantity"] == 3
        assert rows[shared["b"].id]["available_quantity"] == 3
        ids = f"{shared['a'].id},{shared['b'].id}"
        r = superclient.get(f"{P}/orders/available-stock", params={"product_ids": ids, "branch_code": bc})
        assert r.status_code == 200, r.text
        assert r.json() == {str(shared["a"].id): 3, str(shared["b"].id): 3}

    def test_quotation_stock_check_and_partial_so_use_the_item(self, db, shared):
        svc = SalesQuoteService()
        quote = svc.create_quote(db, SalesQuoteCreate(
            quote_type=QuoteTypeEnum.QUOTATION, branch_code=shared["branch"].branch_code,
            customer_id=shared["customer"].id, valid_until=date.today() + timedelta(days=30),
            items=[SalesQuoteItemCreate(product_id=shared["b"].id, quantity=2, selling_price=200.0,
                                        minimum_selling_price=100.0, warrenty_month="0")]))
        quote = svc.resolve_quote_approval(db, quote.id, approve=True, user_id=1)
        check = svc.check_stock_availability(db, quote.id)
        line = check["items"][0]
        assert line["available_quantity"] == 3 and line["is_sufficient"] and line["stock_status"] == "in_stock"
        units = svc._allocate_quote_item_units(db, quote, quote.items[0], 2, quote.items[0].id)
        assert {u.id for u in units} <= {u.id for u in shared["units"]} and len(units) == 2


# ───────────────────────────── warehouse views ─────────────────────────────
def test_on_hand_groups_by_item(db, superclient, shared, make_sales_stock):
    make_sales_stock(product=shared["b"], branch=shared["branch"], location=None)
    loc = shared["units"][0].location_id
    for row in db.query(SalesStock).filter(SalesStock.material_id == shared["item"].id).all():
        row.location_id = loc  # same place, so both products' rows share one grid line
    db.flush()
    r = superclient.get(f"{W}/on-hand", params={"branch_code": shared["branch"].branch_code})
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert len(items) == 1, items
    row = items[0]
    assert row["material_id"] == shared["item"].id and row["item_code"] == shared["item"].item_code
    assert row["item_name"] == shared["item"].name and row["category_name"] == shared["item"].category.name
    assert float(row["on_hand"]) == 4 and row["product_id"] in (shared["a"].id, shared["b"].id)
    k = superclient.get(f"{W}/kpis", params={"branch_code": shared["branch"].branch_code}).json()
    assert k["low_stock_items"] == 1  # one item with 4 available units, not two products
    mv = superclient.get(f"{W}/movements", params={"material_id": shared["item"].id}).json()
    assert mv["total"] >= 4 and all(m["material_id"] == shared["item"].id for m in mv["items"])


def test_sales_stock_paginated_material_filter(superclient, shared, make_sales_stock):
    make_sales_stock(branch=shared["branch"])  # another item at the same branch
    r = superclient.get("/api/v1/inventory/sales-stock/paginated", params={
        "material_id": shared["item"].id, "branch_code": shared["branch"].branch_code})
    assert r.status_code == 200, r.text
    assert {i["id"] for i in r.json()["items"]} == {u.id for u in shared["units"]}
    assert all(i["material_id"] == shared["item"].id for i in r.json()["items"])


def test_product_link_survives_reload(db, shared):
    db.expire_all()
    assert db.get(Product, shared["b"].id).material_item_code == shared["item"].item_code
