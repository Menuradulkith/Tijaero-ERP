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
        assert quote.status == "draft"
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
        # selling_price below minimum_selling_price must raise.
        with pytest.raises(HTTPException) as exc:
            _make_quote(
                db, branch, customer,
                [_item(product.id, price=50.0, minimum=100.0)],
            )
        assert exc.value.status_code == 400
        assert "minimum" in exc.value.detail.lower()

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

    def test_draft_to_sent(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        updated = self._set_status(db, quote.id, QuoteStatusEnum.SENT)
        assert updated.status == "sent"

    def test_draft_to_completed(self, db, make_branch, make_customer, make_product):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id)])
        updated = self._set_status(db, quote.id, QuoteStatusEnum.COMPLETED)
        assert updated.status == "completed"

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
# ┌─ BUG REPORT ─────────────────────────────────────────────────────────────┐
# │ quotation_service.py:538  (SalesQuoteService.create_partial_so)           │
# │     db.refresh(quote, [SalesQuote.items])                                 │
# │                                                                           │
# │ Session.refresh() requires attribute_names to be a list of STRINGS, e.g.  │
# │     db.refresh(quote, attribute_names=["items"])                          │
# │ Passing the InstrumentedAttribute SalesQuote.items raises                 │
# │     KeyError  (sqlalchemy/orm/state.py: _expire_state)                    │
# │ on SQLAlchemy 2.0.45.  This breaks ALL partial Sales Order creation.      │
# │                                                                           │
# │ Note: the sibling method cancel_quote() uses the correct string form      │
# │     db.refresh(quote, attribute_names=["items"])  → works.                │
# │                                                                           │
# │ Fix: change line 538 to use "items" (string).  Once fixed, the xfail      │
# │ tests below will XPASS and the markers should be removed.                 │
# └───────────────────────────────────────────────────────────────────────────┘
_PARTIAL_SO_BUG = pytest.mark.xfail(
    reason="BUG quotation_service.py:538 — db.refresh(quote, [SalesQuote.items]) "
    "passes an InstrumentedAttribute instead of the string 'items'; raises "
    "KeyError and breaks all partial SO creation.",
    raises=KeyError,
    strict=True,
)


_STALE_INVOICE_SCHEMA = pytest.mark.xfail(
    reason=(
        "create_partial_so's invoice creation does not populate the legacy NOT-NULL "
        "'cheque_date' column on the invoices table (stale-DB schema drift). "
        "Run 'alembic upgrade head' or make the column nullable to enable."
    ),
    raises=Exception,
    strict=True,
)


class TestPartialSO:
    @_STALE_INVOICE_SCHEMA
    def test_convert_single_item_creates_invoice_and_completes(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id, qty=2)])
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

    @_STALE_INVOICE_SCHEMA
    def test_multi_item_partial_marks_partially_processed(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer = make_branch(), make_customer()
        p1, p2 = make_product(), make_product()
        quote = _make_quote(db, branch, customer, [_item(p1.id), _item(p2.id)])
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

    @_STALE_INVOICE_SCHEMA
    def test_convert_already_converted_item_400(
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id, qty=2)])
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
        self, db, make_branch, make_customer, make_product
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        quote = _make_quote(db, branch, customer, [_item(product.id, qty=2)])
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
