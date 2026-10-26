"""Item transfer notes: line validation, reject leaves stock alone, damage travels with a receipt."""
from datetime import date, datetime

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock
from app.modules.warehouse import schemas as wh
from app.modules.warehouse.models import ItemTransferNoteItems
from app.modules.warehouse.service import (
    ItemReceiveNoteService,
    ItemTransferNoteItemService,
    ItemTransferNoteService,
)


@pytest.fixture
def world(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    a, b = make_branch(), make_branch()
    loc_a, loc_b = make_location(branch=a), make_location(branch=b)
    product, other_product = make_product(), make_product()
    units = [make_sales_stock(product=product, branch=a, location=loc_a) for _ in range(3)]
    user, _ = make_user(branches=[a, b])
    return dict(a=a, b=b, loc_a=loc_a, loc_b=loc_b, product=product, other_product=other_product, units=units, user=user)


def _note(db, w, remark=None):
    return ItemTransferNoteService(db).create_transfer_note(
        wh.ItemTransferNoteCreate(
            created_date=date.today(), from_location_id=w["loc_a"].id, to_location_id=w["loc_b"].id,
            branch_code=w["a"].branch_code, remark=remark,
        ),
        user_id=w["user"].id,
    )


def _line(w, note, unit=None, **over):
    data = dict(product_id=w["product"].id, barcode=(unit or w["units"][0]).barcode, quantity=1,
                branch_code=w["a"].branch_code, itemtransfernote_id=note.id)
    data.update(over)
    return wh.ItemTransferNoteItemCreate(**data)


def _add(db, w, note, unit=None, **over):
    return ItemTransferNoteItemService(db).create_item(_line(w, note, unit, **over))


def _refused(db, w, note, **over):
    with pytest.raises(HTTPException) as exc:
        _add(db, w, note, **over)
    assert exc.value.status_code == 400
    return exc.value.detail


class TestLineValidation:
    def test_a_free_unit_at_the_source_is_accepted(self, db, world):
        assert _add(db, world, _note(db, world)).barcode == world["units"][0].barcode

    def test_same_barcode_twice_on_one_note(self, db, world):
        note = _note(db, world)
        _add(db, world, note)
        assert "already on transfer note" in _refused(db, world, note)

    def test_same_barcode_on_another_open_note_but_free_again_once_rejected(self, db, world):
        first, second = _note(db, world), _note(db, world)
        _add(db, world, first)
        assert "already on transfer note" in _refused(db, world, second)
        ItemTransferNoteService(db).reject_transfer_note(first.id, user_id=world["user"].id)
        assert _add(db, world, second).itemtransfernote_id == second.id

    def test_unknown_barcode(self, db, world):
        assert "not found" in _refused(db, world, _note(db, world), barcode="NOPE-1")

    def test_barcode_of_another_product(self, db, world):
        assert "different product" in _refused(db, world, _note(db, world), product_id=world["other_product"].id)

    @pytest.mark.parametrize("status", [StockStatus.RESERVED, StockStatus.SOLD, StockStatus.RETURNED_TO_SUPPLIER])
    def test_unit_that_is_not_available(self, db, world, status):
        unit = world["units"][1]
        unit.status = status
        db.flush()
        assert "not available" in _refused(db, world, _note(db, world), barcode=unit.barcode)

    def test_unit_stocked_at_another_branch(self, db, world, make_sales_stock):
        foreign = make_sales_stock(product=world["product"], branch=world["b"], location=world["loc_b"])
        assert "stocked at branch" in _refused(db, world, _note(db, world), barcode=foreign.barcode)

    def test_unit_at_another_location_of_the_branch(self, db, world, make_location):
        elsewhere = make_location(branch=world["a"])
        world["units"][2].location_id = elsewhere.id
        db.flush()
        assert "source location" in _refused(db, world, _note(db, world), barcode=world["units"][2].barcode)

    def test_line_branch_must_be_the_notes_branch(self, db, world):
        assert "must be the transfer note's branch" in _refused(db, world, _note(db, world), branch_code=world["b"].branch_code)

    def test_nothing_can_be_added_changed_or_removed_after_approval(self, db, world):
        note = _note(db, world)
        item = _add(db, world, note)
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=world["user"].id)
        svc = ItemTransferNoteItemService(db)
        for call in (
            lambda: svc.create_item(_line(world, note, world["units"][1])),
            lambda: svc.update_item(item.id, _line(world, note, world["units"][0])),
            lambda: svc.delete_item(item.id),
        ):
            with pytest.raises(HTTPException) as exc:
                call()
            assert exc.value.status_code == 400 and "pending" in exc.value.detail

    def test_pending_note_lines_can_be_updated_and_deleted(self, db, world):
        note = _note(db, world)
        item = _add(db, world, note)
        svc = ItemTransferNoteItemService(db)
        moved = svc.update_item(item.id, _line(world, note, world["units"][1]))  # swap to another free unit
        assert moved.barcode == world["units"][1].barcode
        svc.update_item(item.id, _line(world, note, world["units"][1], remark="same unit again"))  # not "already on a note"
        svc.delete_item(item.id)
        assert db.query(ItemTransferNoteItems).filter_by(itemtransfernote_id=note.id).count() == 0

    def test_item_on_a_missing_note(self, db, world):
        with pytest.raises(HTTPException) as exc:
            ItemTransferNoteItemService(db).create_item(_line(world, type("N", (), {"id": 99999999})()))
        assert exc.value.status_code == 404


class TestRejectLeavesStockAlone:
    def test_rejecting_a_pending_note_does_not_free_units_an_approved_note_holds(self, db, world):
        approved = _note(db, world)
        item = _add(db, world, approved)
        svc = ItemTransferNoteService(db)
        svc.approve_transfer_note(approved.id, user_id=world["user"].id)
        unit = world["units"][0]
        db.refresh(unit)
        assert unit.status == StockStatus.TRANSFER_PENDING

        # a legacy duplicate: a pending note that lists the same barcode (created before lines were validated)
        duplicate = _note(db, world)
        db.add(ItemTransferNoteItems(itemtransfernote_id=duplicate.id, product_id=item.product_id, barcode=item.barcode,
                                     quantity=1, branch_code=world["a"].branch_code, created_date=datetime.utcnow()))
        db.flush()
        svc.reject_transfer_note(duplicate.id, user_id=world["user"].id, remarks="duplicate")

        db.refresh(unit)
        assert unit.status == StockStatus.TRANSFER_PENDING  # still held by the approved note
        db.refresh(approved)
        assert approved.status == "approved"

    def test_rejected_note_never_took_any_stock(self, db, world):
        note = _note(db, world)
        _add(db, world, note)
        ItemTransferNoteService(db).reject_transfer_note(note.id, user_id=world["user"].id)
        db.refresh(world["units"][0])
        assert world["units"][0].status == StockStatus.AVAILABLE


def _approved_note_with(db, w, units):
    note = _note(db, w)
    for u in units:
        _add(db, w, note, unit=u)
    ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=w["user"].id)
    return note


class TestDamageTravelsWithTheReceipt:
    def _receive(self, db, w, note, **kw):
        return ItemReceiveNoteService(db).receive_items(
            note.id, wh.ReceiveItemsRequest(received_user_id=w["user"].id, **kw)
        )

    def test_damaged_serial_unit_arrives_but_is_not_sellable(self, db, world):
        u1, u2 = world["units"][0], world["units"][1]
        note = _approved_note_with(db, world, [u1, u2])
        res = self._receive(db, world, note, barcodes=[u1.barcode, u2.barcode], received_note="dock 3",
                            lines=[wh.ReceiveLine(barcode=u2.barcode, damaged_quantity=1, note="dented box")])
        assert res.all_received
        db.refresh(u1), db.refresh(u2)
        assert u1.status == StockStatus.AVAILABLE and u2.status == StockStatus.DAMAGED
        assert u2.location_id == world["loc_b"].id and u2.branch_code == world["b"].branch_code  # it did arrive
        remark = db.query(ItemTransferNoteItems.remark).filter_by(itemtransfernote_id=note.id, barcode=u2.barcode).scalar()
        assert remark == "dented box"
        irn = ItemReceiveNoteService(db).get_by_transfer_note(note.id)
        assert "dock 3" in irn.received_note and "Damaged on arrival: 1" in irn.received_note

    def test_note_text_without_damage_is_kept_as_typed(self, db, world):
        u1 = world["units"][0]
        note = _approved_note_with(db, world, [u1])
        self._receive(db, world, note, barcodes=[u1.barcode], received_note="all fine")
        assert ItemReceiveNoteService(db).get_by_transfer_note(note.id).received_note == "all fine"

    def test_a_serial_line_cannot_be_more_damaged_than_received(self, db, world):
        u1 = world["units"][0]
        note = _approved_note_with(db, world, [u1])
        with pytest.raises(HTTPException) as exc:
            self._receive(db, world, note, barcodes=[u1.barcode],
                          lines=[wh.ReceiveLine(barcode=u1.barcode, damaged_quantity=3)])
        assert exc.value.status_code == 400 and "more than the 1 received" in exc.value.detail
        db.refresh(u1)
        assert u1.status == StockStatus.TRANSFER_PENDING  # nothing was received

    def test_damage_for_a_line_that_is_not_being_received_is_refused(self, db, world):
        u1, u2 = world["units"][0], world["units"][1]
        note = _approved_note_with(db, world, [u1, u2])
        with pytest.raises(HTTPException) as exc:
            self._receive(db, world, note, barcodes=[u1.barcode],
                          lines=[wh.ReceiveLine(barcode=u2.barcode, damaged_quantity=1)])
        assert exc.value.status_code == 400 and "not being received" in exc.value.detail
        with pytest.raises(HTTPException) as exc:
            self._receive(db, world, note, barcodes=[u1.barcode], lines=[wh.ReceiveLine(damaged_quantity=1)])
        assert exc.value.status_code == 400

    def test_negative_damage_is_a_validation_error(self):
        with pytest.raises(ValueError):
            wh.ReceiveLine(barcode="X", damaged_quantity=-1)


class TestLotDamage:
    @pytest.fixture
    def lot_world(self, db, make_branch, make_location, make_product, make_sales_stock, make_user):
        a, b = make_branch(), make_branch()
        loc_a, loc_b = make_location(branch=a), make_location(branch=b)
        product = make_product()
        product.tracking_type = "batch"
        lot = make_sales_stock(product=product, branch=a, location=loc_a)
        lot.barcode, lot.quantity, lot.batch_no = None, 100, "B1"
        user, _ = make_user(branches=[a, b])
        db.flush()
        return dict(a=a, b=b, loc_a=loc_a, loc_b=loc_b, product=product, lot=lot, user=user)

    def _received_lot(self, db, w, qty, damaged):
        svc = ItemTransferNoteService(db)
        note = svc.create_transfer_note(
            wh.ItemTransferNoteCreate(created_date=date.today(), from_location_id=w["loc_a"].id,
                                      to_location_id=w["loc_b"].id, branch_code=w["a"].branch_code),
            user_id=w["user"].id,
        )
        item = ItemTransferNoteItemService(db).create_item(wh.ItemTransferNoteItemCreate(
            product_id=w["product"].id, quantity=qty, branch_code=w["a"].branch_code, itemtransfernote_id=note.id))
        svc.approve_transfer_note(note.id, user_id=w["user"].id)
        db.refresh(item)
        res = ItemReceiveNoteService(db).receive_items(note.id, wh.ReceiveItemsRequest(
            item_ids=[item.id], received_user_id=w["user"].id,
            lines=[wh.ReceiveLine(item_id=item.id, damaged_quantity=damaged, note="pallet split")]))
        return item, res

    def _units(self, db, w, status):
        from sqlalchemy import func
        return int(db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
            SalesStock.product_id == w["product"].id, SalesStock.status == status,
            SalesStock.branch_code == w["b"].branch_code).scalar())

    def test_part_of_a_lot_arrives_damaged(self, db, lot_world):
        item, res = self._received_lot(db, lot_world, 30, 5)
        assert res.all_received and "5 damaged" in res.results[0].message
        assert self._units(db, lot_world, StockStatus.AVAILABLE) == 25
        assert self._units(db, lot_world, StockStatus.DAMAGED) == 5
        assert db.query(ItemTransferNoteItems.remark).filter_by(id=item.id).scalar() == "pallet split"

    def test_whole_lot_damaged(self, db, lot_world):
        _item, _res = self._received_lot(db, lot_world, 10, 10)
        assert self._units(db, lot_world, StockStatus.DAMAGED) == 10
        assert self._units(db, lot_world, StockStatus.AVAILABLE) == 0

    def test_lot_damage_above_the_line_quantity_is_refused(self, db, lot_world):
        with pytest.raises(HTTPException) as exc:
            self._received_lot(db, lot_world, 10, 11)
        assert exc.value.status_code == 400


class TestHeaderRules:
    def _create(self, db, w, **over):
        data = dict(created_date=date.today(), from_location_id=w["loc_a"].id, to_location_id=w["loc_b"].id,
                    branch_code=w["a"].branch_code)
        data.update(over)
        return ItemTransferNoteService(db).create_transfer_note(wh.ItemTransferNoteCreate(**data), user_id=w["user"].id)

    def test_a_valid_header_is_created(self, db, world):
        assert self._create(db, world).status == "pending"

    def test_source_and_destination_must_differ(self, db, world):
        with pytest.raises(HTTPException) as exc:
            self._create(db, world, to_location_id=world["loc_a"].id)
        assert exc.value.status_code == 400 and "different" in exc.value.detail

    def test_source_must_belong_to_the_notes_branch(self, db, world):
        with pytest.raises(HTTPException) as exc:
            self._create(db, world, from_location_id=world["loc_b"].id, to_location_id=world["loc_a"].id)
        assert exc.value.status_code == 400 and "source location belongs to branch" in exc.value.detail

    def test_unknown_locations(self, db, world):
        for field in ("from_location_id", "to_location_id"):
            with pytest.raises(HTTPException) as exc:
                self._create(db, world, **{field: 2_000_000_000})
            assert exc.value.status_code == 400 and "not found" in exc.value.detail

    def test_update_applies_the_same_rules(self, db, world):
        note = self._create(db, world)
        bad = wh.ItemTransferNoteCreate(created_date=date.today(), from_location_id=world["loc_a"].id,
                                        to_location_id=world["loc_a"].id, branch_code=world["a"].branch_code)
        with pytest.raises(HTTPException) as exc:
            ItemTransferNoteService(db).update_transfer_note(note.id, bad)
        assert exc.value.status_code == 400

    @pytest.mark.parametrize("when", [date(2020, 1, 1), date(2030, 1, 1)])
    def test_date_must_be_within_a_year(self, world, when):
        with pytest.raises(ValueError):
            wh.ItemTransferNoteCreate(created_date=when, from_location_id=world["loc_a"].id,
                                      to_location_id=world["loc_b"].id, branch_code="X")

    def test_remark_length_and_id_range(self, world):
        base = dict(created_date=date.today(), from_location_id=1, to_location_id=2, branch_code="X")
        with pytest.raises(ValueError):
            wh.ItemTransferNoteCreate(**{**base, "remark": "x" * 2001})
        assert wh.ItemTransferNoteCreate(**{**base, "remark": "x" * 2000}).remark
        for bad in (0, -1, 2 ** 40):
            with pytest.raises(ValueError):
                wh.ItemTransferNoteCreate(**{**base, "from_location_id": bad})

    def test_a_note_without_items_cannot_be_approved(self, db, world):
        note = self._create(db, world)
        with pytest.raises(HTTPException) as exc:
            ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=world["user"].id)
        assert exc.value.status_code == 400 and "no items" in exc.value.detail
        db.refresh(note)
        assert note.status == "pending"


class TestOnlyUnitsInTransitCanBeReceived:
    def test_a_unit_that_is_not_in_transit_is_not_received(self, db, world):
        u1, u2 = world["units"][0], world["units"][1]
        note = _approved_note_with(db, world, [u1, u2])
        u2.status = StockStatus.AVAILABLE  # e.g. freed by the old reject bug
        db.flush()
        res = ItemReceiveNoteService(db).receive_items(
            note.id, wh.ReceiveItemsRequest(barcodes=[u1.barcode, u2.barcode], received_user_id=world["user"].id)
        )
        by_code = {r.barcode: r for r in res.results}
        assert by_code[u1.barcode].success and not by_code[u2.barcode].success
        assert "not in transit" in by_code[u2.barcode].message
        assert not res.all_received
        db.refresh(u1), db.refresh(u2)
        assert u1.location_id == world["loc_b"].id and u2.location_id == world["loc_a"].id
        line = db.query(ItemTransferNoteItems).filter_by(itemtransfernote_id=note.id, barcode=u2.barcode).one()
        assert line.item_recieved is False

    def test_dispatched_units_can_be_received(self, db, world):
        u1 = world["units"][0]
        note = _approved_note_with(db, world, [u1])
        ItemTransferNoteService(db).dispatch_transfer_note(note.id)
        db.refresh(u1)
        assert u1.status == StockStatus.IN_TRANSIT
        res = ItemReceiveNoteService(db).receive_items(
            note.id, wh.ReceiveItemsRequest(barcodes=[u1.barcode], received_user_id=world["user"].id)
        )
        assert res.all_received
