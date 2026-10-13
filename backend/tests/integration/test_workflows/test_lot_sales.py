"""
QA suite - selling, cancelling and returning batch/none-tracked stock lots.

A lot is one sales_stock row carrying ``quantity``. Consuming part of it splits
the lot, so the sold units become their own row that follows the normal status
flow while the remainder stays available.

All tests run inside the rolled-back transactional ``db`` fixture.
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import func

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock
from app.modules.inventory.lots import split_lot, take_units
from app.modules.sales.models import InvoiceItems
from app.modules.sales.service import sales_service
from tests.integration.test_workflows.test_sales_guardrails import (
    _invoice,
    _invoice_item,
    _location,
    _return_create,
)

S = "/api/v1/sales"


def _units(db, product, status):
    return int(
        db.query(func.coalesce(func.sum(SalesStock.quantity), 0))
        .filter(SalesStock.product_id == product.id, SalesStock.status == status)
        .scalar()
    )


@pytest.fixture
def lot_shop(db, make_branch, make_customer, make_product, make_sales_stock):
    """A branch + customer + batch-tracked product holding one lot of 100 units."""
    branch, product = make_branch(), make_product()
    product.tracking_type = "batch"
    lot = make_sales_stock(product=product, branch=branch)
    lot.barcode = None
    lot.quantity = 100
    lot.batch_no = "B1"
    db.flush()
    return branch, make_customer(), product, lot


def _order(shop, rep_id, qty, **over):
    branch, customer, product, _ = shop
    body = {
        "branch_code": branch.branch_code,
        "customer_id": customer.id,
        "sale_rep_id": rep_id,
        "payment_method": "cash",
        "cash_amount": 10.0 * qty,
        "items": [
            {"product_id": product.id, "quantity": qty, "selling_price": 10.0,
             "minimum_selling_price": 1.0, "warrenty_month": "0"}
        ],
    }
    body.update(over)
    return body


class TestLotHelpers:
    def test_split_lot_conserves_units(self, db, lot_shop):
        _, _, product, lot = lot_shop
        part = split_lot(db, lot, 30)
        assert (part.quantity, lot.quantity) == (30, 70)
        assert part.id != lot.id and part.batch_no == "B1" and part.barcode is None
        assert split_lot(db, lot, 70) is lot  # whole lot -> same row, no split
        with pytest.raises(ValueError):
            split_lot(db, lot, 71)

    def test_take_units_spans_lots(self, db, lot_shop):
        _, _, product, lot = lot_shop
        taken = take_units(db, [lot], 100)
        assert [t.quantity for t in taken] == [100] and taken[0] is lot


class TestSellingLots:
    def test_partial_sale_splits_the_lot(self, db, superclient, superuser, lot_shop):
        _, _, product, lot = lot_shop
        r = superclient.post(S + "/", json=_order(lot_shop, superuser[0].id, 30))
        assert r.status_code == 201, r.text
        assert _units(db, product, StockStatus.AVAILABLE) == 70
        assert _units(db, product, StockStatus.SOLD) == 30

        (item,) = db.query(InvoiceItems).filter(InvoiceItems.invoice_id == r.json()["id"]).all()
        assert item.quantity == 30 and float(item.line_total) == 300.0
        sold = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).one()
        assert (sold.quantity, sold.status, sold.batch_no) == (30, StockStatus.SOLD, "B1")

    def test_cannot_sell_more_than_the_lot(self, db, superclient, superuser, lot_shop):
        _, _, product, _ = lot_shop
        r = superclient.post(S + "/", json=_order(lot_shop, superuser[0].id, 101))
        assert r.status_code in (400, 409, 422), r.text
        assert _units(db, product, StockStatus.AVAILABLE) == 100

    def test_available_quantity_is_units_not_rows(self, db, superclient, superuser, lot_shop):
        _, _, product, _ = lot_shop
        superclient.post(S + "/", json=_order(lot_shop, superuser[0].id, 30))
        r = superclient.get(S + "/available-products")
        assert r.status_code == 200, r.text
        row = next(p for p in r.json() if p["id"] == product.id)
        assert row["available_quantity"] == 70

    def test_cancelling_a_pending_order_releases_the_units(self, db, superclient, superuser, lot_shop):
        _, _, product, _ = lot_shop
        r = superclient.post(
            S + "/",
            json=_order(lot_shop, superuser[0].id, 40, payment_method="credit", cash_amount=0,
                        credit_amount=400.0, override_credit_validation=True),
        )
        assert r.status_code == 201, r.text
        assert _units(db, product, StockStatus.RESERVED) == 40
        assert _units(db, product, StockStatus.AVAILABLE) == 60
        assert superclient.post(f"{S}/{r.json()['id']}/cancel").status_code == 200
        assert _units(db, product, StockStatus.RESERVED) == 0
        assert _units(db, product, StockStatus.AVAILABLE) == 100


class TestReturningLots:
    def _sold_lot(self, db, make_branch, make_customer, make_product, make_sales_stock, make_user, qty=10):
        branch, customer, product = make_branch(), make_customer(), make_product()
        product.tracking_type = "none"
        user, _ = make_user(branches=[branch])
        lot = make_sales_stock(product=product, branch=branch, status=StockStatus.SOLD, is_active=False)
        lot.barcode, lot.quantity = None, qty
        invoice = _invoice(db, branch, customer, subtotal=str(10 * qty))
        item = _invoice_item(db, invoice, product, qty=qty, price="10.00")
        item.sales_stock_id = lot.id
        db.flush()
        return product, user, _location(db, branch), invoice, item, lot

    def test_partial_returns_restock_only_the_returned_units(
        self, db, make_branch, make_customer, make_product, make_sales_stock, make_user
    ):
        product, user, location, invoice, item, lot = self._sold_lot(
            db, make_branch, make_customer, make_product, make_sales_stock, make_user
        )

        ret = sales_service.create_sale_return(db, _return_create(invoice, location, item, qty=4), user_id=user.id)
        ret.status = "approved"
        db.flush()
        sales_service.process_sale_return(db, ret.id, user_id=user.id)
        assert _units(db, product, StockStatus.AVAILABLE) == 4
        assert _units(db, product, StockStatus.SOLD) == 6

        ret2 = sales_service.create_sale_return(db, _return_create(invoice, location, item, qty=6), user_id=user.id)
        ret2.status = "approved"
        db.flush()
        sales_service.process_sale_return(db, ret2.id, user_id=user.id)
        assert _units(db, product, StockStatus.AVAILABLE) == 10
        assert _units(db, product, StockStatus.SOLD) == 0
