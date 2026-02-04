from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

class BankDepositBase(BaseModel):
    deposits_amount: Decimal
    remarks: Optional[str] = None
    branch_code: str
    bank_name: Optional[str] = None
    payment_for: Optional[str] = None
    invoice_no: Optional[str] = None

class BankDepositCreate(BankDepositBase):
    user_id: Optional[int] = None

class BankDeposit(BankDepositBase):
    id: int
    created_date: datetime
    user_id: Optional[int] = None
    verified: bool = False
    returned: Optional[bool] = None
    
    class Config:
        from_attributes = True

class CardPaymentBase(BaseModel):
    card_type: str
    amount: Decimal
    remark: Optional[str] = None
    ref_number: Optional[str] = None
    invoice_no: Optional[str] = None
    deposited: bool = True

class CardPaymentCreate(CardPaymentBase):
    pass

class CardPayment(CardPaymentBase):
    id: int
    date_time: datetime
    
    class Config:
        from_attributes = True

class ChequePaymentBase(BaseModel):
    cheque_number: int
    branch_code: int
    from_party: str = Field(alias="from")
    bank: str
    amount: Decimal
    cheque_date: date
    deposit_date: date
    remark: Optional[str] = None
    payment_for: Optional[str] = None
    invoice_no: Optional[str] = None

class ChequePaymentCreate(ChequePaymentBase):
    pass

class ChequePayment(ChequePaymentBase):
    id: int
    
    class Config:
        from_attributes = True
        populate_by_name = True

class CustomerAdvancePaymentBase(BaseModel):
    customer_id: int
    payment_method: str
    branch_code: str
    payment_amount: Decimal
    remarks: Optional[str] = None
    cheque_date: date

class CustomerAdvancePaymentCreate(CustomerAdvancePaymentBase):
    pass

class CustomerAdvancePayment(CustomerAdvancePaymentBase):
    id: int
    advance_payments_no: str
    created_date: date
    active: bool
    
    class Config:
        from_attributes = True

class CustomerCreditNoteBase(BaseModel):
    customer_id: int
    amount: Decimal
    remark: str
    invoice_no: Optional[str] = None

class CustomerCreditNoteCreate(CustomerCreditNoteBase):
    pass

class CustomerCreditNote(CustomerCreditNoteBase):
    id: int
    date: datetime
    
    class Config:
        from_attributes = True

class ExpenseBase(BaseModel):
    expenses_no: str
    expenses_method: str
    expense_amount: Decimal
    remarks: Optional[str] = None
    branch_code: str
    bill_reference: Optional[str] = None

class ExpenseCreate(ExpenseBase):
    pass

class Expense(ExpenseBase):
    id: int
    created_date: date
    
    class Config:
        from_attributes = True

class CustomerCreditsSettleTransactionBase(BaseModel):
    payment_method: str
    cheque_date: date
    payment_amount: Decimal
    payment_method_number: Optional[str] = None
    remarks: Optional[str] = None
    invoice_id: int

class CustomerCreditsSettleTransactionCreate(CustomerCreditsSettleTransactionBase):
    pass

class CustomerCreditsSettleTransaction(CustomerCreditsSettleTransactionBase):
    id: int
    created_date: date
    customer_credit_settle_id: int
    
    class Config:
        from_attributes = True

class CustomerCreditsSettleBase(BaseModel):
    customer_id: int
    branch_code: str

class CustomerCreditsSettleCreate(CustomerCreditsSettleBase):
    transactions: List[CustomerCreditsSettleTransactionCreate]

class CustomerCreditsSettle(CustomerCreditsSettleBase):
    id: int
    customer_credits_settle_no: str
    created_date: datetime
    
    class Config:
        from_attributes = True

class CustomerCreditsSettleWithTransactions(CustomerCreditsSettle):
    transactions: List[CustomerCreditsSettleTransaction] = []

class SupplierCreditsSettleTransactionBase(BaseModel):
    payment_method: str
    cheque_date: date
    payment_amount: Decimal
    payment_method_number: Optional[str] = None
    remarks: Optional[str] = None
    good_received_id: int

class SupplierCreditsSettleTransactionCreate(SupplierCreditsSettleTransactionBase):
    pass

class SupplierCreditsSettleTransaction(SupplierCreditsSettleTransactionBase):
    id: int
    created_date: datetime
    supplier_credit_settle_id: Optional[int] = None
    
    class Config:
        from_attributes = True

class ExpenseListFilter(BaseModel):
    branch_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100

class PaymentListFilter(BaseModel):
    branch_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    verified: Optional[bool] = None
    skip: int = 0
    limit: int = 100


# =============================================================================
# CASHBOOK SCHEMAS
# =============================================================================

class CashbookEntryType(str):
    """Transaction type for cashbook entries"""
    INVOICE_RECEIPT = "invoice_receipt"
    CUSTOMER_CREDIT_SETTLE = "customer_credit_settle"
    CUSTOMER_ADVANCE = "customer_advance"
    SUPPLIER_PAYMENT = "supplier_payment"
    EXPENSE = "expense"
    BANK_DEPOSIT = "bank_deposit"
    VOUCHER_SALE = "voucher_sale"  # Gift voucher sold to customer
    ADJUSTMENT = "adjustment"


class CashbookEntry(BaseModel):
    """Single cashbook transaction entry"""
    id: int
    entry_type: str  # CashbookEntryType value
    transaction_date: datetime
    reference_no: str
    description: str
    party_name: Optional[str] = None
    payment_method: Optional[str] = None
    money_in: Decimal = Decimal("0")
    money_out: Decimal = Decimal("0")
    running_balance: Decimal = Decimal("0")  # Cumulative balance after this transaction
    branch_code: Optional[str] = None
    source_table: str  # Table name for drill-down
    source_id: int  # Record ID for drill-down

    class Config:
        from_attributes = True


class CashbookFilter(BaseModel):
    """Filter criteria for cashbook query"""
    branch_code: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    entry_type: Optional[str] = None  # Filter by specific entry type
    payment_method: Optional[str] = None


class CashbookSummary(BaseModel):
    """Summary statistics for cashbook report"""
    total_money_in: Decimal = Decimal("0")
    total_money_out: Decimal = Decimal("0")
    net_movement: Decimal = Decimal("0")
    opening_balance: Decimal = Decimal("0")
    closing_balance: Decimal = Decimal("0")
    
    # Breakdown by type - amounts
    invoice_receipts: Decimal = Decimal("0")
    customer_credit_settlements: Decimal = Decimal("0")
    customer_advances: Decimal = Decimal("0")
    voucher_sales: Decimal = Decimal("0")  # Gift voucher sales
    supplier_payments: Decimal = Decimal("0")
    expenses: Decimal = Decimal("0")
    bank_deposits: Decimal = Decimal("0")
    
    # Breakdown by type - counts
    invoice_receipts_count: int = 0
    customer_credit_settlements_count: int = 0
    customer_advances_count: int = 0
    voucher_sales_count: int = 0  # Gift voucher sales count
    supplier_payments_count: int = 0
    expenses_count: int = 0
    bank_deposits_count: int = 0


class CashbookReport(BaseModel):
    """Complete cashbook report with entries and summary"""
    entries: List[CashbookEntry]
    summary: CashbookSummary
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    branch_code: Optional[str] = None
    entry_count: int = 0
