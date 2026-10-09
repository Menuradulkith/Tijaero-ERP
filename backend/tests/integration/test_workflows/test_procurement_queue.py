"""
QA suite — Procurement queue (the "TOP" page's backing store).

A ProcurementQueueItem is a quotation item with a supplier already chosen but
no Purchase Order created for it yet — queued via the Sales Quotation page's
supplier-selection dialog, and cleared automatically once a PO is actually
created for it. Runs on the same auto-rolled-back ``db`` session as the rest
of the integration suite.

Process rules verified
-----------------------
* Queuing an item, then re-queuing it with a different supplier, updates
  (not duplicates) the row.
* Queuing an already-fulfilled (po_created) item is rejected.
* Creating a PO for a queued item removes it from the queue automatically;
  other queued items (different quote/supplier) are untouched.
* list_queue reflects items from multiple quotations sharing one supplier.
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


def _quote_item(product_id, *, qty=10, price=200.0, minimum=100.0):
    return SalesQuoteItemCreate(
        product_id=product_id,
        quantity=qty,
        selling_price=price,
        minimum_selling_price=minimum,
        warrenty_month="0",
    )


def _make_quote(db, branch, customer, items):
    payload = SalesQuoteCreate(
        quote_type=QuoteTypeEnum.QUOTATION,
        branch_code=branch.branch_code,
        customer_id=customer.id,
        valid_until=date.today() + timedelta(days=30),
        items=items,
    )
    quote = SALES_SERVICE.create_quote(db, payload)
    return SALES_SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)


def _queue_item(quote_item, supplier_id, *, qty=None, unit_price="100.00"):
    return po_schemas.ProcurementQueueItemCreate(
        quote_item_id=quote_item.id,
        supplier_id=supplier_id,
        quantity=qty if qty is not None else quote_item.quantity,
        unit_price=Decimal(unit_price),
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


class TestAddToQueue:
    def test_queuing_then_requeuing_updates_not_duplicates(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier_a, supplier_b = make_supplier(), make_supplier()
        quote = _make_quote(db, branch, customer, [_quote_item(product.id, qty=10)])
        quote_item = quote.items[0]

        svc = po_service_module.ProcurementQueueService(db)
        svc.add_to_queue([_queue_item(quote_item, supplier_a.id)], added_by=1)
        queued = svc.add_to_queue([_queue_item(quote_item, supplier_b.id, unit_price="150.00")], added_by=1)

        assert len(queued) == 1
        entries = svc.list_queue(branch_codes=[branch.branch_code])
        assert len(entries) == 1
        assert entries[0].supplier_id == supplier_b.id
        assert entries[0].unit_price == Decimal("150.00")

    def test_queuing_an_already_fulfilled_item_is_rejected(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier = make_supplier()
        quote = _make_quote(db, branch, customer, [_quote_item(product.id, qty=10)])
        quote_item = quote.items[0]

        po_svc = po_service_module.PurchasingOrderService(db)
        po_svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier.id, quote_item)], created_by=1
        )

        queue_svc = po_service_module.ProcurementQueueService(db)
        with pytest.raises(HTTPException) as exc:
            queue_svc.add_to_queue([_queue_item(quote_item, supplier.id)], added_by=1)
        assert exc.value.status_code == 400


class TestQueueClearedOnPOCreation:
    def test_creating_po_removes_only_that_items_queue_entry(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch, customer = make_branch(), make_customer()
        product_a, product_b = make_product(), make_product()
        supplier = make_supplier()
        quote = _make_quote(
            db, branch, customer,
            [_quote_item(product_a.id, qty=5), _quote_item(product_b.id, qty=5)],
        )
        item_a, item_b = quote.items[0], quote.items[1]

        queue_svc = po_service_module.ProcurementQueueService(db)
        queue_svc.add_to_queue(
            [_queue_item(item_a, supplier.id), _queue_item(item_b, supplier.id)], added_by=1
        )
        assert len(queue_svc.list_queue(branch_codes=[branch.branch_code])) == 2

        po_svc = po_service_module.PurchasingOrderService(db)
        po_svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier.id, item_a)], created_by=1
        )

        remaining = queue_svc.list_queue(branch_codes=[branch.branch_code])
        assert len(remaining) == 1
        assert remaining[0].quote_item_id == item_b.id


class TestListQueueAcrossQuotations:
    def test_list_queue_aggregates_multiple_quotations_for_one_supplier(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch = make_branch()
        customer_a, customer_b = make_customer(), make_customer()
        product_a, product_b = make_product(), make_product()
        supplier = make_supplier()

        quote_1 = _make_quote(db, branch, customer_a, [_quote_item(product_a.id, qty=3)])
        quote_2 = _make_quote(db, branch, customer_b, [_quote_item(product_b.id, qty=7)])

        queue_svc = po_service_module.ProcurementQueueService(db)
        queue_svc.add_to_queue(
            [
                _queue_item(quote_1.items[0], supplier.id),
                _queue_item(quote_2.items[0], supplier.id),
            ],
            added_by=1,
        )

        entries = queue_svc.list_queue(branch_codes=[branch.branch_code])
        assert {e.quote_id for e in entries} == {quote_1.id, quote_2.id}
        assert all(e.supplier_id == supplier.id for e in entries)
        assert {e.quote_no for e in entries} == {quote_1.quote_no, quote_2.quote_no}


class TestQueueProcurementQuantities:
    def test_to_purchase_accounts_for_available_stock(
        self, db, make_branch, make_customer, make_supplier, make_product, make_sales_stock
    ):
        """Required 10, 3 already in stock -> only 7 still need buying."""
        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier = make_supplier()
        quote = _make_quote(db, branch, customer, [_quote_item(product.id, qty=10)])
        quote_item = quote.items[0]

        for _ in range(3):
            make_sales_stock(product=product, branch=branch)

        queue_svc = po_service_module.ProcurementQueueService(db)
        queue_svc.add_to_queue([_queue_item(quote_item, supplier.id, qty=7)], added_by=1)

        entry = next(e for e in queue_svc.list_queue(branch_codes=[branch.branch_code]) if e.quote_item_id == quote_item.id)
        assert entry.required_quantity == 10
        assert entry.available_quantity == 3
        assert entry.ordered_quantity == 0
        assert entry.to_purchase_quantity == 7

    def test_ordered_quantity_reduces_to_purchase(
        self, db, make_branch, make_customer, make_supplier, make_product, make_sales_stock
    ):
        """Defensive check on the aggregation math itself: if a PO already
        exists for this quote line (whatever the business-rule path that got
        it there), its quantity must count as \"already ordered\" and reduce
        to_purchase accordingly. Inserted directly since add_to_queue's own
        terminal-status guard normally prevents re-queuing a po_created line."""
        from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderItems

        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier = make_supplier()
        quote = _make_quote(db, branch, customer, [_quote_item(product.id, qty=10)])
        quote_item = quote.items[0]

        for _ in range(3):
            make_sales_stock(product=product, branch=branch)

        queue_svc = po_service_module.ProcurementQueueService(db)
        queue_svc.add_to_queue([_queue_item(quote_item, supplier.id, qty=7)], added_by=1)

        from datetime import datetime
        po = PurchasingOrder(
            purchasing_order_no=f"PO-TEST-{quote_item.id}",
            branch_code=branch.branch_code,
            payment_method="non_credit",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            created_date=date.today(),
            first_suppliers_id=supplier.id,
            added_date=datetime.utcnow(),
            status="pending_approval",
        )
        db.add(po)
        db.flush()
        db.add(PurchasingOrderItems(
            quantity=2,
            unit_price=Decimal("100.00"),
            warrenty_month="0",
            created_date=date.today(),
            product_id=product.id,
            purchasingorders_id=po.id,
            added_date=datetime.utcnow(),
            quote_item_id=quote_item.id,
        ))
        db.flush()

        entry = next(e for e in queue_svc.list_queue(branch_codes=[branch.branch_code]) if e.quote_item_id == quote_item.id)
        assert entry.required_quantity == 10
        assert entry.available_quantity == 3
        assert entry.ordered_quantity == 2
        assert entry.to_purchase_quantity == 5

