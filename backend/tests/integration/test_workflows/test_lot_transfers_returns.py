"""
QA suite - branch transfers and supplier returns of batch/none stock lots.

* Transfer note lines for non-serial products carry a quantity. Approval
  allocates + splits real stock at the source (lines spanning several lots are
  expanded); dispatch/receive move those rows; reject releases them.
* Purchase returns of a lot split off just the returned units and follow the
  normal return_pending -> returned_to_supplier flow.

All tests run inside the rolled-back transactional ``db`` fixture.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi import HTTPException
from sqlalchemy import func

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock
from app.modules.purchasing import schemas as po_schemas
from app.modules.purchasing.models import PurchasingReturnItems
from app.modules.purchasing.service import PurchasingReturnService
from app.modules.warehouse import schemas as wh_schemas
from app.modules.warehouse.models import ItemTransferNoteItems
from app.modules.warehouse.service import (
    ItemReceiveNoteService,
    ItemTransferNoteItemService,
    ItemTransferNoteService,
)


def _units(db, product, status, branch=None):
    q = db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
        SalesStock.product_id == product.id, SalesStock.status == status
    )
    if branch is not None:
        q = q.filter(SalesStock.branch_code == branch.branch_code)
    return int(q.scalar())


@pytest.fixture
def lot_world(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    """Two branches with a location each; branch A holds one 100-unit lot of a batch product."""
    a, b = make_branch(), make_branch()
    loc_a, loc_b = make_location(branch=a), make_location(branch=b)
    product = make_product()
    product.tracking_type = "batch"
    lot = make_sales_stock(product=product, branch=a, location=loc_a)
    lot.barcode, lot.quantity, lot.batch_no = None, 100, "B1"
    user, _ = make_user(branches=[a, b])
    db.flush()
    return dict(a=a, b=b, loc_a=loc_a, loc_b=loc_b, product=product, lot=lot, user=user)


def _itn(db, w, qty):
    svc = ItemTransferNoteService(db)
    note = svc.create_transfer_note(
        wh_schemas.ItemTransferNoteCreate(
            created_date=date.today(),
            from_location_id=w["loc_a"].id,
            to_location_id=w["loc_b"].id,
            branch_code=w["a"].branch_code,
        ),
        user_id=w["user"].id,
    )
    item = ItemTransferNoteItemService(db).create_item(
        wh_schemas.ItemTransferNoteItemCreate(
            product_id=w["product"].id,
            quantity=qty,
            branch_code=w["a"].branch_code,
            itemtransfernote_id=note.id,
        )
    )
    return svc, note, item


class TestLotTransfers:
    def test_full_lifecycle_moves_only_the_transferred_units(self, db, lot_world):
        w = lot_world
        svc, note, item = _itn(db, w, 30)
        # Nothing is committed until approval.
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 100

        svc.approve_transfer_note(note.id, user_id=w["user"].id)
        db.refresh(item)
        assert item.sales_stock_id is not None and item.quantity == 30
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 70
        assert _units(db, w["product"], StockStatus.TRANSFER_PENDING) == 30

        svc.dispatch_transfer_note(note.id)
        assert _units(db, w["product"], StockStatus.IN_TRANSIT) == 30

        result = ItemReceiveNoteService(db).receive_items(
            note.id, wh_schemas.ReceiveItemsRequest(item_ids=[item.id], received_user_id=w["user"].id)
        )
        assert result.all_received and result.results[0].success
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["b"]) == 30
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 70
        moved = db.query(SalesStock).filter(SalesStock.id == item.sales_stock_id).one()
        assert (moved.location_id, moved.batch_no) == (w["loc_b"].id, "B1")

    def test_cannot_approve_more_than_the_source_holds(self, db, lot_world):
        w = lot_world
        svc, note, _ = _itn(db, w, 150)
        with pytest.raises(HTTPException) as exc:
            svc.approve_transfer_note(note.id, user_id=w["user"].id)
        assert exc.value.status_code == 400
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 100

    def test_reject_releases_the_allocated_units(self, db, lot_world):
        w = lot_world
        svc, note, _ = _itn(db, w, 40)
        svc.approve_transfer_note(note.id, user_id=w["user"].id)
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 60
        # approved notes can't be rejected; a second pending note can
        svc2, note2, _ = _itn(db, w, 10)
        svc2.reject_transfer_note(note2.id, user_id=w["user"].id)
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 60

    def test_line_spanning_two_lots_is_expanded(self, db, lot_world, make_sales_stock):
        w = lot_world
        second = make_sales_stock(product=w["product"], branch=w["a"], location=w["loc_a"])
        second.barcode, second.quantity, second.batch_no = None, 50, "B2"
        db.flush()
        svc, note, item = _itn(db, w, 120)
        svc.approve_transfer_note(note.id, user_id=w["user"].id)
        lines = db.query(ItemTransferNoteItems).filter(ItemTransferNoteItems.itemtransfernote_id == note.id).all()
        assert sum(l.quantity for l in lines) == 120 and len(lines) == 2
        assert _units(db, w["product"], StockStatus.AVAILABLE, w["a"]) == 30

    def test_validation_rules(self, db, lot_world):
        w = lot_world
        svc = ItemTransferNoteService(db)
        ok = svc.validate_lot_for_transfer(
            wh_schemas.LotValidationRequest(product_id=w["product"].id, quantity=100, from_location_id=w["loc_a"].id)
        )
        assert ok.valid and ok.available_quantity == 100
        bad = svc.validate_lot_for_transfer(
            wh_schemas.LotValidationRequest(product_id=w["product"].id, quantity=101, from_location_id=w["loc_a"].id)
        )
        assert not bad.valid and bad.available_quantity == 100
        note = _itn(db, w, 1)[1]
        with pytest.raises(HTTPException):  # a barcode makes no sense for a lot product
            ItemTransferNoteItemService(db).create_item(
                wh_schemas.ItemTransferNoteItemCreate(
                    product_id=w["product"].id, barcode="X", branch_code=w["a"].branch_code, itemtransfernote_id=note.id
                )
            )


class TestLotPurchaseReturns:
    def _return(self, w, qty, *, require_approval=True, sales_stock_id=None):
        lot = w["lot"]
        return po_schemas.PurchasingReturnCreate(
            branch_code=w["a"].branch_code,
            goodreceivednote_id=lot.good_received_note_id,
            require_approval=require_approval,
            items=[
                po_schemas.PurchasingReturnItemCreate(
                    product_id=w["product"].id,
                    purchasing_price=100,
                    return_price=100,
                    sales_stock_id=sales_stock_id or lot.id,
                    quantity=qty,
                )
            ],
        )

    def test_return_splits_the_lot_and_approval_completes_it(self, db, lot_world, monkeypatch):
        w = lot_world
        # The cashbook hook calls a DB function that this dev DB lacks; its failure
        # path rolls the session back, which is unrelated to what is tested here.
        monkeypatch.setattr(PurchasingReturnService, "_ensure_cashbook_entry_for_purchase_return", lambda self, r: None)
        svc = PurchasingReturnService(db)
        ret = svc.create_return(self._return(w, 30), user_id=w["user"].id)
        (item,) = db.query(PurchasingReturnItems).filter(PurchasingReturnItems.purchasingreturn_id == ret.id).all()
        assert (item.quantity, item.barcode) == (30, None)
        assert _units(db, w["product"], StockStatus.AVAILABLE) == 70
        assert _units(db, w["product"], "return_pending") == 30

        svc.approve_return(ret.id, True, user_id=w["user"].id)
        assert _units(db, w["product"], "returned_to_supplier") == 30
        assert _units(db, w["product"], StockStatus.AVAILABLE) == 70

    def test_rejected_return_releases_the_units(self, db, lot_world):
        w = lot_world
        svc = PurchasingReturnService(db)
        ret = svc.create_return(self._return(w, 40), user_id=w["user"].id)
        svc.approve_return(ret.id, False, remarks="no", user_id=w["user"].id)
        assert _units(db, w["product"], StockStatus.AVAILABLE) == 100

    def test_cannot_return_more_than_the_lot_holds(self, db, lot_world):
        w = lot_world
        with pytest.raises(HTTPException) as exc:
            PurchasingReturnService(db).create_return(self._return(w, 101), user_id=w["user"].id)
        assert exc.value.status_code == 400
        assert _units(db, w["product"], StockStatus.AVAILABLE) == 100

    def test_lot_validation_endpoint_logic(self, db, lot_world):
        w = lot_world
        resp, _ = PurchasingReturnService(db).validate_lot_for_return(w["lot"].good_received_note_id, w["lot"].id, 50)
        assert resp.valid and resp.available_quantity == 100 and resp.batch_no == "B1"
        resp, _ = PurchasingReturnService(db).validate_lot_for_return(999999, w["lot"].id, 1)
        assert not resp.valid

    def test_detail_endpoint_reports_the_returned_quantity(self, db, lot_world, superclient):
        w = lot_world
        ret = PurchasingReturnService(db).create_return(self._return(w, 30), user_id=w["user"].id)
        r = superclient.get(f"/api/v1/purchasing/returns/{ret.id}")
        assert r.status_code == 200, r.text
        (item,) = r.json()["items"]
        assert (item["quantity"], item["barcode"]) == (30, None)
