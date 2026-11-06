"""Manufacturing for Sri Lankan factories (s130): expired lots are never issued, good + scrap share
one cap with an over-production tolerance, scrap reasons / yield, shelf life -> batch expiry,
batch tracking for new manufactured products, quality hold, outside work, by-products, batch
traceability, optional planned-time booking and branch-scoped dashboard load."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
from app.modules.inventory.models import SalesStock
from app.modules.manufacturing import models as m
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.service import (
    BOMService,
    PlanningService,
    ProductionOrderService,
    WorkCenterService,
    free_stock,
)

TODAY = date.today()


def _uid():
    import uuid
    return uuid.uuid4().hex[:6]


def _lot(make_sales_stock, product, branch, location, qty, batch="L1", expiry=None):
    row = make_sales_stock(product=product, branch=branch, location=location)
    row.barcode, row.quantity, row.batch_no, row.expiry_date = None, qty, batch, expiry
    return row


@pytest.fixture
def bakery(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    """Buns from flour (batch, with an expired lot) and butter (backflushed)."""
    branch = make_branch()
    loc = make_location(branch=branch)
    user, _ = make_user(branches=[branch])
    bun = make_product(cost_price=40, name="Bun")
    bun.tracking_type = "batch"
    flour = make_product(cost_price=2, name="Flour (g)")
    flour.tracking_type = "batch"
    butter = make_product(cost_price=1, name="Butter (g)")
    butter.tracking_type = "none"
    crumbs = make_product(cost_price=5, name="Bread crumbs")
    crumbs.tracking_type = "batch"
    _lot(make_sales_stock, flour, branch, loc, 500, batch="FL-OLD", expiry=TODAY - timedelta(days=1))
    _lot(make_sales_stock, flour, branch, loc, 2000, batch="FL-NEW", expiry=TODAY + timedelta(days=60))
    _lot(make_sales_stock, butter, branch, loc, 1000, batch=None)
    db.flush()
    wc = WorkCenterService(db).create(s.WorkCenterIn(code=f"OV{_uid()}", name="Oven", labor_rate_per_hour=D(60),
                                                     overhead_rate_per_hour=D(30)), user.id)
    bom = BOMService(db).create(s.BOMIn(
        product_id=bun.id, overproduction_pct=D(10), items=[
            s.BOMItemIn(product_id=flour.id, quantity=D(50)),
            s.BOMItemIn(product_id=butter.id, quantity=D(5), issue_method="backflush"),
        ],
        operations=[s.BOMOperationIn(name="Bake", work_center_id=wc["id"], run_minutes=D(1))],
        by_products=[s.BOMByProductIn(product_id=crumbs.id, quantity=D(2))],
    ), user.id)
    BOMService(db).activate(bom["id"], user.id)
    return dict(branch=branch, loc=loc, user=user, bun=bun, flour=flour, butter=butter, crumbs=crumbs, wc=wc, bom=bom)


def _order(db, p, qty=10, product=None):
    return ProductionOrderService(db).create(s.ProductionOrderIn(
        product_id=(product or p["bun"]).id, branch_code=p["branch"].branch_code, planned_quantity=qty,
        planned_start_date=TODAY, planned_end_date=TODAY + timedelta(days=1)), p["user"].id)


def _released(db, p, qty=10):
    return ProductionOrderService(db).release(_order(db, p, qty)["id"], p["user"].id)


def _net(db, ref_type, ref_id):
    rows = (db.query(ChartOfAccounts.account_code, GeneralLedger.debit_amount, GeneralLedger.credit_amount)
            .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
            .filter(GeneralLedger.reference_type == ref_type, GeneralLedger.reference_id == ref_id).all())
    net = {}
    for code, dr, cr in rows:
        net[code] = net.get(code, D(0)) + D(str(dr or 0)) - D(str(cr or 0))
    return net


class TestFixes:
    def test_expired_lots_are_neither_free_nor_issued(self, db, bakery):
        p = bakery
        assert free_stock(db, [p["flour"].id], [p["branch"].branch_code])[p["flour"].id] == 2000
        o = _released(db, p)
        flour = next(x for x in o["materials"] if x["product_id"] == p["flour"].id)
        svc = ProductionOrderService(db)
        svc.issue_materials(o["id"], s.MaterialMoveIn(lines=[s.MaterialLineIn(material_id=flour["id"], quantity=500)]), p["user"].id)
        txn = db.query(m.MfgMaterialTransaction).filter(m.MfgMaterialTransaction.order_id == o["id"]).one()
        assert {l["batch_no"] for l in txn.lots} == {"FL-NEW"}
        old = db.query(SalesStock).filter(SalesStock.batch_no == "FL-OLD").one()
        assert old.status == StockStatus.AVAILABLE and old.quantity == 500

    def test_good_and_scrap_share_one_cap_with_the_tolerance(self, db, bakery):
        p, svc = bakery, ProductionOrderService(db)
        o = _released(db, p, qty=10)
        assert o["max_quantity"] == 11
        o = svc.record_output(o["id"], s.OutputIn(quantity=10, scrap_quantity=1, scrap_reason="burnt"), p["user"].id)
        with pytest.raises(HTTPException) as exc:
            svc.record_output(o["id"], s.OutputIn(scrap_quantity=1, scrap_reason="burnt"), p["user"].id)
        assert "good and scrap together" in exc.value.detail
        assert o["yield_pct"] == D("90.9") and o["scrap_value"] == D(o["standard_unit_cost"])

    def test_scrap_needs_a_reason(self):
        with pytest.raises(ValueError):
            s.OutputIn(quantity=1, scrap_quantity=1)

    def test_new_manufactured_product_becomes_batch_tracked(self, db, make_product, bakery):
        p = bakery
        cake = make_product(cost_price=100, name="Cake")
        assert cake.tracking_type == "serial"
        bom = BOMService(db).create(s.BOMIn(product_id=cake.id, items=[s.BOMItemIn(product_id=p["flour"].id, quantity=D(5))]),
                                    p["user"].id)
        BOMService(db).activate(bom["id"], p["user"].id)
        assert cake.tracking_type == "batch"
        # a product that already has stock keeps its tracking (it is locked)
        assert p["flour"].tracking_type == "batch"

    def test_complete_without_booking_planned_time(self, db, bakery):
        p, svc = bakery, ProductionOrderService(db)
        o = _released(db, p, qty=2)
        svc.record_output(o["id"], s.OutputIn(quantity=2), p["user"].id)
        o = svc.complete(o["id"], p["user"].id, book_planned_time=False)
        assert o["actual_labor_cost"] == 0 and not db.query(m.MfgTimeLog).filter(m.MfgTimeLog.order_id == o["id"]).first()

    def test_dashboard_load_is_limited_to_the_users_branches(self, db, make_branch, make_user, bakery):
        p = bakery
        other = make_branch()
        WorkCenterService(db).create(s.WorkCenterIn(code=f"X{_uid()}", name="Elsewhere", branch_code=other.branch_code),
                                     p["user"].id)
        codes = {w["code"] for w in PlanningService(db).dashboard([p["branch"].branch_code])["work_center_load"]}
        assert p["wc"]["code"] in codes and not any(c.startswith("X") for c in codes)


class TestShelfLifeAndTrace:
    def test_batch_expiry_comes_from_shelf_life(self, db, bakery):
        p, svc = bakery, ProductionOrderService(db)
        p["bun"].shelf_life_days = 3
        o = _released(db, p, qty=4)
        svc.record_output(o["id"], s.OutputIn(quantity=4, batch_no="BUN-1"), p["user"].id)
        row = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"], SalesStock.product_id == p["bun"].id).one()
        assert row.expiry_date == TODAY + timedelta(days=3) and row.batch_no == "BUN-1"
        assert row.production_output_id is not None

    def test_trace_both_ways(self, db, bakery):
        p, svc = bakery, ProductionOrderService(db)
        o = _released(db, p, qty=4)
        flour = next(x for x in o["materials"] if x["product_id"] == p["flour"].id)
        svc.issue_materials(o["id"], s.MaterialMoveIn(lines=[s.MaterialLineIn(material_id=flour["id"], quantity=200)]), p["user"].id)
        svc.record_output(o["id"], s.OutputIn(quantity=4, batch_no="BUN-T"), p["user"].id)
        fwd = svc.trace("bun-t")
        assert fwd["found_as"] == ["finished"] and fwd["orders"][0]["order_no"] == o["order_no"]
        comps = {(c["batch_no"], c["quantity"]) for c in fwd["orders"][0]["components"]}
        assert ("FL-NEW", 200) in comps
        back = svc.trace("FL-NEW")
        assert "component" in back["found_as"]
        assert any(b["batch_no"] == "BUN-T" for b in back["orders"][0]["finished_batches"])


class TestQualityHold:
    def test_held_output_is_frozen_until_passed_and_failed_units_are_written_off(self, db, bakery):
        p, svc = bakery, ProductionOrderService(db)
        p["bun"].requires_qc = True
        o = _released(db, p, qty=4)
        o = svc.record_output(o["id"], s.OutputIn(quantity=4, batch_no="QC-1"), p["user"].id)
        assert o["qc_on_hold_quantity"] == 4
        assert free_stock(db, [p["bun"].id], [p["branch"].branch_code]).get(p["bun"].id, 0) == 0
        out = db.query(m.MfgProductionOutput).filter(m.MfgProductionOutput.order_id == o["id"]).one()
        with pytest.raises(HTTPException):
            svc.qc_decision(o["id"], s.QcDecisionIn(output_id=out.id, passed_quantity=5), p["user"].id)
        o = svc.qc_decision(o["id"], s.QcDecisionIn(output_id=out.id, passed_quantity=3, failed_quantity=1,
                                                    remark="Underbaked"), p["user"].id)
        assert o["qc_on_hold_quantity"] == 0 and out.qc_status == "partly_passed"
        assert free_stock(db, [p["bun"].id], [p["branch"].branch_code])[p["bun"].id] == 3
        res = db.query(m.MfgQcResult).filter(m.MfgQcResult.output_id == out.id).one()
        assert res.failed_value == D(str(out.unit_cost))
        assert _net(db, "MfgQcResult", res.id) == {"5030": res.failed_value, "1210": -res.failed_value}

    def test_failing_needs_a_reason(self):
        with pytest.raises(ValueError):
            s.QcDecisionIn(output_id=1, failed_quantity=1)


class TestOutsideWork:
    @pytest.fixture
    def garment(self, db, make_supplier, bakery):
        p = bakery
        sup = make_supplier()
        wash = WorkCenterService(db).create(s.WorkCenterIn(code=f"WS{_uid()}", name="Washing (outside)", is_outside=True,
                                                           supplier_id=sup.id), p["user"].id)
        bom = BOMService(db).copy(p["bom"]["id"], s.BOMCopyIn(version="2"), p["user"].id)
        ops = [s.BOMOperationIn(name="Bake", work_center_id=p["wc"]["id"], run_minutes=D(1)),
               s.BOMOperationIn(sequence=20, name="Wash", work_center_id=wash["id"], outside_unit_cost=D(50))]
        BOMService(db).update(bom["id"], s.BOMUpdate(operations=ops), p["user"].id)
        BOMService(db).activate(bom["id"], p["user"].id)
        BOMService(db).set_default(bom["id"], p["user"].id)
        return dict(p, supplier=sup, bom2=BOMService(db).get_out(bom["id"]))

    def test_rollup_includes_the_outside_price(self, garment):
        wash = next(o for o in garment["bom2"]["operations"] if o["name"] == "Wash")
        assert wash["is_outside"] and wash["outside_cost"] == D("50.00") and wash["labor_cost"] == 0
        assert garment["bom2"]["outside_cost"] == D("50.00")

    def test_receiving_outside_work_costs_wip_and_raises_an_expense(self, db, garment):
        p, svc = garment, ProductionOrderService(db)
        o = _released(db, p, qty=5)
        wash = next(x for x in o["operations"] if x["name"] == "Wash")
        assert wash["is_outside"] and wash["supplier_id"] == p["supplier"].id
        with pytest.raises(HTTPException) as exc:
            svc.log_time(o["id"], s.TimeLogIn(operation_id=wash["id"], minutes=D(10)), p["user"].id)
        assert "subcontractor" in exc.value.detail
        o = svc.receive_outside_work(o["id"], s.OutsideReceiptIn(operation_id=wash["id"], quantity=5,
                                                                 bill_reference="INV-77"), p["user"].id)
        assert o["actual_outside_cost"] == D("250.00")
        rec = db.query(m.MfgOutsideReceipt).filter(m.MfgOutsideReceipt.order_id == o["id"]).one()
        assert _net(db, "MfgOutsideReceipt", rec.id) == {"1230": D("250.00"), "5040": D("-250.00")}
        from app.modules.finance.models import Expenses
        exp = db.query(Expenses).filter(Expenses.id == rec.expense_id).one()
        assert exp.status == "pending" and exp.account_code == "5040" and exp.expense_amount == D("250.00")
        assert exp.vendor_name == p["supplier"].company_name
        with pytest.raises(HTTPException):
            svc.receive_outside_work(o["id"], s.OutsideReceiptIn(operation_id=wash["id"], quantity=1), p["user"].id)

    def test_close_counts_outside_cost(self, db, garment):
        p, svc = garment, ProductionOrderService(db)
        o = _released(db, p, qty=2)
        wash = next(x for x in o["operations"] if x["name"] == "Wash")
        svc.receive_outside_work(o["id"], s.OutsideReceiptIn(operation_id=wash["id"], quantity=2, amount=D(120),
                                                             create_expense=False), p["user"].id)
        svc.record_output(o["id"], s.OutputIn(quantity=2), p["user"].id)
        svc.complete(o["id"], p["user"].id, book_planned_time=False)
        o = svc.close(o["id"], p["user"].id)
        assert o["actual_total_cost"] >= D("120.00")
        assert o["variance_amount"] == o["actual_total_cost"] - o["output_value"]


class TestByProducts:
    def test_by_products_go_to_stock_and_reduce_cost(self, db, bakery):
        p, svc = bakery, ProductionOrderService(db)
        bom = BOMService(db).get_out(p["bom"]["id"])
        assert bom["byproduct_value"] == D("10.00")  # 2 x 5
        assert bom["unit_cost"] == bom["material_cost"] + bom["labor_cost"] + bom["overhead_cost"] - D("10.00")
        o = _released(db, p, qty=5)
        bp = o["by_products"][0]
        o = svc.record_output(o["id"], s.OutputIn(quantity=5, by_products=[s.ByProductReceiptIn(byproduct_id=bp["id"],
                                                                                                quantity=9)]), p["user"].id)
        crumbs = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"],
                                             SalesStock.product_id == p["crumbs"].id).one()
        assert crumbs.quantity == 9 and crumbs.batch_no == o["order_no"] and crumbs.status == StockStatus.AVAILABLE
        out = db.query(m.MfgProductionOutput).filter(m.MfgProductionOutput.order_id == o["id"]).one()
        assert out.byproduct_value == D("45.00")
        assert o["output_value"] == out.total_value + D("45.00")
        assert _net(db, "MfgOutput", out.id)["1210"] == out.total_value + D("45.00")
        assert o["by_products"][0]["received_quantity"] == 9 and o["by_products"][0]["expected_quantity"] == 10

    def test_by_product_cannot_be_a_component(self, db, bakery):
        p = bakery
        with pytest.raises(HTTPException) as exc:
            BOMService(db).create(s.BOMIn(product_id=p["bun"].id, version="X", items=[s.BOMItemIn(product_id=p["flour"].id, quantity=D(1))],
                                          by_products=[s.BOMByProductIn(product_id=p["flour"].id, quantity=D(1))]), p["user"].id)
        assert "cannot also be a by-product" in exc.value.detail


class TestApi:
    def test_new_endpoints_need_their_permissions(self, api, make_user):
        _, tok = make_user()
        c = api(tok)
        assert c.get("/api/v1/manufacturing/trace", params={"batch_no": "X"}).status_code == 403
        assert c.post("/api/v1/manufacturing/orders/1/quality", json={"output_id": 1, "passed_quantity": 1}).status_code == 403
        assert c.post("/api/v1/manufacturing/orders/1/outside-work", json={"operation_id": 1, "quantity": 1}).status_code == 403
