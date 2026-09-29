"""
QA suite — Sales Quotation -> PO -> GRN stock reservation workflow.

Covers the business rules from the procurement-reservation feature:

* Receiving stock against a PO line that traces back to a Sales Quotation
  item commits ("reserves") exactly the item's required quantity; any
  excess received lands as normal available stock.
* A PO item with no quote link never reserves anything (ordinary POs are
  unaffected).
* Reservations are released (status -> available) when the quotation is
  cancelled, or via the explicit release-reservation action — never any
  other time.
* The procurement summary reports required/ordered/received/reserved/
  available/outstanding quantities correctly.

All tests run inside the rolled-back transactional ``db`` fixture.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime

import pytest
from fastapi import HTTPException

from app.common.enums import StockStatus
from app.modules.inventory import schemas as inv_schemas
from app.modules.inventory.models import SalesStock
from app.modules.inventory.service import SalesStockService
from app.modules.purchasing.models import (
    GoodReceivedItems,
    GoodReceivedNote,
    PurchasingOrder,
    PurchasingOrderItems,
)
from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
from app.modules.sales.quotation_service import sales_quote_service


def _uid(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


@pytest.fixture
def make_quote_with_item(db, make_customer, make_branch):
    """Build a minimal SalesQuote + single SalesQuoteItem needing `quantity` units."""

    def _make(*, quantity: int = 10, branch=None, customer=None):
        branch = branch or make_branch()
        customer = customer or make_customer()
        now = datetime.utcnow()
        quote = SalesQuote(
            quote_no=_uid("Q"),
            branch_code=branch.branch_code,
            customer_id=customer.id,
            created_date=date.today(),
            created_date_time=now,
            valid_until=date.today(),
            status="approved",
            approval=True,
        )
        db.add(quote)
        db.flush()
        item = SalesQuoteItem(
            quote_id=quote.id,
            product_id=None,  # set by caller
            quantity=quantity,
            selling_price=100,
            minimum_selling_price=50,
            warrenty_month="0",
            created_date=now,
        )
        return quote, item

    return _make


@pytest.fixture
def make_po_item_for_quote(db):
    """Build the Supplier -> PO -> PO-item chain for a given quote item, linking
    the PO item back to it via quote_item_id — mirrors what
    PurchasingOrderService._fulfill_quote_items / the TOP page produce."""

    def _make(*, product, branch, supplier, quote_item, ordered_qty: int):
        now = datetime.utcnow()
        po = PurchasingOrder(
            purchasing_order_no=_uid("PO"),
            branch_code=branch.branch_code,
            payment_method="cash",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            created_date=date.today(),
            first_suppliers_id=supplier.id,
            added_date=now,
            status="approved",
            sales_quote_id=quote_item.quote_id,
        )
        db.add(po)
        db.flush()

        po_item = PurchasingOrderItems(
            quantity=ordered_qty,
            unit_price=100,
            warrenty_month="0",
            created_date=date.today(),
            product_id=product.id,
            purchasingorders_id=po.id,
            added_date=now,
            quote_item_id=quote_item.id,
        )
        db.add(po_item)
        db.flush()
        return po, po_item

    return _make


@pytest.fixture
def make_grn_for_po(db):
    def _make(*, po, branch, location):
        grn = GoodReceivedNote(
            good_received_no=_uid("GRN"),
            good_received_date=date.today(),
            supplier_invoice_no=_uid("SINV"),
            supplier_invoice_date=date.today(),
            branch_code=branch.branch_code,
            created_date=date.today(),
            good_received_locations_id=location.id,
            purchasingorders_id=po.id,
            added_date=datetime.utcnow(),
        )
        db.add(grn)
        db.flush()
        return grn

    return _make


def _receive_units(db, *, product, branch, location, grn, po_item, count: int):
    """Receive `count` physical units against `po_item` through the real
    SalesStockService.create path (the same call the GRN barcode-entry UI
    makes), so the reservation logic under test actually runs. Also creates
    the matching GoodReceivedItems (barcode scan) row for each unit — the
    same two-step "Step 1: GRN item, Step 2: sales stock" sequence the real
    GRN receiving UI performs — so received_quantity is computable too."""
    svc = SalesStockService(db)
    created = []
    for _ in range(count):
        barcode = _uid("BC")
        db.add(GoodReceivedItems(
            good_received_note=grn.good_received_no,
            barcode=barcode,
            branch_code=branch.branch_code,
            active=True,
            created_date=date.today(),
            purchasing_order_items_id=po_item.id,
            added_date=datetime.utcnow(),
        ))
        db.flush()
        created.append(
            svc.create(
                inv_schemas.SalesStockCreate(
                    product_id=product.id,
                    barcode=barcode,
                    branch_code=branch.branch_code,
                    location_id=location.id,
                    good_received_note_id=grn.id,
                    purchasing_order_items_id=po_item.id,
                    status=StockStatus.AVAILABLE,
                )
            )
        )
    return created


class TestReservationOnReceive:
    def test_receiving_exact_quantity_reserves_all_units(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=10, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=10
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)

        units = _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=10)

        assert all(u.status == StockStatus.RESERVED for u in units)
        assert all(u.reserved_for_quote_item_id == item.id for u in units)

    def test_excess_received_beyond_required_qty_stays_available(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=10, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=12
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)

        units = _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=12)

        reserved = [u for u in units if u.status == StockStatus.RESERVED]
        available = [u for u in units if u.status == StockStatus.AVAILABLE]
        assert len(reserved) == 10
        assert len(available) == 2
        assert all(u.reserved_for_quote_item_id is None for u in available)

    def test_partial_grn_then_completion_reserves_incrementally(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=10, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=10
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)

        first_batch = _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=6)
        assert all(u.status == StockStatus.RESERVED for u in first_batch)

        summary = sales_quote_service.get_procurement_summary(db, quote.id)
        row = summary["items"][0]
        assert row["reserved_quantity"] == 6
        assert row["outstanding_quantity"] == 4

        second_batch = _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=4)
        assert all(u.status == StockStatus.RESERVED for u in second_batch)

        summary = sales_quote_service.get_procurement_summary(db, quote.id)
        row = summary["items"][0]
        assert row["reserved_quantity"] == 10
        assert row["outstanding_quantity"] == 0

    def test_po_without_quote_link_never_reserves(
        self, db, make_product, make_branch, make_supplier, make_location,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        now = datetime.utcnow()
        po = PurchasingOrder(
            purchasing_order_no=_uid("PO"),
            branch_code=branch.branch_code,
            payment_method="cash",
            purchasing_order_date=date.today(),
            good_received_note_date=date.today(),
            created_date=date.today(),
            first_suppliers_id=supplier.id,
            added_date=now,
            status="approved",
        )
        db.add(po)
        db.flush()
        po_item = PurchasingOrderItems(
            quantity=5,
            unit_price=100,
            warrenty_month="0",
            created_date=date.today(),
            product_id=product.id,
            purchasingorders_id=po.id,
            added_date=now,
        )
        db.add(po_item)
        db.flush()
        grn = GoodReceivedNote(
            good_received_no=_uid("GRN"),
            good_received_date=date.today(),
            supplier_invoice_no=_uid("SINV"),
            supplier_invoice_date=date.today(),
            branch_code=branch.branch_code,
            created_date=date.today(),
            good_received_locations_id=location.id,
            purchasingorders_id=po.id,
            added_date=now,
        )
        db.add(grn)
        db.flush()

        units = _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=5)
        assert all(u.status == StockStatus.AVAILABLE for u in units)
        assert all(u.reserved_for_quote_item_id is None for u in units)


class TestReservationIsolatedAcrossQuotations:
    """Two quotations both wanting the same product must not be able to
    steal each other's procured stock — reservation is per SalesQuoteItem,
    not per product."""

    def test_stock_received_for_one_quotation_is_invisible_to_another(
        self, db, make_product, make_branch, make_supplier, make_location, make_customer,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()

        # Quotation A: procures and receives 5 units for its own item.
        quote_a, item_a = make_quote_with_item(quantity=5, branch=branch, customer=make_customer())
        item_a.product_id = product.id
        db.add(item_a)
        db.flush()
        po_a, po_item_a = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item_a, ordered_qty=5
        )
        grn_a = make_grn_for_po(po=po_a, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn_a, po_item=po_item_a, count=5)

        # Quotation B: separate quote, same product, same branch, no
        # procurement of its own yet.
        quote_b, item_b = make_quote_with_item(quantity=5, branch=branch, customer=make_customer())
        item_b.product_id = product.id
        db.add(item_b)
        db.flush()

        # Reserved units belong exclusively to A's line item.
        reserved_for_a = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item_a.id,
            SalesStock.status == StockStatus.RESERVED,
        ).count()
        assert reserved_for_a == 5
        reserved_for_b = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item_b.id,
        ).count()
        assert reserved_for_b == 0

        # B's stock-availability check must NOT see A's reserved units.
        check_b = sales_quote_service.check_stock_availability(db, quote_b.id)
        assert check_b["items"][0]["current_branch_available"] == 0
        assert check_b["items"][0]["is_sufficient"] is False
        assert check_b["items"][0]["stock_status"] == "needs_procurement"

        # B's procurement summary must show 0 reserved/available for its item.
        summary_b = sales_quote_service.get_procurement_summary(db, quote_b.id)
        row_b = summary_b["items"][0]
        assert row_b["reserved_quantity"] == 0
        assert row_b["available_quantity"] == 0

        # B cannot convert its item to a Sales Order using A's reserved stock.
        from app.modules.sales.quotation_schemas import CreatePartialSORequest, PartialSOItemRequest
        with pytest.raises(HTTPException) as exc_info:
            sales_quote_service.create_partial_so(
                db, quote_b.id,
                CreatePartialSORequest(items=[PartialSOItemRequest(item_id=item_b.id, quantity=5)]),
                created_by=1,
            )
        assert exc_info.value.status_code == 409

    def test_quotation_own_procurement_only_consumes_its_own_reservation(
        self, db, make_product, make_branch, make_supplier, make_location, make_customer,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        """Once B procures its own stock, B can convert using its own
        reserved units — A's reservation stays untouched throughout."""
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()

        quote_a, item_a = make_quote_with_item(quantity=5, branch=branch, customer=make_customer())
        item_a.product_id = product.id
        db.add(item_a)
        db.flush()
        po_a, po_item_a = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item_a, ordered_qty=5
        )
        grn_a = make_grn_for_po(po=po_a, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn_a, po_item=po_item_a, count=5)

        quote_b, item_b = make_quote_with_item(quantity=3, branch=branch, customer=make_customer())
        item_b.product_id = product.id
        db.add(item_b)
        db.flush()
        po_b, po_item_b = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item_b, ordered_qty=3
        )
        grn_b = make_grn_for_po(po=po_b, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn_b, po_item=po_item_b, count=3)

        from app.modules.sales.quotation_schemas import CreatePartialSORequest, PartialSOItemRequest
        invoice = sales_quote_service.create_partial_so(
            db, quote_b.id,
            CreatePartialSORequest(items=[PartialSOItemRequest(item_id=item_b.id, quantity=3)]),
            created_by=1,
        )
        assert invoice is not None

        # A's 5 reserved units are still intact and untouched by B's SO.
        reserved_for_a = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item_a.id,
            SalesStock.status == StockStatus.RESERVED,
        ).count()
        assert reserved_for_a == 5


class TestReservationRelease:
    def test_cancelling_quote_releases_reserved_stock(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=10, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=10
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=10)

        reserved_count = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item.id,
            SalesStock.status == StockStatus.RESERVED,
        ).count()
        assert reserved_count == 10

        sales_quote_service.cancel_quote(db, quote.id, reason="test cancel")

        available_count = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item.id,
            SalesStock.status == StockStatus.AVAILABLE,
        ).count()
        assert available_count == 10

    def test_explicit_release_reservation_endpoint_action(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=5, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=5
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=5)

        # Quote is still active (not cancelled) — an authorized user
        # explicitly releases the allocation.
        result = sales_quote_service.release_reservation(db, quote.id, user_id=1)
        assert result["units_released"] == 5

        available_count = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item.id,
            SalesStock.status == StockStatus.AVAILABLE,
        ).count()
        assert available_count == 5

    def test_reservation_not_released_without_action(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        """Business rule: reservations never disappear on their own — merely
        checking stock availability must not release anything."""
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=3, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=3
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=3)

        sales_quote_service.check_stock_availability(db, quote.id)

        reserved_count = db.query(SalesStock).filter(
            SalesStock.reserved_for_quote_item_id == item.id,
            SalesStock.status == StockStatus.RESERVED,
        ).count()
        assert reserved_count == 3


class TestProcurementSummary:
    def test_summary_quantities_match_expected(
        self, db, make_product, make_branch, make_supplier, make_location,
        make_quote_with_item, make_po_item_for_quote, make_grn_for_po,
    ):
        branch = make_branch()
        location = make_location(branch=branch)
        supplier = make_supplier()
        product = make_product()
        quote, item = make_quote_with_item(quantity=10, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        po, po_item = make_po_item_for_quote(
            product=product, branch=branch, supplier=supplier, quote_item=item, ordered_qty=10
        )
        grn = make_grn_for_po(po=po, branch=branch, location=location)
        _receive_units(db, product=product, branch=branch, location=location, grn=grn, po_item=po_item, count=6)

        summary = sales_quote_service.get_procurement_summary(db, quote.id)
        row = summary["items"][0]
        assert row["required_quantity"] == 10
        assert row["ordered_quantity"] == 10
        assert row["received_quantity"] == 6
        assert row["reserved_quantity"] == 6
        assert row["on_hand_quantity"] == 6
        assert row["available_quantity"] == 0
        assert row["outstanding_quantity"] == 4

    def test_partial_availability_only_shortfall_needs_purchasing(
        self, db, make_product, make_branch, make_sales_stock, make_quote_with_item,
    ):
        """Customer wants 100, 40 are already in stock (unrelated to any PO
        for this quote) -> only the 60-unit shortfall should need buying,
        both in the stock-availability check and the procurement summary."""
        branch = make_branch()
        product = make_product()
        quote, item = make_quote_with_item(quantity=100, branch=branch)
        item.product_id = product.id
        db.add(item)
        db.flush()

        for _ in range(40):
            make_sales_stock(product=product, branch=branch, status=StockStatus.AVAILABLE)

        check = sales_quote_service.check_stock_availability(db, quote.id)
        row = check["items"][0]
        assert row["requested_quantity"] == 100
        assert row["available_quantity"] == 40
        assert row["is_sufficient"] is False
        assert row["to_purchase_quantity"] == 60

        summary = sales_quote_service.get_procurement_summary(db, quote.id)
        srow = summary["items"][0]
        assert srow["required_quantity"] == 100
        assert srow["available_quantity"] == 40
        assert srow["to_purchase_quantity"] == 60

