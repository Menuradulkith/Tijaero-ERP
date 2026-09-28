"""
QA suite — Sales Quotation stock availability check.

Regression coverage for a bug where SalesQuoteService.check_stock_availability
reported an item as 'in_stock' the moment a Purchase Order was *created* for
it, even though the PO was still pending approval and no GRN had posted any
sales_stock rows. Root cause: converted_qty is bumped by
PurchasingOrderService._fulfill_quote_items as soon as a PO is created (see
test_quotation_to_po_workflow.py), and the stock check subtracted that from
the item's quantity, so `remaining_qty` (and thus the "still needed" amount)
dropped to zero — making `0 (physical stock) >= 0 (remaining)` look
sufficient. Runs on the same auto-rolled-back ``db`` session as the rest of
the integration suite.
"""
from datetime import date, timedelta
from decimal import Decimal

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


class TestStockAvailabilityCheck:
    def test_item_with_no_po_and_no_stock_needs_procurement(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_quote_item(product.id, qty=5)])

        result = SALES_SERVICE.check_stock_availability(db, quote.id)

        item = result["items"][0]
        assert item["is_sufficient"] is False
        assert item["stock_status"] == "needs_procurement"
        assert result["all_sufficient"] is False

    def test_pending_unreceived_po_does_not_report_in_stock(
        self, db, make_branch, make_customer, make_supplier, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        supplier = make_supplier()
        quote = _make_quote(db, branch, customer, [_quote_item(product.id, qty=5)])
        quote_item = quote.items[0]

        po_svc = po_service_module.PurchasingOrderService(db)
        po_svc.create_order_batch(
            [_po_group_for_quote_item(branch.branch_code, supplier.id, quote_item)], created_by=1
        )

        db.refresh(quote_item)
        assert quote_item.item_status == "po_created"
        assert quote_item.converted_qty == quote_item.quantity  # the value that caused the bug

        result = SALES_SERVICE.check_stock_availability(db, quote.id)

        item = result["items"][0]
        assert item["current_branch_available"] == 0
        assert item["is_sufficient"] is False
        assert item["stock_status"] != "in_stock"
        assert result["all_sufficient"] is False
