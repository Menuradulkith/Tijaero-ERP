"""Central stock phase 1 (2026-11-20): stock_transactions ledger written from sales_stock changes,
unit_cost on stock rows, warehouse-stock KPIs / on-hand / movements API, PO available stock sums lots."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock, StockTransaction
from app.modules.warehouse import schemas as wh
from app.modules.warehouse.service import (
    ItemReceiveNoteService,
    ItemTransferNoteItemService,
    ItemTransferNoteService,
)
from tests.integration.test_workflows.test_grn_receive_cancel import P, _body as grn_body, world  # noqa: F401
from tests.test_sales_orders import S, _body as so_body, shop  # noqa: F401

W = "/api/v1/inventory/warehouse-stock"


def _lines(db, after_id=0, **filters):
    q = db.query(StockTransaction).filter(StockTransaction.id > after_id)
    for k, v in filters.items():
        q = q.filter(getattr(StockTransaction, k) == v)
    return q.order_by(StockTransaction.id).all()


def _last_id(db):
    db.flush()
    return db.query(StockTransaction.id).order_by(StockTransaction.id.desc()).limit(1).scalar() or 0


@pytest.fixture
def lot(db, make_branch, make_location, make_product, make_sales_stock):
    """A none-tracked product with one lot of 10 units at a branch."""
    b = make_branch()
    loc = make_location(branch=b)
    p = make_product()
    p.tracking_type = "none"
    row = make_sales_stock(product=p, branch=b, location=loc)
    row.barcode, row.quantity = None, 10
    db.flush()
    return dict(branch=b, loc=loc, product=p, row=row)


# ───────────────────────────── ledger writing ─────────────────────────────
class TestLedgerWriting:
    def test_grn_receipt_logs_receipts_with_po_line_cost(self, db, superclient, world):  # noqa: F811
        start = _last_id(db)
        r = superclient.post(f"{P}/grn/receive", json=grn_body(world, [
            {"purchasing_order_items_id": world["items"]["none"].id, "quantity": 20},
            {"purchasing_order_items_id": world["items"]["serial"].id,
             "units": [{"barcode": f"SN-LEDG-{start}-1"}, {"barcode": f"SN-LEDG-{start}-2"}]},
        ], supplier_invoice_no=f"INV-LEDG-{start}"))
        assert r.status_code == 201, r.text
        grn = r.json()["grn"]
        lines = _lines(db, start, movement_type="receipt")
        assert sum(l.quantity for l in lines) == 22 and len(lines) == 3
        for line in lines:
            assert line.unit_cost == Decimal("10.00")  # PO price, not the product cost price (100)
            assert line.reference_type == "grn" and line.reference_id == grn["id"]
            assert line.reference_no == grn["good_received_no"]
            assert line.on_hand_change == line.quantity and line.to_status == "available"
        rows = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn["id"]).all()
        assert rows and all(r.unit_cost == Decimal("10.00") for r in rows)

    def test_cash_sale(self, db, superclient, superuser, shop):  # noqa: F811
        start = _last_id(db)
        r = superclient.post(S + "/", json=so_body(shop, superuser[0].id))
        assert r.status_code == 201, r.text
        order = r.json()
        sale = _lines(db, start, product_id=shop[2].id)
        assert [l.movement_type for l in sale] == ["sale"]
        assert sale[0].on_hand_change == -1 and sale[0].quantity == 1
        assert sale[0].from_status == "available" and sale[0].to_status == "sold"
        assert (sale[0].reference_type, sale[0].reference_id) == ("sales_order", order["id"])
        assert sale[0].reference_no == order["invoice_no"]

    def test_credit_order_reserve_approve_and_cancel(self, db, superclient, superuser, shop):  # noqa: F811
        credit = dict(payment_method="credit", cash_amount=0, credit_amount=100.0, override_credit_validation=True)
        start = _last_id(db)
        first = superclient.post(S + "/", json=so_body(shop, superuser[0].id, **credit)).json()
        second = superclient.post(S + "/", json=so_body(shop, superuser[0].id, **credit)).json()
        reserves = _lines(db, start, product_id=shop[2].id)
        assert [(l.movement_type, l.on_hand_change) for l in reserves] == [("reserve", 0), ("reserve", 0)]
        assert [l.reference_id for l in reserves] == [first["id"], second["id"]]

        mid = _last_id(db)
        assert superclient.post(f"{S}/{first['id']}/approve").status_code == 200
        assert superclient.post(f"{S}/{second['id']}/cancel").status_code == 200
        lines = _lines(db, mid, product_id=shop[2].id)
        assert [(l.movement_type, l.on_hand_change, l.reference_id) for l in lines] == [
            ("sale", -1, first["id"]), ("unreserve", 0, second["id"])]

    def test_partial_lot_sale_is_one_line(self, db, superclient, superuser, make_customer, lot):
        start = _last_id(db)
        body = {"branch_code": lot["branch"].branch_code, "customer_id": make_customer().id,
                "sale_rep_id": superuser[0].id, "payment_method": "cash", "cash_amount": 300.0,
                "items": [{"product_id": lot["product"].id, "quantity": 3, "selling_price": 100.0,
                           "minimum_selling_price": 1.0, "warrenty_month": "12"}]}
        r = superclient.post(S + "/", json=body)
        assert r.status_code == 201, r.text
        lines = _lines(db, start, product_id=lot["product"].id)
        assert len(lines) == 1, [(l.movement_type, l.quantity) for l in lines]
        assert lines[0].movement_type == "sale" and lines[0].quantity == 3 and lines[0].on_hand_change == -3
        db.refresh(lot["row"])
        assert lot["row"].quantity == 7

    def test_itn_dispatch_and_receive(self, db, make_branch, make_location, make_user, lot):
        dest = make_branch()
        dest_loc = make_location(branch=dest)
        user, _ = make_user(branches=[lot["branch"], dest])
        svc = ItemTransferNoteService(db)
        note = svc.create_transfer_note(wh.ItemTransferNoteCreate(
            created_date=date.today(), from_location_id=lot["loc"].id, to_location_id=dest_loc.id,
            branch_code=lot["branch"].branch_code), user_id=user.id)
        item = ItemTransferNoteItemService(db).create_item(wh.ItemTransferNoteItemCreate(
            product_id=lot["product"].id, quantity=4, branch_code=lot["branch"].branch_code,
            itemtransfernote_id=note.id))
        start = _last_id(db)
        svc.approve_transfer_note(note.id, user_id=user.id)
        svc.dispatch_transfer_note(note.id)
        ItemReceiveNoteService(db).receive_items(note.id, wh.ReceiveItemsRequest(
            item_ids=[item.id], received_user_id=user.id))
        lines = _lines(db, start, product_id=lot["product"].id)
        assert [l.movement_type for l in lines] == ["transfer_pending", "transfer_out", "transfer_in"]
        assert all(l.quantity == 4 for l in lines)
        assert [l.on_hand_change for l in lines] == [0, -4, 4]
        assert lines[1].branch_code == lot["branch"].branch_code and lines[1].from_location_id == lot["loc"].id
        assert lines[2].branch_code == dest.branch_code and lines[2].to_location_id == dest_loc.id
        assert all(l.reference_type == "item_transfer_note" and l.reference_id == note.id for l in lines)
        assert lines[0].reference_no == note.item_transfer_note

    def test_status_patch_damage(self, db, superclient, make_sales_stock):
        unit = make_sales_stock()
        start = _last_id(db)
        r = superclient.patch(f"/api/v1/inventory/sales-stock/{unit.id}/status", params={"status": "damaged"})
        assert r.status_code == 200, r.text
        lines = _lines(db, start, stock_id=unit.id)
        assert [(l.movement_type, l.from_status, l.to_status, l.on_hand_change) for l in lines] == [
            ("damage", "available", "damaged", 0)]
        assert lines[0].reference_type == "manual"

    def test_new_stock_row_gets_unit_cost_and_receipt_line(self, db, make_sales_stock):
        unit = make_sales_stock()
        assert unit.unit_cost == Decimal("100.00")  # the fixture's PO line price
        line = _lines(db, 0, stock_id=unit.id)
        assert [l.movement_type for l in line] == ["receipt"] and line[0].on_hand_change == 1


# ───────────────────────────── API ─────────────────────────────
class TestWarehouseStockApi:
    def _seed(self, db, make_sales_stock, lot):
        """lot: 10 available; add a reserved unit, a damaged unit and an expired lot of 2."""
        p, b, loc = lot["product"], lot["branch"], lot["loc"]
        lot["row"].unit_cost = Decimal("10.00")
        r1 = make_sales_stock(product=p, branch=b, location=loc, status=StockStatus.RESERVED)
        r2 = make_sales_stock(product=p, branch=b, location=loc, status=StockStatus.DAMAGED)
        r3 = make_sales_stock(product=p, branch=b, location=loc)
        r3.barcode, r3.quantity, r3.expiry_date = None, 2, date.today() - timedelta(days=1)
        for r in (r1, r2):
            r.barcode = None
        sold = make_sales_stock(product=p, branch=b, location=loc, status=StockStatus.SOLD, is_active=False)
        assert sold
        db.flush()
        return p, b

    def test_kpis_and_on_hand_match_rows(self, db, superclient, make_sales_stock, lot):
        p, b = self._seed(db, make_sales_stock, lot)
        k = superclient.get(f"{W}/kpis", params={"branch_code": b.branch_code}).json()
        assert Decimal(str(k["on_hand_qty"])) == 14 and Decimal(str(k["available_qty"])) == 12
        assert Decimal(str(k["reserved_qty"])) == 1 and Decimal(str(k["damaged_qty"])) == 1
        assert Decimal(str(k["expired_qty"])) == 2 and Decimal(str(k["in_transit_qty"])) == 0
        # 10 x 10 (lot) + 4 units at the fixture's PO price 100
        assert Decimal(str(k["stock_value"])) == Decimal("500.00")

        r = superclient.get(f"{W}/on-hand", params={"branch_code": b.branch_code, "q": p.item_code})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["total"] == 1 and data["page"] == 1 and data["pages"] == 1
        it = data["items"][0]
        assert it["product_id"] == p.id and it["location_id"] == lot["loc"].id
        assert Decimal(str(it["on_hand"])) == 14 and Decimal(str(it["available"])) == 12
        assert Decimal(str(it["value"])) == Decimal("500.00") and it["ageing_days"] is not None
        assert it["nearest_expiry"] == str(date.today() - timedelta(days=1))

        expired = superclient.get(f"{W}/on-hand", params={"branch_code": b.branch_code, "bucket": "expired"}).json()
        assert p.id in {i["product_id"] for i in expired["items"]}
        frozen = superclient.get(f"{W}/on-hand", params={"branch_code": b.branch_code, "bucket": "frozen"}).json()
        assert frozen["total"] == 0
        assert superclient.get(f"{W}/on-hand", params={"bucket": "bogus"}).status_code == 422

    def test_low_stock_bucket(self, db, superclient, make_sales_stock, make_product, make_branch):
        b = make_branch()
        p = make_product()
        make_sales_stock(product=p, branch=b)
        k = superclient.get(f"{W}/kpis", params={"branch_code": b.branch_code}).json()
        assert k["low_stock_items"] == 1
        low = superclient.get(f"{W}/on-hand", params={"branch_code": b.branch_code, "bucket": "low_stock"}).json()
        assert [i["product_id"] for i in low["items"]] == [p.id]

    def test_movements_filters_scoping_and_export(self, db, api, superclient, superuser, make_user,
                                                  make_branch, shop):  # noqa: F811
        r = superclient.post(S + "/", json=so_body(shop, superuser[0].id))
        assert r.status_code == 201, r.text
        order = r.json()
        b, _c, p = shop

        by_product = superclient.get(f"{W}/movements", params={"product_id": p.id}).json()
        assert by_product["total"] == 4  # 3 receipts + 1 sale
        assert {i["movement_type"] for i in by_product["items"]} == {"receipt", "sale"}
        assert by_product["items"][0]["movement_type"] == "sale"  # newest first

        sales = superclient.get(f"{W}/movements", params={"product_id": p.id, "movement_type": "sale"}).json()
        assert sales["total"] == 1
        m = sales["items"][0]
        assert m["item_code"] == p.item_code and float(m["on_hand_change"]) == -1
        assert m["reference_no"] == order["invoice_no"] and m["branch_code"] == b.branch_code

        by_ref = superclient.get(f"{W}/movements", params={
            "reference_type": "sales_order", "reference_id": order["id"]}).json()
        assert by_ref["total"] == 1

        csv = superclient.get(f"{W}/movements/export-csv", params={"product_id": p.id})
        assert csv.status_code == 200 and "text/csv" in csv.headers["content-type"]
        assert csv.text.count("\n") == 5 and order["invoice_no"] in csv.text

        _, tok = make_user(permissions=[("sales_stock", "view")], branches=[make_branch()])
        other = api(tok)
        assert other.get(f"{W}/movements", params={"product_id": p.id}).json()["total"] == 0
        assert other.get(f"{W}/on-hand", params={"q": p.item_code}).json()["total"] == 0
        assert other.get(f"{W}/kpis", params={"branch_code": b.branch_code}).status_code == 403
        assert other.get(f"{W}/movements", params={"branch_code": b.branch_code}).status_code == 403

    def test_needs_sales_stock_view(self, api, make_user):
        _, tok = make_user(permissions=[("hr_dashboard", "view")])
        c = api(tok)
        for path in ("/kpis", "/on-hand", "/movements", "/movements/export-csv"):
            assert c.get(W + path).status_code == 403, path


# ───────────────────────────── other endpoints ─────────────────────────────
def test_sales_stock_paginated_on_hand_filter(db, superclient, make_sales_stock, make_product, make_branch):
    b, p = make_branch(), make_product()
    live = make_sales_stock(product=p, branch=b)
    sold = make_sales_stock(product=p, branch=b, status=StockStatus.SOLD, is_active=False)
    transit = make_sales_stock(product=p, branch=b, status=StockStatus.IN_TRANSIT)
    url = "/api/v1/inventory/sales-stock/paginated"
    every = {i["id"] for i in superclient.get(url, params={"product_id": p.id}).json()["items"]}
    assert every == {live.id, sold.id, transit.id}
    on_hand = {i["id"] for i in superclient.get(url, params={"product_id": p.id, "on_hand": True}).json()["items"]}
    assert on_hand == {live.id, transit.id}


def test_po_available_stock_sums_lot_quantities(db, superclient, lot):
    r = superclient.get(f"{P}/orders/available-stock", params={
        "product_ids": str(lot["product"].id), "branch_code": lot["branch"].branch_code})
    assert r.status_code == 200, r.text
    assert r.json() == {str(lot["product"].id): 10}
