"""QA audit 2026-11-03 (warehouse + manufacturing): regression tests for the fixes.

Transfer notes: sender-only edits / approval / dispatch, receiver-only receipt, no client-set
"received" flag, no bare mark-received or receive-note writes, cancel releases reserved units,
delete with lines, atomic create, scoped validation. Manufacturing: work-center branch scope,
output / time-log bounds, clear MRP errors.
"""
from datetime import date, timedelta
from decimal import Decimal as D

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.common.models import Approvals
from app.modules.manufacturing import schemas as ms
from app.modules.manufacturing.service import BOMService, ProductionOrderService, WorkCenterService
from app.modules.warehouse import schemas as wh
from app.modules.warehouse.models import ItemTransferNote, ItemTransferNoteItems
from app.modules.warehouse.service import ItemTransferNoteItemService, ItemTransferNoteService

W = "/api/v1/warehouse"
M = "/api/v1/manufacturing"

ITN_PERMS = [
    ("item_transfer_notes", "view"), ("item_transfer_notes", "create"), ("item_transfer_notes", "update"),
    ("item_transfer_notes", "delete"), ("itn_approvals", "view"), ("itn_approvals", "approve"),
    ("receive_notes", "view"), ("receive_notes", "create"), ("receive_notes", "update"),
]


# ─────────────────────────── warehouse ───────────────────────────
@pytest.fixture
def itn_world(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    a, b = make_branch(), make_branch()
    loc_a, loc_b = make_location(branch=a), make_location(branch=b)
    product = make_product()
    units = [make_sales_stock(product=product, branch=a, location=loc_a) for _ in range(3)]
    sender, sender_tok = make_user(permissions=ITN_PERMS, branches=[a])
    receiver, receiver_tok = make_user(permissions=ITN_PERMS, branches=[b])
    return dict(a=a, b=b, loc_a=loc_a, loc_b=loc_b, product=product, units=units,
                sender=sender, sender_tok=sender_tok, receiver=receiver, receiver_tok=receiver_tok)


def _note(db, w, items=()):
    return ItemTransferNoteService(db).create_transfer_note(
        wh.ItemTransferNoteCreate(
            created_date=date.today(), from_location_id=w["loc_a"].id, to_location_id=w["loc_b"].id,
            branch_code=w["a"].branch_code, items=list(items),
        ),
        user_id=w["sender"].id,
    )


def _line(w, unit, **over):
    data = dict(product_id=w["product"].id, barcode=unit.barcode, quantity=1, branch_code=w["a"].branch_code)
    data.update(over)
    return data


def _approved(db, w, n=1):
    note = _note(db, w, [wh.ItemTransferNoteLineIn(**_line(w, u)) for u in w["units"][:n]])
    ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=w["sender"].id)
    return note


class TestReceiveCannotBypassStock:
    def test_bare_mark_received_route_is_gone(self, db, api, itn_world):
        note = _approved(db, itn_world)
        item = db.query(ItemTransferNoteItems).filter_by(itemtransfernote_id=note.id).one()
        r = api(itn_world["receiver_tok"]).patch(f"{W}/transfer-note-items/{item.id}/receive")
        assert r.status_code in (404, 405)
        db.refresh(item)
        assert item.item_recieved is False

    def test_client_cannot_set_received_on_a_line(self, db, api, itn_world):
        note = _note(db, itn_world)
        r = api(itn_world["sender_tok"]).post(f"{W}/transfer-note-items", json={
            **_line(itn_world, itn_world["units"][0]), "itemtransfernote_id": note.id, "item_recieved": True})
        assert r.status_code == 201, r.text
        assert r.json()["item_recieved"] is False
        item_id = r.json()["id"]
        r = api(itn_world["sender_tok"]).put(f"{W}/transfer-note-items/{item_id}", json={
            **_line(itn_world, itn_world["units"][0]), "itemtransfernote_id": note.id, "item_recieved": True})
        assert r.status_code == 200 and r.json()["item_recieved"] is False

    def test_receive_notes_cannot_be_written_directly(self, db, api, itn_world):
        note = _approved(db, itn_world)
        client = api(itn_world["receiver_tok"])
        body = {"item_transfer_note_id": note.id, "received_approval_status": 1, "received_note": "forged"}
        assert client.post(f"{W}/receive-notes", json=body).status_code == 405
        assert client.put(f"{W}/receive-notes/1", json=body).status_code == 405

    def test_overlong_received_note_is_a_422_not_a_500(self, db, api, itn_world):
        note = _approved(db, itn_world)
        r = api(itn_world["receiver_tok"]).post(f"{W}/transfer-notes/{note.id}/receive-items", json={
            "barcodes": [itn_world["units"][0].barcode], "received_note": "x" * 356})
        assert r.status_code == 422


class TestSenderAndReceiverRoles:
    def test_receiving_branch_cannot_edit_approve_or_dispatch(self, db, api, itn_world):
        note = _note(db, itn_world, [wh.ItemTransferNoteLineIn(**_line(itn_world, itn_world["units"][0]))])
        item = db.query(ItemTransferNoteItems).filter_by(itemtransfernote_id=note.id).one()
        client = api(itn_world["receiver_tok"])
        assert client.get(f"{W}/transfer-notes/{note.id}").status_code == 200  # may still read it
        assert client.post(f"{W}/transfer-note-items", json={
            **_line(itn_world, itn_world["units"][1]), "itemtransfernote_id": note.id}).status_code == 403
        assert client.delete(f"{W}/transfer-note-items/{item.id}").status_code == 403
        assert client.delete(f"{W}/transfer-notes/{note.id}").status_code == 403
        assert client.post(f"{W}/transfer-note-approvals", json={"item_transfer_note_id": note.id}).status_code == 403
        assert client.post(f"{W}/transfer-notes/{note.id}/cancel").status_code == 403
        ItemTransferNoteService(db).approve_transfer_note(note.id, user_id=itn_world["sender"].id)
        assert client.post(f"{W}/transfer-notes/{note.id}/dispatch").status_code == 403

    def test_an_undispatched_note_cannot_be_received(self, db, api, itn_world):
        note = _approved(db, itn_world)
        body = {"barcodes": [itn_world["units"][0].barcode]}
        r = api(itn_world["receiver_tok"]).post(f"{W}/transfer-notes/{note.id}/receive-items", json=body)
        assert r.status_code == 400 and "not been dispatched" in r.json()["detail"]

    def test_only_the_receiving_branch_receives(self, db, api, itn_world):
        note = _approved(db, itn_world)
        ItemTransferNoteService(db).dispatch_transfer_note(note.id)
        body = {"barcodes": [itn_world["units"][0].barcode]}
        r = api(itn_world["sender_tok"]).post(f"{W}/transfer-notes/{note.id}/receive-items", json=body)
        assert r.status_code == 403
        r = api(itn_world["receiver_tok"]).post(f"{W}/transfer-notes/{note.id}/receive-items", json=body)
        assert r.status_code == 200 and r.json()["all_received"] is True

    def test_barcode_validation_is_scoped_to_the_source_branch(self, db, api, itn_world):
        r = api(itn_world["receiver_tok"]).post(f"{W}/transfer-notes/validate-barcode", json={
            "barcode": itn_world["units"][0].barcode, "from_location_id": itn_world["loc_a"].id})
        assert r.status_code == 403
        r = api(itn_world["receiver_tok"]).post(f"{W}/transfer-notes/validate-lot", json={
            "product_id": itn_world["product"].id, "quantity": 1, "from_location_id": itn_world["loc_a"].id})
        assert r.status_code == 403

    def test_second_approval_record_is_refused(self, db, api, itn_world):
        note = _note(db, itn_world)
        client = api(itn_world["sender_tok"])
        assert client.post(f"{W}/transfer-note-approvals", json={"item_transfer_note_id": note.id}).status_code == 201
        r = client.post(f"{W}/transfer-note-approvals", json={"item_transfer_note_id": note.id})
        assert r.status_code == 400 and "already has an approval" in r.json()["detail"]


class TestCancelAndDelete:
    def test_cancel_an_approved_note_frees_its_units(self, db, api, itn_world):
        note = _approved(db, itn_world)
        unit = itn_world["units"][0]
        db.refresh(unit)
        assert unit.status == StockStatus.TRANSFER_PENDING
        r = api(itn_world["sender_tok"]).post(f"{W}/transfer-notes/{note.id}/cancel")
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        db.refresh(unit)
        assert unit.status == StockStatus.AVAILABLE
        # and the unit can go on a new note
        assert ItemTransferNoteItemService(db).create_item(wh.ItemTransferNoteItemCreate(
            **_line(itn_world, unit), itemtransfernote_id=_note(db, itn_world).id)).barcode == unit.barcode

    def test_dispatched_note_cannot_be_cancelled(self, db, itn_world):
        note = _approved(db, itn_world)
        ItemTransferNoteService(db).dispatch_transfer_note(note.id)
        with pytest.raises(HTTPException) as exc:
            ItemTransferNoteService(db).cancel_transfer_note(note.id)
        assert exc.value.status_code == 400

    def test_cancel_a_pending_note_withdraws_its_approval_request(self, db, itn_world):
        note = _note(db, itn_world)
        ItemTransferNoteService(db).cancel_transfer_note(note.id)
        assert db.query(Approvals).get(note.approval_id).status == "cancelled"

    def test_delete_pending_note_with_lines(self, db, api, itn_world):
        note = _note(db, itn_world, [wh.ItemTransferNoteLineIn(**_line(itn_world, u)) for u in itn_world["units"][:2]])
        approval_id = note.approval_id
        r = api(itn_world["sender_tok"]).delete(f"{W}/transfer-notes/{note.id}")
        assert r.status_code == 204, r.text
        assert db.query(ItemTransferNote).filter_by(id=note.id).first() is None
        assert db.query(ItemTransferNoteItems).filter_by(itemtransfernote_id=note.id).count() == 0
        assert db.query(Approvals).get(approval_id).status == "cancelled"


class TestLines:
    def test_create_with_lines_is_atomic(self, db, api, itn_world):
        db.commit()  # keep the fixture rows; the request's own work is what gets rolled back below
        before = db.query(ItemTransferNote).count()
        unit = itn_world["units"][0]
        r = api(itn_world["sender_tok"]).post(f"{W}/transfer-notes", json={
            "created_date": date.today().isoformat(), "from_location_id": itn_world["loc_a"].id,
            "to_location_id": itn_world["loc_b"].id, "branch_code": itn_world["a"].branch_code,
            "items": [_line(itn_world, unit), _line(itn_world, unit)],  # same barcode twice
        })
        assert r.status_code == 400 and "already on transfer note" in r.json()["detail"]
        db.rollback()  # what closing the request session does: nothing of the failed create was committed
        assert db.query(ItemTransferNote).count() == before

    def test_create_with_lines_saves_them(self, db, api, itn_world):
        r = api(itn_world["sender_tok"]).post(f"{W}/transfer-notes", json={
            "created_date": date.today().isoformat(), "from_location_id": itn_world["loc_a"].id,
            "to_location_id": itn_world["loc_b"].id, "branch_code": itn_world["a"].branch_code,
            "items": [_line(itn_world, u) for u in itn_world["units"][:2]],
        })
        assert r.status_code == 201, r.text
        assert db.query(ItemTransferNoteItems).filter_by(itemtransfernote_id=r.json()["id"]).count() == 2

    def test_serial_line_needs_a_barcode(self, db, itn_world):
        note = _note(db, itn_world)
        with pytest.raises(HTTPException) as exc:
            ItemTransferNoteItemService(db).create_item(wh.ItemTransferNoteItemCreate(
                product_id=itn_world["product"].id, quantity=1, branch_code=itn_world["a"].branch_code,
                itemtransfernote_id=note.id))
        assert exc.value.status_code == 400 and "barcode" in exc.value.detail


# ─────────────────────────── manufacturing ───────────────────────────
@pytest.fixture
def mfg(db, make_branch, make_location, make_product, make_sales_stock, make_user):
    import uuid
    branch, other = make_branch(), make_branch()
    loc = make_location(branch=branch)
    user, _ = make_user(branches=[branch])
    fg = make_product(cost_price=100, name="Widget")
    fg.tracking_type = "batch"
    part = make_product(cost_price=10, name="Part")
    part.tracking_type = "none"
    row = make_sales_stock(product=part, branch=branch, location=loc)
    row.barcode, row.quantity = None, 100
    db.flush()
    wc = WorkCenterService(db).create(ms.WorkCenterIn(code=f"WC{uuid.uuid4().hex[:6]}", name="Line",
                                                      branch_code=branch.branch_code), user.id)
    bom = BOMService(db).create(ms.BOMIn(
        product_id=fg.id, items=[ms.BOMItemIn(product_id=part.id, quantity=D(2))],
        operations=[ms.BOMOperationIn(name="Make", work_center_id=wc["id"], run_minutes=D(5))]), user.id)
    BOMService(db).activate(bom["id"], user.id)
    order = ProductionOrderService(db).create(ms.ProductionOrderIn(
        product_id=fg.id, branch_code=branch.branch_code, planned_quantity=4,
        planned_start_date=date.today(), planned_end_date=date.today() + timedelta(days=2)), user.id)
    order = ProductionOrderService(db).release(order["id"], user.id)
    return dict(branch=branch, other=other, user=user, fg=fg, part=part, wc=wc, order=order)


WC_PERMS = [("work_centers", "view"), ("work_centers", "create"), ("work_centers", "update"), ("work_centers", "delete")]


class TestWorkCenterBranchScope:
    def test_other_branch_cannot_read_edit_or_delete(self, db, api, mfg, make_user):
        _u, token = make_user(permissions=WC_PERMS, branches=[mfg["other"]])
        client = api(token)
        wc_id = mfg["wc"]["id"]
        assert client.get(f"{M}/work-centers/{wc_id}").status_code == 403
        assert client.put(f"{M}/work-centers/{wc_id}", json={"name": "Hijacked"}).status_code == 403
        assert client.delete(f"{M}/work-centers/{wc_id}").status_code == 403
        assert all(w["id"] != wc_id for w in client.get(f"{M}/work-centers").json())
        r = client.post(f"{M}/work-centers", json={"code": "QAX1", "name": "X", "branch_code": mfg["branch"].branch_code})
        assert r.status_code == 403

    def test_own_branch_user_can_update_but_not_move_it_away(self, db, api, mfg, make_user):
        _u, token = make_user(permissions=WC_PERMS, branches=[mfg["branch"]])
        client = api(token)
        wc_id = mfg["wc"]["id"]
        assert client.put(f"{M}/work-centers/{wc_id}", json={"name": "Renamed"}).json()["name"] == "Renamed"
        assert client.put(f"{M}/work-centers/{wc_id}", json={"branch_code": mfg["other"].branch_code}).status_code == 403


class TestProductionBounds:
    def test_same_material_twice_in_one_issue(self, db, mfg):
        mat = mfg["order"]["materials"][0]["id"]
        with pytest.raises(HTTPException) as exc:
            ProductionOrderService(db).issue_materials(mfg["order"]["id"], ms.MaterialMoveIn(lines=[
                ms.MaterialLineIn(material_id=mat, quantity=2), ms.MaterialLineIn(material_id=mat, quantity=2)]),
                mfg["user"].id)
        assert "only once" in exc.value.detail

    def test_scrap_is_bounded_by_the_planned_quantity(self, db, mfg):
        with pytest.raises(HTTPException) as exc:
            ProductionOrderService(db).record_output(mfg["order"]["id"], ms.OutputIn(scrap_quantity=5), mfg["user"].id)
        assert "scrap" in exc.value.detail
        ProductionOrderService(db).record_output(mfg["order"]["id"], ms.OutputIn(scrap_quantity=4), mfg["user"].id)

    def test_serial_numbers_on_a_batch_product_are_refused(self, db, mfg):
        with pytest.raises(HTTPException) as exc:
            ProductionOrderService(db).record_output(mfg["order"]["id"], ms.OutputIn(
                quantity=1, serial_numbers=["SN-1"]), mfg["user"].id)
        assert "serial-tracked" in exc.value.detail

    def test_time_log_completed_quantity_is_bounded(self, db, mfg):
        op = mfg["order"]["operations"][0]["id"]
        with pytest.raises(HTTPException) as exc:
            ProductionOrderService(db).log_time(mfg["order"]["id"], ms.TimeLogIn(
                operation_id=op, minutes=D(10), completed_quantity=5), mfg["user"].id)
        assert "more unit(s) can be completed" in exc.value.detail
        ProductionOrderService(db).log_time(mfg["order"]["id"], ms.TimeLogIn(
            operation_id=op, minutes=D(10), completed_quantity=4), mfg["user"].id)


class TestMrpErrors:
    def test_unknown_supplier_and_product_are_named(self, db, api, mfg, make_user):
        _u, token = make_user(permissions=[("mrp", "update"), ("purchase_orders", "create")], branches=[mfg["branch"]])
        client = api(token)
        r = client.post(f"{M}/mrp/purchase-orders", json={"branch_code": mfg["branch"].branch_code, "lines": [
            {"product_id": mfg["part"].id, "quantity": 5, "supplier_id": 2_000_000_000}]})
        assert r.status_code == 400 and "Supplier #2000000000 does not exist" in r.json()["detail"]
        r = client.post(f"{M}/mrp/purchase-orders", json={"branch_code": mfg["branch"].branch_code, "lines": [
            {"product_id": 2_000_000_000, "quantity": 5, "supplier_id": 1, "unit_price": "10"}]})
        assert r.status_code == 400 and "Product #2000000000 does not exist" in r.json()["detail"]
