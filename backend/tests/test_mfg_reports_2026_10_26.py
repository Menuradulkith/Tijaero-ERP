"""Manufacturing print documents (production order, job card) and Report Center
reports (WIP, cost variance, production summary, BOM cost roll-up, traceability)."""
from decimal import Decimal as D

import pytest

from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.service import BOMService, ProductionOrderService
from app.reporting.center.core import RunContext, execute, get_report
from tests.test_manufacturing_2026_10_26 import _order, plant  # noqa: F401  (fixture)

DOCS = "/api/v1/reporting/documents"
RC = "/api/v1/reporting/center"


@pytest.fixture
def run(db, plant, make_user):  # noqa: F811
    """A released order with materials issued, time booked and some output; returns it
    with a superuser report context."""
    svc, uid = ProductionOrderService(db), plant["user"].id
    o = svc.release(_order(db, plant, qty=5)["id"], uid)
    mats = {m["product_id"]: m for m in o["materials"]}
    svc.issue_materials(o["id"], s.MaterialMoveIn(lines=[
        s.MaterialLineIn(material_id=mats[plant["top"].id]["id"], quantity=5),
        s.MaterialLineIn(material_id=mats[plant["leg"].id]["id"], quantity=20)]), uid)
    svc.log_time(o["id"], s.TimeLogIn(operation_id=o["operations"][0]["id"], minutes=D(60), completed_quantity=4), uid)
    o = svc.record_output(o["id"], s.OutputIn(quantity=4, scrap_quantity=1, batch_no="TBL-7"), uid)
    admin, _ = make_user(is_superuser=True)
    return dict(order=o, ctx=RunContext(db, admin), svc=svc, uid=uid)


def _report(ctx, key, **params):
    return execute(ctx, get_report(key), params)[1]


def _table(result, key):
    return next(t for t in result.tables if t.key == key)


def _metric(result, label):
    return next(m.value for m in result.metrics if m.label == label)


class TestDocuments:
    def test_production_order_and_job_card_print(self, superclient, run):
        oid, no = run["order"]["id"], run["order"]["order_no"]
        order = superclient.get(f"{DOCS}/production-order/{oid}")
        assert order.status_code == 200, order.text
        assert "PRODUCTION ORDER" in order.text and no in order.text and "Operations (routing)" in order.text
        assert "TBL-7" in order.text  # output received
        card = superclient.get(f"{DOCS}/job-card/{oid}")
        assert card.status_code == 200 and "JOB CARD" in card.text and "Components to pick" in card.text

    def test_draft_order_cannot_be_printed(self, db, superclient, plant):  # noqa: F811
        draft = _order(db, plant)
        r = superclient.get(f"{DOCS}/production-order/{draft['id']}")
        assert r.status_code == 400 and "only approved documents" in r.json()["detail"]

    def test_document_permissions_and_branch(self, api, run, make_user, make_branch, plant):  # noqa: F811
        oid = run["order"]["id"]
        _u, token = make_user(permissions=[("shop_floor", "view")], branches=[plant["branch"]])
        assert api(token).get(f"{DOCS}/production-order/{oid}").status_code == 403
        assert api(token).get(f"{DOCS}/job-card/{oid}").status_code == 200
        _u, other = make_user(permissions=[("production_orders", "view")], branches=[make_branch()])
        assert api(other).get(f"{DOCS}/production-order/{oid}").status_code == 404

    def test_print_template_types_include_manufacturing(self, superclient):
        keys = {d["key"] for d in superclient.get("/api/v1/reporting/print-templates/document-types").json()}
        assert {"production-order", "job-card"} <= keys


class TestReports:
    def test_wip_matches_order_costs_and_the_gl(self, run, plant):  # noqa: F811
        o = run["order"]
        r = _report(run["ctx"], "manufacturing.wip", branch_code=plant["branch"].branch_code)
        row = next(x for x in _table(r, "orders").rows if x["order_no"] == o["order_no"])
        assert row["wip"] == D(str(o["actual_total_cost"])) - D(str(o["output_value"]))
        assert _metric(r, "GL 1230 balance") == _metric(r, "WIP value")

    def test_variance_after_close(self, run, plant):  # noqa: F811
        svc, uid, oid = run["svc"], run["uid"], run["order"]["id"]
        svc.complete(oid, uid)
        closed = svc.close(oid, uid)
        r = _report(run["ctx"], "manufacturing.variance", date_from="2000-01-01", branch_code=plant["branch"].branch_code)
        row = next(x for x in _table(r, "orders").rows if x["order_no"] == closed["order_no"])
        assert row["variance"] == D(str(closed["variance_amount"]))
        assert row["actual_cost"] - row["output_value"] == row["variance"]
        # closed orders leave WIP
        wip = _report(run["ctx"], "manufacturing.wip", branch_code=plant["branch"].branch_code)
        assert all(x["order_no"] != closed["order_no"] for x in _table(wip, "orders").rows)

    def test_production_summary(self, run, plant):  # noqa: F811
        r = _report(run["ctx"], "manufacturing.production_summary", date_from="2000-01-01",
                    branch_code=plant["branch"].branch_code)
        product = next(x for x in _table(r, "products").rows if x["item_code"] == plant["fg"].item_code)
        assert (product["good_qty"], product["scrap_qty"], product["scrap_pct"]) == (4, 1, D("20.00"))
        center = next(x for x in _table(r, "work_centers").rows if x["code"] == plant["wc"]["code"])
        assert center["hours"] == D("1.00")

    def test_bom_cost_matches_the_rollup(self, db, run, plant):  # noqa: F811
        r = _report(run["ctx"], "manufacturing.bom_cost", product_id=plant["fg"].id, show_lines=True)
        row = _table(r, "boms").rows[0]
        assert row["unit_cost"] == BOMService(db).get_out(plant["bom"]["id"])["unit_cost"]
        assert len(_table(r, "lines").rows) == 4  # 3 components + 1 operation

    def test_traceability_by_order_and_by_batch(self, run, plant):  # noqa: F811
        no = run["order"]["order_no"]
        r = _report(run["ctx"], "manufacturing.traceability", order_no=no)
        comps = _table(r, "components").rows
        assert {c["item_code"] for c in comps} == {plant["top"].item_code, plant["leg"].item_code, plant["screw"].item_code}
        assert all(c["grn_no"] for c in comps)  # purchased lots trace back to their GRN
        outs = _table(r, "outputs").rows
        assert [(x["batch_no"], x["qty"]) for x in outs] == [("TBL-7", 4)]
        by_lot = _report(run["ctx"], "manufacturing.traceability", lot="tbl-7")
        assert [x["order_no"] for x in _table(by_lot, "orders").rows] == [no]

    def test_traceability_asks_for_an_order_or_lot(self, run):
        r = _report(run["ctx"], "manufacturing.traceability")
        assert not r.tables and "Enter a production order number" in r.notes[0]

    def test_reports_are_in_the_catalog_and_export(self, superclient, run):
        keys = {r["key"] for r in superclient.get(f"{RC}/catalog").json()["reports"]}
        assert {"manufacturing.wip", "manufacturing.variance", "manufacturing.production_summary",
                "manufacturing.bom_cost", "manufacturing.traceability"} <= keys
        r = superclient.post(f"{RC}/reports/manufacturing.wip/export", json={"format": "csv"})
        assert r.status_code == 200 and run["order"]["order_no"] in r.text

    def test_branch_user_only_sees_own_branch(self, db, run, make_user, make_branch):
        other_user, _ = make_user(permissions=[("production_orders", "view")], branches=[make_branch()])
        r = _report(RunContext(db, other_user), "manufacturing.wip")
        assert all(x["order_no"] != run["order"]["order_no"] for x in _table(r, "orders").rows)
