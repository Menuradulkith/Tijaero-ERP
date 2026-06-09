import pytest
from datetime import datetime, date
from decimal import Decimal
from unittest.mock import patch
from fastapi import HTTPException
from app.modules.sales.service import SalesService
from app.modules.sales import schemas
from app.modules.finance.models import CreditPayments
from app.modules.customers.models import CustomerCreditsSettle
from app.common.enums import DocumentStatus, StockStatus, PaymentStatus

class TestCreditSettlementWorkflow:
    def test_credit_sales_order_remains_approved_until_settled(
        self, db, make_branch, make_customer, make_product, make_sales_stock, make_user
    ):
        branch = make_branch()
        customer = make_customer(max_credit_limit=100000, left_credit_amount=100000)
        customer.email = "test@example.com"
        db.flush()

        product = make_product()
        user, _ = make_user()
        svc = SalesService()

        # Create SalesStock
        s1 = make_sales_stock(product=product, branch=branch)

        # 1. Create Credit Invoice
        mock_now = datetime(2026, 6, 1, 10, 0, 0)
        with patch("app.core.timezone.now", return_value=mock_now):
            invoice = svc.create_invoice(
                db,
                schemas.InvoiceCreate(
                    branch_code=branch.branch_code,
                    customer_id=customer.id,
                    sale_rep_id=user.id,
                    payment_method="credit",
                    cash_amount=0,
                    card_visa_amount=0,
                    card_mastercard_amount=0,
                    card_amex_amount=0,
                    cheque_amount=0,
                    bank_transfer_amount=0,
                    credit_amount=500.0,
                    credit_terms="3 months",
                    is_tax_invoice=False,
                    tax_rate=0,
                    discount_percent=0,
                    discount_amount=0,
                    items=[
                        schemas.InvoiceItemCreate(
                            product_id=product.id,
                            quantity=1,
                            selling_price=500.0,
                            minimum_selling_price=400.0,
                            warrenty_month="12",
                            barcode=s1.barcode,
                        )
                    ],
                ),
                user_id=user.id,
            )

        assert invoice.id is not None
        assert invoice.approval_status == "pending_approval"
        assert invoice.paid_amount == 0.0
        assert invoice.balance_due == 500.0

        # 2. Approve the invoice - it must become APPROVED, NOT COMPLETED
        approved_invoice = svc.approve_invoice(db, invoice.id, user_id=user.id)
        assert approved_invoice.approval_status == DocumentStatus.APPROVED.value

        # 3. Partially Settle the credit payment - status should remain APPROVED
        partial_payment = schemas.CreditPaymentCreate(
            invoice_id=invoice.id,
            payment_method="cash",
            payment_amount=Decimal("200.00"),
            payment_date=date.today(),
            remarks="Partial payment",
        )
        res = svc.settle_credit_payment(db, partial_payment, user_id=user.id)
        db.refresh(invoice)
        assert invoice.approval_status == DocumentStatus.APPROVED.value
        assert invoice.paid_amount == 200.0
        assert invoice.balance_due == 300.0
        assert invoice.payment_status == PaymentStatus.PARTIAL.value

        # 4. Fully Settle the remaining credit - status must transition to COMPLETED
        full_payment = schemas.CreditPaymentCreate(
            invoice_id=invoice.id,
            payment_method="cash",
            payment_amount=Decimal("300.00"),
            payment_date=date.today(),
            remarks="Full payment",
        )
        res = svc.settle_credit_payment(db, full_payment, user_id=user.id)
        db.refresh(invoice)
        assert invoice.approval_status == DocumentStatus.COMPLETED.value
        assert invoice.paid_amount == 500.0
        assert invoice.balance_due == 0.0
        assert invoice.payment_status == PaymentStatus.PAID.value
