"""
QA suite - atomic GRN receipt, rejected quantities, delivery note and GRN cancellation.

* POST /purchasing/grn/receive saves the header, every accepted line (serial /
  batch / none), the stock rows and the rejections in ONE transaction: any
  invalid line saves nothing at all.
* Rejected goods never enter stock and do not count against the PO line.
* A posted GRN is reversed with POST /purchasing/grn/{id}/cancel; it is refused
  once received units have moved on, and a cancelled GRN accepts no returns.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy import func

from app.common.enums import StockStatus
from app.modules.inventory.models import SalesStock
from app.modules.purchasing import schemas as po_schemas
from app.modules.purchasing.models import (
    GoodReceivedItems,
    GoodReceivedNote,
    GoodReceivedRejection,
    PurchasingOrder,
    PurchasingOrderItems,
)
from app.modules.purchasing.service import PurchasingReturnService

P = "/api/v1/purchasing"


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def world(db, make_product, make_branch, make_supplier, make_location):
    """An approved PO: serial x3, batch x100, none x50."""
    branch = make_branch()
    location = make_location(branch=branch)
    supplier = make_supplier()
    products = {}
    for kind in ("serial", "batch", "none"):
        for _attempt in range(10):  # the fixture's 4-char brand code can collide with existing dev data
            try:
                with db.begin_nested():
                    p = make_product()
                break
            except Exception:  # noqa: BLE001
                continue
        p.tracking_type = kind
        products[kind] = p
    now = datetime.utcnow()
    po = PurchasingOrder(
        purchasing_order_no=_uid("PO"), branch_code=branch.branch_code, payment_method="cash",
        purchasing_order_date=date.today(), good_received_note_date=date.today(), created_date=date.today(),
        first_suppliers_id=supplier.id, added_date=now, status="approved",
    )
    db.add(po)
    db.flush()
    po_items = {}
    for kind, qty in (("serial", 3), ("batch", 100), ("none", 50)):
        pi = PurchasingOrderItems(
            quantity=qty, unit_price=10, warrenty_month="12", created_date=date.today(),
            product_id=products[kind].id, purchasingorders_id=po.id, added_date=now,
        )
        db.add(pi)
        po_items[kind] = pi
    db.flush()
    return dict(branch=branch, location=location, po=po, items=po_items, products=products)


def _body(w, lines, **over):
    body = {
        "good_received_date": str(date.today()),
        "branch_code": w["branch"].branch_code,
        "good_received_locations_id": w["location"].id,
        "purchasingorders_id": w["po"].id,
        "lines": lines,
    }
    body.update(over)
    return body


def _full_lines(w):
    return [
        {"purchasing_order_items_id": w["items"]["serial"].id,
         "units": [{"barcode": _uid("SN"), "warranty_month": "12"}, {"barcode": _uid("SN")}],
         "rejected_quantity": 1, "rejection_reason": "Screen cracked"},
        {"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 60, "batch_no": "B-1",
         "expiry_date": "2031-01-01"},
        {"purchasing_order_items_id": w["items"]["none"].id, "quantity": 50},
    ]


def _counts(db):
    return (
        db.query(func.count(GoodReceivedNote.id)).scalar(),
        db.query(func.count(GoodReceivedItems.id)).scalar(),
        db.query(func.count(SalesStock.id)).scalar(),
        db.query(func.count(GoodReceivedRejection.id)).scalar(),
    )


def _units(db, product, status):
    return int(
        db.query(func.coalesce(func.sum(SalesStock.quantity), 0))
        .filter(SalesStock.product_id == product.id, SalesStock.status == status)
        .scalar()
    )


class TestAtomicReceive:
    def test_receipt_saves_everything_and_keeps_the_po_open(self, db, superclient, world):
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w), delivery_note_no="DN-77"))
        assert r.status_code == 201, r.text
        out = r.json()
        assert (out["units_received"], out["units_rejected"]) == (112, 1)
        assert out["grn"]["status"] == "posted" and out["grn"]["delivery_note_no"] == "DN-77"

        assert _units(db, w["products"]["serial"], StockStatus.AVAILABLE) == 2
        assert _units(db, w["products"]["batch"], StockStatus.AVAILABLE) == 60
        assert _units(db, w["products"]["none"], StockStatus.AVAILABLE) == 50
        db.refresh(w["po"])
        assert w["po"].status == "partially_completed"  # serial 2 of 3 (the rejected one is not received), batch 60 of 100

        rej = superclient.get(f"{P}/grn/{out['grn']['id']}/rejections").json()
        assert [(x["quantity"], x["reason"]) for x in rej] == [(1, "Screen cracked")]

    def test_supplier_invoice_is_optional(self, db, superclient, world):
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": 5}]))
        assert r.status_code == 201, r.text
        assert r.json()["grn"]["supplier_invoice_no"] == ""

    @pytest.mark.parametrize(
        "mutate, expect",
        [
            (lambda w, l: l[1].pop("batch_no"), "batch number"),
            (lambda w, l: l[2].update(quantity=51), "Cannot receive 51"),
            (lambda w, l: l[0]["units"].append({"barcode": l[0]["units"][0]["barcode"]}), "Duplicate barcode"),
            (lambda w, l: l[0].update(rejection_reason=""), "reason"),
            (lambda w, l: l[0].update(units=[], quantity=2), "serial-tracked"),
        ],
    )
    def test_one_bad_line_saves_nothing(self, db, superclient, world, mutate, expect):
        w = world
        lines = _full_lines(w)
        mutate(w, lines)
        before = _counts(db)
        r = superclient.post(f"{P}/grn/receive", json=_body(w, lines))
        assert r.status_code == 400, r.text
        assert expect in r.json()["detail"]
        assert _counts(db) == before

    def test_existing_barcode_is_refused(self, db, superclient, world, make_sales_stock):
        w = world
        taken = make_sales_stock()
        lines = _full_lines(w)
        lines[0]["units"][0]["barcode"] = taken.barcode
        before = _counts(db)
        r = superclient.post(f"{P}/grn/receive", json=_body(w, lines))
        assert r.status_code == 400 and "already exist" in r.json()["detail"]
        assert _counts(db) == before

    def test_second_receipt_cannot_exceed_the_order(self, db, superclient, world):
        w = world
        assert superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w))).status_code == 201
        r = superclient.post(
            f"{P}/grn/receive",
            json=_body(w, [{"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 41, "batch_no": "B-2"}]),
        )
        assert r.status_code == 400 and "Cannot receive 41" in r.json()["detail"]
        ok = superclient.post(
            f"{P}/grn/receive",
            json=_body(w, [{"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 40, "batch_no": "B-2"}]),
        )
        assert ok.status_code == 201

    def test_requires_the_stock_create_permission(self, db, api, make_user, world):
        w = world
        _, tok = make_user(permissions=[("grn", "create")], branches=[w["branch"]])
        r = api(tok).post(f"{P}/grn/receive", json=_body(w, _full_lines(w)))
        assert r.status_code == 403

    def test_nothing_to_receive_is_refused(self, superclient, world):
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, [{"purchasing_order_items_id": w["items"]["none"].id}]))
        assert r.status_code == 400 and "Nothing to receive" in r.json()["detail"]


class TestCancel:
    def _receive(self, superclient, w):
        r = superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w)))
        assert r.status_code == 201, r.text
        return r.json()["grn"]["id"]

    def test_cancel_withdraws_stock_and_reopens_the_po(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        r = superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "cancelled" and r.json()["cancel_reason"] == "Wrong delivery"
        for kind in ("serial", "batch", "none"):
            assert _units(db, w["products"][kind], StockStatus.AVAILABLE) == 0
        assert _units(db, w["products"]["batch"], StockStatus.CANCELLED) == 60
        no = db.query(GoodReceivedNote.good_received_no).filter(GoodReceivedNote.id == grn_id).scalar()
        assert db.query(func.count(GoodReceivedItems.id)).filter(
            GoodReceivedItems.good_received_note == no, GoodReceivedItems.active.is_(True)
        ).scalar() == 0
        db.refresh(w["po"])
        assert w["po"].status == "approved"

        assert superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "again"}).status_code == 400

        # the whole order can now be received again
        again = superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w)))
        assert again.status_code == 201, again.text

    def test_cancel_is_blocked_once_a_unit_is_sold(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        unit = db.query(SalesStock).filter(
            SalesStock.good_received_note_id == grn_id, SalesStock.product_id == w["products"]["serial"].id
        ).first()
        unit.status = StockStatus.SOLD
        unit.is_active = False
        db.flush()
        r = superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"})
        assert r.status_code == 400 and "no longer available" in r.json()["detail"] and "sold" in r.json()["detail"]
        assert db.query(GoodReceivedNote).get(grn_id).status == "posted"

    def test_cancelled_grn_accepts_no_returns(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        unit = db.query(SalesStock).filter(
            SalesStock.good_received_note_id == grn_id, SalesStock.product_id == w["products"]["serial"].id
        ).first()
        barcode = unit.barcode
        superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"})
        with pytest.raises(HTTPException) as exc:
            PurchasingReturnService(db).create_return(
                po_schemas.PurchasingReturnCreate(
                    branch_code=w["branch"].branch_code, goodreceivednote_id=grn_id, require_approval=True,
                    items=[po_schemas.PurchasingReturnItemCreate(
                        product_id=w["products"]["serial"].id, purchasing_price=10, return_price=10, barcode=barcode)],
                ),
                user_id=1,
            )
        assert exc.value.status_code == 400 and "cancelled" in exc.value.detail

    def test_cancel_needs_the_delete_permission(self, db, api, make_user, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        # (`api` and `superclient` share one client object: do the superuser call first)
        assert superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": ""}).status_code == 422
        _, tok = make_user(permissions=[("grn", "view"), ("grn", "create")], branches=[w["branch"]])
        assert api(tok).post(f"{P}/grn/{grn_id}/cancel", json={"reason": "nope nope"}).status_code == 403


class TestGrnInventoryPosting:
    """H2: the atomic receipt debits 1210 Inventory (it used to post nothing while sales credited 1210),
    and cancelling the GRN reverses that entry."""

    @staticmethod
    def _grn_lines(db, grn_id):
        from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntry, JournalEntryLine
        rows = (
            db.query(ChartOfAccounts.account_code, JournalEntryLine.debit_amount, JournalEntryLine.credit_amount,
                     JournalEntry.description)
            .join(JournalEntryLine, JournalEntryLine.account_id == ChartOfAccounts.id)
            .join(JournalEntry, JournalEntry.id == JournalEntryLine.journal_entry_id)
            .filter(JournalEntryLine.reference_type == "GRN", JournalEntryLine.reference_id == grn_id)
            .all()
        )
        return rows

    def test_receipt_posts_inventory_and_cancel_reverses(self, db, superclient, world):
        from decimal import Decimal as D
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w)))
        assert r.status_code == 201, r.text
        grn_id = r.json()["grn"]["id"]
        rows = self._grn_lines(db, grn_id)
        # serial 2 x 10 + batch 60 x 10 + none 50 x 10 = 1120 (the rejected unit is not stock)
        assert sum(D(str(x[1])) for x in rows if x[0] == "1210") == D("1120.00")
        # world PO is a CASH PO -> Cr 1010 Cash on Hand (QA F14, 2026-10-12; was 1020 Bank)
        assert sum(D(str(x[2])) for x in rows if x[0] == "1010") == D("1120.00")
        assert sum(D(str(x[1])) for x in rows) == sum(D(str(x[2])) for x in rows)

        assert superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"}).status_code == 200
        rows = self._grn_lines(db, grn_id)
        assert sum(D(str(x[1])) for x in rows if x[0] == "1210") == D("1120.00")
        assert sum(D(str(x[2])) for x in rows if x[0] == "1210") == D("1120.00")  # reversed: net 0
        assert sum(D(str(x[1])) for x in rows) == sum(D(str(x[2])) for x in rows)
