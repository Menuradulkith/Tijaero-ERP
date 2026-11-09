"""Regression: verifying / rejecting a credit-settlement bank transfer returned 500.

The service returns a dict, but the endpoints read `result.invoice_no`, so the change
was saved and the user still saw "internal server error" (found while seeding demo data).
"""
from datetime import date

import pytest

from tests.test_qa_audit_fixes_2026_11_03_sales import S, _credit, shop  # noqa: F401  (fixture re-export)


def _settle_by_transfer(db, superclient, shop, ref):  # noqa: F811
    o = _credit(superclient, shop, qty=1, price=100.0)
    assert superclient.post(f"{S}/{o['id']}/approve").status_code == 200
    r = superclient.post(f"{S}/{o['id']}/settle-payment", json={
        "invoice_id": o["id"], "payment_method": "bank_transfer", "payment_amount": 100.0,
        "payment_date": date.today().isoformat(), "bank_transfer_ref": ref, "bank_name": "BOC"})
    assert r.status_code in (200, 201), r.text
    from app.modules.customers.models import CustomerCreditsSettleTransaction as Tx
    tx = db.query(Tx).filter(Tx.payment_method == "bank_transfer", Tx.status == "pending_verification").order_by(Tx.id.desc()).first()
    assert tx is not None
    return o, tx


def test_verify_returns_200_and_marks_invoice_paid(db, superclient, shop):  # noqa: F811
    o, tx = _settle_by_transfer(db, superclient, shop, "QA-CS-VERIFY")
    r = superclient.post(f"{S}/credit-settlement/{tx.id}/bank-transfer/verify")
    assert r.status_code == 200, r.text
    assert r.json()["invoice_no"]
    assert superclient.get(f"{S}/{o['id']}").json()["payment_status"] == "paid"


def test_reject_returns_200(db, superclient, shop):  # noqa: F811
    _, tx = _settle_by_transfer(db, superclient, shop, "QA-CS-REJECT")
    r = superclient.post(f"{S}/credit-settlement/{tx.id}/bank-transfer/reject", json={"reason": "Not on statement"})
    assert r.status_code == 200, r.text
