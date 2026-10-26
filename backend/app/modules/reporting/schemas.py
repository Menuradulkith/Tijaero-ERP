from pydantic import BaseModel, Field, StringConstraints
from typing import Annotated, Optional, Dict, Any, List, Literal
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
    category: Optional[str] = Field(None, max_length=20)
    low_stock_threshold: Optional[int] = Field(10, ge=0, le=1_000_000)


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
    # Core KPI
    total_sales_today: float
    total_sales_month: float
    total_sales_last_month: float  # for trend calculation
    total_orders_today: int
    total_orders_month: int
    total_orders_last_month: int  # for trend calculation
    total_customers: int
    new_customers_month: int  # new customers this month
    total_products: int
    low_stock_items: int

    # Purchasing
    total_purchases_month: float
    pending_po_count: int

    # Receivables / payables
    total_credit_outstanding: float  # unpaid credit from invoices
    total_supplier_credit: float  # what we owe suppliers

    # Pending approvals breakdown
    pending_approvals: int  # total
    pending_sales_approvals: int
    pending_purchase_approvals: int
    pending_return_approvals: int
    pending_expense_approvals: int
    pending_transfer_approvals: int

    # Support
    open_support_tickets: int

    # Daily sales trend (last 7 days)
    daily_sales: List[Dict[str, Any]]  # [{date, sales, orders}]

    # Top 5 selling products (this month)
    top_products: List[Dict[str, Any]]  # [{name, item_code, quantity, revenue}]

    # Recent activities (real data)
    recent_activities: List[Dict[str, Any]]


# ─── Print templates ──────────────────────────────────────────────────────────

_LOGO_RE = r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$"
_COLOR_RE = r"^#[0-9a-fA-F]{6}$"


class PrintLayoutSettings(BaseModel):
    """Layout options of a print template. Free texts are printed escaped; the logo and
    colour are restricted to formats that cannot carry markup or script."""

    model_config = {"extra": "forbid"}

    show_header: bool = True
    show_discount: bool = True
    show_signatures: bool = True
    logo: Optional[str] = Field(None, max_length=1_500_000, pattern=_LOGO_RE)
    primary_color: Optional[str] = Field(None, pattern=_COLOR_RE)
    company_name: Optional[str] = Field(None, max_length=200)
    company_address: Optional[str] = Field(None, max_length=500)
    company_phone: Optional[str] = Field(None, max_length=100)
    company_email: Optional[str] = Field(None, max_length=200)
    header_text: Optional[str] = Field(None, max_length=1000)
    terms: Optional[str] = Field(None, max_length=4000)
    bank_details: Optional[str] = Field(None, max_length=1000)
    footer_text: Optional[str] = Field(None, max_length=1000)
    layout_style: str = Field("standard", pattern=r"^[a-z_]{1,30}$")
    show_amount_in_words: bool = True
    show_bank_details: bool = True


# Names are trimmed before the length check, so "   " is rejected rather than saved as "".
TemplateName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class PrintTemplateBase(BaseModel):
    name: TemplateName
    branch_code: Optional[str] = Field(None, max_length=255)
    paper_size: Optional[Literal["A4", "A5", "Letter", "Legal", "80mm"]] = None
    orientation: Literal["portrait", "landscape"] = "portrait"
    settings: PrintLayoutSettings = Field(default_factory=PrintLayoutSettings)
    custom_html: Optional[str] = Field(None, max_length=200_000)
    is_active: bool = True


class PrintTemplateCreate(PrintTemplateBase):
    document_type: str = Field(..., max_length=50)
    is_default: bool = False


class PrintTemplateUpdate(PrintTemplateBase):
    # The version the editor loaded; a mismatch means someone else saved in between (409).
    expected_version: Optional[int] = None


class PrintTemplatePreview(PrintTemplateBase):
    document_type: str = Field(..., max_length=50)
    document_id: Optional[int] = Field(None, ge=1, le=2_147_483_647)
    name: TemplateName = "Preview"


class PrintTemplateSummary(TijaeroBaseSchema):
    id: int
    document_type: str
    name: str
    branch_code: Optional[str] = None
    paper_size: Optional[str] = None
    orientation: str
    is_default: bool
    is_active: bool
    has_custom_html: bool
    version: int
    updated_at: Optional[datetime] = None
    updated_by: Optional[int] = None


class PrintTemplateDetail(PrintTemplateSummary):
    settings: Dict[str, Any]
    custom_html: Optional[str] = None


class PrintTemplateVersionOut(TijaeroBaseSchema):
    version: int
    created_at: datetime
    created_by: Optional[int] = None
    snapshot: Dict[str, Any]
