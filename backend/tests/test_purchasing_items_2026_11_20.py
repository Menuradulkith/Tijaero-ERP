"""Central stock phase 3 (2026-11-20): purchasing buys Item Catalog items.

PO lines carry material_id (price / MOQ from the item's supplier link, tax from the item), GRN stock
is the line's item (product_id = the item's single linked product, else NULL), returns / supplier
invoices / transfers carry the item, the supplier-side price list edits material_suppliers, and old
product-based POs still read and receive."""
from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock, StockTransaction
from app.modules.materials.models import MaterialSupplier
from app.modules.purchasing.models import (
    PurchasingOrder, PurchasingOrderItems, PurchasingReturnItems,
)
from app.modules.warehouse.models import ItemTransferNoteItems
from tests.conftest import _unique

P = "/api/v1/purchasing"
W = "/api/v1/warehouse"
WS = "/api/v1/inventory/warehouse-stock"
A = "/api/v1/common/approvals"
Q = "/api/v1/sales/quotes"


@pytest.fixture
def w(db, make_branch, make_location, make_supplier):
    branch = make_branch()
    return dict(branch=branch, location=make_location(branch=branch), supplier=make_supplier())


def _po_body(w, lines, **over):
    body = {
        "branch_code": w["branch"].branch_code,
        "purchasing_order_date": date.today().isoformat(),
        "good_received_note_date": (date.today() + timedelta(days=3)).isoformat(),
        "first_suppliers_id": w["supplier"].id,
        "items": lines,
    }
    body.update(over)
    return body


def _create_po(c, w, lines, approve=True, **over):
    r = c.post(f"{P}/orders", json=_po_body(w, lines, **over))
    assert r.status_code == 201, r.text
    po = r.json()
    if approve:
        assert c.post(f"{A}/{po['approval_id']}/approve", json={}).status_code == 200
    return po


def _receive(c, w, po, lines):
    r = c.post(f"{P}/grn/receive", json={
        "good_received_date": date.today().isoformat(), "branch_code": w["branch"].branch_code,
        "good_received_locations_id": w["location"].id, "purchasingorders_id": po["id"], "lines": lines,
    })
    assert r.status_code == 201, r.text
    return r.json()["grn"]


# ───────────────────────────── PO lines on items ─────────────────────────────
class TestPurchaseOrderLines:
    def test_material_line_takes_price_and_tax_from_the_item(self, db, superclient, w, make_purchasable_item):
        item = make_purchasable_item(w["supplier"], 250, tax_rate=8)
        po = _create_po(superclient, w, [{"material_id": item.id, "quantity": 4}], approve=False)
        line = po["items"][0]
        assert line["material_id"] == item.id and line["product_id"] is None
        assert (line["material_item_code"], line["material_name"], line["unit_of_measure"]) == (item.item_code, item.name, "pcs")
        assert Decimal(str(line["unit_price"])) == Decimal("250.00") and Decimal(str(line["tax_rate"])) == Decimal("8.00")
        assert Decimal(str(po["tax_amount"])) == Decimal("80.00")
        # an explicit price is kept
        po2 = _create_po(superclient, w, [{"material_id": item.id, "quantity": 1, "unit_price": 240}], approve=False)
        assert Decimal(str(po2["items"][0]["unit_price"])) == Decimal("240.00")
        # the GET carries the item fields too
        got = superclient.get(f"{P}/orders/{po['id']}").json()
        assert got["items"][0]["material_name"] == item.name

    def test_product_id_on_a_new_line_is_refused(self, superclient, w, make_product):
        r = superclient.post(f"{P}/orders", json=_po_body(w, [{"product_id": make_product().id, "quantity": 1,
                                                                "unit_price": 10, "warrenty_month": "0"}]))
        assert r.status_code == 422 and "material_id" in r.text

    def test_item_without_a_link_to_the_supplier_is_refused(self, superclient, w, make_supplier, make_purchasable_item):
        item = make_purchasable_item(make_supplier(), 100)  # sold by another supplier only
        r = superclient.post(f"{P}/orders", json=_po_body(w, [{"material_id": item.id, "quantity": 1}]))
        assert r.status_code == 400 and "Suppliers tab" in r.json()["detail"]

    def test_inactive_link_counts_as_no_link(self, db, superclient, w, make_purchasable_item):
        item = make_purchasable_item(w["supplier"], 100)
        db.query(MaterialSupplier).filter(MaterialSupplier.material_id == item.id).update({"active": False})
        db.flush()
        r = superclient.post(f"{P}/orders", json=_po_body(w, [{"material_id": item.id, "quantity": 1}]))
        assert r.status_code == 400

    def test_minimum_order_quantity_of_the_link(self, superclient, w, make_purchasable_item):
        item = make_purchasable_item(w["supplier"], 100, moq=10)
        r = superclient.post(f"{P}/orders", json=_po_body(w, [{"material_id": item.id, "quantity": 4},
                                                               {"material_id": item.id, "quantity": 5}]))
        assert r.status_code == 400 and "minimum order quantity of 10" in r.json()["detail"]
        _create_po(superclient, w, [{"material_id": item.id, "quantity": 4}, {"material_id": item.id, "quantity": 6}],
                   approve=False)

    def test_update_lines_use_items(self, superclient, w, make_purchasable_item):
        a, b = make_purchasable_item(w["supplier"], 100), make_purchasable_item(w["supplier"], 50)
        po = _create_po(superclient, w, [{"material_id": a.id, "quantity": 1}], approve=False)
        r = superclient.patch(f"{P}/orders/{po['id']}", json={"items": [{"material_id": b.id, "quantity": 3}]})
        assert r.status_code == 200, r.text
        got = superclient.get(f"{P}/orders/{po['id']}").json()
        assert [(i["material_id"], i["quantity"], Decimal(str(i["unit_price"]))) for i in got["items"]] == [(b.id, 3, Decimal("50.00"))]
        r = superclient.patch(f"{P}/orders/{po['id']}", json={"items": [{"product_id": 1, "quantity": 1, "unit_price": 1}]})
        assert r.status_code == 422

    def test_batch_create_with_items(self, superclient, w, make_supplier, make_purchasable_item):
        other = make_supplier()
        a, b = make_purchasable_item(w["supplier"], 10), make_purchasable_item(other, 20)
        r = superclient.post(f"{P}/orders/batch", json={"groups": [
            _po_body(w, [{"material_id": a.id, "quantity": 1}]),
            _po_body(w, [{"material_id": b.id, "quantity": 2}], first_suppliers_id=other.id),
        ]})
        assert r.status_code == 201, r.text
        assert sorted(o["items"][0]["material_id"] for o in r.json()["orders"]) == sorted([a.id, b.id])


# ───────────────────────────── GRN → item stock ─────────────────────────────
class TestReceipt:
    def test_item_with_one_product_files_stock_under_it(self, db, superclient, w, make_product, make_purchasable_item):
        product = make_product()
        item = make_purchasable_item(w["supplier"], 75, product=product, tracking_type="none")
        po = _create_po(superclient, w, [{"material_id": item.id, "quantity": 6}])
        grn = _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"], "quantity": 6}])
        rows = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).all()
        assert [(r.material_id, r.product_id, r.quantity, r.unit_cost) for r in rows] == [(item.id, product.id, 6, Decimal("75.00"))]
        tx = db.query(StockTransaction).filter(StockTransaction.stock_id == rows[0].id).all()
        assert [(t.movement_type, t.material_id, int(t.quantity), t.unit_cost) for t in tx] == [("receipt", item.id, 6, Decimal("75.00"))]
        assert superclient.get(f"{P}/orders/{po['id']}").json()["status"] == "completed"

    def test_unlinked_raw_material_is_item_only_stock_end_to_end(self, db, superclient, w, make_purchasable_item):
        item = make_purchasable_item(w["supplier"], 12, tracking_type="batch")
        po = _create_po(superclient, w, [{"material_id": item.id, "quantity": 40}])
        grn = _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"], "quantity": 40,
                                              "batch_no": "RM-1", "expiry_date": (date.today() + timedelta(days=90)).isoformat()}])
        row = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).one()
        assert (row.material_id, row.product_id, row.quantity, row.batch_no) == (item.id, None, 40, "RM-1")
        # warehouse on-hand shows it by item
        r = superclient.get(f"{WS}/on-hand", params={"branch_code": w["branch"].branch_code, "q": item.item_code})
        assert r.status_code == 200, r.text
        got = [i for i in r.json()["items"] if i["material_id"] == item.id]
        assert got and got[0]["on_hand"] == 40 and got[0]["item_name"] == item.name and got[0]["product_id"] is None
        # GRN detail endpoints carry the item
        items = superclient.get(f"{P}/grn/{grn['id']}/items").json()
        assert items and all(i["material_id"] == item.id and i["product_name"] == item.name for i in items)
        # sales-stock barcode / list serialisation does not crash on product NULL
        r = superclient.get(f"{WS}/movements", params={"material_id": item.id})
        assert r.status_code == 200 and r.json()["items"][0]["item_name"] == item.name

    def test_serial_item_by_barcode(self, db, superclient, w, make_purchasable_item):
        item = make_purchasable_item(w["supplier"], 500, tracking_type="serial")
        po = _create_po(superclient, w, [{"material_id": item.id, "quantity": 2}])
        codes = [_unique("SN"), _unique("SN")]
        grn = _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"],
                                              "units": [{"barcode": c} for c in codes]}])
        rows = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).all()
        assert sorted(r.barcode for r in rows) == sorted(codes) and all(r.material_id == item.id for r in rows)

    def test_tolerance_and_tracking_come_from_the_item(self, db, superclient, w, make_purchasable_item):
        item = make_purchasable_item(w["supplier"], 5, tracking_type="none")
        item.over_receipt_tolerance_pct = 10
        db.flush()
        po = _create_po(superclient, w, [{"material_id": item.id, "quantity": 10}])
        line = po["items"][0]["id"]
        r = superclient.post(f"{P}/grn/receive", json={
            "good_received_date": date.today().isoformat(), "branch_code": w["branch"].branch_code,
            "good_received_locations_id": w["location"].id, "purchasingorders_id": po["id"],
            "lines": [{"purchasing_order_items_id": line, "quantity": 12}]})
        assert r.status_code == 400 and item.name in r.json()["detail"]
        _receive(superclient, w, po, [{"purchasing_order_items_id": line, "quantity": 11}])


# ───────────────────────────── returns / invoices / landed cost ─────────────────────────────
class TestDownstreamDocuments:
    def _received(self, superclient, w, make_purchasable_item, qty=10):
        item = make_purchasable_item(w["supplier"], 20, tracking_type="none")
        po = _create_po(superclient, w, [{"material_id": item.id, "quantity": qty}])
        grn = _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"], "quantity": qty}])
        return item, po, grn

    def test_purchase_return_of_item_stock(self, db, superclient, w, make_purchasable_item):
        item, _po, grn = self._received(superclient, w, make_purchasable_item)
        lot = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).one()
        r = superclient.post(f"{P}/returns/validate-lot", json={"grn_id": grn["id"], "sales_stock_id": lot.id, "quantity": 3,
                                                               "branch_code": w["branch"].branch_code})
        assert r.status_code == 200 and r.json()["valid"] and r.json()["material_id"] == item.id, r.text
        r = superclient.post(f"{P}/returns", json={
            "branch_code": w["branch"].branch_code, "goodreceivednote_id": grn["id"], "reason": "Quality issue",
            "items": [{"material_id": item.id, "sales_stock_id": lot.id, "quantity": 3,
                       "purchasing_price": 20, "return_price": 20}]})
        assert r.status_code == 201, r.text
        ri = db.query(PurchasingReturnItems).filter(PurchasingReturnItems.purchasingreturn_id == r.json()["id"]).one()
        assert (ri.material_id, ri.product_id, ri.quantity) == (item.id, None, 3)
        got = superclient.get(f"{P}/returns/{r.json()['id']}").json()
        assert got["items"][0]["material_name"] == item.name and got["items"][0]["product_name"] == item.name
        db.refresh(lot)
        assert lot.quantity == 7

    def test_supplier_invoice_from_grn_carries_the_item(self, db, superclient, w, make_purchasable_item):
        item, po, grn = self._received(superclient, w, make_purchasable_item)
        rows = superclient.get(f"{P}/invoices/supplier/{w['supplier'].id}/invoiceable-grns").json()
        row = next(r for r in rows if r["grn_id"] == grn["id"])
        detail = row["products"][0]
        assert (detail["material_id"], detail["material_name"], detail["product_id"], detail["quantity"]) == (item.id, item.name, None, 10)
        body = {
            "supplier_invoice_no": _unique("SINV"), "supplier_invoice_date": date.today().isoformat(),
            "supplier_id": w["supplier"].id, "branch_code": w["branch"].branch_code,
            "received_date": date.today().isoformat(), "due_date": (date.today() + timedelta(days=30)).isoformat(),
            "items": [{"grn_id": grn["id"], "purchasing_order_id": po["id"], "material_id": item.id, "quantity": 10,
                       "unit_price": 20, "line_total": 200}],
            "subtotal": 200, "total_amount": 200,
        }
        r = superclient.post(f"{P}/invoices", json=body)
        assert r.status_code in (200, 201), r.text
        line = r.json()["items"][0]
        assert (line["material_id"], line["material_name"], line["product_name"]) == (item.id, item.name, item.name)
        # over-invoicing the item is refused (three-way match by item)
        body["supplier_invoice_no"] = _unique("SINV")
        body["items"][0].update(quantity=1, line_total=20)
        body.update(subtotal=20, total_amount=20)
        r = superclient.post(f"{P}/invoices", json=body)
        assert r.status_code == 400, r.text

    def test_landed_cost_on_item_lines(self, superclient, w, make_purchasable_item):
        item, _po, grn = self._received(superclient, w, make_purchasable_item)
        r = superclient.post(f"{P}/grn/{grn['id']}/landed-costs", json={
            "charge_type": "freight", "amount": 50, "allocation_basis": "quantity", "payment_method": "cash",
            "voucher_date": date.today().isoformat()})
        assert r.status_code in (200, 201), r.text
        summary = superclient.get(f"{P}/grn/{grn['id']}/landed-costs").json()
        line = summary["lines"][0]
        assert line["material_id"] == item.id and line["product_name"] == item.name
        assert Decimal(str(line["landed_unit_cost"])) == Decimal("25.00")


# ───────────────────────────── supplier price list ─────────────────────────────
class TestSupplierItems:
    def test_list_create_update_and_one_preferred_per_item(self, db, superclient, w, make_supplier, make_purchasable_item):
        item = make_purchasable_item(make_supplier(), 90, preferred=True)  # another supplier is preferred
        r = superclient.post(f"{P}/suppliers/{w['supplier'].id}/items",
                             json={"material_id": item.id, "cost_price": 80, "supplier_sku": "SKU-1",
                                   "minimum_order_qty": 5, "is_preferred": True})
        assert r.status_code == 201, r.text
        link = r.json()
        assert (link["material_id"], link["material_item_code"], link["material_name"], link["unit_of_measure"]) == \
            (item.id, item.item_code, item.name, "pcs")
        prefs = db.query(MaterialSupplier).filter(MaterialSupplier.material_id == item.id,
                                                  MaterialSupplier.is_preferred.is_(True)).all()
        assert [p.supplier_id for p in prefs] == [w["supplier"].id]
        assert superclient.post(f"{P}/suppliers/{w['supplier'].id}/items",
                                json={"material_id": item.id, "cost_price": 1}).status_code == 400  # duplicate
        assert superclient.post(f"{P}/suppliers/{w['supplier'].id}/items",
                                json={"material_id": item.id, "cost_price": 0}).status_code == 422
        r = superclient.put(f"{P}/suppliers/{w['supplier'].id}/items/{link['id']}", json={"cost_price": 85, "active": False})
        assert r.status_code == 200 and Decimal(str(r.json()["cost_price"])) == Decimal("85.00") and not r.json()["active"]
        rows = superclient.get(f"{P}/suppliers/{w['supplier'].id}/items").json()
        assert [(x["id"], x["material_name"]) for x in rows] == [(link["id"], item.name)]
        assert superclient.get(f"{P}/suppliers/{w['supplier'].id}/items", params={"active_only": True}).json() == []
        # another supplier's link cannot be edited through this supplier
        other_link = db.query(MaterialSupplier).filter(MaterialSupplier.material_id == item.id,
                                                       MaterialSupplier.supplier_id != w["supplier"].id).one()
        assert superclient.put(f"{P}/suppliers/{w['supplier'].id}/items/{other_link.id}",
                               json={"cost_price": 1}).status_code == 404


# ───────────────────────────── PO wizard helpers ─────────────────────────────
def test_available_stock_and_in_transit_by_item(db, superclient, w, make_purchasable_item):
    a = make_purchasable_item(w["supplier"], 10, tracking_type="none")
    b = make_purchasable_item(w["supplier"], 10, tracking_type="none")
    po = _create_po(superclient, w, [{"material_id": a.id, "quantity": 30}, {"material_id": b.id, "quantity": 5}])
    line_a = next(i["id"] for i in po["items"] if i["material_id"] == a.id)
    _receive(superclient, w, po, [{"purchasing_order_items_id": line_a, "quantity": 20}])
    bc = w["branch"].branch_code
    r = superclient.get(f"{P}/orders/available-stock", params={"material_ids": f"{a.id},{b.id}", "branch_code": bc})
    assert r.status_code == 200 and r.json() == {str(a.id): 20}, r.text
    r = superclient.get(f"{P}/orders/available-stock?material_ids={a.id}&material_ids={b.id}&branch_code={bc}")
    assert r.json() == {str(a.id): 20}
    r = superclient.get(f"{P}/orders/in-transit", params={"material_ids": f"{a.id},{b.id}", "branch_code": bc})
    assert r.json() == {str(a.id): 10, str(b.id): 5}
    assert superclient.get(f"{P}/orders/available-stock", params={"branch_code": bc}).status_code == 422


# ───────────────────────────── procurement queue ─────────────────────────────
def test_queue_to_material_po_line_and_grn_reserves_for_the_quote(db, superclient, w, make_customer, make_product,
                                                                 make_purchasable_item):
    product = make_product()
    item = make_purchasable_item(w["supplier"], 100, product=product, tracking_type="none")
    r = superclient.post(f"{Q}/", json={
        "branch_code": w["branch"].branch_code, "customer_id": make_customer().id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(),
        "items": [{"product_id": product.id, "quantity": 5, "selling_price": 300, "minimum_selling_price": 100,
                   "warrenty_month": "12"}]})
    assert r.status_code == 201, r.text
    quote = r.json()
    assert superclient.post(f"{A}/{quote['approval_id']}/approve", json={}).status_code == 200
    qi = superclient.get(f"{Q}/{quote['id']}").json()["items"][0]["id"]
    r = superclient.post(f"{P}/procurement-queue", json={"items": [
        {"quote_item_id": qi, "supplier_id": w["supplier"].id, "quantity": 5, "unit_price": 100}]})
    assert r.status_code == 201, r.text
    row = next(x for x in r.json() if x["quote_item_id"] == qi)
    assert (row["material_id"], row["material_item_code"], row["material_name"]) == (item.id, item.item_code, item.name)
    # the TOP page turns the row into a material PO line
    r = superclient.post(f"{P}/orders/batch", json={"groups": [_po_body(w, [
        {"material_id": row["material_id"], "quantity": 5, "unit_price": 100, "quote_item_id": qi}],
        sales_quote_id=quote["id"])]})
    assert r.status_code == 201, r.text
    po = r.json()["orders"][0]
    assert po["items"][0]["material_id"] == item.id and po["items"][0]["quote_item_id"] == qi
    assert superclient.post(f"{A}/{po['approval_id']}/approve", json={}).status_code == 200
    grn = _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"], "quantity": 5}])
    rows = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).all()
    assert sum(r.quantity for r in rows if r.status == StockStatus.RESERVED and r.reserved_for_quote_item_id == qi) == 5
    assert all(r.material_id == item.id and r.product_id == product.id for r in rows)


def test_quote_line_must_buy_the_quoted_products_item(db, superclient, w, make_customer, make_product,
                                                      make_purchasable_item):
    product = make_product()
    make_purchasable_item(w["supplier"], 100, product=product)
    other = make_purchasable_item(w["supplier"], 100)
    r = superclient.post(f"{Q}/", json={
        "branch_code": w["branch"].branch_code, "customer_id": make_customer().id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(),
        "items": [{"product_id": product.id, "quantity": 2, "selling_price": 300, "minimum_selling_price": 100,
                   "warrenty_month": "12"}]})
    quote = r.json()
    assert superclient.post(f"{A}/{quote['approval_id']}/approve", json={}).status_code == 200
    qi = superclient.get(f"{Q}/{quote['id']}").json()["items"][0]["id"]
    r = superclient.post(f"{P}/orders", json=_po_body(w, [{"material_id": other.id, "quantity": 2, "quote_item_id": qi}],
                                                      sales_quote_id=quote["id"]))
    assert r.status_code == 400 and "different item" in r.json()["detail"]


# ───────────────────────────── transfers of item-only stock ─────────────────────────────
def test_itn_moves_an_item_only_lot(db, superclient, w, make_branch, make_location, make_purchasable_item):
    item = make_purchasable_item(w["supplier"], 8, tracking_type="batch")
    po = _create_po(superclient, w, [{"material_id": item.id, "quantity": 30}])
    _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"], "quantity": 30, "batch_no": "IT-1"}])
    dest_branch = make_branch()
    dest = make_location(branch=dest_branch)
    r = superclient.post(f"{W}/transfer-notes/validate-lot", json={"material_id": item.id, "quantity": 12,
                                                                 "from_location_id": w["location"].id})
    assert r.status_code == 200 and r.json()["valid"] and r.json()["available_quantity"] == 30, r.text
    r = superclient.post(f"{W}/transfer-notes", json={
        "created_date": date.today().isoformat(), "from_location_id": w["location"].id, "to_location_id": dest.id,
        "branch_code": w["branch"].branch_code,
        "items": [{"material_id": item.id, "quantity": 12, "branch_code": w["branch"].branch_code}]})
    assert r.status_code == 201, r.text
    note = r.json()
    lines = superclient.get(f"{W}/transfer-notes/{note['id']}/items").json()
    assert [(l["material_id"], l["product_id"], l["material_name"]) for l in lines] == [(item.id, None, item.name)]
    assert superclient.post(f"{A}/{note['approval_id']}/approve", json={}).status_code == 200
    r = superclient.post(f"{W}/transfer-notes/{note['id']}/dispatch")
    assert r.status_code == 200, r.text
    line = db.query(ItemTransferNoteItems).filter(ItemTransferNoteItems.itemtransfernote_id == note["id"]).one()
    r = superclient.post(f"{W}/transfer-notes/{note['id']}/receive-items", json={"item_ids": [line.id]})
    assert r.status_code == 200 and r.json()["all_received"], r.text
    moved = db.get(SalesStock, line.sales_stock_id)
    assert (moved.material_id, moved.product_id, moved.quantity, moved.branch_code, moved.status) == \
        (item.id, None, 12, dest_branch.branch_code, StockStatus.AVAILABLE)


# ───────────────────────────── old product-based documents ─────────────────────────────
def test_old_product_po_still_reads_and_receives(db, superclient, w, make_product):
    product = make_product()
    product.tracking_type = "none"
    po = PurchasingOrder(
        purchasing_order_no=_unique("PO"), branch_code=w["branch"].branch_code, payment_method="credit",
        purchasing_order_date=date.today(), good_received_note_date=date.today(), created_date=date.today(),
        first_suppliers_id=w["supplier"].id, added_date=datetime.utcnow(), status="approved",
    )
    db.add(po)
    db.flush()
    line = PurchasingOrderItems(quantity=4, unit_price=33, warrenty_month="0", created_date=date.today(),
                                product_id=product.id, purchasingorders_id=po.id, added_date=datetime.utcnow())
    db.add(line)
    db.flush()
    got = superclient.get(f"{P}/orders/{po.id}").json()
    assert (got["items"][0]["product_id"], got["items"][0]["product_name"], got["items"][0]["material_id"]) == \
        (product.id, product.name, None)
    grn = _receive(superclient, w, {"id": po.id}, [{"purchasing_order_items_id": line.id, "quantity": 4}])
    row = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).one()
    assert (row.product_id, row.quantity, row.unit_cost) == (product.id, 4, Decimal("33.00"))


def test_product_suppliers_come_from_its_item(superclient, make_supplier, make_purchasable_item):
    """The sales-side supplier picker (quote -> procurement) reads /products/{id}/suppliers:
    for a product linked to an item it must show the item's supplier prices."""
    import uuid
    from tests.conftest import product_master_ids
    item = make_purchasable_item(make_supplier(), cost=55)
    material_id = item.id
    links = superclient.get(f"/api/v1/materials/items/{material_id}/suppliers").json()
    assert links, "fixture item should have a supplier link"
    cat = superclient.post("/api/v1/inventory/categories/", json={"name": f"QA PS Cat {uuid.uuid4().hex[:6]}"}).json()
    brand = superclient.post("/api/v1/inventory/brands/", json={"brand_name": f"QA PS Br {uuid.uuid4().hex[:6]}"}).json()
    r = superclient.post("/api/v1/inventory/products/", json={
        "name": f"QA PS Prod {uuid.uuid4().hex[:6]}", "tracking_type": "none", "cost_price": 10, "selling_price": 20,
        "category_id": cat["id"], "items_brand_id": brand["id"], "material_id": material_id,
        **product_master_ids(superclient),
    })
    assert r.status_code == 201, r.text
    rows = superclient.get(f"/api/v1/inventory/products/{r.json()['id']}/suppliers").json()
    assert {x["supplier_id"] for x in rows} == {x["supplier_id"] for x in links}
    assert all(x["product_id"] == r.json()["id"] for x in rows)
