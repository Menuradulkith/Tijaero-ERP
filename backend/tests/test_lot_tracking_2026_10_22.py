"""Batch / none (quantity-only) tracking: lot quantity bound on ITN lines, lot identity on lines,
damaged units on the dashboard, receipt notes that accumulate, branch-scoped lot returns."""
from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.inventory.service import SalesStockService
from app.modules.purchasing.service import PurchasingReturnService
from app.modules.warehouse import schemas as wh
from app.modules.warehouse.service import (
    ItemReceiveNoteService,
    ItemTransferNoteItemService,
    ItemTransferNoteService,
)


@pytest.fixture
def lots(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    a, b = make_branch(), make_branch()
    loc_a, loc_b = make_location(branch=a), make_location(branch=b)
    product = make_product()
    product.tracking_type = "batch"
    lot = make_sales_stock(product=product, branch=a, location=loc_a)
    lot.barcode, lot.quantity, lot.batch_no = None, 10, "B-1"
    lot.expiry_date = date.today() + timedelta(days=30)
    user, _ = make_user(branches=[a, b])
    db.flush()
    return dict(a=a, b=b, loc_a=loc_a, loc_b=loc_b, product=product, lot=lot, user=user)


def _note(db, w):
    return ItemTransferNoteService(db).create_transfer_note(
        wh.ItemTransferNoteCreate(created_date=date.today(), from_location_id=w["loc_a"].id,
                                  to_location_id=w["loc_b"].id, branch_code=w["a"].branch_code),
        user_id=w["user"].id,
    )


def _line(db, w, note, qty):
    return ItemTransferNoteItemService(db).create_item(wh.ItemTransferNoteItemCreate(
        product_id=w["product"].id, quantity=qty, branch_code=w["a"].branch_code, itemtransfernote_id=note.id))


class TestLotLineQuantity:
    def test_up_to_what_the_source_holds_is_accepted(self, db, lots):
        assert _line(db, lots, _note(db, lots), 10).quantity == 10

    def test_more_than_the_source_holds_is_refused_when_added(self, db, lots):
        with pytest.raises(HTTPException) as exc:
            _line(db, lots, _note(db, lots), 11)
        assert exc.value.status_code == 400 and "Only 10 unit(s) left" in exc.value.detail

    def test_the_notes_own_lines_count_against_what_is_left(self, db, lots):
        note = _note(db, lots)
        _line(db, lots, note, 7)
        with pytest.raises(HTTPException) as exc:
            _line(db, lots, note, 4)
        assert "Only 3 unit(s) left" in exc.value.detail

    def test_editing_a_line_does_not_count_the_line_against_itself(self, db, lots):
        note = _note(db, lots)
        item = _line(db, lots, note, 7)
        updated = ItemTransferNoteItemService(db).update_item(item.id, wh.ItemTransferNoteItemCreate(
            product_id=lots["product"].id, quantity=10, branch_code=lots["a"].branch_code, itemtransfernote_id=note.id))
        assert updated.quantity == 10


class TestLotIdentityAndReceipt:
    def _approved(self, db, w, qty=4):
        note = _note(db, w)
        item = _line(db, w, note, qty)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=w["user"].id)
        return note, item

    def test_approved_lot_line_shows_its_batch_and_expiry(self, db, lots):
        note, _item = self._approved(db, lots)
        line = ItemTransferNoteItemService(db).list_items_by_transfer_note(note.id)[0]
        assert line.batch_no == "B-1" and line.expiry_date == lots["lot"].expiry_date
        assert wh.ItemTransferNoteItem.model_validate(line).batch_no == "B-1"

    def test_pending_lot_line_has_no_batch_yet(self, db, lots):
        note = _note(db, lots)
        _line(db, lots, note, 2)
        line = ItemTransferNoteItemService(db).list_items_by_transfer_note(note.id)[0]
        assert line.batch_no is None and line.expiry_date is None

    def test_a_later_receipt_adds_to_the_note_instead_of_replacing_it(self, db, lots):
        note = _note(db, lots)
        first, second = _line(db, lots, note, 2), _line(db, lots, note, 3)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=lots["user"].id)
        svc = ItemReceiveNoteService(db)
        svc.receive_items(note.id, wh.ReceiveItemsRequest(
            item_ids=[first.id], received_user_id=lots["user"].id, received_note="first pallet",
            lines=[wh.ReceiveLine(item_id=first.id, damaged_quantity=1)]))
        svc.receive_items(note.id, wh.ReceiveItemsRequest(
            item_ids=[second.id], received_user_id=lots["user"].id, received_note="second pallet"))
        text = svc.get_by_transfer_note(note.id).received_note
        assert "first pallet" in text and "Damaged on arrival: 1" in text and "second pallet" in text
        assert svc.get_by_transfer_note(note.id).recieved_user == lots["user"].id

    def test_receipt_exposes_the_transfer_notes_number(self, db, lots):
        note = _note(db, lots)
        item = _line(db, lots, note, 1)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=lots["user"].id)
        svc = ItemReceiveNoteService(db)
        svc.receive_items(note.id, wh.ReceiveItemsRequest(item_ids=[item.id], received_user_id=lots["user"].id))
        irn = svc.get_by_transfer_note(note.id)
        assert irn.item_transfer_note_no == note.item_transfer_note
        assert wh.ItemReceiveNote.model_validate(irn).item_transfer_note_no == note.item_transfer_note


class TestDamagedOnTheDashboard:
    def test_damaged_units_have_their_own_figure_outside_on_hand(self, db, lots):
        lots["lot"].status = StockStatus.DAMAGED
        db.flush()
        svc = SalesStockService(db)
        assert svc.get_summary(branch_code=lots["a"].branch_code)["damaged"] == 10
        row = svc.get_stock_summary(branch_code=lots["a"].branch_code)["items"][0]
        assert row["damaged_quantity"] == 10 and row["available_quantity"] == 0

    def test_available_lots_are_not_damaged(self, db, lots):
        assert SalesStockService(db).get_summary(branch_code=lots["a"].branch_code)["damaged"] == 0


class TestLotReturnBranch:
    def test_a_lot_cannot_be_returned_from_another_branch(self, db, lots):
        lot = lots["lot"]
        svc = PurchasingReturnService(db)
        bad, row = svc.validate_lot_for_return(lot.good_received_note_id, lot.id, 2, branch_code=lots["b"].branch_code)
        assert not bad.valid and row is None and lots["a"].branch_code in bad.message
        ok, _ = svc.validate_lot_for_return(lot.good_received_note_id, lot.id, 2, branch_code=lots["a"].branch_code)
        assert ok.valid


class TestReceiveEndpoint:
    def test_receiver_is_the_signed_in_user_and_the_receipt_shows_the_itn_number(self, db, lots, superclient, superuser):
        user, _ = superuser
        note = _note(db, lots)
        item = _line(db, lots, note, 2)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=lots["user"].id)
        r = superclient.post(f"/api/v1/warehouse/transfer-notes/{note.id}/receive-items",
                             json={"item_ids": [item.id], "received_user_id": 2147483000})
        assert r.status_code == 200, r.text
        r = superclient.get(f"/api/v1/warehouse/transfer-notes/{note.id}/receive-note")
        assert r.status_code == 200, r.text
        assert r.json()["recieved_user"] == user.id
        assert r.json()["item_transfer_note_no"] == note.item_transfer_note
        r = superclient.get(f"/api/v1/warehouse/transfer-notes/{note.id}/items")
        assert r.json()[0]["batch_no"] == "B-1"


class TestTwoLinesOfOneProduct:
    def test_two_lines_never_take_the_same_units(self, db, lots):
        lots["lot"].quantity = 5
        db.flush()
        note = _note(db, lots)
        _line(db, lots, note, 2)
        _line(db, lots, note, 3)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=lots["user"].id)
        items = ItemTransferNoteItemService(db).list_items_by_transfer_note(note.id)
        assert len({i.sales_stock_id for i in items}) == len(items)
        assert sum(i.quantity for i in items) == 5
        from sqlalchemy import func
        from app.modules.inventory.models import SalesStock
        moved = db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
            SalesStock.product_id == lots["product"].id, SalesStock.status == StockStatus.TRANSFER_PENDING).scalar()
        assert int(moved) == 5


class TestListColumns:
    def test_transfer_and_receive_lists_show_units_people_and_places(self, db, lots, superclient, superuser):
        user, _ = superuser
        note = _note(db, lots)
        item = _line(db, lots, note, 4)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=lots["user"].id)
        itn = next(x for x in superclient.get("/api/v1/warehouse/transfer-notes", params={"limit": 500}).json()
                   if x["id"] == note.id)
        assert itn["total_units"] == 4 and "created_by_name" in itn

        superclient.post(f"/api/v1/warehouse/transfer-notes/{note.id}/receive-items", json={"item_ids": [item.id]})
        irn = next(x for x in superclient.get("/api/v1/warehouse/receive-notes", params={"limit": 500}).json()
                   if x["item_transfer_note_id"] == note.id)
        assert (irn["total_units"], irn["received_units"]) == (4, 4)
        assert irn["from_location_name"] and irn["to_location_name"] and irn["received_by_name"]
        assert irn["item_transfer_note_no"] == note.item_transfer_note
