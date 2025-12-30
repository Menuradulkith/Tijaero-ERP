from pydantic import BaseModel
from datetime import date, datetime
from typing import Optional, List

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

class ItemTransferNote(ItemTransferNoteBase):
    id: int
    added_date: datetime
    approval_id: Optional[int] = None
    
    class Config:
        from_attributes = True

# Item Transfer Note Items Schemas
class ItemTransferNoteItemBase(BaseModel):
    product_id: int
    barcode: Optional[str] = None
    branch_code: str
    remark: Optional[str] = None
    item_recieved: bool = False

class ItemTransferNoteItemCreate(ItemTransferNoteItemBase):
    itemtransfernote_id: int

class ItemTransferNoteItem(ItemTransferNoteItemBase):
    id: int
    itemtransfernote_id: int
    created_date: datetime
    
    class Config:
        from_attributes = True

# Item Transfer Note Approved Schemas
class ItemTransferNoteApprovedBase(BaseModel):
    item_transfer_note_id: int
    approved_status: int = 0
    approval_note: Optional[str] = None

class ItemTransferNoteApprovedCreate(ItemTransferNoteApprovedBase):
    approved_user_id: Optional[int] = None

class ItemTransferNoteApproved(ItemTransferNoteApprovedBase):
    id: int
    approved_user_id: Optional[int] = None
    approved_date: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# Item Receive Note Schemas
class ItemReceiveNoteBase(BaseModel):
    item_transfer_note_id: int
    received_approval_status: int = 0
    received_note: Optional[str] = None

class ItemReceiveNoteCreate(ItemReceiveNoteBase):
    recieved_user: Optional[int] = None

class ItemReceiveNote(ItemReceiveNoteBase):
    id: int
    recieved_user: Optional[int] = None
    recieved_date: Optional[datetime] = None
    
    class Config:
        from_attributes = True

# Item Transfer Note with Items
class ItemTransferNoteWithItems(ItemTransferNote):
    items: List[ItemTransferNoteItem] = []

# Filter Schemas
class WarehouseListFilter(BaseModel):
    branch_code: Optional[str] = None
    from_location_id: Optional[int] = None
    to_location_id: Optional[int] = None
    date_from: Optional[date] = None
    date_to: Optional[date] = None
    approved_status: Optional[int] = None
    skip: int = 0
    limit: int = 100
