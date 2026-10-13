"""
QA suite - GRN receiving for serial / batch / none tracked products.

* serial: one unique barcode per unit (unchanged behaviour), batch details
  rejected.
* batch: one GRN line carrying a quantity + batch no (no barcode); a batch no
  is required.
* none: quantity only; barcode and batch details are rejected.
* Over-receipt is measured in units (SUM(quantity)), not rows, and PO
  completion status follows it.
* A tracking type cannot change once the product has stock.
* Generated barcodes are unique.

All tests run inside the rolled-back transactional ``db`` fixture.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.inventory import schemas as inv_schemas
from app.modules.inventory.service import SalesStockService
from app.modules.products import schemas as product_schemas
from app.modules.products.service import product_service
from app.modules.purchasing import schemas as po_schemas
from app.modules.purchasing.models import (
    GoodReceivedNote,
    PurchasingOrder,
    PurchasingOrderItems,
)
from app.modules.purchasing.service import GoodReceivedNoteService


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def setup(db, make_product, make_branch, make_supplier, make_location):
    """PO line of `ordered_qty` units for a product with the given tracking type."""

    def _make(tracking_type: str, ordered_qty: int = 100):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        product.tracking_type = tracking_type
        now = datetime.utcnow()
        po = PurchasingOrder(
            purchasing_order_no=_uid("PO"),
            branch_code=branch.branch_code,
            payment_method="cash",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            created_date=date.today(),
            first_suppliers_id=supplier.id,
            added_date=now,
            status="approved",
        )
        db.add(po)
        db.flush()
        po_item = PurchasingOrderItems(
            quantity=ordered_qty,
            unit_price=10,
            warrenty_month="0",
            created_date=date.today(),
            product_id=product.id,
            purchasingorders_id=po.id,
            added_date=now,
        )
        db.add(po_item)
        grn = GoodReceivedNote(
            good_received_no=_uid("GRN"),
            good_received_date=date.today(),
            supplier_invoice_no=_uid("SINV"),
            supplier_invoice_date=date.today(),
            branch_code=branch.branch_code,
            created_date=date.today(),
            good_received_locations_id=location.id,
            purchasingorders_id=po.id,
            added_date=now,
        )
        db.add(grn)
        db.flush()
        return dict(branch=branch, location=location, product=product, po=po, po_item=po_item, grn=grn)

    return _make


def _grn_item(ctx, **kw):
    return po_schemas.GoodReceivedItemCreate(
        good_received_note=ctx["grn"].good_received_no,
        branch_code=ctx["branch"].branch_code,
        purchasing_order_items_id=ctx["po_item"].id,
        **kw,
    )


def _stock(ctx, **kw):
    return inv_schemas.SalesStockCreate(
        product_id=ctx["product"].id,
        branch_code=ctx["branch"].branch_code,
        location_id=ctx["location"].id,
        good_received_note_id=ctx["grn"].id,
        purchasing_order_items_id=ctx["po_item"].id,
        status=StockStatus.AVAILABLE,
        **kw,
    )


class TestGrnItems:
    def test_serial_requires_barcode_and_single_unit(self, db, setup):
        ctx = setup("serial")
        svc = GoodReceivedNoteService(db)
        with pytest.raises(ValueError, match="barcode is required"):
            svc.create_item(_grn_item(ctx))
        with pytest.raises(ValueError, match="one unit per barcode"):
            svc.create_item(_grn_item(ctx, barcode=_uid("BC"), quantity=5))
        with pytest.raises(ValueError, match="Batch details"):
            svc.create_item(_grn_item(ctx, barcode=_uid("BC"), batch_no="B1"))
        row = svc.create_item(_grn_item(ctx, barcode=_uid("BC")))
        assert row.quantity == 1

    def test_batch_receives_qty_with_batch_no(self, db, setup):
        ctx = setup("batch", ordered_qty=1000)
        svc = GoodReceivedNoteService(db)
        with pytest.raises(ValueError, match="batch number is required"):
            svc.create_item(_grn_item(ctx, quantity=100))
        with pytest.raises(ValueError, match="Barcodes are not used"):
            svc.create_item(_grn_item(ctx, quantity=100, batch_no="B1", barcode="X"))
        row = svc.create_item(_grn_item(ctx, quantity=400, batch_no=" B1 ", expiry_date=date(2030, 1, 1)))
        assert (row.quantity, row.batch_no, row.barcode, row.expiry_date) == (400, "B1", None, date(2030, 1, 1))

    def test_none_is_quantity_only(self, db, setup):
        ctx = setup("none", ordered_qty=1000)
        svc = GoodReceivedNoteService(db)
        with pytest.raises(ValueError, match="not allowed"):
            svc.create_item(_grn_item(ctx, quantity=10, batch_no="B1"))
        row = svc.create_item(_grn_item(ctx, quantity=1000))
        assert (row.quantity, row.barcode, row.batch_no) == (1000, None, None)

    def test_over_receipt_counts_units_not_rows_and_drives_po_status(self, db, setup):
        ctx = setup("none", ordered_qty=100)
        svc = GoodReceivedNoteService(db)
        svc.create_item(_grn_item(ctx, quantity=60))
        db.refresh(ctx["po"])
        assert ctx["po"].status == "partially_completed"
        with pytest.raises(ValueError, match="Cannot receive 50 more"):
            svc.create_item(_grn_item(ctx, quantity=50))
        svc.create_item(_grn_item(ctx, quantity=40))
        db.refresh(ctx["po"])
        assert ctx["po"].status == "completed"

    def test_generate_barcodes_unique(self, db):
        codes = GoodReceivedNoteService(db).generate_barcodes(500, "itm")
        assert len(codes) == len(set(codes)) == 500
        assert all(c.startswith("ITM") for c in codes)


class TestSalesStock:
    def test_batch_lot_is_one_row_with_quantity(self, db, setup):
        ctx = setup("batch", ordered_qty=1000)
        GoodReceivedNoteService(db).create_item(_grn_item(ctx, quantity=1000, batch_no="B7"))
        row = SalesStockService(db).create(_stock(ctx, quantity=1000, batch_no="B7"))
        assert (row.quantity, row.barcode, row.batch_no, row.status) == (1000, None, "B7", StockStatus.AVAILABLE)

    def test_serial_stock_rules(self, db, setup):
        ctx = setup("serial")
        svc = SalesStockService(db)
        with pytest.raises(ValueError, match="barcode is required"):
            svc.create(_stock(ctx))
        with pytest.raises(ValueError, match="one unit per barcode"):
            svc.create(_stock(ctx, barcode=_uid("BC"), quantity=3))
        bc = _uid("BC")
        GoodReceivedNoteService(db).create_item(_grn_item(ctx, barcode=bc))
        svc.create(_stock(ctx, barcode=bc))
        with pytest.raises(ValueError, match="already exists"):
            svc.create(_stock(ctx, barcode=bc))

    def test_none_stock_rejects_barcode(self, db, setup):
        ctx = setup("none")
        with pytest.raises(ValueError, match="Barcodes are not used"):
            SalesStockService(db).create(_stock(ctx, barcode="X", quantity=5))


class TestTrackingTypeLock:
    def test_cannot_change_tracking_type_once_stock_exists(self, db, setup):
        ctx = setup("batch")
        GoodReceivedNoteService(db).create_item(_grn_item(ctx, quantity=10, batch_no="B1"))
        SalesStockService(db).create(_stock(ctx, quantity=10, batch_no="B1"))
        with pytest.raises(HTTPException) as exc:
            product_service.update_product(
                db, ctx["product"].id, product_schemas.ProductUpdate(tracking_type="serial"), user_id=1
            )
        assert exc.value.status_code == 400
        assert "Tracking type cannot be changed" in exc.value.detail


class TestApiRoutes:
    """Route layer: payloads without a barcode must validate and serialize."""

    def test_batch_receipt_via_api_round_trip(self, db, setup, superclient):
        ctx = setup("batch", ordered_qty=500)
        r = superclient.post(
            "/api/v1/purchasing/grn-items",
            json={
                "good_received_note": ctx["grn"].good_received_no,
                "branch_code": ctx["branch"].branch_code,
                "purchasing_order_items_id": ctx["po_item"].id,
                "quantity": 500,
                "batch_no": "LOT-1",
                "expiry_date": "2031-05-01",
            },
        )
        assert r.status_code == 201, r.text
        assert (r.json()["barcode"], r.json()["quantity"], r.json()["batch_no"]) == (None, 500, "LOT-1")

        r = superclient.post(
            "/api/v1/inventory/sales-stock",
            json={
                "product_id": ctx["product"].id,
                "branch_code": ctx["branch"].branch_code,
                "location_id": ctx["location"].id,
                "good_received_note_id": ctx["grn"].id,
                "purchasing_order_items_id": ctx["po_item"].id,
                "quantity": 500,
                "batch_no": "LOT-1",
                "expiry_date": "2031-05-01",
            },
        )
        assert r.status_code == 201, r.text
        assert (r.json()["barcode"], r.json()["quantity"]) == (None, 500)

        r = superclient.get(f"/api/v1/purchasing/grn/{ctx['grn'].id}/items")
        assert r.status_code == 200, r.text
        (item,) = r.json()
        assert item["quantity"] == 500 and item["barcode"] is None and item["saved_to_sales_stock"] is True

        r = superclient.get("/api/v1/inventory/sales-stock", params={"branch_code": ctx["branch"].branch_code})
        assert r.status_code == 200, r.text

    def test_generate_barcodes_endpoint(self, superclient):
        r = superclient.post("/api/v1/purchasing/grn-items/generate-barcodes", json={"count": 25, "prefix": "TJ"})
        assert r.status_code == 200, r.text
        codes = r.json()["barcodes"]
        assert len(set(codes)) == 25 and all(c.startswith("TJ") for c in codes)
        assert superclient.post("/api/v1/purchasing/grn-items/generate-barcodes", json={"count": 0}).status_code == 422
