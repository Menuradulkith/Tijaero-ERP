"""PO lifecycle rules + the print / email gate.

* an approved PO cannot be cancelled (a pending one still can);
* editing a rejected PO sends it back to approval as a normal pending PO, with the full history kept;
* only approved documents can be printed / emailed (backend guard).
"""

from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.common.document_guard import ensure_printable_status, is_printable_status
from app.common.enums import PurchaseOrderStatus
from app.common.audit import AuditLog
from app.modules.purchasing import schemas, service


def _po(branch_code, supplier_id, product_id, qty=2):
    return schemas.PurchasingOrderCreate(
        branch_code=branch_code, payment_method="non_credit",
        purchasing_order_date=date.today(), good_received_note_date=date.today(),
        first_suppliers_id=supplier_id,
        items=[schemas.PurchasingOrderItemCreate(
            product_id=product_id, quantity=qty, unit_price=Decimal("150.00"), warrenty_month="12")],
    )


@pytest.fixture
def po_ctx(db, make_branch, make_supplier, make_product):
    branch, supplier, product = make_branch(), make_supplier(), make_product()
    svc = service.PurchasingOrderService(db)
    order = svc.create_order(_po(branch.branch_code, supplier.id, product.id), created_by=1)
    return svc, order, product


def _actions(db, order_id):
    rows = db.query(AuditLog).filter(AuditLog.entity_type == "purchase_order", AuditLog.entity_id == order_id).order_by(AuditLog.id).all()
    return [r.action for r in rows]


class TestCancelRules:
    def test_approved_po_cannot_be_cancelled(self, db, po_ctx):
        svc, order, _ = po_ctx
        svc.approve_order(order.id, True, user_id=1)
        with pytest.raises(HTTPException) as exc:
            svc.cancel_order(order.id, "changed my mind", user_id=1)
        assert exc.value.status_code == 400 and "approved" in exc.value.detail.lower()
        db.refresh(order)
        assert order.status == PurchaseOrderStatus.APPROVED

    def test_pending_po_can_still_be_cancelled(self, db, po_ctx):
        svc, order, _ = po_ctx
        svc.cancel_order(order.id, "not needed", user_id=1)
        db.refresh(order)
        assert order.status == PurchaseOrderStatus.CANCELLED


class TestRejectedPoResubmission:
    def test_editing_a_rejected_po_sends_it_back_to_approval(self, db, po_ctx):
        svc, order, product = po_ctx
        first_approval = order.approval_id
        svc.approve_order(order.id, False, remarks="price too high", user_id=1)
        db.refresh(order)
        assert order.status == PurchaseOrderStatus.REJECTED

        svc.update_order(order.id, schemas.PurchasingOrderUpdate(remarks="renegotiated"), updated_by=1)
        db.refresh(order)
        assert order.status == PurchaseOrderStatus.PENDING_APPROVAL
        assert order.approval_id != first_approval  # a fresh approval request

        # it is now an ordinary pending PO: it can be approved
        svc.approve_order(order.id, True, user_id=1)
        db.refresh(order)
        assert order.status == PurchaseOrderStatus.APPROVED

    def test_history_keeps_every_step(self, db, po_ctx):
        svc, order, _ = po_ctx
        svc.approve_order(order.id, False, remarks="wrong supplier", user_id=1)
        svc.update_order(order.id, schemas.PurchasingOrderUpdate(remarks="fixed"), updated_by=1)
        svc.approve_order(order.id, True, user_id=1)
        assert _actions(db, order.id) == ["create", "reject", "update", "resubmit", "approve"]

    def test_pending_po_edit_does_not_create_a_new_approval(self, db, po_ctx):
        svc, order, _ = po_ctx
        first_approval = order.approval_id
        svc.update_order(order.id, schemas.PurchasingOrderUpdate(remarks="small fix"), updated_by=1)
        db.refresh(order)
        assert order.status == PurchaseOrderStatus.PENDING_APPROVAL and order.approval_id == first_approval
        assert "resubmit" not in _actions(db, order.id)


class TestPrintGate:
    @pytest.mark.parametrize("status", ["approved", "completed", "partially_completed", "short_closed", "posted", "paid", "processed"])
    def test_approved_or_later_is_printable(self, status):
        assert is_printable_status(status)
        ensure_printable_status(status)

    @pytest.mark.parametrize("status", ["draft", "pending", "pending_approval", "rejected", "cancelled", "voided", "", None])
    def test_everything_else_is_blocked(self, status):
        assert not is_printable_status(status)
        with pytest.raises(HTTPException) as exc:
            ensure_printable_status(status, "purchase order")
        assert exc.value.status_code == 400

    def test_po_document_endpoint_refuses_unapproved(self, db, superclient, po_ctx):
        svc, order, _ = po_ctx
        r = superclient.get(f"/api/v1/reporting/documents/purchase-order/{order.id}")
        assert r.status_code == 400 and "approved" in r.text.lower()
        svc.approve_order(order.id, True, user_id=1)
        r = superclient.get(f"/api/v1/reporting/documents/purchase-order/{order.id}")
        assert r.status_code == 200

    def test_po_email_draft_refuses_unapproved(self, db, superclient, po_ctx):
        svc, order, _ = po_ctx
        r = superclient.get(f"/api/v1/communication/email-draft/purchase-order/{order.id}")
        assert r.status_code == 400
        svc.approve_order(order.id, True, user_id=1)
        r = superclient.get(f"/api/v1/communication/email-draft/purchase-order/{order.id}")
        assert r.status_code == 200
