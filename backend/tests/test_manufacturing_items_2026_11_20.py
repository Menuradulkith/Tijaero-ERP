"""Central stock phase 4 (2026-11-20): manufacturing works on Item Catalog items.

BOM header / lines / by-products are items; product_id on new records is refused; production
orders make an item and consume component item stock (item-only raw materials bought on a PO,
FEFO); output and by-products become item stock (product_id = the item's only linked product,
unit_cost = the order's standard cost); QC, make-to-order, MRP / reorder rules work per item;
the reporting dashboard, stock summary and low-stock alerts count item-only stock; old
product-based BOM / order rows still read."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock, StockTransaction
from app.modules.manufacturing import models as m
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.planning import MrpService, ReorderRuleService
from app.modules.manufacturing.service import BOMService, ProductionOrderService
from tests.conftest import mfg_item, purchasable_item
from tests.test_purchasing_items_2026_11_20 import _create_po, _receive

M = "/api/v1/manufacturing"
Q = "/api/v1/sales/quotes"
A = "/api/v1/common/approvals"
TODAY = date.today()
REFUSED = "Manufacturing uses Item Catalog items: send material_id"


@pytest.fixture
def shop(db, superclient, make_branch, make_location, make_supplier, make_product, make_user):
    """Bottles (a product linked to its finished item) blown from resin, an item-only raw
    material bought on purchase orders in two lots, yielding regrind (an item-only by-product)."""
    branch = make_branch()
    loc = make_location(branch=branch)
    user, _ = make_user(branches=[branch])
    sup = make_supplier()
    w = dict(branch=branch, location=loc, supplier=sup)
    resin = purchasable_item(db, sup, 12, tracking_type="batch", preferred=True, name=f"Resin {loc.id}")
    resin.stock_issuing_method = "fefo"  # phase 5: FIFO items pick the oldest receipt, FEFO the earliest expiry
    regrind = purchasable_item(db, sup, 3, tracking_type="batch", name=f"Regrind {loc.id}")
    bottle = make_product(cost_price=50, name=f"Bottle {loc.id}")
    bottle.tracking_type = "batch"
    bottle_item_id = mfg_item(db, bottle)
    db.flush()
    # two resin lots: the later one received first, the earlier-expiring one second
    for batch, days in (("RS-LATE", 120), ("RS-EARLY", 30)):
        po = _create_po(superclient, w, [{"material_id": resin.id, "quantity": 30}])
        _receive(superclient, w, po, [{"purchasing_order_items_id": po["items"][0]["id"], "quantity": 30,
                                       "batch_no": batch, "expiry_date": (TODAY + timedelta(days=days)).isoformat()}])
    wc = superclient.post(f"{M}/work-centers", json={"code": f"BL{loc.id}", "name": "Blow moulder",
                                                    "labor_rate_per_hour": 60, "overhead_rate_per_hour": 30})
    assert wc.status_code == 201, wc.text
    bom = superclient.post(f"{M}/boms", json={
        "material_id": bottle_item_id, "output_quantity": 1,
        "items": [{"material_id": resin.id, "quantity": 2}],
        "operations": [{"name": "Blow", "work_center_id": wc.json()["id"], "run_minutes": 1}],
        "by_products": [{"material_id": regrind.id, "quantity": 1}],
    })
    assert bom.status_code == 201, bom.text
    bom = superclient.post(f"{M}/boms/{bom.json()['id']}/activate").json()
    return dict(w, user=user, resin=resin, regrind=regrind, bottle=bottle, bottle_item=bottle.material, bom=bom)


def _order(superclient, p, qty=10):
    r = superclient.post(f"{M}/orders", json={
        "material_id": p["bottle_item"].id, "branch_code": p["branch"].branch_code, "planned_quantity": qty,
        "planned_start_date": TODAY.isoformat(), "planned_end_date": TODAY.isoformat()})
    assert r.status_code == 201, r.text
    return r.json()


def _released(superclient, p, qty=10):
    o = _order(superclient, p, qty)
    r = superclient.post(f"{M}/orders/{o['id']}/release")
    assert r.status_code == 200, r.text
    return r.json()


# ───────────────────────────── BOMs ─────────────────────────────
class TestBoms:
    def test_bom_header_lines_and_by_products_are_items(self, shop):
        bom = shop["bom"]
        assert bom["material_id"] == shop["bottle_item"].id and bom["material_name"] == shop["bottle_item"].name
        assert bom["material_item_code"] == shop["bottle_item"].item_code and bom["unit_of_measure"]
        # the finished item's only linked product, so sales links keep working
        assert bom["product_id"] == shop["bottle"].id and bom["product_name"] == shop["bottle"].name
        line = bom["items"][0]
        assert (line["material_id"], line["material_name"], line["product_id"]) == (shop["resin"].id, shop["resin"].name, None)
        assert D(line["unit_cost"]) == D("12.00")  # the item's cost
        bp = bom["by_products"][0]
        assert (bp["material_id"], bp["product_id"], D(bp["unit_cost"])) == (shop["regrind"].id, None, D("3.00"))
        # roll-up: 2 x 12 resin + 1 min labour/overhead - 3 regrind
        assert D(bom["unit_cost"]) == D("24.00") + D("1.00") + D("0.50") - D("3.00")

    def test_bom_list_filters_by_item_and_by_product(self, superclient, shop):
        by_item = superclient.get(f"{M}/boms", params={"material_id": shop["bottle_item"].id}).json()
        assert [b["id"] for b in by_item] == [shop["bom"]["id"]]
        by_product = superclient.get(f"{M}/boms", params={"product_id": shop["bottle"].id}).json()
        assert [b["id"] for b in by_product] == [shop["bom"]["id"]]

    def test_product_id_on_new_records_is_refused(self, superclient, shop):
        bottle, resin, branch = shop["bottle"], shop["resin"], shop["branch"].branch_code
        cases = [
            (f"{M}/boms", {"product_id": bottle.id, "items": [{"material_id": resin.id, "quantity": 1}]}),
            (f"{M}/boms", {"material_id": shop["bottle_item"].id, "version": "9",
                           "items": [{"product_id": bottle.id, "quantity": 1}]}),
            (f"{M}/orders", {"product_id": bottle.id, "branch_code": branch, "planned_quantity": 1,
                             "planned_start_date": TODAY.isoformat(), "planned_end_date": TODAY.isoformat()}),
            (f"{M}/reorder-rules", {"product_id": bottle.id, "branch_code": branch, "min_quantity": 1}),
        ]
        for url, body in cases:
            r = superclient.post(url, json=body)
            assert r.status_code == 422, (url, r.text)
            assert REFUSED in r.text

    def test_update_product_cost_sets_the_item_and_its_product(self, db, superclient, shop):
        r = superclient.post(f"{M}/boms/{shop['bom']['id']}/update-product-cost")
        assert r.status_code == 200, r.text
        db.refresh(shop["bottle_item"])
        db.refresh(shop["bottle"])
        assert D(str(shop["bottle_item"].cost_price)) == D("22.50") == D(str(shop["bottle"].cost_price))


# ───────────────────────────── production ─────────────────────────────
class TestProduction:
    def test_order_for_an_item_issues_item_only_stock_fefo(self, db, superclient, shop):
        o = _released(superclient, shop, qty=10)
        assert o["material_id"] == shop["bottle_item"].id and o["product_id"] == shop["bottle"].id
        assert D(str(o["standard_unit_cost"])) == D("50.00")
        mat = o["materials"][0]
        assert (mat["material_id"], mat["required_quantity"], mat["available_quantity"]) == (shop["resin"].id, 20, 60)
        r = superclient.post(f"{M}/orders/{o['id']}/issue-materials",
                             json={"lines": [{"material_id": mat["id"], "quantity": 35}]})
        assert r.status_code == 400 and "can be issued up to 20" in r.json()["detail"]
        r = superclient.post(f"{M}/orders/{o['id']}/issue-materials",
                             json={"lines": [{"material_id": mat["id"], "quantity": 20}]})
        assert r.status_code == 200, r.text
        txn = db.query(m.MfgMaterialTransaction).filter(m.MfgMaterialTransaction.order_id == o["id"]).one()
        assert txn.item_material_id == shop["resin"].id and txn.product_id is None
        assert [l["batch_no"] for l in txn.lots] == ["RS-EARLY"]  # earliest expiry first
        act = superclient.get(f"{M}/orders/{o['id']}/activity").json()["materials"][0]
        assert act["material_id"] == mat["id"] and act["item_material_id"] == shop["resin"].id
        assert act["material_name"] == shop["resin"].name
        # return to production stock, by item
        r = superclient.post(f"{M}/orders/{o['id']}/return-materials",
                             json={"lines": [{"material_id": mat["id"], "quantity": 5}]})
        assert r.status_code == 200, r.text
        assert r.json()["materials"][0]["available_quantity"] == 45

    def test_output_and_by_products_become_item_stock(self, db, superclient, shop):
        o = _released(superclient, shop, qty=4)
        bp = o["by_products"][0]
        assert (bp["material_id"], bp["product_id"]) == (shop["regrind"].id, None)
        r = superclient.post(f"{M}/orders/{o['id']}/output", json={
            "quantity": 4, "batch_no": "BTL-1", "by_products": [{"byproduct_id": bp["id"], "quantity": 3}]})
        assert r.status_code == 200, r.text
        rows = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]).all()
        fg = next(x for x in rows if x.material_id == shop["bottle_item"].id)
        assert (fg.product_id, fg.quantity, fg.batch_no, fg.status) == (shop["bottle"].id, 4, "BTL-1", StockStatus.AVAILABLE)
        assert D(str(fg.unit_cost)) == D("50.00")  # the order's standard unit cost
        rg = next(x for x in rows if x.material_id == shop["regrind"].id)
        assert (rg.product_id, rg.quantity, D(str(rg.unit_cost))) == (None, 3, D("3.00"))
        moves = {t.stock_id: t.movement_type for t in db.query(StockTransaction)
                 .filter(StockTransaction.stock_id.in_([fg.id, rg.id]))}
        assert moves == {fg.id: "production_output", rg.id: "by_product"}
        assert all(t.reference_type == "production_order" for t in db.query(StockTransaction)
                   .filter(StockTransaction.stock_id.in_([fg.id, rg.id])))
        out = superclient.get(f"{M}/orders/{o['id']}/activity").json()["outputs"][0]
        assert out["by_products"][0]["material_id"] == shop["regrind"].id

    def test_qc_hold_pass_and_fail_with_items(self, db, superclient, shop):
        shop["bottle_item"].requires_qc = True  # QC comes from the item
        db.flush()
        o = _released(superclient, shop, qty=4)
        o = superclient.post(f"{M}/orders/{o['id']}/output", json={"quantity": 4}).json()
        assert o["qc_on_hold_quantity"] == 4
        row = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]).one()
        assert row.status == StockStatus.FROZEN and row.material_id == shop["bottle_item"].id
        out = db.query(m.MfgProductionOutput).filter(m.MfgProductionOutput.order_id == o["id"]).one()
        r = superclient.post(f"{M}/orders/{o['id']}/quality", json={
            "output_id": out.id, "passed_quantity": 3, "failed_quantity": 1, "remark": "Thin walls"})
        assert r.status_code == 200, r.text
        rows = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]).all()
        assert sorted((x.status, x.quantity) for x in rows) == sorted([(StockStatus.AVAILABLE, 3), (StockStatus.DAMAGED, 1)])

    def test_shelf_life_and_tracking_come_from_the_item(self, db, superclient, shop):
        shop["bottle_item"].shelf_life_days = 10
        db.flush()
        o = _released(superclient, shop, qty=2)
        assert o["tracking_type"] == "batch"
        superclient.post(f"{M}/orders/{o['id']}/output", json={"quantity": 2})
        row = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]).one()
        assert row.expiry_date == TODAY + timedelta(days=10) and row.batch_no == o["order_no"]

    def test_job_cards_and_trace_show_items(self, db, superclient, shop):
        o = _released(superclient, shop, qty=2)
        mat = o["materials"][0]
        superclient.post(f"{M}/orders/{o['id']}/issue-materials", json={"lines": [{"material_id": mat["id"], "quantity": 4}]})
        superclient.post(f"{M}/orders/{o['id']}/output", json={"quantity": 2, "batch_no": "BTL-T"})
        cards = superclient.get(f"{M}/job-cards", params={"branch_code": shop["branch"].branch_code}).json()
        assert cards and cards[0]["material_id"] == shop["bottle_item"].id
        trace = superclient.get(f"{M}/trace", params={"batch_no": "BTL-T"}).json()
        order = trace["orders"][0]
        assert order["material_id"] == shop["bottle_item"].id
        assert order["components"][0]["material_id"] == shop["resin"].id
        assert order["finished_batches"][0]["material_name"] == shop["bottle_item"].name


# ───────────────────────────── make-to-order ─────────────────────────────
class TestMakeToOrder:
    def test_quote_line_makes_the_products_item_and_reserves_output(self, db, superclient, shop, make_customer):
        r = superclient.post(f"{Q}/", json={
            "branch_code": shop["branch"].branch_code, "customer_id": make_customer().id,
            "valid_until": (TODAY + timedelta(days=14)).isoformat(),
            "items": [{"product_id": shop["bottle"].id, "quantity": 3, "selling_price": 90,
                       "minimum_selling_price": 60, "warrenty_month": "0"}]})
        assert r.status_code == 201, r.text
        q = r.json()
        assert superclient.post(f"{A}/{q['approval_id']}/approve", json={}).status_code == 200
        qi_id = superclient.get(f"{Q}/{q['id']}").json()["items"][0]["id"]
        demand = superclient.get(f"{M}/quote-demand", params={"branch_code": shop["branch"].branch_code}).json()
        line = next(d for d in demand if d["quote_item_id"] == qi_id)
        assert line["has_bom"] and line["material_id"] == shop["bottle_item"].id
        r = superclient.post(f"{M}/orders/from-quote", json={"quote_item_id": qi_id})
        assert r.status_code == 201, r.text
        o = r.json()
        assert o["material_id"] == shop["bottle_item"].id and o["quote_item_id"] == qi_id
        superclient.post(f"{M}/orders/{o['id']}/release")
        superclient.post(f"{M}/orders/{o['id']}/output", json={"quantity": 3})
        row = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]).one()
        assert (row.status, row.reserved_for_quote_item_id, row.material_id) == (
            StockStatus.RESERVED, qi_id, shop["bottle_item"].id)


# ───────────────────────────── MRP / reorder ─────────────────────────────
class TestPlanning:
    def test_reorder_rule_per_item_counts_item_only_stock(self, db, superclient, shop):
        r = superclient.post(f"{M}/reorder-rules", json={
            "material_id": shop["resin"].id, "branch_code": shop["branch"].branch_code,
            "min_quantity": 100, "max_quantity": 150, "multiple_quantity": 10})
        assert r.status_code == 201, r.text
        rule = r.json()
        assert (rule["material_id"], rule["product_id"], rule["on_hand_quantity"]) == (shop["resin"].id, None, 60)
        assert rule["below_minimum"] and rule["material_name"] == shop["resin"].name
        dup = superclient.post(f"{M}/reorder-rules", json={
            "material_id": shop["resin"].id, "branch_code": shop["branch"].branch_code, "min_quantity": 1})
        assert dup.status_code == 400
        line = next(l for l in MrpService(db).run(branch_codes=[shop["branch"].branch_code])
                    if l["material_id"] == shop["resin"].id)
        assert line["on_hand_quantity"] == 60 and line["suggested_quantity"] == 90
        assert line["suggested_action"] == "purchase" and line["preferred_supplier_id"] == shop["supplier"].id
        assert line["product_id"] is None and line["material_name"] == shop["resin"].name

    def test_planned_production_explodes_through_the_items_bom(self, db, superclient, shop):
        _order(superclient, shop, qty=40)  # draft: needs 80 resin, 60 free
        rows = {l["material_id"]: l for l in MrpService(db).run(branch_codes=[shop["branch"].branch_code])}
        assert rows[shop["resin"].id]["production_demand"] == 80
        assert rows[shop["resin"].id]["suggested_quantity"] == 20
        r = superclient.post(f"{M}/mrp/purchase-orders", json={
            "branch_code": shop["branch"].branch_code,
            "lines": [{"material_id": shop["resin"].id, "quantity": 20, "supplier_id": shop["supplier"].id}]})
        assert r.status_code == 201, r.text
        rows = {l["material_id"]: l for l in MrpService(db).run(branch_codes=[shop["branch"].branch_code])}
        assert rows[shop["resin"].id]["on_order_quantity"] == 20 and rows[shop["resin"].id]["suggested_quantity"] == 0

    def test_firming_production_takes_the_item_or_a_products_item(self, db, superclient, shop):
        for line in ({"material_id": shop["bottle_item"].id}, {"product_id": shop["bottle"].id}):
            r = superclient.post(f"{M}/mrp/production-orders", json={
                "branch_code": shop["branch"].branch_code,
                "lines": [{**line, "quantity": 5, "planned_start_date": TODAY.isoformat(),
                           "planned_end_date": TODAY.isoformat()}]})
            assert r.status_code == 201, r.text
            assert r.json()["documents"][0]["material_id"] == shop["bottle_item"].id


# ───────────────────────────── stock readers ─────────────────────────────
class TestStockReaders:
    def test_stock_summary_and_dashboard_value_include_item_only_stock(self, db, shop):
        from app.modules.inventory.service import SalesStockService
        from app.modules.reporting import schemas as rs
        from app.modules.reporting.service import ReportingService

        summary = SalesStockService(db).get_stock_summary(branch_code=shop["branch"].branch_code)
        row = next(i for i in summary["items"] if i["material_id"] == shop["resin"].id)
        assert (row["product_id"], row["available_quantity"], row["item_code"]) == (None, 60, shop["resin"].item_code)
        assert D(str(row["total_value"])) == D("720.00")
        report = ReportingService(db, [shop["branch"].branch_code]).get_inventory_report(
            rs.InventoryReportRequest(low_stock_threshold=100))
        assert report.total_stock_value == 720.0
        assert shop["resin"].item_code in {i["item_code"] for i in report.low_stock_items}

    def test_dashboard_low_stock_counts_items(self, db, shop, make_sales_stock):
        from app.modules.reporting.service import ReportingService

        svc = ReportingService(db, [shop["branch"].branch_code])
        regrind_low = svc.get_dashboard_metrics().low_stock_items  # regrind: no stock in the branch
        lot = db.query(SalesStock).filter(SalesStock.material_id == shop["resin"].id).first()
        db.add(SalesStock(material_id=shop["regrind"].id, quantity=50, batch_no="RG-1", branch_code=lot.branch_code,
                          location_id=lot.location_id, status=StockStatus.AVAILABLE, is_active=True,
                          production_order_id=None, good_received_note_id=lot.good_received_note_id,
                          purchasing_order_items_id=lot.purchasing_order_items_id, added_date=lot.added_date))
        db.flush()
        assert svc.get_dashboard_metrics().low_stock_items == regrind_low - 1

    def test_low_stock_digest_names_item_only_stock(self, db, shop, monkeypatch):
        from app.modules.notifications import alerts, dispatcher

        sent = []
        monkeypatch.setattr(dispatcher, "branch", lambda code, **kw: sent.append((code, kw)))
        alerts.run_low_stock_digest(threshold=100)
        mine = [kw for code, kw in sent if code == shop["branch"].branch_code]
        assert mine and shop["resin"].name in mine[0]["message"]
        assert {"name": shop["resin"].name, "available": 60} in mine[0]["extra_data"]["products"]


# ───────────────────────────── history ─────────────────────────────
def test_old_product_based_bom_and_order_still_read(db, make_product, make_branch, make_user):
    branch = make_branch()
    user, _ = make_user(branches=[branch])
    fg, comp = make_product(cost_price=80, name="Old table"), make_product(cost_price=10, name="Old leg")
    bom = m.MfgBOM(bom_no=f"BOM-OLD{fg.id}", product_id=fg.id, version="1", output_quantity=1, status="archived",
                   is_default=False, overproduction_pct=0)
    bom.items = [m.MfgBOMItem(product_id=comp.id, quantity=4, scrap_pct=0, issue_method="manual", sequence=10)]
    db.add(bom)
    db.flush()
    order = m.MfgProductionOrder(
        order_no=f"MO-OLD-{fg.id}", product_id=fg.id, bom_id=bom.id, branch_code=branch.branch_code,
        planned_quantity=2, produced_quantity=2, scrapped_quantity=0, planned_start_date=TODAY,
        planned_end_date=TODAY, status="closed", standard_unit_cost=80, overproduction_pct=0)
    order.materials = [m.MfgProductionOrderMaterial(product_id=comp.id, quantity_per_unit=4, scrap_pct=0,
                                                    required_quantity=8, issued_quantity=8, unit_cost=10, sequence=10)]
    db.add(order)
    db.flush()
    b = BOMService(db).get_out(bom.id)
    assert (b["product_id"], b["product_name"], b["material_id"]) == (fg.id, "Old table", None)
    assert b["items"][0]["product_name"] == "Old leg" and b["items"][0]["unit_cost"] == D("10.00")
    o = ProductionOrderService(db).get_out(order.id)
    assert (o["product_id"], o["product_name"], o["material_id"]) == (fg.id, "Old table", None)
    assert o["materials"][0]["product_id"] == comp.id and o["materials"][0]["material_id"] is None
    assert ProductionOrderService(db).list(branch_codes=[branch.branch_code])["items"][0]["product_name"] == "Old table"
    assert ReorderRuleService(db).list(branch_codes=[branch.branch_code]) == []
