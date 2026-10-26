"""Purchase returns for serial / batch / none tracked stock, through the HTTP API.

A serial unit is returned by barcode; batch and none lots by sales_stock_id + quantity. Each
return carries a reason and comment, shows them on the detail, and is raised against a GRN
that the GRN list reports with its creator and PO approval fields.
"""

from __future__ import annotations

import pytest

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock

URL = "/api/v1/purchasing/returns"


def _stock(make_sales_stock, db, tracking_type):
    stock = make_sales_stock()
    stock.product.tracking_type = tracking_type
    if tracking_type == "serial":
        stock.quantity = 1
    else:
        stock.barcode, stock.quantity = None, 10
        stock.batch_no = "B1" if tracking_type == "batch" else None
    db.flush()
    return stock


def _payload(stock, *, reason="Quality issue", remark="bad unit", quantity=1):
    item = {
        "product_id": stock.product_id,
        "purchasing_price": 100,
        "return_price": 100,
        "quantity": quantity,
    }
    if stock.barcode:
        item["barcode"] = stock.barcode
    else:
        item["sales_stock_id"] = stock.id
    return {
        "branch_code": stock.branch_code,
        "goodreceivednote_id": stock.good_received_note_id,
        "reason": reason,
        "remark": remark,
        "require_approval": True,
        "items": [item],
    }


@pytest.mark.parametrize("tracking_type,quantity", [("serial", 1), ("batch", 4), ("none", 4)])
def test_return_with_reason_for_each_tracking_type(superclient, db, make_sales_stock, tracking_type, quantity):
    stock = _stock(make_sales_stock, db, tracking_type)

    r = superclient.post(URL, json=_payload(stock, quantity=quantity))
    assert r.status_code == 201, r.text
    body = r.json()
    assert (body["reason"], body["remark"], body["status"]) == ("Quality issue", "bad unit", "pending")

    detail = superclient.get(f"{URL}/{body['id']}").json()
    assert detail["reason"] == "Quality issue"
    (item,) = detail["items"]
    assert item["quantity"] == quantity
    assert (item["barcode"] is not None) == (tracking_type == "serial")

    listed = [x for x in superclient.get(URL).json() if x["id"] == body["id"]]
    assert listed and listed[0]["reason"] == "Quality issue"

    if tracking_type == "serial":
        assert db.query(SalesStock).get(stock.id).status == "return_pending"
    else:
        # The returned units were split off the lot; the rest stays available.
        left = (
            db.query(SalesStock)
            .filter(SalesStock.product_id == stock.product_id, SalesStock.status == StockStatus.AVAILABLE)
            .with_entities(SalesStock.quantity)
            .scalar()
        )
        assert left == 10 - quantity


@pytest.mark.parametrize("tracking_type", ["batch", "none"])
def test_lot_return_cannot_exceed_the_lot(superclient, db, make_sales_stock, tracking_type):
    stock = _stock(make_sales_stock, db, tracking_type)
    r = superclient.post(URL, json=_payload(stock, quantity=11))
    assert r.status_code == 400, r.text


def test_other_without_comment_is_rejected(superclient, db, make_sales_stock):
    stock = _stock(make_sales_stock, db, "serial")
    r = superclient.post(URL, json=_payload(stock, reason="Other", remark=""))
    assert r.status_code == 422, r.text


def test_grn_list_reports_creator_and_po_approval_fields(superclient, db, make_sales_stock):
    stock = _stock(make_sales_stock, db, "serial")
    rows = superclient.get("/api/v1/purchasing/grn", params={"limit": 100000}).json()
    row = next(g for g in rows if g["id"] == stock.good_received_note_id)
    # The keys are always present; the factory GRN has no creator/approval, so they are null.
    for key in ("created_by_name", "po_approved_by_name", "po_approved_date", "po_no", "supplier_name"):
        assert key in row
    assert row["po_no"] and row["supplier_name"]
