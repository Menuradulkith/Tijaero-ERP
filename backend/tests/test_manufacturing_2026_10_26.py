"""Manufacturing: work centers, BOMs (validation, activation, cost roll-up), production
orders end to end (release, issue / return / backflush, output into stock, time, close
with GL through WIP), MRP netting, and API permission / branch scoping."""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.finance.accounting_models import ChartOfAccounts, GeneralLedger
from app.modules.inventory.models import SalesStock
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.planning import MrpService
from app.modules.manufacturing.service import (
    BOMService,
    PlanningService,
    ProductionOrderService,
    WorkCenterService,
)


def _wc(db, user, code=None, labor=60, overhead=30, eff=100):
    import uuid
    return WorkCenterService(db).create(s.WorkCenterIn(
        code=code or f"WC{uuid.uuid4().hex[:6]}", name="Assembly", labor_rate_per_hour=D(labor),
        overhead_rate_per_hour=D(overhead), efficiency_pct=D(eff)), user.id)


def _lot(make_sales_stock, product, branch, location, qty, batch="L1", expiry=None):
    row = make_sales_stock(product=product, branch=branch, location=location)
    row.barcode, row.quantity, row.batch_no, row.expiry_date = None, qty, batch, expiry
    return row


@pytest.fixture
def plant(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    branch = make_branch()
    loc = make_location(branch=branch)
    user, _ = make_user(branches=[branch])
    fg = make_product(cost_price=500, name="Table")
    fg.tracking_type = "batch"
    top = make_product(cost_price=200, name="Table top")
    top.tracking_type = "batch"
    leg = make_product(cost_price=25, name="Leg")
    leg.tracking_type = "none"
    screw = make_product(cost_price=1, name="Screw")
    screw.tracking_type = "none"
    _lot(make_sales_stock, top, branch, loc, 10)
    _lot(make_sales_stock, leg, branch, loc, 40)
    _lot(make_sales_stock, screw, branch, loc, 200)
    db.flush()
    wc = _wc(db, user)
    bom = BOMService(db).create(s.BOMIn(
        product_id=fg.id, items=[
            s.BOMItemIn(product_id=top.id, quantity=D(1)),
            s.BOMItemIn(product_id=leg.id, quantity=D(4)),
            # 8 screws + 10% scrap, consumed automatically on output
            s.BOMItemIn(product_id=screw.id, quantity=D(8), scrap_pct=D(10), issue_method="backflush"),
        ],
        operations=[s.BOMOperationIn(name="Assemble", work_center_id=wc["id"], setup_minutes=D(30), run_minutes=D(15))],
    ), user.id)
    BOMService(db).activate(bom["id"], user.id)
    return dict(branch=branch, loc=loc, user=user, fg=fg, top=top, leg=leg, screw=screw, wc=wc, bom=bom)


def _order(db, p, qty=5):
    return ProductionOrderService(db).create(s.ProductionOrderIn(
        product_id=p["fg"].id, branch_code=p["branch"].branch_code, planned_quantity=qty,
        planned_start_date=date.today(), planned_end_date=date.today() + timedelta(days=3)), p["user"].id)


def _free(db, product, branch):
    return sum(r.quantity for r in db.query(SalesStock).filter(
        SalesStock.product_id == product.id, SalesStock.branch_code == branch.branch_code,
        SalesStock.status == StockStatus.AVAILABLE, SalesStock.is_active.is_(True)))


def _order_gl(db, order_no):
    """Net debit per account over every manufacturing JE of the order."""
    rows = (db.query(ChartOfAccounts.account_code, GeneralLedger.debit_amount, GeneralLedger.credit_amount)
            .join(ChartOfAccounts, ChartOfAccounts.id == GeneralLedger.account_id)
            .filter(GeneralLedger.reference_no == order_no).all())
    net = {}
    for code, dr, cr in rows:
        net[code] = net.get(code, D(0)) + D(str(dr or 0)) - D(str(cr or 0))
    return net


class TestWorkCentersAndBoms:
    def test_work_center_code_is_unique_case_insensitively(self, db, make_user):
        user, _ = make_user()
        wc = _wc(db, user)
        with pytest.raises(HTTPException) as exc:
            _wc(db, user, code=wc["code"].lower())
        assert "already used" in exc.value.detail

    def test_bom_cannot_use_its_own_product(self, db, plant):
        with pytest.raises(HTTPException) as exc:
            BOMService(db).create(s.BOMIn(product_id=plant["fg"].id, version="2",
                                          items=[s.BOMItemIn(product_id=plant["fg"].id, quantity=D(1))]), plant["user"].id)
        assert "cannot use the product it makes" in exc.value.detail

    def test_bom_loop_is_refused_on_activation(self, db, plant):
        # Table top made from Table -> Table -> Table top -> Table
        bom = BOMService(db).create(s.BOMIn(product_id=plant["top"].id,
                                            items=[s.BOMItemIn(product_id=plant["fg"].id, quantity=D(1))]), plant["user"].id)
        with pytest.raises(HTTPException) as exc:
            BOMService(db).activate(bom["id"], plant["user"].id)
        assert "loop" in exc.value.detail

    def test_cost_rollup(self, db, plant):
        bom = BOMService(db).get_out(plant["bom"]["id"])
        # 200 + 4 x 25 + 8.8 x 1 = 308.80; 45 min at 60/h labour and 30/h overhead
        assert bom["material_cost"] == D("308.80")
        assert bom["labor_cost"] == D("45.00") and bom["overhead_cost"] == D("22.50")
        assert bom["unit_cost"] == D("376.30")
        assert bom["status"] == "active" and bom["is_default"] is True

    def test_active_bom_is_read_only_and_copies_to_a_new_draft_version(self, db, plant):
        with pytest.raises(HTTPException):
            BOMService(db).update(plant["bom"]["id"], s.BOMUpdate(description="x"), plant["user"].id)
        copy = BOMService(db).copy(plant["bom"]["id"], s.BOMCopyIn(version="2"), plant["user"].id)
        assert copy["status"] == "draft" and copy["item_count"] == 3 and copy["operation_count"] == 1
        BOMService(db).activate(copy["id"], plant["user"].id)
        assert BOMService(db).get_out(copy["id"])["is_default"] is False  # v1 stays the default
        BOMService(db).set_default(copy["id"], plant["user"].id)
        assert BOMService(db).get_out(plant["bom"]["id"])["is_default"] is False

    def test_update_product_cost_from_rollup(self, db, plant):
        BOMService(db).update_product_cost(plant["bom"]["id"], plant["user"].id)
        assert D(str(plant["fg"].cost_price)) == D("376.30")


class TestProductionOrderLifecycle:
    def test_lines_are_built_from_the_bom_with_scrap_rounded_up(self, db, plant):
        o = _order(db, plant, qty=5)
        req = {m["product_id"]: m["required_quantity"] for m in o["materials"]}
        assert req[plant["top"].id] == 5 and req[plant["leg"].id] == 20
        assert req[plant["screw"].id] == 44  # 8 x 1.1 x 5
        assert o["operations"][0]["planned_minutes"] == D("105.00")  # 30 + 15 x 5
        assert o["order_no"].startswith(f"MO-{plant['branch'].branch_code}-")
        assert o["status"] == "draft" and o["material_status"] == "ready"

    def test_materials_cannot_be_issued_before_release(self, db, plant):
        o = _order(db, plant)
        with pytest.raises(HTTPException) as exc:
            ProductionOrderService(db).issue_materials(o["id"], s.MaterialMoveIn(
                lines=[s.MaterialLineIn(material_id=o["materials"][0]["id"], quantity=1)]), plant["user"].id)
        assert "release it first" in exc.value.detail

    def test_full_run_moves_stock_and_settles_wip(self, db, plant):
        svc, uid = ProductionOrderService(db), plant["user"].id
        o = svc.release(_order(db, plant, qty=5)["id"], uid)
        assert o["standard_unit_cost"] == D("500.00")  # the product's cost price
        mats = {m["product_id"]: m for m in o["materials"]}

        o = svc.issue_materials(o["id"], s.MaterialMoveIn(lines=[
            s.MaterialLineIn(material_id=mats[plant["top"].id]["id"], quantity=5),
            s.MaterialLineIn(material_id=mats[plant["leg"].id]["id"], quantity=22),
        ]), uid)
        assert o["status"] == "in_progress"
        assert _free(db, plant["top"], plant["branch"]) == 5 and _free(db, plant["leg"], plant["branch"]) == 18
        consumed = db.query(SalesStock).filter(SalesStock.consumed_by_production_order_id == o["id"]).all()
        assert sum(r.quantity for r in consumed) == 27 and all(r.status == "consumed" for r in consumed)

        o = svc.return_materials(o["id"], s.MaterialMoveIn(lines=[
            s.MaterialLineIn(material_id=mats[plant["leg"].id]["id"], quantity=2)]), uid)
        assert _free(db, plant["leg"], plant["branch"]) == 20

        op_id = o["operations"][0]["id"]
        o = svc.log_time(o["id"], s.TimeLogIn(operation_id=op_id, minutes=D(120), completed_quantity=4), uid)
        assert o["actual_labor_cost"] == D("120.00") and o["actual_overhead_cost"] == D("60.00")

        o = svc.record_output(o["id"], s.OutputIn(quantity=4, scrap_quantity=1, batch_no="T-1"), uid)
        # backflush for 5 units done: ceil(8 x 1.1 x 5) = 44 screws
        assert _free(db, plant["screw"], plant["branch"]) == 156
        assert o["produced_quantity"] == 4 and o["scrapped_quantity"] == 1
        out = db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]).one()
        assert out.quantity == 4 and out.batch_no == "T-1" and out.good_received_note_id is None
        assert out.location_id == plant["loc"].id and out.status == "available"

        o = svc.complete(o["id"], uid)
        assert o["status"] == "completed" and o["operations"][0]["status"] == "completed"
        o = svc.close(o["id"], uid)
        # actual: materials 5x200 + 20x25 + 44x1 = 1544, time 180 -> 1724; output 4 x 500 = 2000
        assert o["actual_total_cost"] == D("1724.00") and o["output_value"] == D("2000.00")
        assert o["variance_amount"] == D("-276.00") and o["status"] == "closed"

        gl = _order_gl(db, o["order_no"])
        assert gl.get("1230", D(0)) == 0  # WIP fully settled
        assert gl["1210"] == D("2000.00") - D("1544.00")
        assert gl["5040"] == D("-180.00") and gl["5030"] == D("-276.00")
        assert sum(gl.values()) == 0

    def test_output_cannot_exceed_the_planned_quantity(self, db, plant):
        svc, uid = ProductionOrderService(db), plant["user"].id
        o = svc.release(_order(db, plant, qty=2)["id"], uid)
        with pytest.raises(HTTPException) as exc:
            svc.record_output(o["id"], s.OutputIn(quantity=3), uid)
        assert "Only 2 more good unit(s)" in exc.value.detail

    def test_shortage_blocks_the_issue_and_nothing_moves(self, db, plant):
        svc, uid = ProductionOrderService(db), plant["user"].id
        o = svc.release(_order(db, plant, qty=12)["id"], uid)
        assert o["material_status"] in ("partial", "shortage")
        top = next(m for m in o["materials"] if m["product_id"] == plant["top"].id)
        assert top["shortage_quantity"] == 2
        with pytest.raises(HTTPException) as exc:
            svc.issue_materials(o["id"], s.MaterialMoveIn(lines=[s.MaterialLineIn(material_id=top["id"], quantity=12)]), uid)
        assert "12 needed, 10 available" in exc.value.detail

    def test_serial_output_gets_generated_serials(self, db, plant):
        plant["fg"].tracking_type = "serial"
        svc, uid = ProductionOrderService(db), plant["user"].id
        o = svc.release(_order(db, plant, qty=2)["id"], uid)
        svc.record_output(o["id"], s.OutputIn(quantity=2), uid)
        serials = sorted(r.barcode for r in db.query(SalesStock).filter(SalesStock.production_order_id == o["id"]))
        assert serials == [f"{o['order_no']}-0001", f"{o['order_no']}-0002"]
        acts = svc.activity(o["id"])
        assert acts["outputs"][0]["serial_numbers"] == serials

    def test_cancel_needs_issued_materials_returned(self, db, plant):
        svc, uid = ProductionOrderService(db), plant["user"].id
        o = svc.release(_order(db, plant)["id"], uid)
        top = next(m for m in o["materials"] if m["product_id"] == plant["top"].id)
        svc.issue_materials(o["id"], s.MaterialMoveIn(lines=[s.MaterialLineIn(material_id=top["id"], quantity=1)]), uid)
        with pytest.raises(HTTPException):
            svc.cancel(o["id"], s.CancelIn(reason="no longer needed"), uid)
        svc.return_materials(o["id"], s.MaterialMoveIn(lines=[s.MaterialLineIn(material_id=top["id"], quantity=1)]), uid)
        assert svc.cancel(o["id"], s.CancelIn(reason="no longer needed"), uid)["status"] == "cancelled"

    def test_draft_edit_rebuilds_lines(self, db, plant):
        svc = ProductionOrderService(db)
        o = svc.update(_order(db, plant, qty=5)["id"], s.ProductionOrderUpdate(planned_quantity=10), plant["user"].id)
        assert next(m for m in o["materials"] if m["product_id"] == plant["leg"].id)["required_quantity"] == 40


class TestPlanning:
    def test_mrp_nets_per_branch(self, db, plant, make_branch, make_location, make_sales_stock):
        # free table tops in another branch cannot cover this branch's order
        other = make_branch()
        _lot(make_sales_stock, plant["top"], other, make_location(branch=other), 50)
        db.flush()
        _order(db, plant, qty=12)
        lines = [l for l in MrpService(db).run() if l["product_id"] == plant["top"].id]
        assert [(l["branch_code"], l["on_hand_quantity"]) for l in lines] == [(plant["branch"].branch_code, 10)]
        assert lines[0]["suggested_quantity"] == 12 - 10 - lines[0]["on_order_quantity"]

    def test_mrp_nets_free_stock(self, db, plant):
        _order(db, plant, qty=12)
        lines = {l["product_id"]: l for l in MrpService(db).run(branch_codes=[plant["branch"].branch_code])}
        top = lines[plant["top"].id]
        assert top["production_demand"] == 12 and top["on_hand_quantity"] == 10
        # the stock fixture's PO line (1 unit, no GRN item) is still open on order
        assert top["on_order_quantity"] == 1 and top["suggested_quantity"] == 1
        assert top["suggested_action"] == "purchase"
        leg = lines[plant["leg"].id]
        assert leg["suggested_quantity"] == 48 - 40 - leg["on_order_quantity"]

    def test_job_cards_list_open_operations_of_released_orders(self, db, plant):
        _order(db, plant)  # draft: not on the shop floor yet
        o = ProductionOrderService(db).release(_order(db, plant)["id"], plant["user"].id)
        cards = PlanningService(db).job_cards(branch_codes=[plant["branch"].branch_code])
        assert [c["order_no"] for c in cards] == [o["order_no"]]

    def test_dashboard_counts(self, db, plant):
        ProductionOrderService(db).release(_order(db, plant)["id"], plant["user"].id)
        d = PlanningService(db).dashboard(branch_codes=[plant["branch"].branch_code])
        assert d["open_orders"] == 1 and d["late_orders"] == 0
        assert {c["status"]: c["count"] for c in d["status_counts"]}["released"] == 1


class TestApi:
    def test_permission_is_required(self, api, make_user):
        _user, token = make_user()
        assert api(token).get("/api/v1/manufacturing/orders").status_code == 403

    def test_orders_are_branch_scoped(self, db, api, plant, make_user, make_branch):
        o = _order(db, plant)
        other = make_branch()
        _u, token = make_user(permissions=[("production_orders", "view")], branches=[other])
        client = api(token)
        assert client.get(f"/api/v1/manufacturing/orders/{o['id']}").status_code == 403
        assert client.get("/api/v1/manufacturing/orders").json()["total"] == 0

    def test_create_via_api(self, db, api, plant, make_user):
        _u, token = make_user(permissions=[("production_orders", "create")], branches=[plant["branch"]])
        r = api(token).post("/api/v1/manufacturing/orders", json={
            "product_id": plant["fg"].id, "branch_code": plant["branch"].branch_code, "planned_quantity": 3,
            "planned_start_date": str(date.today()), "planned_end_date": str(date.today())})
        assert r.status_code == 201, r.text
        assert r.json()["bom_id"] == plant["bom"]["id"]


def test_gl_regenerators_cover_manufacturing_postings():
    from app.modules.finance.gl_regenerators import get_regenerator
    for key in (("MfgMaterialTxn", None), ("MfgTimeLog", None), ("MfgOutput", None),
                ("ProductionOrder", "Production Variance")):
        assert get_regenerator(*key) is not None, key
