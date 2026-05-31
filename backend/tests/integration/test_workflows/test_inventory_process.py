"""
QA suite — Inventory & Warehouse money-path.

Covers the stock side of the money path:

* SalesStock lifecycle  (barcode uniqueness, status transitions, branch scoping)
* CompanyAssets lifecycle (barcode + inventory-no uniqueness)
* Item Transfer Note (ITN) state machine
      pending -> approved -> dispatched -> received
      pending -> rejected (stock restored)
      edit / delete only while pending
* Barcode validation for transfer (existence / status / location)
* Receive items (barcode must belong to the ITN, no double-receive,
  stock moves to destination location + branch)

All tests run inside the rolled-back transactional ``db`` fixture, so nothing
touches the real database.  Real product bugs are *reported* with
``xfail(strict=True)`` rather than fixed.
"""

from __future__ import annotations

import uuid
from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app.common.enums import StockStatus
from app.modules.inventory import schemas as inv_schemas
from app.modules.inventory.service import CompanyAssetService, SalesStockService
from app.modules.warehouse import schemas as wh_schemas
from app.modules.warehouse.models import (
    ItemTransferNoteItems,
    TransferNoteStatus,
)
from app.modules.warehouse.service import (
    ItemReceiveNoteService,
    ItemTransferNoteItemService,
    ItemTransferNoteService,
)


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


# --------------------------------------------------------------------------- #
# SalesStock
# --------------------------------------------------------------------------- #
class TestSalesStock:
    def test_create_then_lookup_by_barcode(self, db, make_sales_stock):
        stock = make_sales_stock(barcode="SS-LOOKUP-1")
        svc = SalesStockService(db)

        found = svc.get_by_barcode("SS-LOOKUP-1")
        assert found is not None
        assert found["id"] == stock.id
        assert found["barcode"] == "SS-LOOKUP-1"

    def test_create_duplicate_barcode_rejected(self, db, make_sales_stock, make_product, make_branch):
        existing = make_sales_stock(barcode="SS-DUP-1")
        svc = SalesStockService(db)
        payload = inv_schemas.SalesStockCreate(
            product_id=existing.product_id,
            barcode="SS-DUP-1",
            branch_code=existing.branch_code,
            good_received_note_id=existing.good_received_note_id,
            purchasing_order_items_id=existing.purchasing_order_items_id,
        )
        with pytest.raises(ValueError):
            svc.create(payload)

    def test_barcode_exists_helper(self, db, make_sales_stock):
        make_sales_stock(barcode="SS-EXIST-1")
        svc = SalesStockService(db)
        assert svc.barcode_exists("SS-EXIST-1") is True
        assert svc.barcode_exists("SS-NOPE") is False

    def test_update_status(self, db, make_sales_stock):
        stock = make_sales_stock()
        svc = SalesStockService(db)
        updated = svc.update_status(stock.id, "sold")
        assert updated.status == "sold"

    def test_available_by_branch_excludes_sold(self, db, make_branch, make_sales_stock):
        branch = make_branch()
        make_sales_stock(branch=branch, status=StockStatus.AVAILABLE)
        make_sales_stock(branch=branch, status="sold")
        svc = SalesStockService(db)
        available = svc.get_available_by_branch(branch.branch_code)
        assert len(available) == 1
        assert all(s.status == StockStatus.AVAILABLE for s in available)

    def test_get_all_is_branch_scoped(self, db, make_branch, make_sales_stock):
        branch_a = make_branch()
        branch_b = make_branch()
        make_sales_stock(branch=branch_a)
        make_sales_stock(branch=branch_a)
        make_sales_stock(branch=branch_b)
        svc = SalesStockService(db)

        only_a = svc.get_all(branch_code=branch_a.branch_code)
        assert len(only_a) == 2
        assert {r["branch_code"] for r in only_a} == {branch_a.branch_code}

    def test_get_all_multi_branch_filter(self, db, make_branch, make_sales_stock):
        branch_a = make_branch()
        branch_b = make_branch()
        branch_c = make_branch()
        make_sales_stock(branch=branch_a)
        make_sales_stock(branch=branch_b)
        make_sales_stock(branch=branch_c)
        svc = SalesStockService(db)

        scoped = svc.get_all(branch_codes=[branch_a.branch_code, branch_b.branch_code])
        codes = {r["branch_code"] for r in scoped}
        assert codes == {branch_a.branch_code, branch_b.branch_code}


# --------------------------------------------------------------------------- #
# CompanyAssets
# --------------------------------------------------------------------------- #
class TestCompanyAssets:
    def _payload(self, *, product, branch, barcode=None, inventory_no=None):
        return inv_schemas.CompanyAssetCreate(
            product_id=product.id,
            inventory_no=inventory_no or _uid("INV"),
            item="Test Asset",
            branch_code=branch.branch_code,
            barcode=barcode,
        )

    def test_create_company_asset(self, db, make_product, make_branch):
        svc = CompanyAssetService(db)
        product, branch = make_product(), make_branch()
        asset = svc.create(self._payload(product=product, branch=branch, barcode="CA-1"))
        assert asset.id is not None
        assert asset.source == "grn"
        assert asset.status == "available"

    def test_duplicate_barcode_rejected(self, db, make_product, make_branch):
        svc = CompanyAssetService(db)
        product, branch = make_product(), make_branch()
        svc.create(self._payload(product=product, branch=branch, barcode="CA-DUP"))
        with pytest.raises(ValueError):
            svc.create(self._payload(product=product, branch=branch, barcode="CA-DUP"))

    def test_duplicate_inventory_no_rejected(self, db, make_product, make_branch):
        svc = CompanyAssetService(db)
        product, branch = make_product(), make_branch()
        svc.create(self._payload(product=product, branch=branch, inventory_no="INV-DUP"))
        with pytest.raises(ValueError):
            svc.create(self._payload(product=product, branch=branch, inventory_no="INV-DUP"))

    def test_update_status(self, db, make_product, make_branch):
        svc = CompanyAssetService(db)
        product, branch = make_product(), make_branch()
        asset = svc.create(self._payload(product=product, branch=branch, barcode="CA-ST"))
        updated = svc.update_status(asset.id, "assigned")
        assert updated.status == "assigned"

    def test_get_by_branch_scoped(self, db, make_product, make_branch):
        svc = CompanyAssetService(db)
        product = make_product()
        branch_a, branch_b = make_branch(), make_branch()
        svc.create(self._payload(product=product, branch=branch_a, barcode="CA-A1"))
        svc.create(self._payload(product=product, branch=branch_a, barcode="CA-A2"))
        svc.create(self._payload(product=product, branch=branch_b, barcode="CA-B1"))
        assert len(svc.get_by_branch(branch_a.branch_code)) == 2


# --------------------------------------------------------------------------- #
# Item Transfer Note — creation & guards
# --------------------------------------------------------------------------- #
def _itn_payload(*, branch, from_loc, to_loc):
    return wh_schemas.ItemTransferNoteCreate(
        created_date=date.today(),
        from_location_id=from_loc.id,
        to_location_id=to_loc.id,
        branch_code=branch.branch_code,
    )


class TestTransferNoteCreate:
    def test_create_happy_path(self, db, make_branch, make_location):
        branch = make_branch()
        from_loc = make_location(branch=branch)
        to_loc = make_location(branch=branch)
        svc = ItemTransferNoteService(db)

        itn = svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        assert itn.id is not None
        assert itn.status == TransferNoteStatus.PENDING
        assert itn.item_transfer_note.startswith("ITN-")
        assert itn.approval_id is not None  # approval request linked

    def test_create_inactive_branch_rejected(self, db, make_branch, make_location):
        from fastapi import HTTPException

        branch = make_branch(active=False)
        from_loc = make_location(branch_code=branch.branch_code)
        to_loc = make_location(branch_code=branch.branch_code)
        svc = ItemTransferNoteService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        assert exc.value.status_code == 400

    def test_get_missing_returns_404(self, db):
        from fastapi import HTTPException

        svc = ItemTransferNoteService(db)
        with pytest.raises(HTTPException) as exc:
            svc.get_transfer_note(999_999_999)
        assert exc.value.status_code == 404

    def test_itn_numbers_are_sequential(self, db, make_branch, make_location):
        branch = make_branch()
        from_loc = make_location(branch=branch)
        to_loc = make_location(branch=branch)
        svc = ItemTransferNoteService(db)
        first = svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        second = svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        seq1 = int(first.item_transfer_note.split("-")[-1])
        seq2 = int(second.item_transfer_note.split("-")[-1])
        assert seq2 == seq1 + 1


class TestTransferNoteEditDelete:
    def _create(self, db, make_branch, make_location):
        branch = make_branch()
        from_loc = make_location(branch=branch)
        to_loc = make_location(branch=branch)
        svc = ItemTransferNoteService(db)
        itn = svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        return svc, itn, branch, from_loc, to_loc

    def test_update_pending_allowed(self, db, make_branch, make_location):
        svc, itn, branch, from_loc, to_loc = self._create(db, make_branch, make_location)
        payload = _itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc)
        payload.remark = "edited"
        updated = svc.update_transfer_note(itn.id, payload)
        assert updated.remark == "edited"
        assert updated.item_transfer_note == itn.item_transfer_note

    def test_cannot_edit_after_approval(self, db, make_branch, make_location):
        from fastapi import HTTPException

        svc, itn, branch, from_loc, to_loc = self._create(db, make_branch, make_location)
        svc.approve_transfer_note(itn.id, user_id=1)
        with pytest.raises(HTTPException) as exc:
            svc.update_transfer_note(itn.id, _itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        assert exc.value.status_code == 400

    def test_delete_pending_allowed(self, db, make_branch, make_location):
        from fastapi import HTTPException

        svc, itn, *_ = self._create(db, make_branch, make_location)
        svc.delete_transfer_note(itn.id)
        with pytest.raises(HTTPException):
            svc.get_transfer_note(itn.id)

    def test_cannot_delete_after_approval(self, db, make_branch, make_location):
        from fastapi import HTTPException

        svc, itn, *_ = self._create(db, make_branch, make_location)
        svc.approve_transfer_note(itn.id, user_id=1)
        with pytest.raises(HTTPException) as exc:
            svc.delete_transfer_note(itn.id)
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Item Transfer Note — state machine + stock side effects
# --------------------------------------------------------------------------- #
class TestTransferStateMachine:
    def _setup_with_item(self, db, make_branch, make_location, make_sales_stock):
        """Create an ITN with one real sales-stock item attached by barcode."""
        branch = make_branch()
        from_loc = make_location(branch=branch)
        to_loc = make_location(branch=branch)
        stock = make_sales_stock(branch=branch, location=from_loc, barcode=_uid("TBC"))

        itn_svc = ItemTransferNoteService(db)
        itn = itn_svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))

        item_svc = ItemTransferNoteItemService(db)
        item_svc.create_item(
            wh_schemas.ItemTransferNoteItemCreate(
                product_id=stock.product_id,
                barcode=stock.barcode,
                branch_code=branch.branch_code,
                itemtransfernote_id=itn.id,
            )
        )
        return itn_svc, itn, stock, branch, from_loc, to_loc

    def test_approve_marks_stock_transfer_pending(self, db, make_branch, make_location, make_sales_stock):
        itn_svc, itn, stock, *_ = self._setup_with_item(db, make_branch, make_location, make_sales_stock)
        itn_svc.approve_transfer_note(itn.id, user_id=1)

        db.refresh(itn)
        db.refresh(stock)
        assert itn.status == TransferNoteStatus.APPROVED
        assert stock.status == "transfer_pending"

    def test_reject_from_pending_restores_stock(self, db, make_branch, make_location, make_sales_stock):
        itn_svc, itn, stock, *_ = self._setup_with_item(db, make_branch, make_location, make_sales_stock)
        itn_svc.reject_transfer_note(itn.id, user_id=1)

        db.refresh(itn)
        db.refresh(stock)
        assert itn.status == TransferNoteStatus.REJECTED
        # stock was never moved off available (reject from pending)
        assert stock.status == StockStatus.AVAILABLE

    def test_cannot_approve_twice(self, db, make_branch, make_location, make_sales_stock):
        from fastapi import HTTPException

        itn_svc, itn, *_ = self._setup_with_item(db, make_branch, make_location, make_sales_stock)
        itn_svc.approve_transfer_note(itn.id, user_id=1)
        with pytest.raises(HTTPException) as exc:
            itn_svc.approve_transfer_note(itn.id, user_id=1)
        assert exc.value.status_code == 400

    def test_dispatch_requires_approval(self, db, make_branch, make_location, make_sales_stock):
        from fastapi import HTTPException

        itn_svc, itn, *_ = self._setup_with_item(db, make_branch, make_location, make_sales_stock)
        with pytest.raises(HTTPException) as exc:
            itn_svc.dispatch_transfer_note(itn.id)
        assert exc.value.status_code == 400

    def test_dispatch_marks_in_transit(self, db, make_branch, make_location, make_sales_stock):
        itn_svc, itn, stock, *_ = self._setup_with_item(db, make_branch, make_location, make_sales_stock)
        itn_svc.approve_transfer_note(itn.id, user_id=1)
        itn_svc.dispatch_transfer_note(itn.id)

        db.refresh(itn)
        db.refresh(stock)
        assert itn.status == TransferNoteStatus.DISPATCHED
        assert stock.status == "in_transit"
        assert stock.location_id is None  # cleared from source


# --------------------------------------------------------------------------- #
# Barcode validation for transfer
# --------------------------------------------------------------------------- #
class TestBarcodeValidation:
    def test_unknown_barcode_invalid(self, db, make_location):
        loc = make_location()
        svc = ItemTransferNoteService(db)
        resp = svc.validate_barcode_for_transfer(
            wh_schemas.BarcodeValidationRequest(barcode="DOES-NOT-EXIST", from_location_id=loc.id)
        )
        assert resp.valid is False

    def test_valid_available_barcode(self, db, make_branch, make_location, make_sales_stock):
        branch = make_branch()
        loc = make_location(branch=branch)
        stock = make_sales_stock(branch=branch, location=loc, barcode="VAL-OK")
        svc = ItemTransferNoteService(db)
        resp = svc.validate_barcode_for_transfer(
            wh_schemas.BarcodeValidationRequest(barcode="VAL-OK", from_location_id=loc.id)
        )
        assert resp.valid is True
        assert resp.sales_stock_id == stock.id

    def test_non_available_barcode_invalid(self, db, make_branch, make_location, make_sales_stock):
        branch = make_branch()
        loc = make_location(branch=branch)
        make_sales_stock(branch=branch, location=loc, barcode="VAL-SOLD", status="sold")
        svc = ItemTransferNoteService(db)
        resp = svc.validate_barcode_for_transfer(
            wh_schemas.BarcodeValidationRequest(barcode="VAL-SOLD", from_location_id=loc.id)
        )
        assert resp.valid is False
        assert resp.current_status == "sold"

    def test_wrong_location_invalid(self, db, make_branch, make_location, make_sales_stock):
        branch = make_branch()
        real_loc = make_location(branch=branch)
        other_loc = make_location(branch=branch)
        make_sales_stock(branch=branch, location=real_loc, barcode="VAL-LOC")
        svc = ItemTransferNoteService(db)
        resp = svc.validate_barcode_for_transfer(
            wh_schemas.BarcodeValidationRequest(barcode="VAL-LOC", from_location_id=other_loc.id)
        )
        assert resp.valid is False


# --------------------------------------------------------------------------- #
# Receiving items
# --------------------------------------------------------------------------- #
class TestReceiveItems:
    def _approved_dispatched_itn(self, db, make_branch, make_location, make_sales_stock):
        branch = make_branch()
        from_loc = make_location(branch=branch)
        to_loc = make_location(branch=branch)
        stock = make_sales_stock(branch=branch, location=from_loc, barcode=_uid("RBC"))

        itn_svc = ItemTransferNoteService(db)
        itn = itn_svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        ItemTransferNoteItemService(db).create_item(
            wh_schemas.ItemTransferNoteItemCreate(
                product_id=stock.product_id,
                barcode=stock.barcode,
                branch_code=branch.branch_code,
                itemtransfernote_id=itn.id,
            )
        )
        itn_svc.approve_transfer_note(itn.id, user_id=1)
        itn_svc.dispatch_transfer_note(itn.id)
        return itn, stock, to_loc

    def test_receive_moves_stock_to_destination(self, db, make_branch, make_location, make_sales_stock):
        itn, stock, to_loc = self._approved_dispatched_itn(db, make_branch, make_location, make_sales_stock)
        recv_svc = ItemReceiveNoteService(db)
        resp = recv_svc.receive_items(
            itn.id, wh_schemas.ReceiveItemsRequest(barcodes=[stock.barcode])
        )
        assert resp.all_received is True
        assert resp.received_items == 1

        db.refresh(stock)
        db.refresh(itn)
        assert stock.status == StockStatus.AVAILABLE
        assert stock.location_id == to_loc.id
        assert itn.status == TransferNoteStatus.RECEIVED

    def test_receive_unknown_barcode_reports_failure(self, db, make_branch, make_location, make_sales_stock):
        itn, stock, _ = self._approved_dispatched_itn(db, make_branch, make_location, make_sales_stock)
        recv_svc = ItemReceiveNoteService(db)
        resp = recv_svc.receive_items(
            itn.id, wh_schemas.ReceiveItemsRequest(barcodes=["NOT-IN-ITN"])
        )
        assert resp.received_items == 0
        assert resp.results[0].success is False

    def test_double_receive_is_noop(self, db, make_branch, make_location, make_sales_stock):
        # Two-item ITN: receive item A, then attempt to receive A again while the
        # note is only PARTIALLY_RECEIVED -> the per-item "already received" no-op
        # path is exercised (a single-item note would already be RECEIVED and the
        # note-level guard would fire instead).
        branch = make_branch()
        from_loc = make_location(branch=branch)
        to_loc = make_location(branch=branch)
        stock_a = make_sales_stock(branch=branch, location=from_loc, barcode=_uid("DA"))
        stock_b = make_sales_stock(branch=branch, location=from_loc, barcode=_uid("DB"))

        itn_svc = ItemTransferNoteService(db)
        itn = itn_svc.create_transfer_note(_itn_payload(branch=branch, from_loc=from_loc, to_loc=to_loc))
        item_svc = ItemTransferNoteItemService(db)
        for s in (stock_a, stock_b):
            item_svc.create_item(
                wh_schemas.ItemTransferNoteItemCreate(
                    product_id=s.product_id,
                    barcode=s.barcode,
                    branch_code=branch.branch_code,
                    itemtransfernote_id=itn.id,
                )
            )
        itn_svc.approve_transfer_note(itn.id, user_id=1)
        itn_svc.dispatch_transfer_note(itn.id)

        recv_svc = ItemReceiveNoteService(db)
        recv_svc.receive_items(itn.id, wh_schemas.ReceiveItemsRequest(barcodes=[stock_a.barcode]))
        # ITN is now partially received; receiving A again is a per-item no-op
        resp = recv_svc.receive_items(
            itn.id, wh_schemas.ReceiveItemsRequest(barcodes=[stock_a.barcode])
        )
        assert resp.results[0].success is False
        assert "already received" in resp.results[0].message.lower()
