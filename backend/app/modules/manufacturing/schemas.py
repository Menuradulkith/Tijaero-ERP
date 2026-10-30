"""Schemas for manufacturing. Input schemas are strict (bounded, trimmed, blank -> None);
response schemas stay lenient."""
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, List, Literal, Optional

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints, model_validator

INT4_MAX = 2_147_483_647


def _blank_to_none(v):
    if isinstance(v, str):
        v = v.strip()
        return v or None
    return v


def ReqStr(n: int):
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=n)]


def OptStr(n: int):
    return Annotated[Optional[Annotated[str, StringConstraints(max_length=n)]], BeforeValidator(_blank_to_none)]


Id = Annotated[int, Field(ge=1, le=INT4_MAX)]
OptId = Annotated[Optional[int], Field(default=None, ge=1, le=INT4_MAX)]
Qty = Annotated[int, Field(ge=1, le=1_000_000)]
Money = Annotated[Decimal, Field(ge=0, le=Decimal("999999999999"), decimal_places=2)]
Minutes = Annotated[Decimal, Field(ge=0, le=Decimal("1000000"), decimal_places=4)]

Priority = Literal["low", "normal", "high", "urgent"]
IssueMethod = Literal["manual", "backflush"]


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ═══════════════════════════ work centers ═══════════════════════════
class WorkCenterIn(BaseModel):
    code: ReqStr(30)
    name: ReqStr(150)
    description: OptStr(2000) = None
    branch_code: OptStr(200) = None
    capacity: int = Field(1, ge=1, le=1000)
    efficiency_pct: Decimal = Field(Decimal("100"), ge=1, le=300, decimal_places=2)
    working_hours_per_day: Decimal = Field(Decimal("8"), gt=0, le=24, decimal_places=2)
    labor_rate_per_hour: Money = Decimal("0")
    overhead_rate_per_hour: Money = Decimal("0")
    active: bool = True


class WorkCenterUpdate(BaseModel):
    code: Optional[ReqStr(30)] = None
    name: Optional[ReqStr(150)] = None
    description: OptStr(2000) = None
    branch_code: OptStr(200) = None
    capacity: Optional[int] = Field(None, ge=1, le=1000)
    efficiency_pct: Optional[Decimal] = Field(None, ge=1, le=300, decimal_places=2)
    working_hours_per_day: Optional[Decimal] = Field(None, gt=0, le=24, decimal_places=2)
    labor_rate_per_hour: Optional[Money] = None
    overhead_rate_per_hour: Optional[Money] = None
    active: Optional[bool] = None


class WorkCenterOut(_Out):
    id: int
    code: str
    name: str
    description: Optional[str] = None
    branch_code: Optional[str] = None
    capacity: int
    efficiency_pct: Decimal
    working_hours_per_day: Decimal
    labor_rate_per_hour: Decimal
    overhead_rate_per_hour: Decimal
    active: bool
    # Open load: planned minutes not yet booked on released / in-progress orders
    open_load_minutes: Decimal = Decimal("0")
    open_operations: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ═══════════════════════════ BOMs ═══════════════════════════
class BOMItemIn(BaseModel):
    sequence: int = Field(10, ge=0, le=100000)
    product_id: Id
    quantity: Decimal = Field(..., gt=0, le=Decimal("1000000"), decimal_places=4)
    scrap_pct: Decimal = Field(Decimal("0"), ge=0, lt=100, decimal_places=2)
    issue_method: IssueMethod = "manual"
    remark: OptStr(255) = None


class BOMOperationIn(BaseModel):
    sequence: int = Field(10, ge=0, le=100000)
    name: ReqStr(150)
    work_center_id: Id
    setup_minutes: Minutes = Decimal("0")
    run_minutes: Minutes = Decimal("0")
    description: OptStr(2000) = None


class BOMIn(BaseModel):
    product_id: Id
    version: ReqStr(20) = "1"
    output_quantity: Decimal = Field(Decimal("1"), gt=0, le=Decimal("1000000"), decimal_places=4)
    description: OptStr(2000) = None
    items: List[BOMItemIn] = Field(..., min_length=1, max_length=500)
    operations: List[BOMOperationIn] = Field(default_factory=list, max_length=200)


class BOMUpdate(BaseModel):
    version: Optional[ReqStr(20)] = None
    output_quantity: Optional[Decimal] = Field(None, gt=0, le=Decimal("1000000"), decimal_places=4)
    description: OptStr(2000) = None
    # When given, these replace the BOM's lines
    items: Optional[List[BOMItemIn]] = Field(None, min_length=1, max_length=500)
    operations: Optional[List[BOMOperationIn]] = Field(None, max_length=200)


class BOMItemOut(_Out):
    id: int
    sequence: int
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    unit_of_measure: Optional[str] = None
    quantity: Decimal
    scrap_pct: Decimal
    issue_method: str
    remark: Optional[str] = None
    unit_cost: Decimal = Decimal("0")
    line_cost: Decimal = Decimal("0")
    is_manufactured: bool = False  # the component has an active BOM of its own


class BOMOperationOut(_Out):
    id: int
    sequence: int
    name: str
    work_center_id: int
    work_center_code: Optional[str] = None
    work_center_name: Optional[str] = None
    setup_minutes: Decimal
    run_minutes: Decimal
    description: Optional[str] = None
    labor_cost: Decimal = Decimal("0")
    overhead_cost: Decimal = Decimal("0")


class BOMOut(_Out):
    id: int
    bom_no: str
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    unit_of_measure: Optional[str] = None
    product_cost_price: Decimal = Decimal("0")
    version: str
    output_quantity: Decimal
    status: str
    is_default: bool
    description: Optional[str] = None
    item_count: int = 0
    operation_count: int = 0
    # Cost roll-up for output_quantity units
    material_cost: Decimal = Decimal("0")
    labor_cost: Decimal = Decimal("0")
    overhead_cost: Decimal = Decimal("0")
    total_cost: Decimal = Decimal("0")
    unit_cost: Decimal = Decimal("0")
    items: List[BOMItemOut] = []
    operations: List[BOMOperationOut] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class BOMCopyIn(BaseModel):
    version: ReqStr(20)


# ═══════════════════════════ production orders ═══════════════════════════
class ProductionOrderIn(BaseModel):
    product_id: Id
    bom_id: OptId = None  # the product's default active BOM when omitted
    branch_code: ReqStr(200)
    location_id: OptId = None
    planned_quantity: Qty
    planned_start_date: date
    planned_end_date: date
    priority: Priority = "normal"
    source_reference: OptStr(100) = None
    remark: OptStr(2000) = None

    @model_validator(mode="after")
    def _dates(self):
        if self.planned_end_date < self.planned_start_date:
            raise ValueError("Planned end date cannot be before the planned start date")
        return self


class ProductionOrderUpdate(BaseModel):
    bom_id: OptId = None
    location_id: OptId = None
    planned_quantity: Optional[Qty] = None
    planned_start_date: Optional[date] = None
    planned_end_date: Optional[date] = None
    priority: Optional[Priority] = None
    source_reference: OptStr(100) = None
    remark: OptStr(2000) = None


class OrderMaterialOut(_Out):
    id: int
    sequence: int
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    unit_of_measure: Optional[str] = None
    tracking_type: Optional[str] = None
    quantity_per_unit: Decimal
    scrap_pct: Decimal
    required_quantity: int
    issued_quantity: int
    remaining_quantity: int = 0
    issue_method: str
    unit_cost: Decimal
    available_quantity: int = 0  # free stock in the order's branch
    shortage_quantity: int = 0


class OrderOperationOut(_Out):
    id: int
    sequence: int
    name: str
    work_center_id: int
    work_center_code: Optional[str] = None
    work_center_name: Optional[str] = None
    planned_minutes: Decimal
    actual_minutes: Decimal
    completed_quantity: int
    status: str
    labor_rate_per_hour: Decimal
    overhead_rate_per_hour: Decimal
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class ProductionOrderOut(_Out):
    id: int
    order_no: str
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    unit_of_measure: Optional[str] = None
    tracking_type: Optional[str] = None
    bom_id: int
    bom_no: Optional[str] = None
    bom_version: Optional[str] = None
    branch_code: str
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    planned_quantity: int
    produced_quantity: int
    scrapped_quantity: int
    progress_pct: Decimal = Decimal("0")
    planned_start_date: date
    planned_end_date: date
    actual_start_at: Optional[datetime] = None
    actual_end_at: Optional[datetime] = None
    priority: str
    status: str
    is_late: bool = False
    source_reference: Optional[str] = None
    quote_item_id: Optional[int] = None
    quote_id: Optional[int] = None
    quote_no: Optional[str] = None
    customer_name: Optional[str] = None
    remark: Optional[str] = None
    cancel_reason: Optional[str] = None
    standard_unit_cost: Decimal
    planned_material_cost: Decimal
    planned_labor_cost: Decimal
    planned_overhead_cost: Decimal
    planned_total_cost: Decimal = Decimal("0")
    actual_material_cost: Decimal
    actual_labor_cost: Decimal
    actual_overhead_cost: Decimal
    actual_total_cost: Decimal = Decimal("0")
    output_value: Decimal
    wip_balance: Decimal = Decimal("0")
    variance_amount: Optional[Decimal] = None
    # ready | partial | shortage | issued (detail view only)
    material_status: Optional[str] = None
    released_at: Optional[datetime] = None
    released_by_name: Optional[str] = None
    closed_at: Optional[datetime] = None
    created_by_name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    materials: List[OrderMaterialOut] = []
    operations: List[OrderOperationOut] = []


class ProductionOrderPage(BaseModel):
    items: List[ProductionOrderOut]
    total: int
    page: int
    size: int
    pages: int


class CancelIn(BaseModel):
    reason: ReqStr(500)


class MaterialLineIn(BaseModel):
    material_id: Id
    quantity: Qty


class MaterialMoveIn(BaseModel):
    lines: List[MaterialLineIn] = Field(..., min_length=1, max_length=500)
    remark: OptStr(255) = None


class OutputIn(BaseModel):
    quantity: int = Field(0, ge=0, le=1_000_000)
    scrap_quantity: int = Field(0, ge=0, le=1_000_000)
    batch_no: OptStr(100) = None
    expiry_date: Optional[date] = None
    # Serial-tracked products: one per good unit; generated from the order number when omitted
    serial_numbers: Optional[List[ReqStr(100)]] = Field(None, max_length=10_000)
    location_id: OptId = None
    remark: OptStr(255) = None

    @model_validator(mode="after")
    def _something(self):
        if self.quantity == 0 and self.scrap_quantity == 0:
            raise ValueError("Enter a good or a scrap quantity")
        return self


class TimeLogIn(BaseModel):
    operation_id: Id
    employee_id: OptId = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    # Required unless both start and end time are given
    minutes: Optional[Decimal] = Field(None, gt=0, le=Decimal("100000"), decimal_places=2)
    completed_quantity: int = Field(0, ge=0, le=1_000_000)
    complete_operation: bool = False
    remark: OptStr(255) = None

    @model_validator(mode="after")
    def _time(self):
        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValueError("End time must be after the start time")
        if self.minutes is None and not (self.start_time and self.end_time):
            raise ValueError("Enter the minutes worked, or a start and end time")
        return self


class MaterialTransactionOut(_Out):
    id: int
    order_id: int
    material_id: int
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    transaction_type: str
    quantity: int
    unit_cost: Decimal
    total_cost: Decimal
    transaction_date: datetime
    remark: Optional[str] = None
    created_by_name: Optional[str] = None


class OutputOut(_Out):
    id: int
    order_id: int
    quantity: int
    scrap_quantity: int
    batch_no: Optional[str] = None
    expiry_date: Optional[date] = None
    unit_cost: Decimal
    total_value: Decimal
    location_id: Optional[int] = None
    location_name: Optional[str] = None
    receipt_date: datetime
    remark: Optional[str] = None
    serial_numbers: List[str] = []
    created_by_name: Optional[str] = None


class TimeLogOut(_Out):
    id: int
    order_id: int
    operation_id: int
    operation_name: Optional[str] = None
    work_center_name: Optional[str] = None
    employee_id: Optional[int] = None
    employee_name: Optional[str] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    minutes: Decimal
    completed_quantity: int
    labor_cost: Decimal
    overhead_cost: Decimal
    is_auto: bool
    remark: Optional[str] = None
    created_at: Optional[datetime] = None
    created_by_name: Optional[str] = None


class OrderActivityOut(BaseModel):
    materials: List[MaterialTransactionOut]
    outputs: List[OutputOut]
    time_logs: List[TimeLogOut]


# ═══════════════════════════ job cards / MRP / dashboard ═══════════════════════════
class JobCardOut(BaseModel):
    operation_id: int
    order_id: int
    order_no: str
    order_status: str
    priority: str
    branch_code: str
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    planned_quantity: int
    produced_quantity: int
    planned_start_date: date
    planned_end_date: date
    is_late: bool = False
    sequence: int
    name: str
    work_center_id: int
    work_center_code: Optional[str] = None
    work_center_name: Optional[str] = None
    planned_minutes: Decimal
    actual_minutes: Decimal
    completed_quantity: int
    status: str
    started_at: Optional[datetime] = None


class MrpDemandSource(BaseModel):
    # quotation | production_order | planned (dependent demand of a planned parent) | reorder
    source_type: str
    reference: str
    document_id: Optional[int] = None
    quantity: int
    need_date: Optional[date] = None


class MrpLineOut(BaseModel):
    product_id: int
    branch_code: str  # requirements are netted per branch
    product_name: str
    product_code: str
    unit_of_measure: Optional[str] = None
    is_manufactured: bool = False
    bom_id: Optional[int] = None  # the default active BOM a planned production order would use
    low_level_code: int = 0
    # gross requirements
    quote_demand: int = 0  # open quotation lines not yet ordered
    production_demand: int = 0  # components still to be issued to open production orders
    planned_demand: int = 0  # components of planned production of parent items
    total_demand: int = 0
    # supply
    on_hand_quantity: int = 0  # free stock
    on_order_quantity: int = 0  # open purchase orders not yet received
    in_production_quantity: int = 0  # open production orders not yet produced
    # reordering rule
    min_quantity: Optional[int] = None
    max_quantity: Optional[int] = None
    projected_quantity: int = 0  # supply - demand, before the suggestion
    suggested_quantity: int = 0  # planned order quantity (0 = covered)
    suggested_action: Optional[str] = None  # purchase | produce
    preferred_supplier_id: Optional[int] = None
    preferred_supplier_name: Optional[str] = None
    lead_time_days: int = 0
    unit_cost: Decimal = Decimal("0")
    suggested_value: Decimal = Decimal("0")
    need_by_date: Optional[date] = None
    order_by_date: Optional[date] = None  # need-by date less the lead time
    demand_sources: List[MrpDemandSource] = []


class MrpPurchaseLineIn(BaseModel):
    product_id: Id
    quantity: Qty
    supplier_id: Id
    unit_price: Optional[Decimal] = Field(None, gt=0, le=Decimal("999999999999"), decimal_places=2)


class MrpPurchaseIn(BaseModel):
    branch_code: ReqStr(200)
    expected_date: Optional[date] = None
    lines: List[MrpPurchaseLineIn] = Field(..., min_length=1, max_length=200)


class MrpProduceLineIn(BaseModel):
    product_id: Id
    quantity: Qty
    bom_id: OptId = None
    planned_start_date: date
    planned_end_date: date

    @model_validator(mode="after")
    def _dates(self):
        if self.planned_end_date < self.planned_start_date:
            raise ValueError("Planned end date cannot be before the planned start date")
        return self


class MrpProduceIn(BaseModel):
    branch_code: ReqStr(200)
    priority: Priority = "normal"
    lines: List[MrpProduceLineIn] = Field(..., min_length=1, max_length=200)


class MrpFirmResult(BaseModel):
    documents: List[dict]  # [{id, number, supplier / product, lines}]


class FromQuoteIn(BaseModel):
    quote_item_id: Id
    quantity: Optional[Qty] = None  # what is left to produce for the line when omitted
    bom_id: OptId = None
    location_id: OptId = None
    planned_start_date: Optional[date] = None
    planned_end_date: Optional[date] = None
    priority: Priority = "normal"
    remark: OptStr(2000) = None


class QuoteDemandOut(BaseModel):
    quote_item_id: int
    quote_id: int
    quote_no: str
    quote_status: str
    customer_name: Optional[str] = None
    branch_code: str
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    unit_of_measure: Optional[str] = None
    quantity: int
    ordered_quantity: int  # already on purchase orders / sales orders (converted)
    in_production_quantity: int  # on open production orders for the line
    remaining_quantity: int
    item_status: str
    expected_delivery_date: Optional[date] = None
    valid_until: Optional[date] = None
    has_bom: bool = False


class ReorderRuleIn(BaseModel):
    product_id: Id
    branch_code: ReqStr(200)
    min_quantity: int = Field(..., ge=0, le=10_000_000)
    max_quantity: Optional[int] = Field(None, ge=0, le=10_000_000)
    multiple_quantity: int = Field(1, ge=1, le=1_000_000)
    preferred_supplier_id: OptId = None
    active: bool = True

    @model_validator(mode="after")
    def _range(self):
        if self.max_quantity is not None and self.max_quantity < self.min_quantity:
            raise ValueError("Maximum quantity cannot be below the minimum")
        return self


class ReorderRuleUpdate(BaseModel):
    min_quantity: Optional[int] = Field(None, ge=0, le=10_000_000)
    max_quantity: Optional[int] = Field(None, ge=0, le=10_000_000)
    multiple_quantity: Optional[int] = Field(None, ge=1, le=1_000_000)
    preferred_supplier_id: OptId = None
    active: Optional[bool] = None


class ReorderRuleOut(BaseModel):
    id: int
    product_id: int
    product_name: Optional[str] = None
    product_code: Optional[str] = None
    unit_of_measure: Optional[str] = None
    is_manufactured: bool = False
    branch_code: str
    min_quantity: int
    max_quantity: Optional[int] = None
    multiple_quantity: int
    preferred_supplier_id: Optional[int] = None
    preferred_supplier_name: Optional[str] = None
    active: bool
    on_hand_quantity: int = 0
    below_minimum: bool = False
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class StatusCount(BaseModel):
    status: str
    count: int


class WorkCenterLoad(BaseModel):
    work_center_id: int
    code: str
    name: str
    open_load_minutes: Decimal
    capacity_minutes_per_day: Decimal
    load_days: Decimal
    open_operations: int


class MonthlyOutput(BaseModel):
    month: str  # YYYY-MM
    quantity: int
    value: Decimal
    scrap_quantity: int


class ManufacturingDashboardOut(BaseModel):
    status_counts: List[StatusCount]
    open_orders: int
    late_orders: int
    wip_value: Decimal
    output_this_month: int
    output_value_this_month: Decimal
    scrap_rate_pct: Decimal
    material_shortages: int
    active_boms: int
    active_work_centers: int
    variance_this_month: Decimal
    work_center_load: List[WorkCenterLoad]
    monthly_output: List[MonthlyOutput]
    upcoming_orders: List[ProductionOrderOut]
    late_order_list: List[ProductionOrderOut]
