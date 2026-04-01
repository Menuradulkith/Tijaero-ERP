from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

from app.common.base_schemas import TijaeroBaseSchema
from app.common.enums import DocumentStatus, PaymentStatus, ExpenseStatus

class BankDepositBase(BaseModel):
    deposits_amount: Decimal
    remarks: Optional[str] = None
    branch_code: str
    bank_name: Optional[str] = None
    payment_for: Optional[str] = None
    invoice_no: Optional[str] = None

class BankDepositCreate(BankDepositBase):
    user_id: Optional[int] = None

class BankDeposit(BankDepositBase, TijaeroBaseSchema):
    id: int
    created_date: datetime
    user_id: Optional[int] = None
    verified: bool = False
    returned: Optional[bool] = None
    status: str = DocumentStatus.PENDING
    confirmed_by: Optional[int] = None
    confirmed_date: Optional[datetime] = None

class CardPaymentBase(BaseModel):
    card_type: str
    amount: Decimal
    remark: Optional[str] = None
    ref_number: Optional[str] = None
    invoice_no: Optional[str] = None
    deposited: bool = False

class CardPaymentCreate(CardPaymentBase):
    pass

class CardPayment(CardPaymentBase, TijaeroBaseSchema):
    id: int
    date_time: datetime

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

class ChequePayment(ChequePaymentBase, TijaeroBaseSchema):
    id: int

class CustomerAdvancePaymentBase(BaseModel):
    customer_id: int
    payment_method: str
    branch_code: str
    payment_amount: Decimal
    remarks: Optional[str] = None
    cheque_date: date

class CustomerAdvancePaymentCreate(CustomerAdvancePaymentBase):
    pass

class CustomerAdvancePayment(CustomerAdvancePaymentBase, TijaeroBaseSchema):
    id: int
    advance_payments_no: str
    created_date: date
    active: bool
    applied_amount: Decimal = Decimal("0")
    remaining_amount: Decimal = Decimal("0")
    is_fully_applied: bool = False

class CustomerCreditNoteBase(BaseModel):
    customer_id: int
    amount: Decimal
    remark: str
    invoice_no: Optional[str] = None

class CustomerCreditNoteCreate(CustomerCreditNoteBase):
    pass

class CustomerCreditNote(CustomerCreditNoteBase, TijaeroBaseSchema):
    id: int
    date: datetime

class ExpenseBase(BaseModel):
    expenses_no: Optional[str] = None
    expense_type: str = "operational"
    expense_category: str
    expenses_method: str
    expense_amount: Decimal
    expense_date: Optional[date] = None
    vendor_name: Optional[str] = None
    description: Optional[str] = None
    receipt_number: Optional[str] = None
    receipt_image: Optional[str] = None
    invoice_attachment: Optional[str] = None
    remarks: Optional[str] = None
    bill_reference: Optional[str] = None
    branch_code: str
    account_code: Optional[str] = None
    cost_center: Optional[str] = None

class ExpenseCreate(ExpenseBase):
    pass

class ExpenseUpdate(BaseModel):
    expense_type: Optional[str] = None
    expense_category: Optional[str] = None
    expenses_method: Optional[str] = None
    expense_amount: Optional[Decimal] = None
    expense_date: Optional[date] = None
    vendor_name: Optional[str] = None
    description: Optional[str] = None
    receipt_number: Optional[str] = None
    receipt_image: Optional[str] = None
    invoice_attachment: Optional[str] = None
    remarks: Optional[str] = None
    bill_reference: Optional[str] = None
    account_code: Optional[str] = None
    cost_center: Optional[str] = None

class Expense(ExpenseBase, TijaeroBaseSchema):
    id: int
    status: str = ExpenseStatus.PENDING
    submitted_by: Optional[int] = None
    approved_by: Optional[int] = None
    approved_date: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    payment_status: Optional[str] = None
    payment_date: Optional[date] = None
    payment_method: Optional[str] = None
    payment_reference: Optional[str] = None
    created_date: date
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class ExpenseApproval(BaseModel):
    remarks: Optional[str] = None

class ExpenseReject(BaseModel):
    rejection_reason: str

class ExpensePayment(BaseModel):
    payment_method: str
    payment_reference: Optional[str] = None
    payment_date: Optional[date] = None
    remarks: Optional[str] = None

class ExpenseRecord(BaseModel):
    account_code: str
    cost_center: Optional[str] = None
    remarks: Optional[str] = None

class CustomerCreditsSettleTransactionBase(BaseModel):
    payment_method: str
    cheque_date: date
    payment_amount: Decimal
    payment_method_number: Optional[str] = None
    remarks: Optional[str] = None
    invoice_id: int

class CustomerCreditsSettleTransactionCreate(CustomerCreditsSettleTransactionBase):
    pass

class CustomerCreditsSettleTransaction(CustomerCreditsSettleTransactionBase, TijaeroBaseSchema):
    id: int
    created_date: date
    customer_credit_settle_id: int

class CustomerCreditsSettleBase(BaseModel):
    customer_id: int
    branch_code: str

class CustomerCreditsSettleCreate(CustomerCreditsSettleBase):
    transactions: List[CustomerCreditsSettleTransactionCreate]

class CustomerCreditsSettle(CustomerCreditsSettleBase, TijaeroBaseSchema):
    id: int
    customer_credits_settle_no: str
    created_date: datetime

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

class SupplierCreditsSettleTransaction(SupplierCreditsSettleTransactionBase, TijaeroBaseSchema):
    id: int
    created_date: datetime
    supplier_credit_settle_id: Optional[int] = None

class ExpenseListFilter(BaseModel):
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # user-scoped branch list
    status: Optional[str] = None
    expense_category: Optional[str] = None
    payment_status: Optional[str] = None
    search: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100

class PaymentListFilter(BaseModel):
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # user-scoped branch list
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


class CashbookEntry(TijaeroBaseSchema):
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


class CashbookFilter(BaseModel):
    """Filter criteria for cashbook query"""
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # user-scoped branch list
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


# =============================================================================
# PETTY CASH FUND SCHEMAS (Scenario 25)
# =============================================================================

class PettyCashFundCreate(BaseModel):
    """Open a new petty cash fund"""
    opening_balance: Decimal
    branch_code: str
    opened_by: Optional[int] = None
    remarks: Optional[str] = None

class PettyCashFundResponse(TijaeroBaseSchema):
    id: int
    petty_cash_no: str
    opening_balance: Decimal
    current_balance: Decimal
    closing_balance: Optional[Decimal] = None
    branch_code: str
    opened_by: Optional[int] = None
    opened_date: date
    status: str
    closed_by: Optional[int] = None
    closed_date: Optional[date] = None
    remarks: Optional[str] = None
    created_date: datetime

class PettyCashFundWithTransactions(PettyCashFundResponse):
    transactions: List["PettyCashTransactionResponse"] = []


# Petty Cash Transaction Schemas
class PettyCashExpenseCreate(BaseModel):
    """Record a petty cash expense"""
    petty_cash_id: int
    amount: Decimal
    expense_type: str
    recipient_name: Optional[str] = None
    purpose: Optional[str] = None
    receipt_number: Optional[str] = None
    description: Optional[str] = None
    transaction_date: Optional[date] = None
    recorded_by: Optional[int] = None
    remarks: Optional[str] = None

class PettyCashReplenishCreate(BaseModel):
    """Replenish a petty cash fund"""
    petty_cash_id: int
    amount: Decimal
    approved_by: Optional[int] = None
    description: Optional[str] = None
    transaction_date: Optional[date] = None
    recorded_by: Optional[int] = None
    remarks: Optional[str] = None

class PettyCashTransactionResponse(TijaeroBaseSchema):
    id: int
    transaction_no: str
    petty_cash_id: int
    transaction_type: str
    amount: Decimal
    balance_after: Decimal
    expense_type: Optional[str] = None
    recipient_name: Optional[str] = None
    purpose: Optional[str] = None
    receipt_number: Optional[str] = None
    approved_by: Optional[int] = None
    description: Optional[str] = None
    transaction_date: date
    recorded_by: Optional[int] = None
    branch_code: str
    remarks: Optional[str] = None
    created_date: datetime


class PettyCashReconcileRequest(BaseModel):
    """Close/Reconcile a petty cash fund"""
    physical_cash_count: Decimal
    closed_by: Optional[int] = None
    remarks: Optional[str] = None

class PettyCashReconcileResponse(BaseModel):
    fund: PettyCashFundResponse
    expected_balance: Decimal
    physical_cash_count: Decimal
    discrepancy: Decimal
    has_discrepancy: bool
    message: str


class PettyCashListFilter(BaseModel):
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # user-scoped branch list
    status: Optional[str] = None  # active, closed
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    skip: int = 0
    limit: int = 100


class PettyCashSummary(BaseModel):
    """Summary of a petty cash fund"""
    fund_id: int
    petty_cash_no: str
    branch_code: str
    status: str
    opening_balance: Decimal
    current_balance: Decimal
    total_expenses: Decimal
    total_replenishments: Decimal
    expense_count: int
    replenishment_count: int
    last_transaction_date: Optional[date] = None

# Forward reference resolution
PettyCashFundWithTransactions.model_rebuild()
