from __future__ import annotations

from decimal import Decimal
from typing import Annotated, List, Optional

from pydantic import BaseModel, Field, StringConstraints

from app.common.base_schemas import FormattedDateTime, TijaeroBaseSchema, VersionedSchema
from app.modules.products.design_brief_schemas import DesignBriefStatus, _Id, _Notes, _Versioned

MAX_STEPS = 50
MAX_MATERIALS_PER_STEP = 100
_StepName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=150)]
_Short = Annotated[str, StringConstraints(strip_whitespace=True, max_length=150)]


class BomMaterialIn(BaseModel):
    material_id: _Id
    quantity: Decimal = Field(..., gt=0, le=Decimal("99999999"), decimal_places=4)
    scrap_pct: Decimal = Field(Decimal("0"), ge=0, lt=100, decimal_places=2)
    notes: Optional[_Notes] = None


class BomStepIn(BaseModel):
    name: _StepName
    work_area: Optional[_Short] = None
    # Run time per unit (minutes)
    minutes_per_unit: Optional[Decimal] = Field(None, ge=0, le=Decimal("99999999"), decimal_places=2)
    instructions: Optional[_Notes] = None
    # Routing
    work_center_id: Optional[_Id] = None
    setup_minutes: Optional[Decimal] = Field(None, ge=0, le=Decimal("99999999"), decimal_places=2)
    move_minutes: Optional[Decimal] = Field(None, ge=0, le=Decimal("99999999"), decimal_places=2)
    workers: Optional[int] = Field(None, ge=1, le=1000)
    outside_unit_cost: Optional[Decimal] = Field(None, ge=0, le=Decimal("999999999999"), decimal_places=2)
    materials: List[BomMaterialIn] = Field(default_factory=list, max_length=MAX_MATERIALS_PER_STEP)


class BomStructureSave(_Versioned):
    notes: Optional[_Notes] = None
    steps: List[BomStepIn] = Field(default_factory=list, max_length=MAX_STEPS)


class BomSubStructure(BaseModel):
    """Read-only BOM Structure of another product whose stock item is used as a material (multi-level)."""
    product_id: int
    product_code: str
    product_name: str
    status: DesignBriefStatus
    steps: List["BomStepOut"] = []


class BomMaterialOut(TijaeroBaseSchema):
    id: int
    material_id: int
    item_code: str
    item_name: str
    category_id: Optional[int] = None
    category_name: Optional[str] = None
    unit_of_measure: Optional[str] = None
    quantity: float
    scrap_pct: float
    notes: Optional[str] = None
    sort_order: int
    # Set when the item is another product's stock item and that product has its own structure.
    sub_structure: Optional[BomSubStructure] = None


class BomWorkCenter(BaseModel):
    """A Manufacturing work center as the routing needs it (current rates, for costing)."""
    id: int
    code: str
    name: str
    active: bool
    is_outside: bool
    capacity: int
    efficiency_pct: float
    working_hours_per_day: float
    labor_rate_per_hour: float
    overhead_rate_per_hour: float


class BomStepOut(TijaeroBaseSchema):
    id: int
    sort_order: int
    name: str
    work_area: Optional[str] = None
    minutes_per_unit: Optional[float] = None
    instructions: Optional[str] = None
    work_center_id: Optional[int] = None
    work_center: Optional[BomWorkCenter] = None
    setup_minutes: Optional[float] = None
    move_minutes: Optional[float] = None
    workers: Optional[int] = None
    outside_unit_cost: Optional[float] = None
    materials: List[BomMaterialOut] = []


class BomStructureOut(TijaeroBaseSchema, VersionedSchema):
    id: int
    product_id: int
    status: DesignBriefStatus
    notes: Optional[str] = None
    steps: List[BomStepOut] = []
    confirmed_by_name: Optional[str] = None
    confirmed_at: Optional[FormattedDateTime] = None
    rejected_by_name: Optional[str] = None
    rejected_at: Optional[FormattedDateTime] = None
    reject_reason: Optional[str] = None
    created_by_name: Optional[str] = None
    updated_by_name: Optional[str] = None
    created_at: Optional[FormattedDateTime] = None
    updated_at: Optional[FormattedDateTime] = None


BomSubStructure.model_rebuild()


class BomStructureListRow(TijaeroBaseSchema):
    """One row of the BOM Structures list (a product's structure with its counts)."""
    id: int
    product_id: int
    product_code: str
    product_name: str
    product_active: bool
    category_name: Optional[str] = None
    status: DesignBriefStatus
    step_count: int
    material_count: int
    total_minutes: Optional[float] = None
    created_by_name: Optional[str] = None
    created_at: Optional[FormattedDateTime] = None
    updated_by_name: Optional[str] = None
    updated_at: Optional[FormattedDateTime] = None
    confirmed_by_name: Optional[str] = None
    confirmed_at: Optional[FormattedDateTime] = None


class BomStatusCounts(BaseModel):
    all: int = 0
    draft: int = 0
    confirmed: int = 0
    rejected: int = 0


class BomStructurePage(BaseModel):
    items: List[BomStructureListRow]
    total: int
    page: int
    size: int
    pages: int
    # Per status for the current search (ignores the status filter), for the filter's counts.
    counts: BomStatusCounts
