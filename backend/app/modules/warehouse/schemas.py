from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional, List

from app.common.base_schemas import TijaeroBaseSchema
from app.common.enums import DocumentStatus

# Item Transfer Note Schemas
class ItemTransferNoteBase(BaseModel):
    item_transfer_note: str
    remark: Optional[str] = None
    created_date: date
    from_location_id: int
    to_location_id: int
    branch_code: str

class ItemTransferNoteCreate(ItemTransferNoteBase):
    approval_id: Optional[int] = None
    status: Optional[str] = "pending"

class ItemTransferNote(ItemTransferNoteBase, TijaeroBaseSchema):
    id: int
    added_date: datetime
    approval_id: Optional[int] = None
    status: str = DocumentStatus.PENDING
    from_location_name: Optional[str] = None
    to_location_name: Optional[str] = None

# Item Transfer Note Items Schemas
class ItemTransferNoteItemBase(BaseModel):
    product_id: int
    barcode: Optional[str] = None
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


# Receive Items Schemas
class ReceiveItemsRequest(BaseModel):
    barcodes: List[str]
    received_note: Optional[str] = None
    received_user_id: Optional[int] = None

class ReceivedItemResult(BaseModel):
    barcode: str
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
