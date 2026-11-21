"""Central stock phase 5 (2026-11-20): costing from the stock row cost and stock counts.

Receipt cost (PO price; POs are base currency only), landed cost onto held rows, weighted
average per item, issue cost (WAC average / FIFO lot cost; LIFO = FIFO) for sales COGS, returns,
damage GL, manufacturing issues and valuation; FIFO / FEFO picking; the stock count document."""
from datetime import date, datetime, timedelta
from decimal import Decimal as D

import pytest

from app.common.enums import StockStatus
from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntryLine
from app.modules.inventory import costing
from app.modules.inventory.lots import split_lot
from app.modules.inventory.models import SalesStock, StockCount, StockCountLine, StockTransaction
from app.modules.sales.models import InvoiceItems
from tests.conftest import purchasable_item
from tests.integration.test_workflows.test_grn_receive_cancel import P, _body as grn_body, world  # noqa: F401

S = "/api/v1/sales"
W = "/api/v1/inventory/warehouse-stock"
C = "/api/v1/inventory/stock-counts"


# ───────────────────────────── helpers ─────────────────────────────
def _je(db, reference_type, reference_id):
    rows = (db.query(JournalEntryLine, ChartOfAccounts.account_code)
            .join(ChartOfAccounts, ChartOfAccounts.id == JournalEntryLine.account_id)
            .filter(JournalEntryLine.reference_type == reference_type, JournalEntryLine.reference_id == reference_id)
            .all())
    return [(code, D(str(l.debit_amount or 0)), D(str(l.credit_amount or 0))) for l, code in rows]


def _sum(lines, code, side):
    return sum((l[1] if side == "dr" else l[2]) for l in lines if l[0] == code)


_SOURCE = {}


def _stock(db, item, branch, loc, qty, cost, *, product=None, batch=None, expiry=None, barcode=None, days_ago=0):
    """A stock row of ``item`` (received on a throwaway GRN line: every row needs a source)."""
    src = _SOURCE["row"]
    row = SalesStock(
        good_received_note_id=src.good_received_note_id, purchasing_order_items_id=src.purchasing_order_items_id,
        material_id=item.id, product_id=product.id if product is not None else None,
        quantity=1 if barcode else qty, unit_cost=cost, batch_no=batch, expiry_date=expiry, barcode=barcode,
        branch_code=branch.branch_code, location_id=loc.id, status=StockStatus.AVAILABLE.value, is_active=True,
        added_date=datetime.utcnow() - timedelta(days=days_ago),
    )
    db.add(row)
    db.flush()
    return row


@pytest.fixture
def env(db, make_branch, make_location, make_supplier, make_product, make_customer, make_sales_stock):
    _SOURCE["row"] = make_sales_stock()  # in a branch of its own; lends its GRN line to _stock rows
    b = make_branch()
    loc = make_location(branch=b)
    sup = make_supplier()

    def item(cost=10, *, method="fifo", issuing="fifo", tracking="none", product=False, name=None):
        p = None
        if product:
            p = make_product(cost_price=cost)
            p.tracking_type = tracking
            mat = purchasable_item(db, sup, cost, product=p, tracking_type=tracking)
        else:
            mat = purchasable_item(db, sup, cost, tracking_type=tracking, name=name)
        mat.inventory_valuation_method = method
        mat.stock_issuing_method = issuing
        db.flush()
        return mat, p

    return dict(branch=b, loc=loc, supplier=sup, item=item, customer=make_customer())


def _sell(superclient, superuser, env, product, qty, price=100.0):
    body = {"branch_code": env["branch"].branch_code, "customer_id": env["customer"].id,
            "sale_rep_id": superuser[0].id, "payment_method": "cash", "cash_amount": price * qty,
            "items": [{"product_id": product.id, "quantity": qty, "selling_price": price,
                       "minimum_selling_price": 1.0, "warrenty_month": "12"}]}
    r = superclient.post(S + "/", json=body)
    assert r.status_code == 201, r.text
    return r.json()


# ───────────────────────────── receipt cost / landed cost ─────────────────────────────
class TestReceiptCost:
    def test_grn_receipt_cost_is_the_po_price(self, db, superclient, world):  # noqa: F811
        r = superclient.post(f"{P}/grn/receive", json=grn_body(world, [
            {"purchasing_order_items_id": world["items"]["none"].id, "quantity": 20}],
            supplier_invoice_no=f"INV-RC-{world['po'].id}"))
        assert r.status_code == 201, r.text
        rows = db.query(SalesStock).filter(SalesStock.good_received_note_id == r.json()["grn"]["id"]).all()
        # Purchase orders carry no currency / exchange rate: the PO price is already base currency
        assert rows and all(row.unit_cost == costing.receipt_cost(db, world["items"]["none"]) == D("10.00")
                            for row in rows)

    def test_landed_cost_raises_held_rows_and_wac_average(self, db, superclient, world):  # noqa: F811
        from tests.conftest import mfg_item
        from app.modules.materials.models import Material

        item = db.get(Material, mfg_item(db, world["products"]["none"]))
        item.inventory_valuation_method = "weighted_average"
        db.flush()
        r = superclient.post(f"{P}/grn/receive", json=grn_body(world, [
            {"purchasing_order_items_id": world["items"]["none"].id, "quantity": 50},
            {"purchasing_order_items_id": world["items"]["batch"].id, "quantity": 50, "batch_no": "LC-1",
             "expiry_date": "2031-01-01"}], supplier_invoice_no=f"INV-LC-{world['po'].id}"))
        assert r.status_code == 201, r.text
        grn_id = r.json()["grn"]["id"]
        db.refresh(item)
        assert item.average_cost == D("10.0000")
        none_row = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn_id,
                                               SalesStock.material_id == item.id).one()
        sold = split_lot(db, none_row, 10)  # 10 units already sold: they keep their cost
        sold.status, sold.is_active = StockStatus.SOLD.value, False
        db.flush()
        v = superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={
            "charge_type": "freight", "amount": "100.00", "allocation_basis": "quantity", "payment_method": "cash"})
        assert v.status_code in (200, 201), v.text
        db.refresh(none_row)
        db.refresh(sold)
        assert none_row.unit_cost == D("11.00") and sold.unit_cost == D("10.00")  # 100 over 100 units
        batch_row = db.query(SalesStock).filter(SalesStock.good_received_note_id == grn_id,
                                                SalesStock.batch_no == "LC-1").one()
        assert batch_row.unit_cost == D("11.00")
        db.refresh(item)
        assert item.average_cost == D("11.0000")  # 40 held units x 1 added / 40 held
        # cancelling the voucher takes the share back
        assert superclient.post(f"{P}/landed-costs/{v.json()['id']}/cancel", json={"reason": "dup"}).status_code == 200
        db.refresh(none_row)
        db.refresh(item)
        assert none_row.unit_cost == D("10.00") and item.average_cost == D("10.0000")


# ───────────────────────────── weighted average / FIFO COGS ─────────────────────────────
class TestIssueCost:
    def test_wac_average_after_two_receipts_and_sale_cogs(self, db, superclient, superuser, env):
        mat, p = env["item"](10, method="weighted_average", product=True)
        _stock(db, mat, env["branch"], env["loc"], 10, D("10"), product=p, days_ago=2)
        _stock(db, mat, env["branch"], env["loc"], 10, D("20"), product=p, days_ago=1)
        db.refresh(mat)
        assert mat.average_cost == D("15.0000")
        order = _sell(superclient, superuser, env, p, 4)
        lines = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == order["id"]).all()
        assert [l.unit_cost for l in lines] == [D("15.00")]  # the average, not the 10 lot it came from
        je = _je(db, "Invoice", order["id"])
        assert _sum(je, "5010", "dr") == D("60.00") and _sum(je, "1210", "cr") == D("60.00")
        sale = db.query(StockTransaction).filter(StockTransaction.reference_id == order["id"],
                                                 StockTransaction.movement_type == "sale").one()
        assert sale.unit_cost == D("15.00")
        db.refresh(mat)
        assert mat.average_cost == D("15.0000")  # issues never move the average

    def test_fifo_sale_cogs_uses_the_sold_lots_cost(self, db, superclient, superuser, env):
        mat, p = env["item"](10, product=True, tracking="batch")
        soon = date.today() + timedelta(days=10)
        _stock(db, mat, env["branch"], env["loc"], 2, D("10"), product=p, batch="OLD", expiry=soon + timedelta(days=90),
               days_ago=5)
        _stock(db, mat, env["branch"], env["loc"], 5, D("30"), product=p, batch="NEW", expiry=soon, days_ago=1)
        order = _sell(superclient, superuser, env, p, 3)
        lines = (db.query(InvoiceItems, SalesStock.batch_no)
                 .join(SalesStock, SalesStock.id == InvoiceItems.sales_stock_id)
                 .filter(InvoiceItems.invoice_id == order["id"]).order_by(InvoiceItems.id).all())
        # FIFO item: the oldest receipt first, whatever the expiry
        assert [(l.quantity, b, l.unit_cost) for l, b in lines] == [(2, "OLD", D("10.00")), (1, "NEW", D("30.00"))]
        assert _sum(_je(db, "Invoice", order["id"]), "5010", "dr") == D("50.00")

    def test_fefo_item_picks_the_earliest_expiry(self, db, superclient, superuser, env):
        mat, p = env["item"](10, product=True, tracking="batch", issuing="fefo")
        soon = date.today() + timedelta(days=10)
        _stock(db, mat, env["branch"], env["loc"], 2, D("10"), product=p, batch="OLD", expiry=soon + timedelta(days=90),
               days_ago=5)
        _stock(db, mat, env["branch"], env["loc"], 5, D("30"), product=p, batch="NEW", expiry=soon, days_ago=1)
        order = _sell(superclient, superuser, env, p, 3)
        batches = [b for (b,) in db.query(SalesStock.batch_no).join(InvoiceItems, InvoiceItems.sales_stock_id == SalesStock.id)
                   .filter(InvoiceItems.invoice_id == order["id"])]
        assert batches == ["NEW"]

    def test_lifo_is_costed_like_fifo(self, db, env):
        mat, _ = env["item"](10, method="lifo")
        row = _stock(db, mat, env["branch"], env["loc"], 3, D("12"))
        assert costing.issue_unit_cost(db, row) == D("12")

    def test_sales_return_reverses_at_the_stored_cost(self, db, superclient, superuser, env):
        from app.modules.sales.accounting_integration import SalesAccountingIntegration
        from app.modules.sales.models import SaleReturn, SaleReturnItems

        mat, p = env["item"](10, method="weighted_average", product=True)
        _stock(db, mat, env["branch"], env["loc"], 10, D("10"), product=p, days_ago=1)
        order = _sell(superclient, superuser, env, p, 2)
        inv_item = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == order["id"]).one()
        assert inv_item.unit_cost == D("10.00")
        _stock(db, mat, env["branch"], env["loc"], 8, D("40"), product=p)  # average moves to 25
        db.refresh(mat)
        assert mat.average_cost == D("25.0000")
        ret = SaleReturn(sale_return_no=f"SR-CC-{order['id']}", branch_code=env["branch"].branch_code,
                         added_date=date.today(), good_received_locations_id=env["loc"].id, invoice_id=order["id"],
                         cheque_date=date.today(), payment_method="cash", status="processed", subtotal=200,
                         tax_refund=0, total_refund=200)
        db.add(ret)
        db.flush()
        db.add(SaleReturnItems(barcode="-", return_price=100, branch_code=env["branch"].branch_code,
                               added_date=datetime.utcnow(), sale_return_id=ret.id, sold_price=100,
                               invoice_item_id=inv_item.id, sales_stock_id=inv_item.sales_stock_id,
                               product_id=p.id, quantity=2, condition="good", restockable=True, restocked=True))
        db.flush()
        db.refresh(ret)
        SalesAccountingIntegration(db).post_sale_return_to_gl(ret, superuser[0].id)
        je = _je(db, "SaleReturn", ret.id)
        assert _sum(je, "5010", "cr") == D("20.00") and _sum(je, "1210", "dr") == D("20.00")  # 2 x 10, not 2 x 25

    def test_damage_gl_uses_the_issue_cost(self, db, superclient, env):
        mat, _ = env["item"](10, method="weighted_average")
        row = _stock(db, mat, env["branch"], env["loc"], 4, D("10"))
        _stock(db, mat, env["branch"], env["loc"], 4, D("30"))
        r = superclient.patch(f"/api/v1/inventory/sales-stock/{row.id}/status", params={"status": "damaged"})
        assert r.status_code == 200, r.text
        je = _je(db, "SalesStock", row.id)
        assert _sum(je, "5186", "dr") == D("80.00")  # 4 x average 20 (the row itself cost 10)

    def test_valuation_kpi_is_qty_times_issue_cost(self, db, superclient, env):
        wac, _ = env["item"](10, method="weighted_average")
        fifo, _ = env["item"](10)
        _stock(db, wac, env["branch"], env["loc"], 10, D("10"))
        _stock(db, wac, env["branch"], env["loc"], 10, D("20"))
        _stock(db, fifo, env["branch"], env["loc"], 3, D("7"))
        k = superclient.get(f"{W}/kpis", params={"branch_code": env["branch"].branch_code}).json()
        assert D(str(k["stock_value"])) == D("321.00")  # 20 x 15 + 3 x 7


from tests.test_manufacturing_items_2026_11_20 import shop  # noqa: E402,F401,F811


def test_wac_component_issue_is_costed_at_the_average(db, superclient, shop):  # noqa: F811
    from app.modules.manufacturing import models as m
    from tests.test_manufacturing_items_2026_11_20 import M, _released

    resin = shop["resin"]
    resin.inventory_valuation_method = "weighted_average"
    resin.average_cost = D("20")  # the two lots cost 12 each
    db.flush()
    o = _released(superclient, shop, qty=10)
    mat = o["materials"][0]
    r = superclient.post(f"{M}/orders/{o['id']}/issue-materials", json={"lines": [{"material_id": mat["id"], "quantity": 20}]})
    assert r.status_code == 200, r.text
    txn = db.query(m.MfgMaterialTransaction).filter(m.MfgMaterialTransaction.order_id == o["id"]).one()
    assert txn.unit_cost == D("20.00") and txn.total_cost == D("400.00")
    je = _je(db, "MfgMaterialTxn", txn.id)  # WIP / inventory entry at the same cost
    assert _sum(je, "1230", "dr") == D("400.00") and _sum(je, "1210", "cr") == D("400.00")


# ───────────────────────────── stock counts ─────────────────────────────
@pytest.fixture
def count_env(db, env, make_location):
    """Branch with two locations; item A (lot, FIFO), B (serial x2), C (WAC lot), D (lot, another
    category) at L1 and E (lot) at L2."""
    b, l1 = env["branch"], env["loc"]
    l2 = make_location(branch=b)
    a, _ = env["item"](5, tracking="batch")
    bser, _ = env["item"](100, tracking="serial")
    c, _ = env["item"](20, method="weighted_average")
    d, _ = env["item"](8)
    e, _ = env["item"](9)
    rows = dict(
        a=_stock(db, a, b, l1, 10, D("5"), batch="A-1"),
        b1=_stock(db, bser, b, l1, 1, D("100"), barcode=f"SC-B1-{l1.id}"),
        b2=_stock(db, bser, b, l1, 1, D("100"), barcode=f"SC-B2-{l1.id}"),
        c=_stock(db, c, b, l1, 4, D("20")),
        d=_stock(db, d, b, l1, 3, D("8")),
        e=_stock(db, e, b, l2, 2, D("9")),
    )
    return dict(env, l1=l1, l2=l2, items=dict(a=a, b=bser, c=c, d=d, e=e), rows=rows)


def _line(count, stock_id=None, **match):
    for l in count["lines"]:
        if stock_id is not None and l["stock_id"] == stock_id:
            return l
        if match and all(l.get(k) == v for k, v in match.items()):
            return l
    raise AssertionError(f"line not found: {stock_id} {match}")


class TestStockCounts:
    def test_scope_overlap_and_cancel(self, db, superclient, count_env):
        ce = count_env
        bc = ce["branch"].branch_code
        r = superclient.post(C + "/", json={"branch_code": bc, "location_id": ce["l1"].id,
                                            "category_id": ce["items"]["a"].category_id, "remark": "shelf A"})
        assert r.status_code == 201, r.text
        first = r.json()
        assert first["status"] == "counting" and first["count_no"].startswith(f"SC-{bc}-")
        assert first["line_count"] == 1 and first["lines"][0]["stock_id"] == ce["rows"]["a"].id
        assert first["location_name"] == ce["l1"].name and first["category_name"]
        assert D(str(first["lines"][0]["system_quantity"])) == 10 and D(str(first["lines"][0]["unit_cost"])) == D("5.00")
        # whole branch overlaps the open L1 count; L2 does not
        assert superclient.post(C + "/", json={"branch_code": bc}).status_code == 409
        assert superclient.post(C + "/", json={"branch_code": bc, "location_id": ce["l1"].id}).status_code == 409
        r2 = superclient.post(C + "/", json={"branch_code": bc, "location_id": ce["l2"].id})
        assert r2.status_code == 201, r2.text
        assert [l["stock_id"] for l in r2.json()["lines"]] == [ce["rows"]["e"].id]
        # nothing to count
        empty_cat = superclient.post(C + "/", json={"branch_code": bc, "location_id": ce["l2"].id,
                                                    "category_id": ce["items"]["a"].category_id})
        assert empty_cat.status_code in (409, 422)
        # cancel needs a reason; then the scope is free again
        assert superclient.post(f"{C}/{first['id']}/cancel", json={"reason": " "}).status_code == 422
        for cid in (first["id"], r2.json()["id"]):
            r = superclient.post(f"{C}/{cid}/cancel", json={"reason": "Wrong scope"})
            assert r.status_code == 200 and r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "Wrong scope"
        assert superclient.post(f"{C}/{first['id']}/cancel", json={"reason": "again"}).status_code == 409
        none_left = superclient.post(C + "/", json={"branch_code": bc, "location_id": ce["l2"].id,
                                                    "category_id": ce["items"]["a"].category_id})
        assert none_left.status_code == 422
        lst = superclient.get(C + "/", params={"branch_code": bc, "status": "cancelled"}).json()
        assert {i["id"] for i in lst["items"]} == {first["id"], r2.json()["id"]} and lst["total"] == 2
        assert "lines" not in lst["items"][0]
        found = superclient.get(C + "/", params={"branch_code": bc, "search": "shelf"}).json()
        assert [i["id"] for i in found["items"]] == [first["id"]]

    def test_full_count_flow(self, db, superclient, superuser, count_env):
        ce = count_env
        rows, items = ce["rows"], ce["items"]
        bc = ce["branch"].branch_code
        r = superclient.post(C + "/", json={"branch_code": bc})
        assert r.status_code == 201, r.text
        count = r.json()
        cid = count["id"]
        assert count["line_count"] == 6 and count["counted_count"] == 0
        assert D(str(_line(count, rows["c"].id)["unit_cost"])) == D("20.00")  # WAC: the average

        # validation
        b1 = _line(count, rows["b1"].id)
        bad = superclient.put(f"{C}/{cid}/lines", json={"lines": [{"id": b1["id"], "counted_quantity": 2}]})
        assert bad.status_code == 422
        frac = superclient.put(f"{C}/{cid}/lines", json={"lines": [{"id": _line(count, rows["a"].id)["id"],
                                                                   "counted_quantity": 1.5}]})
        assert frac.status_code == 422
        neg = superclient.put(f"{C}/{cid}/lines", json={"lines": [{"id": b1["id"], "counted_quantity": -1}]})
        assert neg.status_code == 422

        # after the snapshot: 1 unit of D is sold, E... and C stays; D's line keeps its snapshot of 3
        part = split_lot(db, rows["d"], 1)
        part.status, part.is_active = StockStatus.SOLD.value, False
        db.flush()

        counts = {rows["a"].id: 7, rows["b1"].id: 1, rows["b2"].id: 0, rows["c"].id: 6, rows["d"].id: 2}
        upd = [{"id": _line(count, sid)["id"], "counted_quantity": q} for sid, q in counts.items()]
        r = superclient.put(f"{C}/{cid}/lines", json={"lines": upd})
        assert r.status_code == 200, r.text
        count = r.json()
        assert count["counted_count"] == 5
        a_line = _line(count, rows["a"].id)
        assert D(str(a_line["difference"])) == -3 and D(str(a_line["difference_value"])) == D("-15.00")

        # found lines
        assert superclient.post(f"{C}/{cid}/lines", json={"material_id": items["b"].id, "location_id": ce["l1"].id,
                                                          "counted_quantity": 1}).status_code == 422  # no serial
        assert superclient.post(f"{C}/{cid}/lines", json={"material_id": items["b"].id, "location_id": ce["l1"].id,
                                                          "counted_quantity": 2, "barcode": "X"}).status_code == 422
        assert superclient.post(f"{C}/{cid}/lines", json={"material_id": items["b"].id, "location_id": ce["l1"].id,
                                                          "counted_quantity": 1,
                                                          "barcode": rows["b1"].barcode}).status_code == 409
        new_sn = f"SC-NEW-{cid}"
        r = superclient.post(f"{C}/{cid}/lines", json={"material_id": items["b"].id, "location_id": ce["l1"].id,
                                                       "counted_quantity": 1, "barcode": new_sn})
        assert r.status_code == 200, r.text
        r = superclient.post(f"{C}/{cid}/lines", json={"material_id": items["a"].id, "location_id": ce["l1"].id,
                                                       "counted_quantity": 4, "batch_no": "A-FOUND"})
        assert r.status_code == 200, r.text
        found_a = _line(r.json(), batch_no="A-FOUND")
        assert found_a["is_found"] and D(str(found_a["unit_cost"])) == D("5.00")  # item cost price
        r = superclient.post(f"{C}/{cid}/lines", json={"material_id": items["c"].id, "location_id": ce["l1"].id,
                                                       "counted_quantity": 4, "unit_cost": 26})
        assert r.status_code == 200, r.text
        extra = superclient.post(f"{C}/{cid}/lines", json={"material_id": items["d"].id, "location_id": ce["l1"].id,
                                                           "counted_quantity": 1, "batch_no": "OOPS"}).json()
        oops = _line(extra, batch_no="OOPS")
        assert superclient.delete(f"{C}/{cid}/lines/{_line(extra, rows['a'].id)['id']}").status_code == 422
        after = superclient.delete(f"{C}/{cid}/lines/{oops['id']}")
        assert after.status_code == 200 and after.json()["line_count"] == 9

        # E is still uncounted
        r = superclient.post(f"{C}/{cid}/post")
        assert r.status_code == 422 and "(1 left)" in r.json()["detail"]
        # E moved to another location since the snapshot: current 0, counted 0
        rows["e"].location_id = ce["l1"].id
        db.flush()
        superclient.put(f"{C}/{cid}/lines", json={"lines": [{"id": _line(count, rows["e"].id)["id"], "counted_quantity": 0}]})

        csv = superclient.get(f"{C}/{cid}/export-csv")
        assert csv.status_code == 200 and items["a"].item_code in csv.text and "System Qty" in csv.text

        r = superclient.post(f"{C}/{cid}/post")
        assert r.status_code == 200, r.text
        posted = r.json()
        assert posted["status"] == "posted" and posted["posted_by_name"] and posted["posted_at"]
        # loss: A 3 x 5 + B2 1 x 100 = 115; gain: C 2 x 20 + found B 100 + found A 4 x 5 + found C 4 x 26 = 264
        assert D(str(posted["loss_value"])) == D("115.00") and D(str(posted["gain_value"])) == D("264.00")
        assert D(str(posted["net_value"])) == D("149.00")
        d_line = _line(posted, rows["d"].id)
        assert D(str(d_line["difference"])) == 0  # 2 left after the sale, 2 counted
        e_line = _line(posted, rows["e"].id)
        assert D(str(e_line["difference"])) == 0  # moved away: current 0, counted 0
        db.expire_all()
        # stock
        a_row = db.get(SalesStock, rows["a"].id)
        assert a_row.quantity == 7 and a_row.status == "available"
        written = db.query(SalesStock).filter(SalesStock.material_id == items["a"].id,
                                              SalesStock.status == "adjusted_out").one()
        assert written.quantity == 3 and written.batch_no == "A-1"
        assert db.get(SalesStock, rows["b2"].id).status == "adjusted_out"
        assert db.get(SalesStock, rows["c"].id).quantity == 6
        new_b = db.query(SalesStock).filter(SalesStock.barcode == new_sn).one()
        assert new_b.status == "available" and new_b.unit_cost == D("100.00") and new_b.material_id == items["b"].id
        found_row = db.query(SalesStock).filter(SalesStock.batch_no == "A-FOUND").one()
        assert found_row.quantity == 4 and found_row.location_id == ce["l1"].id
        assert db.get(StockCountLine, found_a["id"]).stock_id == found_row.id
        # ledger
        ledger = db.query(StockTransaction).filter(StockTransaction.reference_type == "stock_count",
                                                   StockTransaction.reference_id == cid).all()
        assert ledger and all(t.movement_type == "count_adjustment" and t.reference_no == posted["count_no"]
                              for t in ledger)
        assert sum(t.on_hand_change for t in ledger) == D("-3") - 1 + 2 + 1 + 4 + 4
        mv = superclient.get(f"{W}/movements", params={"movement_type": "count_adjustment",
                                                       "branch_code": bc}).json()
        assert mv["total"] == len(ledger) and all(i["reference_no"] == posted["count_no"] for i in mv["items"])
        # GL
        je = _je(db, "StockCount", cid)
        assert sum(l[1] for l in je) == sum(l[2] for l in je)
        assert _sum(je, "1210", "dr") == D("264.00") and _sum(je, "1210", "cr") == D("115.00")
        assert posted["journal_entry_id"] and posted["journal_entry_no"]
        # WAC: +2 at the average (no change), then 4 found at 26: (6 x 20 + 4 x 26) / 10
        db.refresh(items["c"])
        assert items["c"].average_cost == D("22.4000")
        # idempotent
        assert superclient.post(f"{C}/{cid}/post").status_code == 409
        assert superclient.put(f"{C}/{cid}/lines", json={"lines": []}).status_code == 409
        got = superclient.get(f"{C}/{cid}").json()
        assert got["difference_count"] == posted["difference_count"] and len(got["lines"]) == 9

    def test_permissions_and_branch_scope(self, db, api, make_user, make_branch, count_env):
        ce = count_env
        _, viewer = make_user(permissions=[("stock_count", "view")], branches=[ce["branch"]])
        c = api(viewer)
        assert c.get(C + "/", params={"branch_code": ce["branch"].branch_code}).status_code == 200
        assert c.post(C + "/", json={"branch_code": ce["branch"].branch_code}).status_code == 403
        other = make_branch()
        _, outsider = make_user(permissions=[("stock_count", "view"), ("stock_count", "create")], branches=[other])
        o = api(outsider)
        assert o.post(C + "/", json={"branch_code": ce["branch"].branch_code}).status_code == 403

    def test_serial_sold_after_snapshot_cannot_be_counted_present(self, db, superclient, count_env):
        ce = count_env
        r = superclient.post(C + "/", json={"branch_code": ce["branch"].branch_code, "location_id": ce["l1"].id,
                                            "category_id": ce["items"]["b"].category_id})
        count = r.json()
        b1 = ce["rows"]["b1"]
        b1.status, b1.is_active = StockStatus.SOLD.value, False
        db.flush()
        superclient.put(f"{C}/{count['id']}/lines", json={"lines": [
            {"id": l["id"], "counted_quantity": 1} for l in count["lines"]]})
        r = superclient.post(f"{C}/{count['id']}/post")
        assert r.status_code == 422 and b1.barcode in r.json()["detail"]
        assert db.get(StockCount, count["id"]).status == "counting"


def test_material_response_has_read_only_average_cost(db, superclient, env):
    mat, _ = env["item"](10, method="weighted_average")
    _stock(db, mat, env["branch"], env["loc"], 2, D("12"))
    r = superclient.get(f"/api/v1/materials/items/{mat.id}")
    assert r.status_code == 200, r.text
    assert D(str(r.json()["average_cost"])) == D("12.0000")
