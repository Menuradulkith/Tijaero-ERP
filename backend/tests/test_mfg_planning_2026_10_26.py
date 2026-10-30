"""Manufacturing planning: demand-driven MRP (quotation demand, BOM explosion, reordering
rules), firming suggestions into purchase / production orders, and make-to-order
production orders raised from quotation lines."""
from datetime import date, timedelta

import pytest

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock
from app.modules.manufacturing import schemas as s
from app.modules.manufacturing.planning import MrpService, ReorderRuleService
from app.modules.manufacturing.service import ProductionOrderService
from app.modules.purchasing.models import PurchasingOrder
from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
from tests.test_manufacturing_2026_10_26 import _order, plant  # noqa: F401  (fixture)

Q = "/api/v1/sales/quotes"
A = "/api/v1/common/approvals"
M = "/api/v1/manufacturing"


def _rows(db, p, product):
    return {r["product_id"]: r for r in MrpService(db).run(branch_codes=[p["branch"].branch_code])}.get(product.id)


@pytest.fixture
def quote(superclient, plant, make_customer):  # noqa: F811
    customer = make_customer()

    def _make(qty=4, product=None, approve=True):
        r = superclient.post(f"{Q}/", json={
            "branch_code": plant["branch"].branch_code, "customer_id": customer.id,
            "valid_until": (date.today() + timedelta(days=14)).isoformat(),
            "items": [{"product_id": (product or plant["fg"]).id, "quantity": qty, "selling_price": 900,
                       "minimum_selling_price": 600, "warrenty_month": "12"}],
        })
        assert r.status_code == 201, r.text
        j = r.json()
        if approve:
            assert superclient.post(f"{A}/{j['approval_id']}/approve", json={}).status_code == 200
        return superclient.get(f"{Q}/{j['id']}").json()
    return _make


class TestDemandDrivenMrp:
    def test_quotation_demand_explodes_through_the_bom(self, db, plant, quote):  # noqa: F811
        quote(qty=12)
        table = _rows(db, plant, plant["fg"])
        assert table["quote_demand"] == 12 and table["suggested_quantity"] == 12
        assert table["suggested_action"] == "produce" and table["low_level_code"] == 0
        top = _rows(db, plant, plant["top"])
        assert top["planned_demand"] == 12 and top["low_level_code"] == 1
        # 10 free + 1 open on the stock fixture's PO
        assert top["suggested_quantity"] == 1 and top["suggested_action"] == "purchase"
        assert any(src["source_type"] == "planned" for src in top["demand_sources"])

    def test_unapproved_quotations_are_not_demand(self, db, plant, quote):  # noqa: F811
        quote(qty=12, approve=False)
        assert _rows(db, plant, plant["fg"]) is None

    def test_reorder_rule_orders_up_to_max_in_multiples(self, db, plant):  # noqa: F811
        ReorderRuleService(db).create(s.ReorderRuleIn(
            product_id=plant["leg"].id, branch_code=plant["branch"].branch_code,
            min_quantity=50, max_quantity=100, multiple_quantity=25), plant["user"].id)
        leg = _rows(db, plant, plant["leg"])
        projected = 40 + leg["on_order_quantity"]
        assert leg["projected_quantity"] == projected
        assert leg["suggested_quantity"] == -(-(100 - projected) // 25) * 25
        assert leg["demand_sources"][-1]["source_type"] == "reorder"

    def test_rule_is_unique_per_product_and_branch(self, db, plant):  # noqa: F811
        data = s.ReorderRuleIn(product_id=plant["leg"].id, branch_code=plant["branch"].branch_code, min_quantity=5)
        ReorderRuleService(db).create(data, plant["user"].id)
        with pytest.raises(Exception) as exc:
            ReorderRuleService(db).create(data, plant["user"].id)
        assert "already has a reordering rule" in str(exc.value.detail)


class TestFirming:
    def test_purchase_suggestion_becomes_a_po_that_covers_it(self, db, plant, make_supplier):  # noqa: F811
        _order(db, plant, qty=12)  # needs 12 tops, 10 free + 1 on order
        sup = make_supplier()
        res = MrpService(db).create_purchase_orders(s.MrpPurchaseIn(
            branch_code=plant["branch"].branch_code, payment_method="cash",
            lines=[s.MrpPurchaseLineIn(product_id=plant["top"].id, quantity=1, supplier_id=sup.id)]), plant["user"].id)
        po = db.query(PurchasingOrder).filter(PurchasingOrder.id == res["documents"][0]["id"]).one()
        assert po.status == "pending_approval" and po.first_suppliers_id == sup.id
        assert po.items[0].unit_price == 200  # the component's standard cost when the supplier has no price
        assert _rows(db, plant, plant["top"])["suggested_quantity"] == 0

    def test_expected_date_in_the_past_is_moved_to_today(self, db, plant, make_supplier):  # noqa: F811
        # a browser in a timezone ahead of UTC can send yesterday's date
        res = MrpService(db).create_purchase_orders(s.MrpPurchaseIn(
            branch_code=plant["branch"].branch_code, payment_method="cash", expected_date=date.today() - timedelta(days=1),
            lines=[s.MrpPurchaseLineIn(product_id=plant["top"].id, quantity=1, supplier_id=make_supplier().id)]),
            plant["user"].id)
        po = db.query(PurchasingOrder).filter(PurchasingOrder.id == res["documents"][0]["id"]).one()
        assert po.required_date >= po.purchasing_order_date

    def test_credit_po_for_a_supplier_with_a_credit_limit(self, db, plant, make_supplier):  # noqa: F811
        # the PO credit check used to multiply the Decimal credit limit by a float
        sup = make_supplier()
        sup.max_credit_limit = 100000
        db.flush()
        res = MrpService(db).create_purchase_orders(s.MrpPurchaseIn(
            branch_code=plant["branch"].branch_code, payment_method="Credit",
            lines=[s.MrpPurchaseLineIn(product_id=plant["top"].id, quantity=1, supplier_id=sup.id)]), plant["user"].id)
        assert len(res["documents"]) == 1

    def test_production_suggestion_becomes_a_draft_order(self, db, plant, quote):  # noqa: F811
        quote(qty=5)
        res = MrpService(db).create_production_orders(s.MrpProduceIn(
            branch_code=plant["branch"].branch_code, lines=[s.MrpProduceLineIn(
                product_id=plant["fg"].id, quantity=5, planned_start_date=date.today(),
                planned_end_date=date.today())]), plant["user"].id)
        order = ProductionOrderService(db).get_out(res["documents"][0]["id"])
        assert order["status"] == "draft" and order["planned_quantity"] == 5
        table = _rows(db, plant, plant["fg"])
        assert table["in_production_quantity"] == 5 and table["suggested_quantity"] == 0


class TestMakeToOrder:
    def test_order_from_quote_line_reserves_its_output(self, db, superclient, plant, quote):  # noqa: F811
        q = quote(qty=4)
        qi_id = q["items"][0]["id"]
        r = superclient.post(f"{M}/orders/from-quote", json={"quote_item_id": qi_id})
        assert r.status_code == 201, r.text
        order = r.json()
        assert order["planned_quantity"] == 4 and order["quote_no"] == q["quote_no"]
        db.expire_all()
        assert db.query(SalesQuoteItem).get(qi_id).item_status == "mo_created"
        assert db.query(SalesQuote).get(q["id"]).status == "partially_processed"

        # the line is covered: no second order, no MRP demand, no PO for it
        again = superclient.post(f"{M}/orders/from-quote", json={"quote_item_id": qi_id})
        assert again.status_code == 400 and "fully covered" in again.json()["detail"]
        assert _rows(db, plant, plant["fg"]) is None
        demand = superclient.get(f"{M}/quote-demand", params={"branch_code": plant["branch"].branch_code}).json()
        line = next(d for d in demand if d["quote_item_id"] == qi_id)
        assert line["in_production_quantity"] == 4 and line["remaining_quantity"] == 0

        svc = ProductionOrderService(db)
        svc.release(order["id"], plant["user"].id)
        svc.record_output(order["id"], s.OutputIn(quantity=3), plant["user"].id)
        rows = db.query(SalesStock).filter(SalesStock.production_order_id == order["id"]).all()
        assert [(r.quantity, r.status, r.reserved_for_quote_item_id) for r in rows] == [(3, StockStatus.RESERVED, qi_id)]

    def test_cancelling_the_order_reopens_the_quote_line(self, db, superclient, plant, quote):  # noqa: F811
        q = quote(qty=2)
        qi_id = q["items"][0]["id"]
        order = superclient.post(f"{M}/orders/from-quote", json={"quote_item_id": qi_id, "quantity": 2}).json()
        ProductionOrderService(db).cancel(order["id"], s.CancelIn(reason="customer changed mind"), plant["user"].id)
        db.expire_all()
        assert db.query(SalesQuoteItem).get(qi_id).item_status == "pending"
        assert _rows(db, plant, plant["fg"])["quote_demand"] == 2

    def test_unapproved_quote_line_cannot_be_produced(self, superclient, plant, quote):  # noqa: F811
        q = quote(qty=2, approve=False)
        r = superclient.post(f"{M}/orders/from-quote", json={"quote_item_id": q["items"][0]["id"]})
        assert r.status_code == 400 and "approved" in r.json()["detail"]


class TestPermissions:
    def test_firming_purchases_needs_purchase_order_create(self, api, plant, make_user, make_supplier):  # noqa: F811
        _u, token = make_user(permissions=[("mrp", "update")], branches=[plant["branch"]])
        r = api(token).post(f"{M}/mrp/purchase-orders", json={
            "branch_code": plant["branch"].branch_code,
            "lines": [{"product_id": plant["top"].id, "quantity": 1, "supplier_id": make_supplier().id}]})
        assert r.status_code == 403 and "purchase_orders:create" in r.json()["detail"]

    def test_reorder_rules_need_mrp_update(self, api, plant, make_user):  # noqa: F811
        _u, token = make_user(permissions=[("mrp", "view")], branches=[plant["branch"]])
        r = api(token).post(f"{M}/reorder-rules", json={
            "product_id": plant["leg"].id, "branch_code": plant["branch"].branch_code, "min_quantity": 5})
        assert r.status_code == 403
