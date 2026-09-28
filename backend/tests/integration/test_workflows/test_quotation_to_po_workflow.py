"""
QA suite — Sales Quotation -> multi-supplier Purchase Orders workflow.

Covers PurchasingOrderService.create_order_batch's handling of quote-sourced
items (quote_item_id): the quote-item fulfillment side-effects and the
server-side duplicate-PO guard. Runs on the same auto-rolled-back ``db``
session as the rest of the integration suite.

Process rules verified
-----------------------
* Creating POs for a quote's items (one PO per supplier) marks each item
  po_created with the correct converted_qty, and recomputes the quote header
  to PARTIALLY_PROCESSED.
* Items left out of the batch keep their original (pending) status.
* Re-submitting a quote item that's already po_created is rejected (400) and
  nothing from that attempt is created (rollback).
"""
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.purchasing import schemas as po_schemas
from app.modules.purchasing import service as po_service_module
from app.modules.sales.quotation_schemas import (
    QuoteTypeEnum,
    SalesQuoteCreate,
    SalesQuoteItemCreate,
)
from app.modules.sales.quotation_service import SalesQuoteService


SALES_SERVICE = SalesQuoteService()


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


def _make_quote(db, branch, customer, items):
    """Create a quote and immediately approve it — POs can only be created
    from an approved quotation (see PurchasingOrderService._validate_order_group)."""
    payload = SalesQuoteCreate(
        quote_type=QuoteTypeEnum.QUOTATION,
        branch_code=branch.branch_code,
        customer_id=customer.id,
        valid_until=date.today() + timedelta(days=30),
        items=items,
    )
    quote = SALES_SERVICE.create_quote(db, payload)
    return SALES_SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)


def _po_group_for_quote_item(branch_code, supplier_id, quote_item, *, qty=None, unit_price="100.00"):
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
                quantity=qty if qty is not None else quote_item.quantity,
                unit_price=Decimal(unit_price),
                warrenty_month="0",
                quote_item_id=quote_item.id,
            )
        ],
    )


# --------------------------------------------------------------------------- #
# Sales Quotation -> multi-supplier POs
# --------------------------------------------------------------------------- #
class TestQuotationToMultiSupplierPO:
    def test_happy_path_marks_items_po_created_and_recomputes_quote_status(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch = make_branch()
        customer = make_customer()
        rice, chicken, oil = make_product(), make_product(), make_product()
        supplier_a, supplier_b, supplier_c = make_supplier(), make_supplier(), make_supplier()

        quote = _make_quote(
            db, branch, customer,
            [_quote_item(rice.id, qty=50), _quote_item(chicken.id, qty=20), _quote_item(oil.id, qty=10)],
        )
        items_by_product = {i.product_id: i for i in quote.items}

        svc = po_service_module.PurchasingOrderService(db)
        groups = [
            _po_group_for_quote_item(branch.branch_code, supplier_a.id, items_by_product[rice.id]),
            _po_group_for_quote_item(branch.branch_code, supplier_b.id, items_by_product[chicken.id]),
            _po_group_for_quote_item(branch.branch_code, supplier_c.id, items_by_product[oil.id]),
        ]

        batch_id, orders = svc.create_order_batch(groups, created_by=1)

        assert batch_id
        assert len(orders) == 3
        assert all(o.sales_quote_id == quote.id for o in orders)
        assert {o.first_suppliers_id for o in orders} == {supplier_a.id, supplier_b.id, supplier_c.id}

        db.refresh(quote, attribute_names=["items"])
        for item in quote.items:
            assert item.item_status == "po_created"
            assert item.converted_qty == item.quantity
        assert quote.status == "partially_processed"

    def test_items_left_out_of_the_batch_keep_their_status(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch = make_branch()
        customer = make_customer()
        rice, chicken = make_product(), make_product()
        supplier_a = make_supplier()

        quote = _make_quote(db, branch, customer, [_quote_item(rice.id, qty=50), _quote_item(chicken.id, qty=20)])
        items_by_product = {i.product_id: i for i in quote.items}

        svc = po_service_module.PurchasingOrderService(db)
        groups = [_po_group_for_quote_item(branch.branch_code, supplier_a.id, items_by_product[rice.id])]
        svc.create_order_batch(groups, created_by=1)

        db.refresh(quote, attribute_names=["items"])
        by_product = {i.product_id: i for i in quote.items}
        assert by_product[rice.id].item_status == "po_created"
        assert by_product[chicken.id].item_status == "pending"
        assert by_product[chicken.id].converted_qty == 0

    def test_duplicate_po_for_same_quote_item_is_rejected_and_rolled_back(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch = make_branch()
        customer = make_customer()
        rice = make_product()
        supplier_a, supplier_b = make_supplier(), make_supplier()

        quote = _make_quote(db, branch, customer, [_quote_item(rice.id, qty=50)])
        rice_item = quote.items[0]

        svc = po_service_module.PurchasingOrderService(db)
        svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier_a.id, rice_item)], created_by=1
        )

        # A second attempt to source the same (now po_created) quote item to
        # a different supplier must be rejected outright.
        with pytest.raises(HTTPException) as exc:
            svc.create_order_batch(
                [_po_group_for_quote_item(branch.branch_code, supplier_b.id, rice_item)], created_by=1
            )
        assert exc.value.status_code == 400

        # Only the first batch's PO should exist — the duplicate attempt created nothing.
        remaining = svc.check_daily_limit(branch.branch_code)
        assert remaining.count == 1
