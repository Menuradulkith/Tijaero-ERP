from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, date

from app.common.base_schemas import TijaeroBaseSchema


# Report Schemas
class ReportBase(BaseModel):
    name: str
    description: Optional[str] = None
    report_type: str
    category: Optional[str] = None
    parameters: Optional[str] = None
    is_template: bool = False
    is_scheduled: bool = False
    schedule_frequency: Optional[str] = None


class ReportCreate(ReportBase):
    created_by: int


class Report(ReportBase, TijaeroBaseSchema):
    id: int
    created_by: int
    created_date: datetime
    last_run: Optional[datetime] = None


# Report Execution Schemas
class ReportExecutionCreate(BaseModel):
    report_id: int
    executed_by: int
    parameters: Optional[str] = None


class ReportExecution(TijaeroBaseSchema):
    id: int
    report_id: int
    executed_by: int
    execution_date: datetime
    status: str
    parameters: Optional[str] = None
    result_summary: Optional[str] = None
    execution_time: Optional[int] = None
    error_message: Optional[str] = None


# Report Request/Response Schemas
class DateRangeFilter(BaseModel):
    start_date: date
    end_date: date


class SalesReportRequest(BaseModel):
    start_date: date
    end_date: date
    branch_code: Optional[str] = None
    customer_id: Optional[int] = None
    product_id: Optional[int] = None


class SalesReportResponse(BaseModel):
    total_sales: float
    total_orders: int
    total_customers: int
    average_order_value: float
    top_products: List[Dict[str, Any]]
    sales_by_date: List[Dict[str, Any]]
    sales_by_branch: List[Dict[str, Any]]


class FinanceReportRequest(BaseModel):
    start_date: date
    end_date: date
    report_type: str  # income, expenses, cashflow, balance


class FinanceReportResponse(BaseModel):
    total_income: float
    total_expenses: float
    net_profit: float
    bank_deposits: float
    card_payments: float
    cheque_payments: float
    expenses_by_category: List[Dict[str, Any]]
    monthly_summary: List[Dict[str, Any]]


class InventoryReportRequest(BaseModel):
    branch_code: Optional[str] = None
    category: Optional[str] = None
    low_stock_threshold: Optional[int] = 10


class InventoryReportResponse(BaseModel):
    total_products: int
    total_stock_value: float
    low_stock_items: List[Dict[str, Any]]
    stock_by_category: List[Dict[str, Any]]
    stock_by_branch: List[Dict[str, Any]]


class HRReportRequest(BaseModel):
    start_date: date
    end_date: date
    department: Optional[str] = None


class HRReportResponse(BaseModel):
    total_employees: int
    total_payroll: float
    total_reimbursements: float
    total_deductions: float
    payroll_by_month: List[Dict[str, Any]]
    department_summary: List[Dict[str, Any]]


class WarehouseReportRequest(BaseModel):
    start_date: date
    end_date: date
    warehouse_id: Optional[int] = None


class WarehouseReportResponse(BaseModel):
    total_transfers: int
    total_receives: int
    pending_approvals: int
    transfer_by_status: List[Dict[str, Any]]
    warehouse_activity: List[Dict[str, Any]]


class SupportReportRequest(BaseModel):
    start_date: date
    end_date: date
    branch_code: Optional[str] = None
    job_type: Optional[str] = None


class SupportReportResponse(BaseModel):
    total_tickets: int
    open_tickets: int
    closed_tickets: int
    total_warranty_claims: int
    tickets_by_type: List[Dict[str, Any]]
    tickets_by_status: List[Dict[str, Any]]
    average_resolution_time: Optional[float] = None


class DashboardMetrics(BaseModel):
    """Overall system metrics for dashboard"""
    total_sales_today: float
    total_sales_month: float
    total_orders_today: int
    total_orders_month: int
    total_customers: int
    total_products: int
    low_stock_items: int
    pending_approvals: int
    open_support_tickets: int
    recent_activities: List[Dict[str, Any]]
