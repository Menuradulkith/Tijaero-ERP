"""
Debtors Management Pydantic Schemas

Request/response schemas for debtors management API endpoints.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from decimal import Decimal


# ============================================================================
# PAYMENT SCHEMAS
# ============================================================================

class InvoicePaymentCreate(BaseModel):
    """Schema for creating a new invoice payment"""
    amount: Decimal = Field(..., gt=0, description="Payment amount")
    payment_date: date = Field(..., description="Date of payment")
    payment_method: str = Field(..., description="Payment method (bank_transfer, cheque, cash, etc.)")
    reference_no: Optional[str] = Field(None, description="Reference number (cheque #, transaction ID, etc.)")
    notes: Optional[str] = Field(None, description="Additional notes")

    class Config:
        json_schema_extra = {
            "example": {
                "amount": "5000.00",
                "payment_date": "2024-02-15",
                "payment_method": "bank_transfer",
                "reference_no": "TXN123456",
                "notes": "Partial payment received"
            }
        }


class InvoicePaymentResponse(InvoicePaymentCreate):
    """Schema for invoice payment response"""
    id: int
    invoice_id: int
    customer_id: int
    created_at: datetime
    created_by: Optional[int] = None

    class Config:
        from_attributes = True


# ============================================================================
# FOLLOW-UP SCHEMAS
# ============================================================================

class FollowupCreate(BaseModel):
    """Schema for creating a follow-up record"""
    followup_date: date = Field(..., description="Date of follow-up")
    followup_type: str = Field(..., description="Type: call, email, sms, visit, reminder")
    notes: str = Field(..., min_length=1, description="Follow-up notes")
    amount_promised: Optional[Decimal] = Field(None, ge=0, description="Amount customer promised to pay")
    promised_payment_date: Optional[date] = Field(None, description="When customer promised to pay")

    class Config:
        json_schema_extra = {
            "example": {
                "followup_date": "2024-02-15",
                "followup_type": "call",
                "notes": "Customer promised payment by 20th",
                "amount_promised": "10000.00",
                "promised_payment_date": "2024-02-20"
            }
        }


class FollowupResponse(FollowupCreate):
    """Schema for follow-up response"""
    id: int
    customer_id: int
    created_at: datetime
    created_by: Optional[int] = None
    is_resolved: int

    class Config:
        from_attributes = True


# ============================================================================
# INVOICE DETAIL SCHEMAS
# ============================================================================

class InvoiceDetailResponse(BaseModel):
    """Schema for invoice details in debt view"""
    invoice_id: int
    invoice_no: str
    sale_date: date
    created_date: Optional[date] = None
    invoice_amount: Decimal
    amount_paid: Decimal
    outstanding_balance: Decimal
    days_outstanding: int
    days_overdue: int
    status: str  # paid, partial, unpaid, overdue
    payment_status: str

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "invoice_id": 1,
                "invoice_no": "INV-001",
                "sale_date": "2024-01-01",
                "invoice_amount": "10000.00",
                "amount_paid": "7000.00",
                "outstanding_balance": "3000.00",
                "days_outstanding": 45,
                "days_overdue": 15,
                "status": "partial",
                "payment_status": "overdue"
            }
        }


# ============================================================================
# DEBTOR SUMMARY SCHEMAS
# ============================================================================

class DebtorSummary(BaseModel):
    """Schema for debtor summary in list view"""
    customer_id: int
    customer_name: str
    company_name: Optional[str] = None
    total_credit_sales: Decimal
    total_paid: Decimal
    outstanding_balance: Decimal
    credit_limit: Decimal
    credit_days: int
    last_sale_date: Optional[date] = None
    oldest_invoice_date: Optional[date] = None
    days_overdue: int
    status: str  # current, overdue, critical
    contact_number: Optional[str] = None
    email: Optional[str] = None

    class Config:
        from_attributes = True
        json_schema_extra = {
            "example": {
                "customer_id": 1,
                "customer_name": "ABC Corp",
                "company_name": "ABC Ltd",
                "outstanding_balance": "50000.00",
                "credit_limit": "100000.00",
                "credit_days": 30,
                "days_overdue": 15,
                "status": "overdue",
                "contact_number": "+94771234567",
                "email": "info@abc.com"
            }
        }


class DebtorsReport(BaseModel):
    """Schema for debtors report/summary"""
    total_debtors: int
    total_outstanding: Decimal
    total_overdue: Decimal
    critical_count: int
    overdue_count: int
    current_count: int
    debtors: List[DebtorSummary]

    class Config:
        from_attributes = True


# ============================================================================
# CUSTOMER DEBT DETAIL SCHEMAS
# ============================================================================

class CustomerDebtDetails(BaseModel):
    """Schema for complete customer debt information"""
    customer_id: int
    customer_name: str
    company_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    credit_limit: Decimal
    credit_days: int
    total_outstanding: Decimal
    invoices: List[InvoiceDetailResponse]
    followup_history: List[FollowupResponse] = []

    class Config:
        from_attributes = True


# ============================================================================
# STATEMENT FILTER SCHEMAS
# ============================================================================

class DebtorStatementRequest(BaseModel):
    """Schema for requesting customer statement"""
    customer_id: int = Field(..., description="Customer ID")
    from_date: Optional[date] = Field(None, description="From date for filtering")
    to_date: Optional[date] = Field(None, description="To date for filtering")
    include_payments: bool = Field(True, description="Include payment history")

    class Config:
        json_schema_extra = {
            "example": {
                "customer_id": 1,
                "from_date": "2024-01-01",
                "to_date": "2024-12-31",
                "include_payments": True
            }
        }


class DebtorStatement(BaseModel):
    """Schema for customer aging statement"""
    customer_id: int
    customer_name: str
    company_name: Optional[str] = None
    statement_date: date
    credit_limit: Decimal
    credit_used: Decimal
    available_credit: Decimal
    total_outstanding: Decimal
    amount_due_this_month: Optional[Decimal] = None
    total_overdue: Decimal
    oldest_overdue_invoice: Optional[str] = None
    days_since_oldest_invoice: int

    class Config:
        from_attributes = True


# ============================================================================
# PAYMENT RECORD SCHEMAS
# ============================================================================

class PaymentRecordRequest(BaseModel):
    """Schema for recording a payment"""
    invoice_id: int = Field(..., description="Invoice ID to apply payment to")
    amount: Decimal = Field(..., gt=0, description="Payment amount")
    payment_date: date = Field(..., description="Payment date")
    payment_method: str = Field(..., description="Payment method")
    reference_no: Optional[str] = Field(None, description="Reference number")
    notes: Optional[str] = Field(None, description="Notes")

    class Config:
        json_schema_extra = {
            "example": {
                "invoice_id": 1,
                "amount": "5000.00",
                "payment_date": "2024-02-15",
                "payment_method": "bank_transfer",
                "reference_no": "TXN12345"
            }
        }


# ============================================================================
# QUERY PARAMETER SCHEMAS
# ============================================================================

class DebtorListRequest(BaseModel):
    """Schema for debtor list query parameters"""
    status_filter: str = Field("all", description="Filter: all, current, overdue, critical")
    min_outstanding: Optional[Decimal] = Field(None, description="Minimum outstanding amount")
    max_outstanding: Optional[Decimal] = Field(None, description="Maximum outstanding amount")
    sort_by: str = Field("outstanding_balance", description="Sort by: outstanding_balance, days_overdue, customer_name")
    sort_order: str = Field("desc", description="Sort order: asc or desc")
    skip: int = Field(0, ge=0, description="Pagination skip")
    limit: int = Field(100, ge=1, le=1000, description="Pagination limit")

    class Config:
        json_schema_extra = {
            "example": {
                "status_filter": "overdue",
                "sort_by": "days_overdue",
                "sort_order": "desc",
                "skip": 0,
                "limit": 10
            }
        }
