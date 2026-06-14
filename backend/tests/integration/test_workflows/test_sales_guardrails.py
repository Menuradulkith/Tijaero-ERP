"""
QA suite — Sales guard-rails (grill-me audit regressions).

Locks in the fixes for real money-leak bugs found in the full-ERP audit:

create_invoice — gift vouchers:
* redeeming MORE than the voucher balance is rejected (was: any amount accepted)
* an expired-but-still-'active' voucher is rejected at redemption
* a missing voucher id is rejected (was: silently skipped while still
  discounting the invoice)

create_invoice — coupons:
* a coupon discount larger than the coupon's real value is rejected
  (was: client-sent ``cupon_amount`` trusted blindly)
* a coupon amount without a coupon id is rejected

create_sale_return — over-refund guards:
* items that were never sold on the invoice are rejected
* return price above the sold price is rejected
* returning more units than were sold is rejected
* a second return cannot exceed the remaining (unreturned) quantity

process_sale_return — state machine:
* a PENDING (unapproved) return cannot be processed
* an APPROVED return processes exactly once

cancel_invoice / delete_invoice — instrument restoration:
* cancelling gives the customer their voucher money back
* cancelling frees the coupon usage slot
* cancelling cancels the pending agent commission
* a COMPLETED invoice can never be hard-deleted
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.modules.common.models import Locations
from app.modules.customers.commission_models import CustomerAgentCommission
from app.modules.customers.models import (
    CouponUsage,
    CustomerCuponCodes,
    CustomerGiftVoucher,
    VoucherUsage,
)
from app.modules.purchasing.models import (
    GoodReceivedNote,
    PurchasingOrder,
    PurchasingOrderItems,
)
from app.modules.inventory.models import SalesStock
from app.modules.sales import schemas as sales_schemas
from app.modules.sales.models import Invoice, InvoiceItems
from app.modules.sales.service import sales_service
from app.core import timezone as tz


def _uid() -> str:
    return uuid.uuid4().hex[:10]


TODAY = tz.today() if callable(getattr(tz, "today", None)) else date.today()


# --------------------------------------------------------------------------- #
# Row factories (rollback-isolated; flush only)
# --------------------------------------------------------------------------- #
def _location(db, branch) -> Locations:
    loc = Locations(
        name=f"QA Loc {_uid()}",
        branch_code=branch.branch_code,
        created_date=datetime.combine(TODAY, time(9, 0)),
    )
    db.add(loc)
    db.flush()
    return loc


def _invoice(db, branch, customer, *, payment_method="cash", subtotal="600.00",
             approval_status="completed", paid=None) -> Invoice:
    total = Decimal(subtotal)
    inv = Invoice(
        is_tax_invoice=False,
        invoice_no=f"INV-GRD-{_uid()}",
        branch_code=branch.branch_code,
        payment_method=payment_method,
        created_date=TODAY,
        customer_id=customer.id,
        approval=approval_status in ("completed", "approved"),
        approval_status=approval_status,
        bank_transfer_amount=Decimal("0"),
        card_amex_amount=Decimal("0"),
        card_mastercard_amount=Decimal("0"),
        card_visa_amount=Decimal("0"),
        cash_amount=total,
        cheque_date=TODAY,
        cheque_amount=Decimal("0"),
        payment_adjustments=Decimal("0"),
        credit_amount=Decimal("0"),
        cupon_amount=Decimal("0"),
        special=False,
        created_date_time=datetime.combine(TODAY, time(12, 0)),
        status=True,
        tax_rate=Decimal("0"),
        tax_amount=Decimal("0"),
        discount_percent=Decimal("0"),
        discount_amount=Decimal("0"),
        subtotal=total,
        grand_total=total,
        paid_amount=total if paid is None else Decimal(str(paid)),
        balance_due=Decimal("0") if paid is None else total - Decimal(str(paid)),
        payment_status="paid" if paid is None else "partial",
        service_charge_rate=Decimal("0"),
        service_charge_amount=Decimal("0"),
    )
    db.add(inv)
    db.flush()
    return inv


def _invoice_item(db, invoice, product, *, qty=2, price="300.00") -> InvoiceItems:
    item = InvoiceItems(
        warrenty_month="12",
        selling_price=Decimal(price),
        created_date=datetime.combine(TODAY, time(12, 0)),
        invoice_id=invoice.id,
        product_id=product.id,
        quantity=qty,
        minimum_selling_price=Decimal("1.00"),
        line_total=Decimal(price) * qty,
    )
    db.add(item)
    db.flush()
    return item


def _voucher(db, *, amount="100.00", issued: date | None = None,
             months=12, status="active") -> CustomerGiftVoucher:
    voucher = CustomerGiftVoucher(
        barcode_no=f"GV-{_uid()}",
        amount=Decimal(amount),
        balance=Decimal(amount),
        date=issued or TODAY,
        valid_period_in_months=months,
        status=status,
        payment_method="cash",
    )
    db.add(voucher)
    db.flush()
    return voucher


def _coupon(db, *, discount_type="PERCENT", value="10", active=True) -> CustomerCuponCodes:
    coupon = CustomerCuponCodes(
        cupon_code=f"CP-{_uid()}",
        discount_type=discount_type,
        discount_value=Decimal(value),
        minimum_invoice_amount=Decimal("0"),
        limit_by_usage=1000,
        limit_for_customer=10,
        valid_until_date=TODAY + timedelta(days=90),
        active=active,
        usage_count=0,
    )
    db.add(coupon)
    db.flush()
    return coupon


def _stock_units(db, branch, supplier, product, location, n=2) -> list[SalesStock]:
    """Minimal purchase chain so ``validate_product_availability`` passes."""
    now = datetime.combine(TODAY, time(8, 0))
    po = PurchasingOrder(
        purchasing_order_no=f"PO-GRD-{_uid()}",
        branch_code=branch.branch_code,
        payment_method="non_credit",
        purchasing_order_date=TODAY,
        good_received_note_date=TODAY,
        created_date=TODAY,
        first_suppliers_id=supplier.id,
        added_date=now,
        status="approved",
    )
    db.add(po)
    db.flush()
    po_item = PurchasingOrderItems(
        quantity=n,
        unit_price=Decimal("150.00"),
        warrenty_month="12",
        created_date=TODAY,
        product_id=product.id,
        purchasingorders_id=po.id,
        added_date=now,
    )
    db.add(po_item)
    db.flush()
    grn = GoodReceivedNote(
        good_received_no=f"GRN-GRD-{_uid()}",
        good_received_date=TODAY,
        supplier_invoice_no=f"SI-{_uid()}",
        supplier_invoice_date=TODAY,
        branch_code=branch.branch_code,
        created_date=TODAY,
        good_received_locations_id=location.id,
        purchasingorders_id=po.id,
        added_date=now,
    )
    db.add(grn)
    db.flush()
    units = []
    for _ in range(n):
        unit = SalesStock(
            product_id=product.id,
            barcode=f"BC-{uuid.uuid4().hex}",
            branch_code=branch.branch_code,
            location_id=location.id,
            good_received_note_id=grn.id,
            purchasing_order_items_id=po_item.id,
            status="available",
            is_active=True,
            added_date=now,
        )
        db.add(unit)
        units.append(unit)
    db.flush()
    return units


def _invoice_create(branch, customer, product, *, rep_id, price=300.0, qty=2, **over):
    payload = dict(
        branch_code=branch.branch_code,
        customer_id=customer.id,
        sale_rep_id=rep_id,
        payment_method="cash",
        cash_amount=price * qty,
        items=[
            sales_schemas.InvoiceItemCreate(
                product_id=product.id,
                quantity=qty,
                selling_price=price,
                minimum_selling_price=1.0,
                warrenty_month="12",
            )
        ],
    )
    payload.update(over)
    return sales_schemas.InvoiceCreate(**payload)


def _return_create(invoice, location, item, *, qty=1, price=None, barcode="",
                   payment_method="credit_note"):
    return sales_schemas.SaleReturnCreate(
        branch_code=invoice.branch_code,
        invoice_id=invoice.id,
        good_received_locations_id=location.id,
        payment_method=payment_method,
        items=[
            sales_schemas.SaleReturnItemCreate(
                barcode=barcode,
                return_price=float(price if price is not None else item.selling_price),
                sold_price=float(item.selling_price),
                branch_code=invoice.branch_code,
                invoice_item_id=item.id,
                quantity=qty,
            )
        ],
    )


# --------------------------------------------------------------------------- #
# create_invoice — gift voucher guards
# --------------------------------------------------------------------------- #
class TestVoucherRedemptionGuards:
    def test_redeeming_more_than_balance_rejected(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)
        voucher = _voucher(db, amount="100.00")

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            cash_amount=200.0,
            voucher_redemptions=[
                sales_schemas.VoucherRedemptionItem(
                    voucher_id=voucher.id, amount_to_redeem=400.0
                )
            ],
        )
        with pytest.raises(HTTPException) as exc:
            sales_service.create_invoice(db, data, user_id=user.id)
        assert exc.value.status_code == 400
        assert "balance" in exc.value.detail.lower()

    def test_valid_redemption_claims_voucher(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)
        voucher = _voucher(db, amount="100.00")

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            cash_amount=500.0,
            voucher_redemptions=[
                sales_schemas.VoucherRedemptionItem(
                    voucher_id=voucher.id, amount_to_redeem=100.0
                )
            ],
        )
        created = sales_service.create_invoice(db, data, user_id=user.id)
        assert created is not None
        db.refresh(voucher)
        assert voucher.status == "fully_claimed"
        assert Decimal(str(voucher.balance)) == Decimal("0")

    def test_expired_voucher_rejected_even_if_marked_active(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)
        # Issued 2 years ago, valid 12 months, but nobody flipped the status.
        voucher = _voucher(db, amount="100.00", issued=TODAY - timedelta(days=730))

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            voucher_redemptions=[
                sales_schemas.VoucherRedemptionItem(
                    voucher_id=voucher.id, amount_to_redeem=50.0
                )
            ],
        )
        with pytest.raises(HTTPException) as exc:
            sales_service.create_invoice(db, data, user_id=user.id)
        assert exc.value.status_code == 400
        assert "expired" in exc.value.detail.lower()

    def test_missing_voucher_rejected_not_skipped(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            voucher_redemptions=[
                sales_schemas.VoucherRedemptionItem(
                    voucher_id=99_999_999, amount_to_redeem=50.0
                )
            ],
        )
        with pytest.raises(HTTPException) as exc:
            sales_service.create_invoice(db, data, user_id=user.id)
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# create_invoice — coupon guards
# --------------------------------------------------------------------------- #
class TestCouponGuards:
    def test_inflated_coupon_amount_rejected(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)
        coupon = _coupon(db, discount_type="PERCENT", value="10")  # max 10% of 600 = 60

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            cupon_id=coupon.id,
            cupon_amount=500.0,  # way past the real 60
        )
        with pytest.raises(HTTPException) as exc:
            sales_service.create_invoice(db, data, user_id=user.id)
        assert exc.value.status_code == 400
        assert "exceeds" in exc.value.detail.lower()

    def test_coupon_amount_without_coupon_rejected(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)

        data = _invoice_create(branch, customer, product, rep_id=user.id, cupon_amount=50.0)
        with pytest.raises(HTTPException) as exc:
            sales_service.create_invoice(db, data, user_id=user.id)
        assert exc.value.status_code == 400

    def test_honest_coupon_accepted(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)
        coupon = _coupon(db, discount_type="PERCENT", value="10")

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            cupon_id=coupon.id,
            cupon_amount=60.0,  # exactly 10% of 600
        )
        created = sales_service.create_invoice(db, data, user_id=user.id)
        assert created is not None
        db.refresh(coupon)
        assert coupon.usage_count == 1


# --------------------------------------------------------------------------- #
# create_sale_return — over-refund guards
# --------------------------------------------------------------------------- #
class TestSaleReturnGuards:
    def _sold(self, db, make_branch, make_customer, make_product, make_user):
        branch, customer, product = make_branch(), make_customer(), make_product()
        user, _ = make_user()
        location = _location(db, branch)
        invoice = _invoice(db, branch, customer, subtotal="600.00")
        item = _invoice_item(db, invoice, product, qty=2, price="300.00")
        return branch, customer, product, location, invoice, item, user

    def test_item_not_on_invoice_rejected(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        branch, customer, product, location, invoice, item, user = self._sold(
            db, make_branch, make_customer, make_product, make_user
        )
        other_invoice = _invoice(db, branch, customer, subtotal="100.00")
        other_item = _invoice_item(db, other_invoice, product, qty=1, price="100.00")

        data = _return_create(invoice, location, other_item)  # foreign item id
        with pytest.raises(HTTPException) as exc:
            sales_service.create_sale_return(db, data, user_id=user.id)
        assert exc.value.status_code == 400
        assert "not sold on invoice" in exc.value.detail.lower()

    def test_return_price_above_sold_price_rejected(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        _, _, _, location, invoice, item, user = self._sold(
            db, make_branch, make_customer, make_product, make_user
        )
        data = _return_create(invoice, location, item, price=999.0)
        with pytest.raises(HTTPException) as exc:
            sales_service.create_sale_return(db, data, user_id=user.id)
        assert exc.value.status_code == 400
        assert "exceeds" in exc.value.detail.lower()

    def test_returning_more_than_sold_rejected(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        _, _, _, location, invoice, item, user = self._sold(
            db, make_branch, make_customer, make_product, make_user
        )
        data = _return_create(invoice, location, item, qty=5)  # sold only 2
        with pytest.raises(HTTPException) as exc:
            sales_service.create_sale_return(db, data, user_id=user.id)
        assert exc.value.status_code == 400
        assert "cannot return" in exc.value.detail.lower()

    def test_second_return_capped_by_remaining_quantity(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        _, _, _, location, invoice, item, user = self._sold(
            db, make_branch, make_customer, make_product, make_user
        )
        first = sales_service.create_sale_return(
            db, _return_create(invoice, location, item, qty=1), user_id=user.id
        )
        assert first.id is not None

        with pytest.raises(HTTPException) as exc:
            sales_service.create_sale_return(
                db, _return_create(invoice, location, item, qty=2), user_id=user.id
            )
        assert exc.value.status_code == 400
        assert "already returned" in exc.value.detail.lower()

    def test_valid_partial_return_accepted(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        _, _, _, location, invoice, item, user = self._sold(
            db, make_branch, make_customer, make_product, make_user
        )
        ret = sales_service.create_sale_return(
            db, _return_create(invoice, location, item, qty=2), user_id=user.id
        )
        assert Decimal(str(ret.total_refund)) == Decimal("600.00")


# --------------------------------------------------------------------------- #
# process_sale_return — state machine
# --------------------------------------------------------------------------- #
class TestSaleReturnProcessing:
    def test_pending_return_cannot_be_processed(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        user, _ = make_user()
        location = _location(db, branch)
        invoice = _invoice(db, branch, customer, subtotal="600.00")
        item = _invoice_item(db, invoice, product, qty=2, price="300.00")
        ret = sales_service.create_sale_return(
            db, _return_create(invoice, location, item, qty=1), user_id=user.id
        )
        assert ret.status == "pending"

        with pytest.raises(HTTPException) as exc:
            sales_service.process_sale_return(db, ret.id, user_id=user.id)
        assert exc.value.status_code == 400
        assert "approved" in exc.value.detail.lower()

    def test_approved_return_processes_exactly_once(
        self, db, make_branch, make_customer, make_product, make_user
    ):
        branch, customer, product = make_branch(), make_customer(), make_product()
        user, _ = make_user()
        location = _location(db, branch)
        invoice = _invoice(db, branch, customer, subtotal="600.00")
        item = _invoice_item(db, invoice, product, qty=2, price="300.00")
        ret = sales_service.create_sale_return(
            db, _return_create(invoice, location, item, qty=1), user_id=user.id
        )
        ret.status = "approved"
        db.flush()

        result = sales_service.process_sale_return(db, ret.id, user_id=user.id)
        assert result is not None
        db.refresh(ret)
        assert ret.status == "processed"

        with pytest.raises(HTTPException) as exc:
            sales_service.process_sale_return(db, ret.id, user_id=user.id)
        assert exc.value.status_code == 400


# --------------------------------------------------------------------------- #
# cancel / delete — instrument restoration
# --------------------------------------------------------------------------- #
class TestCancelRestoresInstruments:
    def test_cancel_restores_voucher_money(self, db, make_branch, make_customer):
        branch, customer = make_branch(), make_customer()
        invoice = _invoice(
            db, branch, customer, payment_method="credit",
            approval_status="pending_approval", paid="0",
        )
        voucher = _voucher(db, amount="100.00")
        voucher.balance = Decimal("0")
        voucher.status = "fully_claimed"
        voucher.claimed_invoice_no = invoice.invoice_no
        db.add(VoucherUsage(
            voucher_id=voucher.id,
            invoice_id=invoice.id,
            amount_used=Decimal("100.00"),
            used_date=datetime.combine(TODAY, time(12, 0)),
        ))
        db.flush()

        sales_service.cancel_invoice(db, invoice.id, user_id=1)

        db.refresh(voucher)
        assert voucher.status == "active"
        assert Decimal(str(voucher.balance)) == Decimal("100.00")
        assert db.query(VoucherUsage).filter(
            VoucherUsage.invoice_id == invoice.id
        ).count() == 0

    def test_cancel_frees_coupon_slot(self, db, make_branch, make_customer):
        branch, customer = make_branch(), make_customer()
        invoice = _invoice(
            db, branch, customer, payment_method="credit",
            approval_status="pending_approval", paid="0",
        )
        coupon = _coupon(db)
        coupon.usage_count = 1
        db.add(CouponUsage(
            coupon_id=coupon.id,
            customer_id=customer.id,
            invoice_id=invoice.id,
            discount_amount=Decimal("60.00"),
            used_date=datetime.combine(TODAY, time(12, 0)),
        ))
        db.flush()

        sales_service.cancel_invoice(db, invoice.id, user_id=1)

        db.refresh(coupon)
        assert coupon.usage_count == 0
        assert db.query(CouponUsage).filter(
            CouponUsage.invoice_id == invoice.id
        ).count() == 0

    def test_cancel_cancels_pending_commission(self, db, make_branch, make_customer):
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(
            db, branch, customer, payment_method="credit",
            approval_status="pending_approval", paid="0",
        )
        commission = CustomerAgentCommission(
            invoice_id=invoice.id,
            customer_agent_id=agent.id,
            represented_customer_id=customer.id,
            invoice_amount=Decimal("600.00"),
            commission_type="PERCENT",
            commission_rate=Decimal("5"),
            commission_amount=Decimal("30.00"),
            status="pending",
        )
        db.add(commission)
        db.flush()

        sales_service.cancel_invoice(db, invoice.id, user_id=1)

        db.refresh(commission)
        assert commission.status == "cancelled"

    def test_completed_invoice_cannot_be_deleted(self, db, make_branch, make_customer):
        branch, customer = make_branch(), make_customer()
        invoice = _invoice(db, branch, customer, approval_status="completed")

        with pytest.raises(HTTPException) as exc:
            sales_service.delete_invoice(db, invoice.id)
        assert exc.value.status_code == 400
        assert "cannot be deleted" in exc.value.detail.lower()


# --------------------------------------------------------------------------- #
# create_invoice — the agent commission entry is owned by the sales order
# --------------------------------------------------------------------------- #
class TestOrderDrivenCommission:
    """The commission entry must be generated from the sales order, honouring the
    rate/amount assigned on the order (not just the agent's default profile rate)."""

    def _commission_for(self, db, invoice_id):
        return db.query(CustomerAgentCommission).filter(
            CustomerAgentCommission.invoice_id == invoice_id
        ).first()

    def test_order_rate_overrides_agent_default(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        agent = make_customer(is_customer_agent=True)
        agent.commission_rate = Decimal("5")  # default profile rate
        db.flush()
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)

        # Order assigns 10% — must win over the agent's 5% default.
        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            customer_agent_id=agent.id, agent_commission_rate=10.0,
        )
        created = sales_service.create_invoice(db, data, user_id=user.id)

        commission = self._commission_for(db, created.id)
        assert commission is not None
        assert commission.commission_type == "PERCENT"
        assert Decimal(str(commission.commission_rate)) == Decimal("10")
        # 10% of the 600 grand total.
        assert Decimal(str(commission.commission_amount)) == Decimal("60.00")
        assert commission.status == "pending"

    def test_commission_created_when_agent_has_no_default_rate(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        agent = make_customer(is_customer_agent=True)  # no default commission_rate
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            customer_agent_id=agent.id, agent_commission_rate=7.5,
        )
        created = sales_service.create_invoice(db, data, user_id=user.id)

        commission = self._commission_for(db, created.id)
        assert commission is not None
        assert Decimal(str(commission.commission_rate)) == Decimal("7.5")
        assert Decimal(str(commission.commission_amount)) == Decimal("45.00")

    def test_order_amount_override_sets_amount_type(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        agent = make_customer(is_customer_agent=True)
        agent.commission_rate = Decimal("5")
        db.flush()
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)

        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            customer_agent_id=agent.id, agent_commission_amount=123.45,
        )
        created = sales_service.create_invoice(db, data, user_id=user.id)

        commission = self._commission_for(db, created.id)
        assert commission is not None
        assert commission.commission_type == "AMOUNT"
        assert Decimal(str(commission.commission_amount)) == Decimal("123.45")

    def test_no_commission_when_no_rate_anywhere(
        self, db, make_branch, make_customer, make_product, make_supplier, make_user
    ):
        branch, customer, product, supplier = (
            make_branch(), make_customer(), make_product(), make_supplier()
        )
        agent = make_customer(is_customer_agent=True)  # no default rate
        user, _ = make_user()
        location = _location(db, branch)
        _stock_units(db, branch, supplier, product, location, n=2)

        # Agent assigned but no rate/amount anywhere → nothing to pay, no entry.
        data = _invoice_create(
            branch, customer, product, rep_id=user.id,
            customer_agent_id=agent.id,
        )
        created = sales_service.create_invoice(db, data, user_id=user.id)

        assert self._commission_for(db, created.id) is None

