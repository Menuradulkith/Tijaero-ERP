"""Regression tests for the 2026-10-11 API audit (rows 4-6, 10-13, 21, 22):
GRN/sales-stock receipt consistency, approval remarks, PATCH approvals, batch daily limit, PO CSV."""
import uuid
from datetime import date, datetime

import pytest

from app.modules.purchasing.models import GoodReceivedNote, PurchasingOrder, PurchasingOrderItems

P = "/api/v1/purchasing"
A = "/api/v1/common/approvals"
I = "/api/v1/inventory"


def _uid(p):
    return f"{p}_{uuid.uuid4().hex[:10]}"


def _po_body(branch, supplier, product, **kw):
    today = date.today().isoformat()
    b = {
        "branch_code": branch.branch_code, "payment_method": "Non-credit", "purchasing_order_date": today,
        "good_received_note_date": today, "first_suppliers_id": supplier.id,
        "items": [{"product_id": product.id, "quantity": 2, "unit_price": 10, "warrenty_month": "12"}],
    }
    b.update(kw)
    return b


@pytest.fixture
def world(make_branch, make_supplier, make_product):
    return {"branch": make_branch(), "other": make_branch(), "supplier": make_supplier(), "product": make_product()}


@pytest.fixture
def receipt(db, world, make_location):
    """Factory: an ORM PO (given status) with a 2-unit serial line and a GRN of that PO."""
    def _make(status="approved"):
        loc = make_location(branch=world["branch"])
        po = PurchasingOrder(
            purchasing_order_no=_uid("PO"), branch_code=world["branch"].branch_code, payment_method="cash",
            purchasing_order_date=date.today(), good_received_note_date=date.today(), created_date=date.today(),
            first_suppliers_id=world["supplier"].id, added_date=datetime.utcnow(), status=status,
        )
        db.add(po)
        db.flush()
        line = PurchasingOrderItems(
            quantity=2, unit_price=10, warrenty_month="0", created_date=date.today(),
            product_id=world["product"].id, purchasingorders_id=po.id, added_date=datetime.utcnow(),
        )
        db.add(line)
        grn = GoodReceivedNote(
            good_received_no=_uid("GRN"), good_received_date=date.today(), supplier_invoice_no=_uid("SI"),
            supplier_invoice_date=date.today(), branch_code=world["branch"].branch_code, created_date=date.today(),
            good_received_locations_id=loc.id, purchasingorders_id=po.id, added_date=datetime.utcnow(),
        )
        db.add(grn)
        db.flush()
        return {"po": po, "line": line, "grn": grn, "loc": loc}
    return _make


def _recv(c, world, r, barcode=None, grn=None):
    return c.post(f"{P}/grn-items", json={
        "good_received_note": (grn or r["grn"]).good_received_no, "branch_code": world["branch"].branch_code,
        "purchasing_order_items_id": r["line"].id, "barcode": barcode or _uid("BC"),
    })


class TestGrnItemGuards:
    @pytest.mark.parametrize("status", ["pending_approval", "pending", "rejected", "cancelled", "short_closed", "completed"])
    def test_non_receivable_po_status_refused(self, superclient, db, world, receipt, status):
        r = receipt(status=status)
        resp = _recv(superclient, world, r)
        assert resp.status_code == 400, resp.text
        assert "status" in resp.json()["detail"]
        db.refresh(r["po"])
        assert r["po"].status == status  # a cancelled/short-closed PO is never flipped back

    def test_approved_po_receives_and_progresses(self, superclient, db, world, receipt):
        r = receipt()
        assert _recv(superclient, world, r).status_code == 201
        db.refresh(r["po"])
        assert r["po"].status == "partially_completed"
        assert _recv(superclient, world, r).status_code == 201
        db.refresh(r["po"])
        assert r["po"].status == "completed"

    def test_grn_of_another_po_refused(self, superclient, world, receipt):
        r, other = receipt(), receipt()
        resp = _recv(superclient, world, r, grn=other["grn"])
        assert resp.status_code == 400 and "does not belong" in resp.json()["detail"]

    def test_unknown_grn_refused(self, superclient, world, receipt):
        r = receipt()
        resp = superclient.post(f"{P}/grn-items", json={
            "good_received_note": "NO-SUCH-GRN", "branch_code": world["branch"].branch_code,
            "purchasing_order_items_id": r["line"].id, "barcode": _uid("BC")})
        assert resp.status_code == 400


class TestSalesStockConsistency:
    def _stock(self, c, world, r, **kw):
        body = {
            "product_id": world["product"].id, "branch_code": world["branch"].branch_code, "location_id": r["loc"].id,
            "good_received_note_id": r["grn"].id, "purchasing_order_items_id": r["line"].id, "barcode": _uid("BC"),
        }
        body.update(kw)
        return c.post(f"{I}/sales-stock", json=body)

    def test_product_must_match_po_line(self, superclient, world, receipt, make_product):
        r = receipt()
        bc = _uid("BC")
        assert _recv(superclient, world, r, barcode=bc).status_code == 201
        resp = self._stock(superclient, world, r, barcode=bc, product_id=make_product().id)
        assert resp.status_code == 400 and "does not match" in resp.json()["detail"]

    def test_unit_must_be_in_grn_items(self, superclient, world, receipt):
        r = receipt()
        resp = self._stock(superclient, world, r, barcode=_uid("NOTRECEIVED"))
        assert resp.status_code == 400 and "not a received unit" in resp.json()["detail"]

    def test_grn_must_belong_to_po_and_items_must_exist(self, superclient, world, receipt):
        r, other = receipt(), receipt()
        bc = _uid("BC")
        assert _recv(superclient, world, r, barcode=bc).status_code == 201
        assert self._stock(superclient, world, r, barcode=bc, good_received_note_id=other["grn"].id).status_code == 400
        assert self._stock(superclient, world, r, barcode=bc, purchasing_order_items_id=2 ** 31 - 1).status_code == 400
        assert self._stock(superclient, world, r, barcode=bc, good_received_note_id=2 ** 31 - 1).status_code == 400

    def test_no_over_receipt_beyond_line_quantity(self, superclient, world, receipt):
        r = receipt()
        codes = []
        for _ in range(2):
            bc = _uid("BC")
            assert _recv(superclient, world, r, barcode=bc).status_code == 201
            codes.append(self._stock(superclient, world, r, barcode=bc).status_code)
        assert codes == [201, 201]
        assert self._stock(superclient, world, r, barcode=_uid("BC")).status_code == 400


class TestApprovalRemarks:
    def _po(self, c, world):
        r = c.post(f"{P}/orders", json=_po_body(world["branch"], world["supplier"], world["product"]))
        assert r.status_code == 201, r.text
        return r.json()

    @pytest.mark.parametrize("n", [255, 256, 400, 500])
    def test_reject_and_approve_with_long_remark(self, superclient, world, n):
        po = self._po(superclient, world)
        assert superclient.post(f"{A}/{po['approval_id']}/reject", json={"remarks": "r" * n}).status_code == 200
        assert len(superclient.get(f"{A}/{po['approval_id']}").json()["remark"]) == n
        po2 = self._po(superclient, world)
        assert superclient.post(f"{A}/{po2['approval_id']}/approve", json={"remarks": "a" * n}).status_code == 200

    def test_cancel_with_500_char_reason(self, superclient, world):
        po = self._po(superclient, world)
        resp = superclient.post(f"{P}/orders/{po['id']}/cancel", json={"reason": "c" * 500})
        assert resp.status_code == 200, resp.text
        assert superclient.get(f"{P}/orders/{po['id']}").json()["status"] == "cancelled"


class TestPatchApproval:
    def _po(self, c, world, branch=None):
        r = c.post(f"{P}/orders", json=_po_body(branch or world["branch"], world["supplier"], world["product"]))
        assert r.status_code == 201, r.text
        return r.json()

    def test_status_cannot_be_flipped(self, superclient, world):
        po = self._po(superclient, world)
        for body in ({"status": "approved"}, {"status_changed_by": 1}, {"next_approval_group": "x"}, {"status": "approved", "remark": "x"}):
            assert superclient.patch(f"{A}/{po['approval_id']}", json=body).status_code == 400, body
        assert superclient.get(f"{A}/{po['approval_id']}").json()["status"] == "pending"
        assert superclient.get(f"{P}/orders/{po['id']}").json()["status"] == "pending_approval"

    def test_remark_edit_allowed_when_pending_only(self, superclient, world):
        po = self._po(superclient, world)
        r = superclient.patch(f"{A}/{po['approval_id']}", json={"remark": "r" * 500})
        assert r.status_code == 200 and len(r.json()["remark"]) == 500
        assert superclient.patch(f"{A}/{po['approval_id']}", json={"remark": "r" * 501}).status_code == 422
        assert superclient.post(f"{A}/{po['approval_id']}/reject", json={"remarks": "no"}).status_code == 200
        assert superclient.patch(f"{A}/{po['approval_id']}", json={"remark": "late"}).status_code == 400

    def test_branch_scope_and_permission(self, superclient, api, make_user, world):
        other_po = self._po(superclient, world, branch=world["other"])
        _u, token = make_user(permissions=[("common", "update")], branches=[world["branch"]])
        assert api(token).patch(f"{A}/{other_po['approval_id']}", json={"remark": "idor"}).status_code == 403
        _u2, token2 = make_user(permissions=[("common", "view")], branches=[world["other"]])
        assert api(token2).patch(f"{A}/{other_po['approval_id']}", json={"remark": "x"}).status_code == 403


class TestBatchDailyLimit:
    def test_limit_checked_for_every_branch_in_the_batch(self, superclient, world):
        for _ in range(5):
            assert superclient.post(f"{P}/orders", json=_po_body(world["other"], world["supplier"], world["product"])).status_code == 201
        groups = [_po_body(world["branch"], world["supplier"], world["product"]), _po_body(world["other"], world["supplier"], world["product"])]
        r = superclient.post(f"{P}/orders/batch", json={"groups": groups})
        assert r.status_code == 400, r.text
        assert world["other"].branch_code in r.json()["detail"]
        # nothing was created for the branch that had room
        assert not superclient.get(f"{P}/orders", params={"branch_code": world["branch"].branch_code}).json()

    def test_batch_within_limits_still_works(self, superclient, world):
        groups = [_po_body(world["branch"], world["supplier"], world["product"]), _po_body(world["other"], world["supplier"], world["product"])]
        assert superclient.post(f"{P}/orders/batch", json={"groups": groups}).status_code == 201


class TestPoCsvAndParams:
    def test_formula_cells_neutralised(self, superclient, world):
        body = _po_body(world["branch"], world["supplier"], world["product"], remarks='=HYPERLINK("http://x","y")')
        assert superclient.post(f"{P}/orders", json=body).status_code == 201
        r = superclient.get(f"{P}/export-csv", params={"branch_codes": world["branch"].branch_code})
        assert r.status_code == 200
        assert "'=HYPERLINK" in r.text and ",=HYPERLINK" not in r.text

    def test_id_and_amount_bounds(self, superclient, world):
        assert superclient.get(f"{P}/export-csv", params={"supplier_id": 2 ** 40}).status_code == 422
        assert superclient.get(f"{P}/export-csv", params={"supplier_id": 0}).status_code == 422
        s = world["supplier"].id
        for params in ({"supplier_id": 2 ** 40, "grn_value": 1}, {"supplier_id": s, "grn_value": 1, "po_id": 2 ** 40},
                       {"supplier_id": s, "grn_value": "nan"}, {"supplier_id": s, "grn_value": "inf"},
                       {"supplier_id": s, "grn_value": 1e30}, {"supplier_id": s, "grn_value": -1}):
            assert superclient.post(f"{P}/grn/check-credit", params=params).status_code == 422, params
        assert superclient.post(f"{P}/grn/check-credit", params={"supplier_id": s, "grn_value": 100}).status_code == 200
