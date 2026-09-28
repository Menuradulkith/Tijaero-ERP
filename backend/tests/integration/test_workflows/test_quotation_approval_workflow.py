"""
QA suite — Sales Quotation approval workflow.

Mirrors the Purchase Order approval pattern (TestPurchaseOrderBatchCreate in
test_purchasing_process.py): every new quote is created directly in
PENDING_APPROVAL with a real Approvals row, and only an approved quote can
have Purchase Orders or a Sales Order created from it.

Process rules verified
-----------------------
* create_quote starts a quote in PENDING_APPROVAL with a linked Approvals row.
* resolve_quote_approval(approve=True) flips both the quote and its Approvals
  row to approved, and sets `approval`/`approved_date`.
* resolve_quote_approval(approve=False) rejects both, records the reason.
* Editing an approved quote resets it to PENDING_APPROVAL and requires
  re-approval.
* create_order_batch (PO creation) and create_partial_so (SO creation) both
  reject a quote that has never been approved, and both succeed once
  approved — even after the header status has moved on to
  partially_processed from an earlier partial fulfillment.
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.common.models import Approvals
from app.modules.purchasing import schemas as po_schemas
from app.modules.purchasing import service as po_service_module
from app.modules.sales.quotation_schemas import (
    CreatePartialSORequest,
    PartialSOItemRequest,
    QuoteTypeEnum,
    SalesQuoteCreate,
    SalesQuoteItemCreate,
    SalesQuoteUpdate,
)
from app.modules.sales.quotation_service import SalesQuoteService


SERVICE = SalesQuoteService()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _quote_item(product_id, *, qty=10, price=200.0, minimum=100.0):
    return SalesQuoteItemCreate(
        product_id=product_id,
        quantity=qty,
        selling_price=price,
        minimum_selling_price=minimum,
        warrenty_month="0",
    )


def _quote_create(branch_code, customer_id, items):
    return SalesQuoteCreate(
        quote_type=QuoteTypeEnum.QUOTATION,
        branch_code=branch_code,
        customer_id=customer_id,
        valid_until=date.today() + timedelta(days=30),
        items=items,
    )


def _po_group_for_quote_item(branch_code, supplier_id, quote_item, *, unit_price="100.00"):
    return po_schemas.PurchasingOrderCreate(
        branch_code=branch_code,
        payment_method="non_credit",
        purchasing_order_date=date.today(),
        good_received_note_date=date.today(),
        first_suppliers_id=supplier_id,
        sales_quote_id=quote_item.quote_id,
        items=[
            po_schemas.PurchasingOrderItemCreate(
                product_id=quote_item.product_id,
                quantity=quote_item.quantity,
                unit_price=Decimal(unit_price),
                warrenty_month="0",
                quote_item_id=quote_item.id,
            )
        ],
    )


class TestQuotationApprovalCreateAndResolve:
    def test_create_quote_starts_pending_approval_with_approval_record(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id)]))

        assert quote.status == "pending_approval"
        assert quote.approval is False
        assert quote.approval_id is not None

        approval = db.query(Approvals).filter(Approvals.id == quote.approval_id).first()
        assert approval is not None
        assert approval.status == "pending"
        assert approval.approval_for == f"sales_quote:{quote.id}:{quote.quote_no}"

    def test_resolve_approval_approves_quote_and_approval_record(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id)]))

        approved = SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=7)

        assert approved.status == "approved"
        assert approved.approval is True
        assert approved.approved_date is not None

        approval = db.query(Approvals).filter(Approvals.id == approved.approval_id).first()
        assert approval.status == "approved"
        assert approval.status_changed_by == 7

    def test_resolve_approval_rejects_quote_and_approval_record(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id)]))

        rejected = SERVICE.resolve_quote_approval(db, quote.id, approve=False, remarks="Price too high", user_id=7)

        assert rejected.status == "rejected"
        assert rejected.rejection_reason == "Price too high"

        approval = db.query(Approvals).filter(Approvals.id == rejected.approval_id).first()
        assert approval.status == "rejected"

    def test_resolve_approval_on_non_pending_quote_400(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id)]))
        SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)

        with pytest.raises(HTTPException) as exc:
            SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)
        assert exc.value.status_code == 400

    def test_editing_an_approved_quote_requires_re_approval(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id)]))
        approved = SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)
        old_approval_id = approved.approval_id

        updated = SERVICE.update_quote(
            db, quote.id, SalesQuoteUpdate(remarks="Updated after approval"), user_id=1
        )

        assert updated.status == "pending_approval"
        assert updated.approval_id is not None

        approval = db.query(Approvals).filter(Approvals.id == updated.approval_id).first()
        assert approval.status == "pending"
        if updated.approval_id == old_approval_id:
            assert approval.status_changed_by is None


class TestApprovalGatesPOAndSOCreation:
    def test_po_creation_rejected_for_unapproved_quote(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier = make_supplier()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id, qty=20)]))
        quote_item = quote.items[0]

        svc = po_service_module.PurchasingOrderService(db)
        with pytest.raises(HTTPException) as exc:
            svc.create_order_batch(
                [_po_group_for_quote_item(branch.branch_code, supplier.id, quote_item)], created_by=1
            )
        assert exc.value.status_code == 400
        assert "not been approved" in exc.value.detail

    def test_po_creation_succeeds_once_approved(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier = make_supplier()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id, qty=20)]))
        SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)
        db.refresh(quote, attribute_names=["items"])
        quote_item = quote.items[0]

        svc = po_service_module.PurchasingOrderService(db)
        batch_id, orders = svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier.id, quote_item)], created_by=1
        )
        assert len(orders) == 1

    def test_po_creation_still_succeeds_after_quote_moves_to_partially_processed(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        """Once some items are fulfilled the header status moves on to
        partially_processed — the `approval` flag (not `status`) must still
        gate remaining PO/SO creation."""
        branch, customer = make_branch(), make_customer()
        product_a, product_b = make_product(), make_product()
        supplier_a, supplier_b = make_supplier(), make_supplier()
        quote = SERVICE.create_quote(
            db,
            _quote_create(branch.branch_code, customer.id, [_quote_item(product_a.id, qty=10), _quote_item(product_b.id, qty=5)]),
        )
        SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)
        db.refresh(quote, attribute_names=["items"])
        items_by_product = {i.product_id: i for i in quote.items}

        svc = po_service_module.PurchasingOrderService(db)
        svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier_a.id, items_by_product[product_a.id])],
            created_by=1,
        )

        db.refresh(quote)
        assert quote.status == "partially_processed"
        assert quote.approval is True

        # Second product still un-fulfilled — must still be creatable.
        db.refresh(quote, attribute_names=["items"])
        items_by_product = {i.product_id: i for i in quote.items}
        batch_id, orders = svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier_b.id, items_by_product[product_b.id])],
            created_by=1,
        )
        assert len(orders) == 1

    def test_so_creation_rejected_for_unapproved_quote(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, [_quote_item(product.id, qty=5)]))
        quote_item = quote.items[0]

        request = CreatePartialSORequest(items=[PartialSOItemRequest(item_id=quote_item.id, quantity=5)])
        with pytest.raises(HTTPException) as exc:
            SERVICE.create_partial_so(db, quote.id, request, created_by=1)
        assert exc.value.status_code == 400
        assert "not been approved" in exc.value.detail
