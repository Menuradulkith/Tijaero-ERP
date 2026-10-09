"""
QA suite — Sales process (Quotations → Sales Order conversion).

Verifies the SalesQuoteService business rules at the service layer using the
auto-rolled-back ``db`` session.  The service is stateless (``SalesQuoteService()``)
and every method takes ``db`` explicitly.

Process rules verified
----------------------
Quote creation:
* happy path -> DRAFT status, quote_no generated, totals computed, items attached
* inactive customer -> 400
* missing customer -> 404
* inactive branch -> 4xx
* minimum-price violation (selling < minimum) -> 400

Quote edit / delete:
* update totals recompute
* cannot edit a CANCELLED quote
* cannot delete a CANCELLED quote

Status machine:
* DRAFT -> SENT allowed
* SENT -> COMPLETED allowed; DRAFT -> COMPLETED allowed
* cannot leave a terminal state (CANCELLED)
* cancel sets CANCELLED and cascades pending items -> cancelled
* cancel of already-cancelled -> 400

Partial SO conversion (the money path):
* converting an item creates an Invoice, marks item so_created, recomputes
  quote status to COMPLETED (single item) 
* multi-item: converting one of two items -> PARTIALLY_PROCESSED
* converting an already-converted item -> 400
* requested qty exceeding remaining -> 400
* converting on a cancelled quote -> 400

Item cancellation:
* cancelling one item of two recomputes header; cancelling the only remaining
  pending item behaviour.
"""

from datetime import date, timedelta

import pytest
from fastapi import HTTPException

from app.modules.sales.quotation_schemas import (
    CreatePartialSORequest,
    PartialSOItemRequest,
    QuoteTypeEnum,
    SalesQuoteCreate,
    SalesQuoteItemCreate,
    SalesQuoteStatusUpdate,
    SalesQuoteUpdate,
)
from app.modules.sales.quotation_schemas import QuoteStatusEnum
from app.modules.sales.quotation_service import SalesQuoteService


SERVICE = SalesQuoteService()


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def _item(product_id, *, qty=2, price=200.0, minimum=100.0, warranty="12"):
    return SalesQuoteItemCreate(
        product_id=product_id,
        quantity=qty,
        selling_price=price,
        minimum_selling_price=minimum,
        warrenty_month=warranty,
    )


def _quote_create(branch_code, customer_id, items, *, quote_type=QuoteTypeEnum.QUOTATION):
    return SalesQuoteCreate(
        quote_type=quote_type,
        branch_code=branch_code,
        customer_id=customer_id,
        valid_until=date.today() + timedelta(days=30),
        items=items,
    )


def _make_quote(db, branch, customer, items):
    return SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, items))


# --------------------------------------------------------------------------- #
# Quote creation
# --------------------------------------------------------------------------- #
class TestQuoteCreate:
    def test_happy_path(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id, qty=2, price=200.0)])

        assert quote.id is not None
        # Every new quote starts pending internal approval (mirrors Purchase
        # Orders) rather than draft — see SalesQuoteService.create_quote.
        assert quote.status == "pending_approval"
        assert quote.approval_id is not None
        assert quote.quote_no
        assert len(quote.items) == 1
        # 2 * 200 = 400
        assert float(quote.total_amount) == 400.0

    def test_inactive_customer_rejected(self, db, make_branch, make_customer, make_product):
        branch, product = make_branch(), make_product()
        customer = make_customer(active=False)
        with pytest.raises(HTTPException) as exc:
            _make_quote(db, branch, customer, [_item(product.id)])
        assert exc.value.status_code == 400
        assert "inactive" in exc.value.detail.lower()

    def test_missing_customer_404(self, db, make_branch, make_product):
        branch, product = make_branch(), make_product()
        with pytest.raises(HTTPException) as exc:
            SERVICE.create_quote(
                db, _quote_create(branch.branch_code, 99_999_999, [_item(product.id)])
            )
        assert exc.value.status_code == 404

    def test_inactive_branch_rejected(self, db, make_branch, make_customer, make_product):
        branch = make_branch(active=False)
        customer, product = make_customer(), make_product()
        with pytest.raises(HTTPException) as exc:
            _make_quote(db, branch, customer, [_item(product.id)])
        assert 400 <= exc.value.status_code < 500

    def test_minimum_price_violation_rejected(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        # selling_price below minimum_selling_price must raise (the schema now refuses it up front).
        from pydantic import ValidationError

        with pytest.raises((HTTPException, ValidationError)) as exc:
            _make_quote(
                db, branch, customer,
                [_item(product.id, price=50.0, minimum=100.0)],
            )
        assert "minimum" in str(getattr(exc.value, "detail", exc.value)).lower()

    def test_discount_applied_to_total(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        item = _item(product.id, qty=2, price=200.0)
        item.discount_percent = 10  # 10% off 400 = 360
        quote = _make_quote(db, branch, customer, [item])
        assert float(quote.total_amount) == 360.0


# --------------------------------------------------------------------------- #
# Quote edit / delete
# --------------------------------------------------------------------------- #
class TestQuoteEditDelete:
    def test_update_recomputes_total(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id, qty=1, price=200.0)])
        updated = SERVICE.update_quote(
            db, quote.id,
            SalesQuoteUpdate(items=[_item(product.id, qty=3, price=200.0)]),
        )
        assert float(updated.total_amount) == 600.0

    def test_cannot_edit_cancelled_quote(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        SERVICE.cancel_quote(db, quote.id)
        with pytest.raises(HTTPException) as exc:
            SERVICE.update_quote(db, quote.id, SalesQuoteUpdate(remarks="x"))
        assert exc.value.status_code == 400

    def test_cannot_delete_cancelled_quote(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        SERVICE.cancel_quote(db, quote.id)
        with pytest.raises(HTTPException) as exc:
            SERVICE.delete_quote(db, quote.id)
        assert exc.value.status_code == 400

    def test_delete_draft_quote(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        assert SERVICE.delete_quote(db, quote.id) is True


# --------------------------------------------------------------------------- #
# Status machine
# --------------------------------------------------------------------------- #
class TestStatusMachine:
    def _set_status(self, db, quote_id, status_enum):
        return SERVICE.update_status(
            db, quote_id, SalesQuoteStatusUpdate(status=status_enum)
        )

    def test_system_managed_statuses_cannot_be_set_by_hand(self, db, make_branch, make_customer, make_product):
        # approved / completed / sent are decided by the approval workflow and the document actions,
        # never by a manual status change (that used to bypass the approval).
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        for target in (QuoteStatusEnum.SENT, QuoteStatusEnum.COMPLETED, QuoteStatusEnum.APPROVED, QuoteStatusEnum.REJECTED):
            with pytest.raises(HTTPException) as exc:
                self._set_status(db, quote.id, target)
            assert exc.value.status_code == 400

    def test_accept_needs_prior_approval(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        with pytest.raises(HTTPException) as exc:
            self._set_status(db, quote.id, QuoteStatusEnum.ACCEPTED)
        assert exc.value.status_code == 400
        SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)
        assert self._set_status(db, quote.id, QuoteStatusEnum.ACCEPTED).status == "accepted"

    def test_cannot_leave_cancelled_state(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        SERVICE.cancel_quote(db, quote.id)
        with pytest.raises(HTTPException) as exc:
            self._set_status(db, quote.id, QuoteStatusEnum.SENT)
        assert exc.value.status_code == 400

    def test_cancel_cascades_pending_items(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id), _item(product.id)])
        cancelled = SERVICE.cancel_quote(db, quote.id, reason="customer withdrew")
        assert cancelled.status == "cancelled"
        assert all(i.item_status == "cancelled" for i in cancelled.items)

    def test_cancel_already_cancelled_400(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        SERVICE.cancel_quote(db, quote.id)
        with pytest.raises(HTTPException) as exc:
            SERVICE.cancel_quote(db, quote.id)
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Partial SO conversion (money path)
# --------------------------------------------------------------------------- #
#
# create_partial_so requires (a) the quote to be approved — `approval`, not
# `status`, is the gate a later Phase added — and (b) real physical stock:
# it locks and consumes matching `sales_stock` rows the same way a normal
# barcode-less POS sale does, rather than trusting item_status/converted_qty.
# _make_quote (used by every other class in this file) deliberately leaves
# the quote unapproved so those tests can see the pending_approval state, so
# this class uses its own helper that approves it, and seeds real stock via
# a minimal PO -> GRN -> sales_stock chain (mirrors test_concurrency.py)
# instead of going through the full service layer for that setup.
def _make_approved_quote(db, branch, customer, items):
    quote = SERVICE.create_quote(db, _quote_create(branch.branch_code, customer.id, items))
    return SERVICE.resolve_quote_approval(db, quote.id, approve=True, user_id=1)


def _seed_stock(db, branch, location, supplier, product, qty=1, *, unit_price=100.0):
    from datetime import datetime
    import uuid

    from app.modules.inventory.models import SalesStock
    from app.modules.purchasing.models import (
        GoodReceivedItems,
        GoodReceivedNote,
        PurchasingOrder,
        PurchasingOrderItems,
    )

    tag = uuid.uuid4().hex[:8]
    po = PurchasingOrder(
        purchasing_order_no=f"PO-TEST-{tag}",
        branch_code=branch.branch_code,
        payment_method="cash",
        purchasing_order_date=date.today(),
        good_received_note_date=date.today(),
        created_date=date.today(),
        first_suppliers_id=supplier.id,
        added_date=datetime.utcnow(),
        status="approved",
    )
    db.add(po)
    db.flush()

    po_item = PurchasingOrderItems(
        quantity=qty,
        unit_price=unit_price,
        warrenty_month="12",
        created_date=date.today(),
        product_id=product.id,
        purchasingorders_id=po.id,
        added_date=datetime.utcnow(),
    )
    db.add(po_item)
    db.flush()

    grn = GoodReceivedNote(
        good_received_no=f"GRN-TEST-{tag}",
        good_received_date=date.today(),
        supplier_invoice_no=f"SINV-TEST-{tag}",
        supplier_invoice_date=date.today(),
        branch_code=branch.branch_code,
        created_date=date.today(),
        good_received_locations_id=location.id,
        purchasingorders_id=po.id,
        added_date=datetime.utcnow(),
    )
    db.add(grn)
    db.flush()

    for i in range(qty):
        barcode = f"BC-TEST-{tag}-{i}"
        db.add(GoodReceivedItems(
            good_received_note=grn.good_received_no,
            barcode=barcode,
            branch_code=branch.branch_code,
            active=True,
            created_date=date.today(),
            purchasing_order_items_id=po_item.id,
            added_date=datetime.utcnow(),
        ))
        db.add(SalesStock(
            product_id=product.id,
            barcode=barcode,
            branch_code=branch.branch_code,
            location_id=location.id,
            good_received_note_id=grn.id,
            purchasing_order_items_id=po_item.id,
            warranty_month="12",
            status="available",
            is_active=True,
            added_date=datetime.utcnow(),
        ))
    db.flush()


class TestPartialSO:
    def test_convert_single_item_creates_invoice_and_completes(
        self, db, make_branch, make_customer, make_supplier, make_location, make_product
    ):
        branch, customer, supplier, product = make_branch(), make_customer(), make_supplier(), make_product()
        location = make_location(branch=branch)
        _seed_stock(db, branch, location, supplier, product, qty=2)
        quote = _make_approved_quote(db, branch, customer, [_item(product.id, qty=2)])
        item = quote.items[0]

        invoice = SERVICE.create_partial_so(
            db, quote.id,
            CreatePartialSORequest(
                items=[PartialSOItemRequest(item_id=item.id, quantity=2)],
                payment_method="cash",
            ),
        )
        assert invoice.id is not None
        assert invoice.invoice_no.startswith("INV-")
        assert invoice.source_quote_id == quote.id

        db.refresh(quote)
        assert quote.items[0].item_status == "so_created"
        assert quote.status == "completed"

        # The two physical units backing this item must now be consumed —
        # this is the exact class of bug fixed on the stock-availability
        # check: a status flag alone must never imply real stock.
        from app.modules.inventory.models import SalesStock
        remaining_available = db.query(SalesStock).filter(
            SalesStock.product_id == product.id,
            SalesStock.status == "available",
        ).count()
        assert remaining_available == 0

    def test_multi_item_partial_marks_partially_processed(
        self, db, make_branch, make_customer, make_supplier, make_location, make_product
    ):
        branch, customer, supplier = make_branch(), make_customer(), make_supplier()
        location = make_location(branch=branch)
        p1, p2 = make_product(), make_product()
        _seed_stock(db, branch, location, supplier, p1, qty=2)
        quote = _make_approved_quote(db, branch, customer, [_item(p1.id), _item(p2.id)])
        first_item = quote.items[0]

        SERVICE.create_partial_so(
            db, quote.id,
            CreatePartialSORequest(
                items=[PartialSOItemRequest(item_id=first_item.id, quantity=2)],
                payment_method="cash",
            ),
        )
        db.refresh(quote)
        assert quote.status == "partially_processed"
        statuses = {i.item_status for i in quote.items}
        assert "so_created" in statuses
        assert "pending" in statuses

    def test_convert_already_converted_item_400(
        self, db, make_branch, make_customer, make_supplier, make_location, make_product
    ):
        branch, customer, supplier, product = make_branch(), make_customer(), make_supplier(), make_product()
        location = make_location(branch=branch)
        _seed_stock(db, branch, location, supplier, product, qty=2)
        quote = _make_approved_quote(db, branch, customer, [_item(product.id, qty=2)])
        item = quote.items[0]
        SERVICE.create_partial_so(
            db, quote.id,
            CreatePartialSORequest(
                items=[PartialSOItemRequest(item_id=item.id, quantity=2)],
                payment_method="cash",
            ),
        )
        with pytest.raises(HTTPException) as exc:
            SERVICE.create_partial_so(
                db, quote.id,
                CreatePartialSORequest(
                    items=[PartialSOItemRequest(item_id=item.id, quantity=1)],
                    payment_method="cash",
                ),
            )
        assert exc.value.status_code == 400

    def test_qty_exceeding_remaining_400(
        self, db, make_branch, make_customer, make_supplier, make_location, make_product
    ):
        branch, customer, supplier, product = make_branch(), make_customer(), make_supplier(), make_product()
        location = make_location(branch=branch)
        _seed_stock(db, branch, location, supplier, product, qty=5)
        quote = _make_approved_quote(db, branch, customer, [_item(product.id, qty=2)])
        item = quote.items[0]
        with pytest.raises(HTTPException) as exc:
            SERVICE.create_partial_so(
                db, quote.id,
                CreatePartialSORequest(
                    items=[PartialSOItemRequest(item_id=item.id, quantity=5)],
                    payment_method="cash",
                ),
            )
        assert exc.value.status_code == 400

    def test_insufficient_real_stock_409(
        self, db, make_branch, make_customer, make_supplier, make_location, make_product
    ):
        """Item_status/converted_qty say nothing was converted yet, and the
        requested qty is within the quote line's remaining amount — but no
        sales_stock exists at all. This must be rejected, not silently
        allowed through on the item's bookkeeping fields alone."""
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_approved_quote(db, branch, customer, [_item(product.id, qty=2)])
        item = quote.items[0]
        with pytest.raises(HTTPException) as exc:
            SERVICE.create_partial_so(
                db, quote.id,
                CreatePartialSORequest(
                    items=[PartialSOItemRequest(item_id=item.id, quantity=2)],
                    payment_method="cash",
                ),
            )
        assert exc.value.status_code == 409

    def test_convert_on_cancelled_quote_400(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id, qty=2)])
        item_id = quote.items[0].id
        SERVICE.cancel_quote(db, quote.id)
        with pytest.raises(HTTPException) as exc:
            SERVICE.create_partial_so(
                db, quote.id,
                CreatePartialSORequest(
                    items=[PartialSOItemRequest(item_id=item_id, quantity=1)],
                    payment_method="cash",
                ),
            )
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# Item cancellation
# --------------------------------------------------------------------------- #
class TestItemCancellation:
    def test_cancel_one_item_of_two(self, db, make_branch, make_customer, make_product):
        branch, customer = make_branch(), make_customer()
        p1, p2 = make_product(), make_product()
        quote = _make_quote(db, branch, customer, [_item(p1.id), _item(p2.id)])
        target = quote.items[0]
        result = SERVICE.cancel_quote_item(db, quote.id, target.id, reason="oos")
        cancelled = [i for i in result.items if i.item_status == "cancelled"]
        assert len(cancelled) == 1
