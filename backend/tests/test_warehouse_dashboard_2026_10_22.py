"""Warehouse dashboard accuracy: quotation-sourced orders reserve (not sell) while pending,
Sold Today counts only units that are really sold, and a cancelled order reopens its quotation."""
from datetime import date, timedelta

import pytest

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock
from app.modules.inventory.service import SalesStockService

Q = "/api/v1/sales/quotes"
S = "/api/v1/sales"
A = "/api/v1/common/approvals"


@pytest.fixture
def world(db, make_branch, make_customer, make_product, make_sales_stock):
    branch, product = make_branch(), make_product()
    units = [make_sales_stock(product=product, branch=branch) for _ in range(3)]
    return {"branch": branch, "customer": make_customer(), "product": product, "units": units}


def _approved_quote(c, w, qty):
    r = c.post(f"{Q}/", json={
        "branch_code": w["branch"].branch_code, "customer_id": w["customer"].id,
        "valid_until": (date.today() + timedelta(days=14)).isoformat(),
        "items": [{"product_id": w["product"].id, "quantity": qty, "selling_price": 300,
                   "minimum_selling_price": 100, "warrenty_month": "12"}],
    })
    assert r.status_code == 201, r.text
    assert c.post(f"{A}/{r.json()['approval_id']}/approve", json={}).status_code == 200
    return c.get(f"{Q}/{r.json()['id']}").json()


def _partial_so(c, quote, qty):
    return c.post(f"{Q}/{quote['id']}/partial-so", json={
        "items": [{"item_id": quote["items"][0]["id"], "quantity": qty}], "payment_method": "cash",
    })


def _statuses(db, w):
    for u in w["units"]:
        db.refresh(u)
    return sorted(str(u.status) for u in w["units"])


def _kpi(db, w):
    return SalesStockService(db).get_summary(branch_code=w["branch"].branch_code)


class TestPendingQuotationOrderReservesStock:
    def test_units_are_reserved_not_sold_until_the_order_is_approved(self, superclient, db, world):
        quote = _approved_quote(superclient, world, qty=2)
        r = _partial_so(superclient, quote, 2)
        assert r.status_code == 200, r.text
        assert r.json()["approval_status"] == "pending_approval"

        assert _statuses(db, world).count("reserved") == 2
        assert _statuses(db, world).count("sold") == 0
        k = _kpi(db, world)
        assert (k["in_stock"], k["reserved"], k["sold_today"]) == (1, 2, 0)
        # a held unit is not linked to the quote item any more: no second order can pick it up
        assert db.query(SalesStock).filter(SalesStock.reserved_for_quote_item_id.isnot(None),
                                           SalesStock.id.in_([u.id for u in world["units"]])).count() == 0

        assert superclient.post(f"{S}/{r.json()['id']}/approve").status_code == 200
        assert _statuses(db, world).count("sold") == 2
        k = _kpi(db, world)
        assert (k["in_stock"], k["reserved"], k["sold_today"]) == (1, 0, 2)


class TestSoldToday:
    def test_cancelled_order_is_not_counted(self, superclient, db, world):
        quote = _approved_quote(superclient, world, qty=2)
        inv = _partial_so(superclient, quote, 2).json()
        assert superclient.post(f"{S}/{inv['id']}/approve").status_code == 200
        assert _kpi(db, world)["sold_today"] == 2

        quote2 = _approved_quote(superclient, world, qty=1)
        inv2 = _partial_so(superclient, quote2, 1).json()
        assert _kpi(db, world)["sold_today"] == 2  # pending: held, not sold
        assert superclient.post(f"{S}/{inv2['id']}/cancel").status_code == 200
        k = _kpi(db, world)
        assert k["sold_today"] == 2
        assert k["in_stock"] == 1

    def test_processed_return_is_not_counted(self, superclient, db, world):
        quote = _approved_quote(superclient, world, qty=2)
        inv = _partial_so(superclient, quote, 2).json()
        assert superclient.post(f"{S}/{inv['id']}/approve").status_code == 200
        assert _kpi(db, world)["sold_today"] == 2
        ret = superclient.post(f"{S}/{inv['id']}/return-full", json={"payment_method": "cash", "reason": "x"})
        assert ret.status_code == 201, ret.text
        assert superclient.post(f"{A}/{ret.json()['approval_id']}/approve", json={}).status_code == 200
        processed = superclient.post(f"{S}/returns/{ret.json()['id']}/process", json={})
        assert processed.status_code == 200, processed.text
        assert _kpi(db, world)["sold_today"] == 0
        assert _kpi(db, world)["in_stock"] == 3


class TestCancelledOrderReopensQuotation:
    def test_cancel_releases_the_quote_line_and_allows_a_new_order(self, superclient, db, world):
        quote = _approved_quote(superclient, world, qty=2)
        inv = _partial_so(superclient, quote, 2).json()
        assert superclient.get(f"{Q}/{quote['id']}").json()["status"] == "completed"

        assert superclient.post(f"{S}/{inv['id']}/cancel").status_code == 200
        after = superclient.get(f"{Q}/{quote['id']}").json()
        assert after["status"] == "approved"
        assert after["items"][0]["item_status"] == "pending"
        assert after["items"][0]["converted_qty"] == 0
        assert _statuses(db, world) == ["available"] * 3

        again = _partial_so(superclient, after, 2)
        assert again.status_code == 200, again.text
        assert superclient.get(f"{Q}/{quote['id']}").json()["status"] == "completed"

    def test_partial_quantity_cancel_returns_only_what_the_order_took(self, superclient, db, world):
        quote = _approved_quote(superclient, world, qty=3)
        so = _partial_so(superclient, quote, 1).json()
        item = superclient.get(f"{Q}/{quote['id']}").json()["items"][0]
        assert (item["converted_qty"], item["item_status"]) == (1, "so_created")
        assert superclient.post(f"{S}/{so['id']}/cancel").status_code == 200
        item = superclient.get(f"{Q}/{quote['id']}").json()["items"][0]
        assert (item["converted_qty"], item["item_status"]) == (0, "pending")
        assert superclient.get(f"{Q}/{quote['id']}").json()["status"] == "approved"

    def test_quantity_ordered_from_suppliers_stays_after_cancel(self, superclient, db, world):
        from app.modules.sales.quotation_models import SalesQuoteItem

        quote = _approved_quote(superclient, world, qty=3)
        item_id = quote["items"][0]["id"]
        qi = db.query(SalesQuoteItem).filter(SalesQuoteItem.id == item_id).one()
        qi.converted_qty, qi.item_status = 1, "procurement"  # 1 unit already on a PO
        db.flush()
        so = _partial_so(superclient, quote, 2)
        assert so.status_code == 200, so.text
        assert superclient.post(f"{S}/{so.json()['id']}/cancel").status_code == 200
        item = superclient.get(f"{Q}/{quote['id']}").json()["items"][0]
        assert (item["converted_qty"], item["item_status"]) == (1, "procurement")
        assert superclient.get(f"{Q}/{quote['id']}").json()["status"] == "partially_processed"

    def test_reject_also_releases(self, superclient, db, world):
        quote = _approved_quote(superclient, world, qty=1)
        inv = _partial_so(superclient, quote, 1).json()
        r = superclient.post(f"{S}/{inv['id']}/reject", json={"reason": "no"})
        assert r.status_code == 200, r.text
        assert superclient.get(f"{Q}/{quote['id']}").json()["status"] == "approved"
        assert _statuses(db, world) == ["available"] * 3


class TestStockInTransit:
    def test_transfer_units_show_as_in_transit_and_stay_out_of_on_hand(self, db, make_branch, make_product, make_sales_stock):
        branch, product = make_branch(), make_product()
        make_sales_stock(product=product, branch=branch)
        make_sales_stock(product=product, branch=branch, status=StockStatus.TRANSFER_PENDING)
        make_sales_stock(product=product, branch=branch, status=StockStatus.IN_TRANSIT)
        svc = SalesStockService(db)

        k = svc.get_summary(branch_code=branch.branch_code)
        assert (k["in_stock"], k["in_transit"]) == (1, 2)
        row = svc.get_stock_summary(branch_code=branch.branch_code)["items"][0]
        assert row["in_transit_quantity"] == 2
        assert (row["total_quantity"], row["available_quantity"]) == (1, 1)

    def test_product_with_only_transit_units_is_listed(self, db, make_branch, make_product, make_sales_stock):
        branch, product = make_branch(), make_product()
        make_sales_stock(product=product, branch=branch, status=StockStatus.IN_TRANSIT)
        res = SalesStockService(db).get_stock_summary(branch_code=branch.branch_code)
        assert res["total"] == 1
        row = res["items"][0]
        assert (row["in_transit_quantity"], row["total_quantity"], row["total_value"]) == (1, 0, 0)


class TestStockValuation:
    def test_value_uses_purchase_cost_not_the_current_product_cost(self, db, make_branch, make_product, make_sales_stock):
        from decimal import Decimal
        from app.modules.purchasing.models import PurchasingOrderItems

        branch, product = make_branch(), make_product()
        a = make_sales_stock(product=product, branch=branch)
        b = make_sales_stock(product=product, branch=branch)
        db.get(PurchasingOrderItems, a.purchasing_order_items_id).unit_price = 80
        db.get(PurchasingOrderItems, b.purchasing_order_items_id).unit_price = 100
        product.cost_price = 150  # a later cost change must not revalue the stock on the shelf
        db.flush()

        row = SalesStockService(db).get_stock_summary(branch_code=branch.branch_code)["items"][0]
        assert Decimal(str(row["total_value"])) == Decimal("180.00")
        assert Decimal(str(row["unit_cost"])) == Decimal("90.00")

    def test_sold_and_transit_units_are_not_valued(self, db, make_branch, make_product, make_sales_stock):
        from decimal import Decimal

        branch, product = make_branch(), make_product()
        make_sales_stock(product=product, branch=branch)
        make_sales_stock(product=product, branch=branch, status=StockStatus.SOLD)
        make_sales_stock(product=product, branch=branch, status=StockStatus.IN_TRANSIT)
        row = SalesStockService(db).get_stock_summary(branch_code=branch.branch_code)["items"][0]
        assert Decimal(str(row["total_value"])) == Decimal("100.00")
