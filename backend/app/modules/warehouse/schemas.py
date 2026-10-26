from pydantic import BaseModel, Field, field_validator
from datetime import date, datetime
from typing import Optional, List

from app.common.base_schemas import TijaeroBaseSchema
from app.common.enums import DocumentStatus

# Item Transfer Note Schemas
class ItemTransferNoteBase(BaseModel):
    item_transfer_note: Optional[str] = None  # Auto-generated on server
    remark: Optional[str] = None
    created_date: date
    from_location_id: int
    to_location_id: int
    branch_code: str

class ItemTransferNoteCreate(ItemTransferNoteBase):
    approval_id: Optional[int] = None
    status: Optional[str] = "pending"
    sales_quote_id: Optional[int] = None

    # Input rules live on the create schema only, so old rows still serialise in responses.
    @field_validator("created_date")
    @classmethod
    def _date_within_a_year(cls, v: date) -> date:
        today = date.today()
        if v < date(today.year - 1, today.month, 1) or v > date(today.year + 1, today.month, 1):
            raise ValueError("Transfer date must be within a year of today")
        return v

    @field_validator("remark")
    @classmethod
    def _remark_length(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 2000:
            raise ValueError("Remark must be at most 2000 characters")
        return v

    @field_validator("from_location_id", "to_location_id")
    @classmethod
    def _location_id_range(cls, v: int) -> int:
        if v < 1 or v > 2_147_483_647:
            raise ValueError("Location id is out of range")
        return v

class ItemTransferNote(ItemTransferNoteBase, TijaeroBaseSchema):
    id: int
    added_date: datetime
    approval_id: Optional[int] = None
    status: str = DocumentStatus.PENDING
    from_location_name: Optional[str] = None
    to_location_name: Optional[str] = None
    sales_quote_id: Optional[int] = None
    total_units: int = 0  # units across all lines (lots count by quantity)
    created_by_name: Optional[str] = None

# Item Transfer Note Items Schemas
class ItemTransferNoteItemBase(BaseModel):
    product_id: int
    barcode: Optional[str] = None
    quantity: int = Field(default=1, ge=1)  # units (lots); 1 for barcode items
    branch_code: str
    remark: Optional[str] = None
    item_recieved: bool = False

class ItemTransferNoteItemCreate(ItemTransferNoteItemBase):
    itemtransfernote_id: int

class ItemTransferNoteItem(ItemTransferNoteItemBase, TijaeroBaseSchema):
    id: int
    itemtransfernote_id: int
    created_date: datetime
    product_name: Optional[str] = None
    sales_stock_id: Optional[int] = None  # set once a lot line is allocated at approval
    batch_no: Optional[str] = None  # of the allocated lot (batch-tracked products)
    expiry_date: Optional[date] = None

# Item Transfer Note Approved Schemas
class ItemTransferNoteApprovedBase(BaseModel):
    item_transfer_note_id: int
    approved_status: int = 0
    approval_note: Optional[str] = None

class ItemTransferNoteApprovedCreate(ItemTransferNoteApprovedBase):
    approved_user_id: Optional[int] = None

class ItemTransferNoteApproved(ItemTransferNoteApprovedBase, TijaeroBaseSchema):
    id: int
    approved_user_id: Optional[int] = None
    approved_date: Optional[datetime] = None

# Item Receive Note Schemas
class ItemReceiveNoteBase(BaseModel):
    item_transfer_note_id: int
    received_approval_status: int = 0
    received_note: Optional[str] = None

class ItemReceiveNoteCreate(ItemReceiveNoteBase):
    recieved_user: Optional[int] = None

class ItemReceiveNote(ItemReceiveNoteBase, TijaeroBaseSchema):
    id: int
    recieved_user: Optional[int] = None
    recieved_date: Optional[datetime] = None
    item_transfer_note_no: Optional[str] = None
    from_location_name: Optional[str] = None
    to_location_name: Optional[str] = None
    total_units: int = 0  # units on the transfer note
    received_units: int = 0  # of those, units already received
    received_by_name: Optional[str] = None

# Item Transfer Note with Items
class ItemTransferNoteWithItems(ItemTransferNote):
    items: List[ItemTransferNoteItem] = []

# Filter Schemas
class WarehouseListFilter(BaseModel):
    branch_code: Optional[str] = None
    branch_codes: Optional[List[str]] = None  # For multi-branch access control
    from_location_id: Optional[int] = None
    to_location_id: Optional[int] = None
    to_location_branch: Optional[str] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    approved_status: Optional[int] = None
    skip: int = 0
    limit: int = 100


# Barcode Validation Schemas
class BarcodeValidationRequest(BaseModel):
    barcode: str
    from_location_id: int
    branch_code: Optional[str] = None

class BarcodeValidationResponse(BaseModel):
    valid: bool
    barcode: str
    message: str
    sales_stock_id: Optional[int] = None
    product_id: Optional[int] = None
    product_name: Optional[str] = None
    current_location_id: Optional[int] = None
    current_location_name: Optional[str] = None
    current_status: Optional[str] = None
    cost_price: Optional[float] = None


class LotValidationRequest(BaseModel):
    product_id: int
    quantity: int = Field(..., ge=1)
    from_location_id: int


class LotValidationResponse(BaseModel):
    valid: bool
    message: str
    product_id: int
    product_name: Optional[str] = None
    available_quantity: int = 0


# Receive Items Schemas
class ReceiveLine(BaseModel):
    """What the receiver found on one received line: units that arrived damaged and a line note.
    Identify the line by `barcode` (serial unit) or `item_id` (batch / non-serial line)."""
    barcode: Optional[str] = Field(default=None, max_length=255)
    item_id: Optional[int] = Field(default=None, ge=1)
    damaged_quantity: int = Field(default=0, ge=0, le=1_000_000)  # at most the line's received quantity
    note: Optional[str] = Field(default=None, max_length=355)


class ReceiveItemsRequest(BaseModel):
    barcodes: List[str] = []
    item_ids: List[int] = []  # lot lines (no barcode) are received whole, by item id
    lines: List[ReceiveLine] = []  # damage / notes for lines being received now
    received_note: Optional[str] = None
    received_user_id: Optional[int] = None

class ReceivedItemResult(BaseModel):
    barcode: Optional[str] = None
    item_id: Optional[int] = None
    success: bool
    message: str
    product_name: Optional[str] = None

class ReceiveItemsResponse(BaseModel):
    transfer_note_id: int
    total_items: int
    received_items: int
    pending_items: int
    results: List[ReceivedItemResult]
    all_received: bool


# Transfer Note Status Response
class TransferNoteStatusResponse(BaseModel):
    transfer_note_id: int
    transfer_note_number: str
    status: str
    total_items: int
    received_items: int
    pending_items: int
    from_location_name: Optional[str] = None
    to_location_name: Optional[str] = None
    created_date: date
    approval_status: Optional[int] = None
    can_dispatch: bool
    can_receive: bool
