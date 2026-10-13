"""
QA suite - receiving details, receipt tolerances and landed cost vouchers.

* received_by defaults to the posting user; vehicle no is stored.
* over-receipt tolerance lets a line exceed the order by +x%; under-receipt tolerance
  closes the PO once -x% of the order has arrived. 0% = exact (unchanged).
* a landed cost voucher is allocated across the GRN lines (by value or quantity), gives each
  line a landed unit cost, posts Dr 1210 Inventory / Cr creditors|cash|bank and can be reversed.
"""

from __future__ import annotations

from decimal import Decimal

import pytest
from sqlalchemy import func

from app.modules.finance.accounting_models import JournalEntryLine
from app.modules.purchasing.models import GoodReceivedNote
from app.modules.purchasing.receipt_rules import receipt_limits
from tests.integration.test_workflows.test_grn_receive_cancel import (  # noqa: F401  (fixtures)
    P,
    _body,
    _full_lines,
    _uid,
    world,
)


class TestReceiptLimits:
    @pytest.mark.parametrize(
        "ordered, over, under, expect",
        [
            (50, 0, 0, (50, 50)),
            (50, 10, 0, (55, 50)),
            (50, 0, 10, (50, 45)),
            (50, 10, 10, (55, 45)),
            (3, 10, 10, (3, 3)),  # fractions never grant a unit that was not earned / required
            (3, 40, 40, (4, 2)),
            (1, 0, 100, (1, 1)),  # a non-empty line always needs at least one unit
        ],
    )
    def test_limits(self, ordered, over, under, expect):
        assert receipt_limits(ordered, over, under) == expect


class TestReceivingDetails:
    def test_received_by_defaults_to_the_user_and_vehicle_is_kept(self, db, superclient, superuser, world):
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w), vehicle_no="WP-1234"))
        assert r.status_code == 201, r.text
        grn = r.json()["grn"]
        user = superuser[0]
        assert grn["vehicle_no"] == "WP-1234"
        assert grn["received_by"] == f"{user.first_name} {user.last_name}".strip()

        r2 = superclient.post(
            f"{P}/grn/receive",
            json=_body(w, [{"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 40, "batch_no": "B-2"}],
                       received_by="Store keeper Nimal"),
        )
        assert r2.status_code == 201 and r2.json()["grn"]["received_by"] == "Store keeper Nimal"


class TestTolerance:
    def test_over_receipt_within_tolerance_is_allowed(self, db, superclient, world):
        w = world
        w["products"]["none"].over_receipt_tolerance_pct = Decimal("10")  # 50 ordered -> 55 receivable
        db.flush()
        line = lambda qty: [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": qty}]
        bad = superclient.post(f"{P}/grn/receive", json=_body(w, line(56)))
        assert bad.status_code == 400 and "55" in bad.json()["detail"]
        assert superclient.post(f"{P}/grn/receive", json=_body(w, line(55))).status_code == 201
        # nothing more fits after the tolerance is used up
        assert superclient.post(f"{P}/grn/receive", json=_body(w, line(1))).status_code == 400

    def test_exact_quantity_without_tolerance(self, superclient, world):
        w = world
        r = superclient.post(f"{P}/grn/receive", json=_body(w, [{"purchasing_order_items_id": w["items"]["none"].id, "quantity": 51}]))
        assert r.status_code == 400

    def test_under_receipt_tolerance_closes_the_po(self, db, superclient, world):
        w = world
        w["products"]["none"].under_receipt_tolerance_pct = Decimal("10")  # 50 ordered -> 45 closes the line
        db.flush()
        lines = [
            {"purchasing_order_items_id": w["items"]["serial"].id, "units": [{"barcode": _uid("SN")} for _ in range(3)]},
            {"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 100, "batch_no": "B-1"},
            {"purchasing_order_items_id": w["items"]["none"].id, "quantity": 45},
        ]
        assert superclient.post(f"{P}/grn/receive", json=_body(w, lines)).status_code == 201
        db.refresh(w["po"])
        assert w["po"].status == "completed"

    def test_without_the_tolerance_the_same_receipt_leaves_the_po_open(self, db, superclient, world):
        w = world
        lines = [
            {"purchasing_order_items_id": w["items"]["serial"].id, "units": [{"barcode": _uid("SN")} for _ in range(3)]},
            {"purchasing_order_items_id": w["items"]["batch"].id, "quantity": 100, "batch_no": "B-1"},
            {"purchasing_order_items_id": w["items"]["none"].id, "quantity": 45},
        ]
        assert superclient.post(f"{P}/grn/receive", json=_body(w, lines)).status_code == 201
        db.refresh(w["po"])
        assert w["po"].status == "partially_completed"

    def test_product_tolerance_is_validated(self, superclient, world):
        w = world
        pid = w["products"]["none"].id
        assert superclient.put(f"/api/v1/inventory/products/{pid}", json={"over_receipt_tolerance_pct": 150}).status_code == 422
        assert superclient.put(f"/api/v1/inventory/products/{pid}", json={"under_receipt_tolerance_pct": -1}).status_code == 422


class TestLandedCost:
    def _receive(self, superclient, w):
        r = superclient.post(f"{P}/grn/receive", json=_body(w, _full_lines(w)))
        assert r.status_code == 201, r.text
        return r.json()["grn"]["id"]

    def _gl_lines(self, db, voucher_id):
        return db.query(func.count(JournalEntryLine.id)).filter(
            JournalEntryLine.reference_type == "LandedCost", JournalEntryLine.reference_id == voucher_id
        ).scalar()

    def test_value_allocation_gives_each_line_a_landed_unit_cost(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        # received: serial 2 x 10, batch 60 x 10, none 50 x 10  (all unit price 10) -> 112 units
        r = superclient.post(
            f"{P}/grn/{grn_id}/landed-costs",
            json={"charge_type": "freight", "amount": "1120.00", "allocation_basis": "value", "payment_method": "cash",
                  "reference_no": "FRT-1"},
        )
        assert r.status_code == 201, r.text
        assert r.json()["voucher_no"].startswith("LCV-") and r.json()["status"] == "posted"

        summary = superclient.get(f"{P}/grn/{grn_id}/landed-costs").json()
        assert Decimal(str(summary["total_landed"])) == Decimal("1120.00")
        by_qty = {l["quantity"]: l for l in summary["lines"]}
        assert Decimal(str(by_qty[60]["landed_total"])) == Decimal("600.00")
        assert Decimal(str(by_qty[60]["landed_per_unit"])) == Decimal("10.00")
        assert Decimal(str(by_qty[60]["landed_unit_cost"])) == Decimal("20.00")  # 10 price + 10 freight

    def test_quantity_basis_and_rounding_remainder_sum_exactly(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        r = superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={"charge_type": "duty", "amount": "100.00", "allocation_basis": "quantity"})
        assert r.status_code == 201, r.text
        summary = superclient.get(f"{P}/grn/{grn_id}/landed-costs").json()
        assert sum(Decimal(str(l["landed_total"])) for l in summary["lines"]) == Decimal("100.00")

    def test_posts_to_the_gl_and_cancel_reverses_it(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        v = superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={"charge_type": "insurance", "amount": "250.00", "payment_method": "credit"}).json()
        assert self._gl_lines(db, v["id"]) == 2  # Dr 1210 / Cr 2010

        r = superclient.post(f"{P}/landed-costs/{v['id']}/cancel", json={"reason": "Charged twice"})
        assert r.status_code == 200 and r.json()["status"] == "cancelled"
        assert self._gl_lines(db, v["id"]) == 4  # + the mirror entry
        assert superclient.post(f"{P}/landed-costs/{v['id']}/cancel", json={"reason": "again"}).status_code == 400
        assert Decimal(str(superclient.get(f"{P}/grn/{grn_id}/landed-costs").json()["total_landed"])) == 0

    def test_grn_cancel_is_blocked_while_a_landed_cost_is_posted(self, db, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        v = superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={"charge_type": "freight", "amount": "50.00"}).json()
        r = superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"})
        assert r.status_code == 400 and "landed cost" in r.json()["detail"]
        superclient.post(f"{P}/landed-costs/{v['id']}/cancel", json={"reason": "Charged twice"})
        assert superclient.post(f"{P}/grn/{grn_id}/cancel", json={"reason": "Wrong delivery"}).status_code == 200

    def test_validation_and_permissions(self, db, api, make_user, superclient, world):
        w = world
        grn_id = self._receive(superclient, w)
        assert superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={"charge_type": "freight", "amount": "0"}).status_code == 422
        assert superclient.post(f"{P}/grn/{grn_id}/landed-costs", json={"charge_type": "bogus", "amount": "5"}).status_code == 422
        assert superclient.post(f"{P}/grn/999999999/landed-costs", json={"charge_type": "freight", "amount": "5"}).status_code in (400, 404)
        _, tok = make_user(permissions=[("grn", "view")], branches=[w["branch"]])
        assert api(tok).post(f"{P}/grn/{grn_id}/landed-costs", json={"charge_type": "freight", "amount": "5"}).status_code == 403
