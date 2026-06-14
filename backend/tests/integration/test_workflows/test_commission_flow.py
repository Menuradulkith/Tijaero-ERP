"""
QA suite — Customer-agent commission flow (standard maker-checker recreation).

Locks in the recreated commission payment flow:

create_payment (maker)
* an unapproved (pending) commission cannot be paid — approval gate
* the amount paid can never exceed the commission's remaining balance
* the payment is created as 'pending' and posts NOTHING to the ledger yet,
  and the commission is NOT flipped to 'paid' yet

verify_payment (checker)
* verifying a payment marks the fully-covered commission as 'paid'
* verifying is the step that posts the commission expense to the GL

cancel_payment
* cancelling a pending payment leaves the commission 'approved' and — crucially
  — never leaves a stray ledger entry behind (the old flow posted at create and
  did not reverse on cancel → a phantom commission expense / bank credit)

partial payments
* two partial verified payments accumulate to mark the commission 'paid'
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.core import timezone as tz
from app.modules.customers import commission_schemas as cs
from app.modules.customers.commission_models import (
    CustomerAgentCommission,
    CustomerAgentCommissionPayment,
)
from app.modules.customers.commission_service import commission_service
from app.modules.finance.accounting_models import ChartOfAccounts, JournalEntry
from app.modules.sales.models import Invoice


# A far-future date with no accounting period → GL posting is always allowed.
OPEN_DATE = date(2090, 6, 15)


def _uid() -> str:
    return uuid.uuid4().hex[:10]


# --------------------------------------------------------------------------- #
# Row factories (rollback-isolated; flush only)
# --------------------------------------------------------------------------- #
def _ensure_account(db, code, *, account_type, normal_balance, name=None) -> ChartOfAccounts:
    acc = db.query(ChartOfAccounts).filter(ChartOfAccounts.account_code == code).first()
    if acc is not None:
        if not acc.is_active:
            acc.is_active = True
            db.flush()
        return acc
    acc = ChartOfAccounts(
        account_code=code,
        account_name=name or f"QA Account {code}",
        account_type=account_type,
        normal_balance=normal_balance,
        is_active=True,
        is_system_account=False,
    )
    db.add(acc)
    db.flush()
    return acc


def _seed_commission_accounts(db) -> None:
    """Minimal chart of accounts so a Cash commission payment can post."""
    _ensure_account(db, "5150", account_type="Expense", normal_balance="Debit",
                    name="Commission Expense")
    _ensure_account(db, "1010", account_type="Asset", normal_balance="Debit",
                    name="Cash on Hand")
    _ensure_account(db, "1020", account_type="Asset", normal_balance="Debit",
                    name="Bank Account")


def _invoice(db, branch, customer, *, subtotal="600.00") -> Invoice:
    total = Decimal(subtotal)
    inv = Invoice(
        is_tax_invoice=False,
        invoice_no=f"INV-COM-{_uid()}",
        branch_code=branch.branch_code,
        payment_method="cash",
        created_date=OPEN_DATE,
        customer_id=customer.id,
        approval=True,
        approval_status="completed",
        bank_transfer_amount=Decimal("0"),
        card_amex_amount=Decimal("0"),
        card_mastercard_amount=Decimal("0"),
        card_visa_amount=Decimal("0"),
        cash_amount=total,
        cheque_date=OPEN_DATE,
        cheque_amount=Decimal("0"),
        payment_adjustments=Decimal("0"),
        credit_amount=Decimal("0"),
        cupon_amount=Decimal("0"),
        special=False,
        created_date_time=datetime.combine(OPEN_DATE, time(12, 0)),
        status=True,
        tax_rate=Decimal("0"),
        tax_amount=Decimal("0"),
        discount_percent=Decimal("0"),
        discount_amount=Decimal("0"),
        subtotal=total,
        grand_total=total,
        paid_amount=total,
        balance_due=Decimal("0"),
        payment_status="paid",
        service_charge_rate=Decimal("0"),
        service_charge_amount=Decimal("0"),
    )
    db.add(inv)
    db.flush()
    return inv


def _commission(db, invoice, agent, customer, *, amount="30.00", status="approved") -> CustomerAgentCommission:
    commission = CustomerAgentCommission(
        invoice_id=invoice.id,
        customer_agent_id=agent.id,
        represented_customer_id=customer.id,
        invoice_amount=Decimal("600.00"),
        commission_type="PERCENT",
        commission_rate=Decimal("5"),
        commission_amount=Decimal(amount),
        status=status,
    )
    db.add(commission)
    db.flush()
    return commission


def _pay(agent, commission, *, amount, method="Cash", branch_code):
    return cs.CustomerAgentCommissionPaymentCreate(
        customer_agent_id=agent.id,
        payment_date=OPEN_DATE,
        payment_method=method,
        payment_amount=Decimal(str(amount)),
        branch_code=branch_code,
        items=[cs.CommissionPaymentItemCreate(
            commission_id=commission.id, paid_amount=Decimal(str(amount))
        )],
    )


def _commission_je_count(db, payment_id) -> int:
    return (
        db.query(JournalEntry)
        .filter(JournalEntry.description.ilike(f"%CommPayment ID: {payment_id}%"))
        .count()
    )


def _reload(db, model, pk):
    return db.query(model).filter(model.id == pk).first()


# --------------------------------------------------------------------------- #
# Tests
# --------------------------------------------------------------------------- #
class TestCommissionPaymentFlow:
    def test_pay_unapproved_commission_is_rejected(self, db, make_branch, make_customer):
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, status="pending")

        with pytest.raises(HTTPException) as exc:
            commission_service.create_payment(
                db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
                created_by=1,
            )
        assert exc.value.status_code == 400
        assert "approve" in str(exc.value.detail).lower()

    def test_overpayment_is_rejected(self, db, make_branch, make_customer):
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, amount="30.00", status="approved")

        with pytest.raises(HTTPException) as exc:
            commission_service.create_payment(
                db, _pay(agent, commission, amount="50.00", branch_code=branch.branch_code),
                created_by=1,
            )
        assert exc.value.status_code == 400
        assert "exceeds" in str(exc.value.detail).lower()

    def test_create_payment_is_pending_and_posts_no_gl(self, db, make_branch, make_customer):
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, amount="30.00", status="approved")

        payment = commission_service.create_payment(
            db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
            created_by=1,
        )

        assert payment.status == "pending"
        # Commission is NOT paid yet — only verification flips it.
        assert _reload(db, CustomerAgentCommission, commission.id).status == "approved"
        # The crux: nothing hit the ledger at creation time.
        assert _commission_je_count(db, payment.id) == 0

    def test_verify_marks_paid_and_posts_gl(self, db, make_branch, make_customer):
        _seed_commission_accounts(db)
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, amount="30.00", status="approved")

        payment = commission_service.create_payment(
            db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
            created_by=1,
        )
        commission_service.verify_payment(db, payment.id, verified_by=1)

        assert _reload(db, CustomerAgentCommissionPayment, payment.id).status == "verified"
        assert _reload(db, CustomerAgentCommission, commission.id).status == "paid"
        # Now — and only now — the commission expense is on the books.
        assert _commission_je_count(db, payment.id) == 1

    def test_cancel_pending_payment_leaves_no_ledger_entry(self, db, make_branch, make_customer):
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, amount="30.00", status="approved")

        payment = commission_service.create_payment(
            db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
            created_by=1,
        )
        commission_service.cancel_payment(db, payment.id)

        assert _reload(db, CustomerAgentCommissionPayment, payment.id).status == "cancelled"
        # Commission falls back to approved (still payable), not stuck on 'paid'.
        assert _reload(db, CustomerAgentCommission, commission.id).status == "approved"
        # No phantom commission expense / bank credit was ever posted.
        assert _commission_je_count(db, payment.id) == 0

    def test_cancelled_payment_frees_the_balance_for_a_new_payment(self, db, make_branch, make_customer):
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, amount="30.00", status="approved")

        first = commission_service.create_payment(
            db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
            created_by=1,
        )
        # While the first payment is active, the full balance is committed:
        with pytest.raises(HTTPException):
            commission_service.create_payment(
                db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
                created_by=1,
            )
        # Cancelling it frees the balance again.
        commission_service.cancel_payment(db, first.id)
        second = commission_service.create_payment(
            db, _pay(agent, commission, amount="30.00", branch_code=branch.branch_code),
            created_by=1,
        )
        assert second.status == "pending"

    def test_partial_payments_accumulate_to_paid_on_verify(self, db, make_branch, make_customer):
        _seed_commission_accounts(db)
        branch = make_branch()
        customer = make_customer()
        agent = make_customer(is_customer_agent=True)
        invoice = _invoice(db, branch, customer)
        commission = _commission(db, invoice, agent, customer, amount="100.00", status="approved")

        first = commission_service.create_payment(
            db, _pay(agent, commission, amount="40.00", branch_code=branch.branch_code),
            created_by=1,
        )
        commission_service.verify_payment(db, first.id, verified_by=1)
        # 40 of 100 verified → still approved, not yet paid.
        assert _reload(db, CustomerAgentCommission, commission.id).status == "approved"

        second = commission_service.create_payment(
            db, _pay(agent, commission, amount="60.00", branch_code=branch.branch_code),
            created_by=1,
        )
        commission_service.verify_payment(db, second.id, verified_by=1)
        # 100 of 100 verified → paid.
        assert _reload(db, CustomerAgentCommission, commission.id).status == "paid"
