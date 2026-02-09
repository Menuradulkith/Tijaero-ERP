from app.common.base_models import TimestampMixin
from app.db.base import Base
from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    Column,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import relationship


# =============================================================================
# MATERIALIZED CASHBOOK TABLE
# =============================================================================

class CashbookEntryRecord(Base):
    """
    Materialized cashbook entries table.
    
    Instead of aggregating from 8+ tables on every query (slow, no audit trail),
    each cash movement is written here via database triggers when source 
    transactions are created. Advisory locks per branch ensure correct 
    running balance even with concurrent transactions.
    
    CASH INFLOWS (money_in > 0):
    - invoice_receipt: Invoice cash/card/bank/cheque amounts (6 payment methods)
    - customer_credit_settle: Late payments from credit customers
    - customer_advance: Advance payments received before invoicing
    - voucher_sale: Gift voucher sales to customers
    
    CASH OUTFLOWS (money_out > 0):
    - supplier_payment: Supplier credit settlements, direct payments, advance payments
    - expense: Operating expenses
    - bank_deposit: Cash transferred from shop to bank
    """
    __tablename__ = "cashbook_entries"

    id = Column(Integer, primary_key=True, index=True)
    
    # Entry classification
    entry_type = Column(String(50), nullable=False)
    # Values: invoice_receipt, customer_credit_settle, customer_advance,
    #         voucher_sale, supplier_payment, expense, bank_deposit, adjustment
    
    # Temporal
    transaction_date = Column(TIMESTAMP, nullable=False)
    created_at = Column(TIMESTAMP, nullable=False, server_default=func.now())
    
    # Reference to source transaction
    source_table = Column(String(100), nullable=False)
    # Values: invoices, customer_credits_settle_transaction, 
    #         customer_advance_payments, customer_gift_voucher,
    #         supplier_credits_settle_transaction, supplier_payments,
    #         supplier_advance_payment, expenses, bank_deposits
    source_id = Column(Integer, nullable=False)
    
    # Display fields
    reference_no = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    party_name = Column(String(200), nullable=True)
    payment_method = Column(String(50), nullable=True)
    
    # Financial
    money_in = Column(Numeric(15, 2), nullable=False, default=0)
    money_out = Column(Numeric(15, 2), nullable=False, default=0)
    running_balance = Column(Numeric(15, 2), nullable=False, default=0)
    
    # Branch context
    branch_code = Column(String(200), nullable=True)
    
    # Audit
    is_reversal = Column(Boolean, default=False)
    original_entry_id = Column(Integer, nullable=True)

    __table_args__ = (
        Index('idx_cashbook_branch_date', 'branch_code', 'transaction_date', 'id'),
        Index('idx_cashbook_source', 'source_table', 'source_id'),
        Index('idx_cashbook_entry_type', 'entry_type'),
        Index('idx_cashbook_transaction_date', 'transaction_date'),
    )


class BankDeposits(Base):
    __tablename__ = "bank_deposits"

    id = Column(Integer, primary_key=True, index=True)
    deposits_amount = Column(Numeric(60, 2), nullable=False)
    remarks = Column(Text)
    created_date = Column(TIMESTAMP, nullable=False)
    branch_code = Column(String(200), nullable=False)
    bank_name = Column(String(20))
    user_id = Column(Integer, nullable=True)
    payment_for = Column(Text)
    invoice_no = Column(String(200))
    verified = Column(Boolean, default=False)
    returned = Column(Boolean)

    invoices = relationship("Invoice", back_populates="bank_transfer")


class CardPayments(Base):
    __tablename__ = "card_payments"

    id = Column(Integer, primary_key=True, index=True)
    card_type = Column(String(10), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    date_time = Column(TIMESTAMP, nullable=False)
    remark = Column(Text)
    ref_number = Column(String(30))
    invoice_no = Column(String(200))
    deposited = Column(Boolean, nullable=False, default=True)

    invoices = relationship("Invoice", back_populates="card_payment")


class ChequePayments(Base):
    __tablename__ = "cheque_payments"

    id = Column(Integer, primary_key=True, index=True)
    cheque_number = Column(Numeric(10, 0), nullable=False)
    branch_code = Column(Integer, nullable=False)
    from_party = Column(String(50), nullable=False, name="from")
    bank = Column(String(20), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    cheque_date = Column(Date, nullable=False)
    deposit_date = Column(Date, nullable=False)
    remark = Column(String(255))
    payment_for = Column(Text)
    invoice_no = Column(String(200))

    invoices = relationship("Invoice", back_populates="cheque_payment")


class CreditPayments(Base):
    __tablename__ = "credit_payments"

    id = Column(Integer, primary_key=True, index=True)
    customer_id = Column(Integer, ForeignKey("customers.id"), nullable=True)
    amount = Column(Numeric(60, 2), nullable=True)
    credit_terms = Column(String(100), nullable=True)
    due_date = Column(Date, nullable=True)
    status = Column(String(30), default="pending")
    created_date = Column(TIMESTAMP, nullable=True)


    invoices = relationship("Invoice", back_populates="credit_payment")


class Vouchers(Base):
    __tablename__ = "vouchers"

    id = Column(Integer, primary_key=True, index=True)
    voucher_number = Column(String(50), nullable=True)
    voucher_type = Column(String(30), nullable=True)
    amount = Column(Numeric(60, 2), nullable=True)
    description = Column(Text, nullable=True)
    branch_code = Column(String(200), nullable=True)
    created_date = Column(TIMESTAMP, nullable=True)
    status = Column(String(30), default="active")

    invoices = relationship("Invoice", back_populates="voucher")


class PettyCash(Base):

    __tablename__ = "petty_cash"

    id = Column(Integer, primary_key=True, index=True)
    transaction_no = Column(String(50), unique=True, nullable=True)
    transaction_type = Column(String(20), nullable=False)
    amount = Column(Numeric(60, 2), nullable=False)
    description = Column(Text, nullable=True)
    branch_code = Column(String(200), nullable=False)
    user_id = Column(Integer, ForeignKey("accounts_user.id"), nullable=True)
    created_date = Column(TIMESTAMP, nullable=False)
    remarks = Column(Text, nullable=True)
    receipt_reference = Column(String(200), nullable=True)
    approved = Column(Boolean, default=False)
    approval_id = Column(Integer, ForeignKey("approvals.id"), nullable=True)


# NOTE: Customer-related models (CustomerAdvancePayments, CustomerCreditNotes,
# CustomerCreditsSettle, CustomerCreditsSettleTransaction) are defined in
# app.modules.customers.models to avoid duplication.
# Import them from there when needed:
# from app.modules.customers.models import (
#     CustomerAdvancePayments, CustomerCreditNotes,
#     CustomerCreditsSettle, CustomerCreditsSettleTransaction
# )

# NOTE: Supplier-related models (SupplierCreditsSettle, SupplierCreditsSettleTransaction)
# are defined in app.modules.purchasing.models to avoid duplication.
# Import them from there when needed:
# from app.modules.purchasing.models import (
#     SupplierCreditsSettle, SupplierCreditsSettleTransaction
# )


class Expenses(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    expenses_no = Column(String(200), nullable=False)
    expenses_method = Column(String(30), nullable=False)
    expense_amount = Column(Numeric(60, 2), nullable=False)
    remarks = Column(Text)
    created_date = Column(Date, nullable=False)
    branch_code = Column(String(200), nullable=False)
    bill_reference = Column(String(200))

    bill_reference = Column(String(200))
