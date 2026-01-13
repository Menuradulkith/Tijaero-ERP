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
    TransferNoteStatus,
)
from app.modules.inventory.models import SalesStock
from app.modules.common.models import Locations

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
    
    def validate_barcode_for_transfer(
        self, request: schemas.BarcodeValidationRequest
    ) -> schemas.BarcodeValidationResponse:
        """Validate barcode for transfer - check existence, status, and location"""
        # Find the stock item by barcode
        stock_item = self.db.query(SalesStock).filter(
            SalesStock.barcode == request.barcode,
            SalesStock.is_active == True
        ).first()
        
        if not stock_item:
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=request.barcode,
                message="Barcode not found in inventory"
            )
        
        # Check status - must be available
        if stock_item.status != "available":
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=request.barcode,
                message=f"Item is not available (current status: {stock_item.status})",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                current_status=stock_item.status
            )
        
        # Check location if location_id is set on stock
        if stock_item.location_id and stock_item.location_id != request.from_location_id:
            location = self.db.query(Locations).filter(
                Locations.id == stock_item.location_id
            ).first()
            return schemas.BarcodeValidationResponse(
                valid=False,
                barcode=request.barcode,
                message=f"Item is in a different location: {location.name if location else 'Unknown'}",
                sales_stock_id=stock_item.id,
                product_id=stock_item.product_id,
                current_location_id=stock_item.location_id,
                current_location_name=location.name if location else None,
                current_status=stock_item.status
            )
        
        # Get product name and cost price
        product_name = stock_item.product.name if stock_item.product else None
        cost_price = stock_item.product.cost_price if stock_item.product else None
        
        return schemas.BarcodeValidationResponse(
            valid=True,
            barcode=request.barcode,
            message="Valid - item can be transferred",
            sales_stock_id=stock_item.id,
            product_id=stock_item.product_id,
            product_name=product_name,
            current_location_id=stock_item.location_id,
            current_status=stock_item.status,
            cost_price=cost_price
        )
    
    def dispatch_transfer_note(self, transfer_note_id: int) -> ItemTransferNote:
        """Dispatch transfer note and mark items as in_transit"""
        db_transfer_note = self.get_transfer_note(transfer_note_id)
        
        # Check if already dispatched
        if db_transfer_note.status in [TransferNoteStatus.DISPATCHED, TransferNoteStatus.IN_TRANSIT]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfer note has already been dispatched"
            )
        
        # Get all items for this transfer note
        items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note_id
        ).all()
        
        # Update stock status for each item
        for item in items:
            if item.barcode:
                stock_item = self.db.query(SalesStock).filter(
                    SalesStock.barcode == item.barcode
                ).first()
                if stock_item:
                    stock_item.status = "in_transit"
        
        # Update transfer note status
        db_transfer_note.status = TransferNoteStatus.DISPATCHED
        
        self.db.commit()
        self.db.refresh(db_transfer_note)
        return db_transfer_note
    
    def get_transfer_status(self, transfer_note_id: int) -> schemas.TransferNoteStatusResponse:
        """Get detailed transfer note status"""
        db_transfer_note = self.get_transfer_note(transfer_note_id)
        
        # Get items count
        items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note_id
        ).all()
        
        total_items = len(items)
        received_items = len([i for i in items if i.item_recieved])
        pending_items = total_items - received_items
        
        # Get location names
        from_location = self.db.query(Locations).filter(
            Locations.id == db_transfer_note.from_location_id
        ).first()
        to_location = self.db.query(Locations).filter(
            Locations.id == db_transfer_note.to_location_id
        ).first()
        
        # Get approval status
        approval = self.db.query(ItemTransferNoteApproved).filter(
            ItemTransferNoteApproved.item_transfer_note_id == transfer_note_id
        ).first()
        
        # Determine what actions are available
        can_dispatch = (
            db_transfer_note.status == TransferNoteStatus.APPROVED or
            (approval and approval.approved_status == 1 and 
             db_transfer_note.status == TransferNoteStatus.PENDING)
        )
        can_receive = db_transfer_note.status in [
            TransferNoteStatus.DISPATCHED, 
            TransferNoteStatus.IN_TRANSIT,
            TransferNoteStatus.PARTIALLY_RECEIVED
        ]
        
        return schemas.TransferNoteStatusResponse(
            transfer_note_id=transfer_note_id,
            transfer_note_number=db_transfer_note.item_transfer_note,
            status=db_transfer_note.status,
            total_items=total_items,
            received_items=received_items,
            pending_items=pending_items,
            from_location_name=from_location.name if from_location else None,
            to_location_name=to_location.name if to_location else None,
            created_date=db_transfer_note.created_date,
            approval_status=approval.approved_status if approval else None,
            can_dispatch=can_dispatch,
            can_receive=can_receive
        )

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
        old_status = db_approval.approved_status
        
        for key, value in approval.model_dump().items():
            setattr(db_approval, key, value)
        db_approval.approved_date = datetime.now()
        
        # If approval status changed to approved (1), update transfer note and stock
        if approval.approved_status == 1 and old_status != 1:
            # Get transfer note
            transfer_note = self.db.query(ItemTransferNote).filter(
                ItemTransferNote.id == approval.item_transfer_note_id
            ).first()
            
            if transfer_note:
                transfer_note.status = TransferNoteStatus.APPROVED
                
                # Get all items and mark stock as transfer_pending
                items = self.db.query(ItemTransferNoteItems).filter(
                    ItemTransferNoteItems.itemtransfernote_id == transfer_note.id
                ).all()
                
                for item in items:
                    if item.barcode:
                        stock_item = self.db.query(SalesStock).filter(
                            SalesStock.barcode == item.barcode
                        ).first()
                        if stock_item:
                            stock_item.status = "transfer_pending"
        
        # If rejected (2), update transfer note status
        elif approval.approved_status == 2:
            transfer_note = self.db.query(ItemTransferNote).filter(
                ItemTransferNote.id == approval.item_transfer_note_id
            ).first()
            if transfer_note:
                transfer_note.status = TransferNoteStatus.REJECTED
        
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
    
    def receive_items(
        self, transfer_note_id: int, request: schemas.ReceiveItemsRequest
    ) -> schemas.ReceiveItemsResponse:
        """
        Receive items from a transfer note:
        - Validates barcodes are in this transfer note
        - Marks items as received
        - Updates sales_stock location and status
        """
        # Get the transfer note
        transfer_note = self.db.query(ItemTransferNote).filter(
            ItemTransferNote.id == transfer_note_id
        ).first()
        
        if not transfer_note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transfer note not found"
            )
        
        # Get all items for this transfer note
        transfer_items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note_id
        ).all()
        
        # Create a map of barcodes to items
        barcode_to_item = {item.barcode: item for item in transfer_items if item.barcode}
        
        results = []
        received_count = 0
        
        for barcode in request.barcodes:
            # Check if barcode is in this transfer note
            if barcode not in barcode_to_item:
                results.append(schemas.ReceivedItemResult(
                    barcode=barcode,
                    success=False,
                    message="Barcode not found in this transfer note"
                ))
                continue
            
            transfer_item = barcode_to_item[barcode]
            
            # Check if already received
            if transfer_item.item_recieved:
                results.append(schemas.ReceivedItemResult(
                    barcode=barcode,
                    success=False,
                    message="Item already received"
                ))
                continue
            
            # Mark as received
            transfer_item.item_recieved = True
            
            # Update sales_stock
            stock_item = self.db.query(SalesStock).filter(
                SalesStock.barcode == barcode
            ).first()
            
            product_name = None
            if stock_item:
                # Update location to destination
                stock_item.location_id = transfer_note.to_location_id
                # Update status back to available
                stock_item.status = "available"
                product_name = stock_item.product.name if stock_item.product else None
            
            results.append(schemas.ReceivedItemResult(
                barcode=barcode,
                success=True,
                message="Item received successfully",
                product_name=product_name
            ))
            received_count += 1
        
        # Update transfer note status based on received count
        total_items = len(transfer_items)
        already_received = len([i for i in transfer_items if i.item_recieved])
        
        if already_received == total_items:
            transfer_note.status = TransferNoteStatus.RECEIVED
        elif already_received > 0:
            transfer_note.status = TransferNoteStatus.PARTIALLY_RECEIVED
        
        # Create or update receive note
        existing_receive_note = self.get_by_transfer_note(transfer_note_id)
        if existing_receive_note:
            existing_receive_note.received_note = request.received_note
            existing_receive_note.recieved_user = request.received_user_id
            existing_receive_note.recieved_date = datetime.now()
            if already_received == total_items:
                existing_receive_note.received_approval_status = 1  # Complete
        else:
            new_receive_note = ItemReceiveNote(
                item_transfer_note_id=transfer_note_id,
                received_approval_status=1 if already_received == total_items else 0,
                received_note=request.received_note,
                recieved_user=request.received_user_id,
                recieved_date=datetime.now()
            )
            self.db.add(new_receive_note)
        
        self.db.commit()
        
        pending_items = total_items - already_received
        
        return schemas.ReceiveItemsResponse(
            transfer_note_id=transfer_note_id,
            total_items=total_items,
            received_items=already_received,
            pending_items=pending_items,
            results=results,
            all_received=(already_received == total_items)
        )
