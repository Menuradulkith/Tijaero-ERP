"""
Customer Agent Commission Schemas
Pydantic schemas for commission management API
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, date
from decimal import Decimal


# =============================================================================
# Commission Schemas
# =============================================================================

class CustomerAgentCommissionBase(BaseModel):
    invoice_id: int = Field(..., description="Invoice ID")
    customer_agent_id: int = Field(..., description="Customer Agent ID")
    represented_customer_id: int = Field(..., description="Represented Customer ID")
    invoice_amount: Decimal = Field(..., description="Invoice amount")
    commission_type: str = Field(..., max_length=20, description="PERCENT or AMOUNT")
    commission_rate: Optional[Decimal] = Field(None, description="Commission rate (for PERCENT type)")
    commission_amount: Decimal = Field(..., description="Calculated commission amount")
    remarks: Optional[str] = Field(None, description="Remarks")


class CustomerAgentCommissionCreate(CustomerAgentCommissionBase):
    pass


class CustomerAgentCommissionUpdate(BaseModel):
    commission_type: Optional[str] = Field(None, max_length=20)
    commission_rate: Optional[Decimal] = None
    commission_amount: Optional[Decimal] = None
    status: Optional[str] = Field(None, max_length=30)
    remarks: Optional[str] = None


class CustomerAgentCommission(CustomerAgentCommissionBase):
    id: int
    status: str
    approved_by: Optional[int] = None
    approved_date: Optional[datetime] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerAgentCommissionWithDetails(CustomerAgentCommission):
    """Commission with agent and customer names for list views"""
    agent_name: Optional[str] = None
    customer_name: Optional[str] = None
    invoice_no: Optional[str] = None
    total_paid: Optional[Decimal] = Decimal("0")

    class Config:
        from_attributes = True


# =============================================================================
# Commission Payment Schemas
# =============================================================================

class CommissionPaymentItemBase(BaseModel):
    commission_id: int = Field(..., description="Commission ID to pay")
    paid_amount: Decimal = Field(..., gt=0, description="Amount paid for this commission")


class CommissionPaymentItemCreate(CommissionPaymentItemBase):
    pass


class CommissionPaymentItem(CommissionPaymentItemBase):
    id: int
    payment_id: int
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CommissionPaymentItemWithDetails(CommissionPaymentItem):
    """Payment item with commission details"""
    invoice_no: Optional[str] = None
    invoice_amount: Optional[Decimal] = None
    commission_amount: Optional[Decimal] = None
    commission_status: Optional[str] = None

    class Config:
        from_attributes = True


class CustomerAgentCommissionPaymentBase(BaseModel):
    customer_agent_id: int = Field(..., description="Customer Agent ID")
    payment_date: date = Field(..., description="Payment date")
    payment_method: str = Field(..., max_length=30, description="Cash, Bank Transfer, Cheque")
    payment_amount: Decimal = Field(..., gt=0, description="Total payment amount")
    reference_number: Optional[str] = Field(None, max_length=300, description="Payment reference")
    bank_name: Optional[str] = Field(None, max_length=255, description="Bank name")
    branch_code: str = Field(..., max_length=200, description="Branch code")
    remarks: Optional[str] = Field(None, description="Remarks")


class CustomerAgentCommissionPaymentCreate(CustomerAgentCommissionPaymentBase):
    items: List[CommissionPaymentItemCreate] = Field(..., min_length=1, description="Payment items")


class CustomerAgentCommissionPaymentUpdate(BaseModel):
    status: Optional[str] = Field(None, max_length=30)
    remarks: Optional[str] = None


class CustomerAgentCommissionPayment(CustomerAgentCommissionPaymentBase):
    id: int
    payment_no: str
    status: str
    verified_by: Optional[int] = None
    verified_date: Optional[datetime] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class CustomerAgentCommissionPaymentWithItems(CustomerAgentCommissionPayment):
    """Payment with items and details"""
    items: List[CommissionPaymentItemWithDetails] = []
    agent_name: Optional[str] = None

    class Config:
        from_attributes = True


# =============================================================================
# Summary / Report Schemas
# =============================================================================

class AgentCommissionSummary(BaseModel):
    """Summary of commissions for a specific agent"""
    agent_id: int
    agent_name: str
    total_commissions: Decimal = Decimal("0")
    pending_amount: Decimal = Decimal("0")
    approved_amount: Decimal = Decimal("0")
    paid_amount: Decimal = Decimal("0")
    total_invoices: int = 0
    pending_count: int = 0
    approved_count: int = 0
    paid_count: int = 0


class CommissionListResponse(BaseModel):
    """Paginated commission list"""
    items: List[CustomerAgentCommissionWithDetails]
    total: int
