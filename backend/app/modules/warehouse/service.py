from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime
from . import schemas
from .models import (
    ItemTransferNote,
    ItemTransferNoteItems,
    ItemTransferNoteApproved,
    ItemReceiveNote,
)

# Item Transfer Note Service
class ItemTransferNoteService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_transfer_note(self, transfer_note: schemas.ItemTransferNoteCreate) -> ItemTransferNote:
        db_transfer_note = ItemTransferNote(
            **transfer_note.model_dump(),
            added_date=datetime.now()
        )
        self.db.add(db_transfer_note)
        self.db.commit()
        self.db.refresh(db_transfer_note)
        return db_transfer_note
    
    def get_transfer_note(self, transfer_note_id: int) -> ItemTransferNote:
        transfer_note = self.db.query(ItemTransferNote).filter(
            ItemTransferNote.id == transfer_note_id
        ).first()
        if not transfer_note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transfer note not found"
            )
        return transfer_note
    
    def list_transfer_notes(self, filters: schemas.WarehouseListFilter) -> List[ItemTransferNote]:
        query = self.db.query(ItemTransferNote)
        
        if filters.branch_code:
            query = query.filter(ItemTransferNote.branch_code == filters.branch_code)
        
        if filters.from_location_id:
            query = query.filter(ItemTransferNote.from_location_id == filters.from_location_id)
        
        if filters.to_location_id:
            query = query.filter(ItemTransferNote.to_location_id == filters.to_location_id)
        
        if filters.date_from:
            query = query.filter(ItemTransferNote.created_date >= filters.date_from)
        
        if filters.date_to:
            query = query.filter(ItemTransferNote.created_date <= filters.date_to)
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_transfer_note(
        self, transfer_note_id: int, transfer_note: schemas.ItemTransferNoteCreate
    ) -> ItemTransferNote:
        db_transfer_note = self.get_transfer_note(transfer_note_id)
        for key, value in transfer_note.model_dump().items():
            setattr(db_transfer_note, key, value)
        self.db.commit()
        self.db.refresh(db_transfer_note)
        return db_transfer_note
    
    def delete_transfer_note(self, transfer_note_id: int):
        db_transfer_note = self.get_transfer_note(transfer_note_id)
        self.db.delete(db_transfer_note)
        self.db.commit()

# Item Transfer Note Items Service
class ItemTransferNoteItemService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_item(self, item: schemas.ItemTransferNoteItemCreate) -> ItemTransferNoteItems:
        db_item = ItemTransferNoteItems(
            **item.model_dump(),
            created_date=datetime.now()
        )
        self.db.add(db_item)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item
    
    def get_item(self, item_id: int) -> ItemTransferNoteItems:
        item = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.id == item_id
        ).first()
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transfer note item not found"
            )
        return item
    
    def list_items_by_transfer_note(self, transfer_note_id: int) -> List[ItemTransferNoteItems]:
        return self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note_id
        ).all()
    
    def update_item(
        self, item_id: int, item: schemas.ItemTransferNoteItemCreate
    ) -> ItemTransferNoteItems:
        db_item = self.get_item(item_id)
        for key, value in item.model_dump().items():
            setattr(db_item, key, value)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item
    
    def delete_item(self, item_id: int):
        db_item = self.get_item(item_id)
        self.db.delete(db_item)
        self.db.commit()
    
    def mark_as_received(self, item_id: int) -> ItemTransferNoteItems:
        db_item = self.get_item(item_id)
        db_item.item_recieved = True
        self.db.commit()
        self.db.refresh(db_item)
        return db_item

# Item Transfer Note Approval Service
class ItemTransferNoteApprovalService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_approval(
        self, approval: schemas.ItemTransferNoteApprovedCreate
    ) -> ItemTransferNoteApproved:
        db_approval = ItemTransferNoteApproved(
            **approval.model_dump(),
            approved_date=datetime.now()
        )
        self.db.add(db_approval)
        self.db.commit()
        self.db.refresh(db_approval)
        return db_approval
    
    def get_approval(self, approval_id: int) -> ItemTransferNoteApproved:
        approval = self.db.query(ItemTransferNoteApproved).filter(
            ItemTransferNoteApproved.id == approval_id
        ).first()
        if not approval:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Approval record not found"
            )
        return approval
    
    def get_by_transfer_note(self, transfer_note_id: int) -> Optional[ItemTransferNoteApproved]:
        return self.db.query(ItemTransferNoteApproved).filter(
            ItemTransferNoteApproved.item_transfer_note_id == transfer_note_id
        ).first()
    
    def update_approval(
        self, approval_id: int, approval: schemas.ItemTransferNoteApprovedCreate
    ) -> ItemTransferNoteApproved:
        db_approval = self.get_approval(approval_id)
        for key, value in approval.model_dump().items():
            setattr(db_approval, key, value)
        db_approval.approved_date = datetime.now()
        self.db.commit()
        self.db.refresh(db_approval)
        return db_approval

# Item Receive Note Service
class ItemReceiveNoteService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_receive_note(
        self, receive_note: schemas.ItemReceiveNoteCreate
    ) -> ItemReceiveNote:
        db_receive_note = ItemReceiveNote(
            **receive_note.model_dump(),
            recieved_date=datetime.now()
        )
        self.db.add(db_receive_note)
        self.db.commit()
        self.db.refresh(db_receive_note)
        return db_receive_note
    
    def get_receive_note(self, receive_note_id: int) -> ItemReceiveNote:
        receive_note = self.db.query(ItemReceiveNote).filter(
            ItemReceiveNote.id == receive_note_id
        ).first()
        if not receive_note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Receive note not found"
            )
        return receive_note
    
    def get_by_transfer_note(self, transfer_note_id: int) -> Optional[ItemReceiveNote]:
        return self.db.query(ItemReceiveNote).filter(
            ItemReceiveNote.item_transfer_note_id == transfer_note_id
        ).first()
    
    def list_receive_notes(self, filters: schemas.WarehouseListFilter) -> List[ItemReceiveNote]:
        query = self.db.query(ItemReceiveNote)
        
        if filters.approved_status is not None:
            query = query.filter(
                ItemReceiveNote.received_approval_status == filters.approved_status
            )
        
        return query.offset(filters.skip).limit(filters.limit).all()
    
    def update_receive_note(
        self, receive_note_id: int, receive_note: schemas.ItemReceiveNoteCreate
    ) -> ItemReceiveNote:
        db_receive_note = self.get_receive_note(receive_note_id)
        for key, value in receive_note.model_dump().items():
            setattr(db_receive_note, key, value)
        db_receive_note.recieved_date = datetime.now()
        self.db.commit()
        self.db.refresh(db_receive_note)
        return db_receive_note
