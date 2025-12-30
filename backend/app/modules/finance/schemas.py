from pydantic import BaseModel, Field
from datetime import date, datetime
from typing import Optional, List
from decimal import Decimal

# Bank Deposit Schemas (existing table)
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

# Card Payment Schemas (existing table)
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

# Cheque Payment Schemas (existing table)
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

# Advance Payment Schemas (existing table)
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

# Credit Note Schemas (existing table)
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

# Expense Schemas (existing table)
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

# Credit Settlement Schemas (existing tables)
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

# Supplier Credit Settlement Schemas (existing tables)
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

# Filter Schemas
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
