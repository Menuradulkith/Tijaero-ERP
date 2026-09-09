from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from typing import List, Optional
from datetime import datetime
from app.core import timezone as tz
from . import schemas
from .models import (
    ItemTransferNote,
    ItemTransferNoteItems,
    ItemTransferNoteApproved,
    ItemReceiveNote,
    TransferNoteStatus,
)
from app.modules.inventory.models import SalesStock
from app.modules.common.models import Locations, Approvals
from app.modules.common.approval_service import approval_service, ApprovalType, ApprovalStatus
from app.common.enums import StockStatus

from sqlalchemy import text

# Item Transfer Note Service
class ItemTransferNoteService:
    def __init__(self, db: Session):
        self.db = db
    
    def _get_next_itn_number(self, branch_code: str = None) -> str:
        """Generate next ITN number: ITN-BranchCode-YYXXXXXX with advisory lock"""
        year_yy = str(tz.year())[-2:]
        
        # Extract branch code with default
        branch_code = branch_code or "HQ"
        
        prefix = f"ITN-{branch_code}-{year_yy}"
        self.db.execute(text("SELECT pg_advisory_xact_lock(hashtext(:prefix))"), {"prefix": prefix})
        last = (
            self.db.query(ItemTransferNote)
            .filter(ItemTransferNote.item_transfer_note.like(f"{prefix}%"))
            .order_by(ItemTransferNote.id.desc())
            .first()
        )
        if last:
            try:
                last_part = last.item_transfer_note.split("-")[-1]
                last_seq = int(last_part[2:])
                next_seq = last_seq + 1
            except (ValueError, IndexError):
                next_seq = 1
        else:
            next_seq = 1
        return f"{prefix}{next_seq:06d}"
    
    def create_transfer_note(
        self,
        transfer_note: schemas.ItemTransferNoteCreate,
        user_id: int = 0,
    ) -> ItemTransferNote:
        # ── Validate branch is active ──
        from app.common.branch_validation import validate_branch_is_active
        validate_branch_is_active(self.db, transfer_note.branch_code)

        transfer_data = transfer_note.model_dump(exclude={'status', 'approval_id'})
        # Server-side sequential ITN number generation
        branch_code = transfer_note.branch_code or "HQ"
        transfer_data['item_transfer_note'] = self._get_next_itn_number(branch_code)
        db_transfer_note = ItemTransferNote(
            **transfer_data,
            added_date=tz.now(),
            status=TransferNoteStatus.PENDING
        )
        self.db.add(db_transfer_note)
        self.db.flush()

        approval_record = approval_service.create_approval_request(
            db=self.db,
            approval_type=ApprovalType.ITEM_TRANSFER,
            reference_id=db_transfer_note.id,
            reference_no=db_transfer_note.item_transfer_note,
            branch_code=db_transfer_note.branch_code,
            requested_by=user_id,
            remarks=f"Item transfer pending approval - {db_transfer_note.item_transfer_note}",
            approval_group="warehouse_approvers",
        )
        db_transfer_note.approval_id = approval_record.id

        self.db.commit()
        self.db.refresh(db_transfer_note)
        return db_transfer_note
    
    def get_transfer_note(self, transfer_note_id: int) -> ItemTransferNote:
        from sqlalchemy.orm import joinedload
        transfer_note = self.db.query(ItemTransferNote).options(
            joinedload(ItemTransferNote.from_location),
            joinedload(ItemTransferNote.to_location)
        ).filter(
            ItemTransferNote.id == transfer_note_id
        ).first()
        if not transfer_note:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Transfer note not found"
            )
        
        # Populate location names
        if transfer_note.from_location:
            transfer_note.from_location_name = transfer_note.from_location.name
        if transfer_note.to_location:
            transfer_note.to_location_name = transfer_note.to_location.name
        
        return transfer_note
    
    def list_transfer_notes(self, filters: schemas.WarehouseListFilter) -> List[ItemTransferNote]:
        from sqlalchemy.orm import joinedload
        from sqlalchemy.orm import aliased
        query = self.db.query(ItemTransferNote).options(
            joinedload(ItemTransferNote.from_location),
            joinedload(ItemTransferNote.to_location)
        )
        
        if filters.branch_code:
            query = query.filter(ItemTransferNote.branch_code == filters.branch_code)
        elif filters.branch_codes:
            # Multi-branch filtering for branch-based access control
            query = query.filter(ItemTransferNote.branch_code.in_(filters.branch_codes))
        
        if filters.from_location_id:
            query = query.filter(ItemTransferNote.from_location_id == filters.from_location_id)
        
        if filters.to_location_id:
            query = query.filter(ItemTransferNote.to_location_id == filters.to_location_id)

        if filters.to_location_branch:
            to_loc_alias = aliased(Locations)
            query = query.join(to_loc_alias, ItemTransferNote.to_location).filter(
                to_loc_alias.branch_code == filters.to_location_branch
            )
        
        if filters.date_from:
            query = query.filter(ItemTransferNote.created_date >= filters.date_from)
        
        if filters.date_to:
            query = query.filter(ItemTransferNote.created_date <= filters.date_to)
        
        transfer_notes = query.offset(filters.skip).limit(filters.limit).all()
        
        # Populate location names for each transfer note
        for tn in transfer_notes:
            if tn.from_location:
                tn.from_location_name = tn.from_location.name
            if tn.to_location:
                tn.to_location_name = tn.to_location.name
        
        return transfer_notes
    
    def update_transfer_note(
        self, transfer_note_id: int, transfer_note: schemas.ItemTransferNoteCreate
    ) -> ItemTransferNote:
        db_transfer_note = self.get_transfer_note(transfer_note_id)
        
        # Only allow editing pending transfer notes (before approval)
        if db_transfer_note.status != TransferNoteStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot edit transfer note with status '{db_transfer_note.status}'. Only pending transfer notes can be edited."
            )
        
        for key, value in transfer_note.model_dump(exclude={'item_transfer_note', 'status', 'approval_id'}).items():
            setattr(db_transfer_note, key, value)
        self.db.commit()
        self.db.refresh(db_transfer_note)
        return db_transfer_note
    
    def delete_transfer_note(self, transfer_note_id: int):
        db_transfer_note = self.get_transfer_note(transfer_note_id)
        
        # Only allow deleting pending transfer notes (before approval)
        if db_transfer_note.status != TransferNoteStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot delete transfer note with status '{db_transfer_note.status}'. Only pending transfer notes can be deleted."
            )
        
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
        cost_price = None
        if stock_item.product:
            active_tiers = [t for t in stock_item.product.price_tiers if t.is_active] if hasattr(stock_item.product, "price_tiers") else []
            if active_tiers:
                latest_tier = max(active_tiers, key=lambda x: x.created_at or x.id)
                cost_price = latest_tier.cost_price
            else:
                cost_price = stock_item.product.cost_price
        
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

        if db_transfer_note.status != TransferNoteStatus.APPROVED:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Transfer note must be approved before dispatch"
            )

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
        
        # Update stock status for each item - mark in_transit and clear location
        for item in items:
            if item.barcode:
                # Lock the stock item row before updating
                stock_item = self.db.query(SalesStock).filter(
                    SalesStock.barcode == item.barcode
                ).with_for_update().first()
                if stock_item:
                    stock_item.status = "in_transit"
                    stock_item.location_id = None  # No longer at source location
        
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
        
        approval_status = None
        if db_transfer_note.approval_id:
            approval = self.db.query(Approvals).filter(
                Approvals.id == db_transfer_note.approval_id
            ).first()
            if approval:
                if approval.status == ApprovalStatus.APPROVED.value:
                    approval_status = 1
                elif approval.status == ApprovalStatus.REJECTED.value:
                    approval_status = 2
                else:
                    approval_status = 0
        
        # Determine what actions are available
        can_dispatch = (
            db_transfer_note.status == TransferNoteStatus.APPROVED
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
            approval_status=approval_status,
            can_dispatch=can_dispatch,
            can_receive=can_receive
        )

    def approve_transfer_note(self, transfer_note_id: int, user_id: int = 0, remarks: Optional[str] = None) -> ItemTransferNote:
        transfer_note = self.get_transfer_note(transfer_note_id)
        if transfer_note.status != TransferNoteStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Transfer note is not pending. Current status: {transfer_note.status}"
            )

        if transfer_note.approval_id:
            # Lock the approval record to prevent concurrent approval/rejection
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == transfer_note.approval_id
            ).with_for_update().first()
            if approval_record:
                if approval_record.status != ApprovalStatus.PENDING.value:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                approval_record.status = ApprovalStatus.APPROVED.value
                approval_record.status_changed_by = user_id
                approval_record.remark = remarks or f"Approved by user {user_id}"

        transfer_note.status = TransferNoteStatus.APPROVED

        items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note.id
        ).all()
        for item in items:
            if item.barcode:
                # Lock the stock item row before updating status
                stock_item = self.db.query(SalesStock).filter(
                    SalesStock.barcode == item.barcode
                ).with_for_update().first()
                if stock_item:
                    stock_item.status = "transfer_pending"

        self.db.commit()
        self.db.refresh(transfer_note)
        return transfer_note

    def reject_transfer_note(self, transfer_note_id: int, user_id: int = 0, remarks: Optional[str] = None) -> ItemTransferNote:
        transfer_note = self.get_transfer_note(transfer_note_id)
        if transfer_note.status != TransferNoteStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Transfer note is not pending. Current status: {transfer_note.status}"
            )

        if transfer_note.approval_id:
            # Lock the approval record to prevent concurrent approval/rejection
            approval_record = self.db.query(Approvals).filter(
                Approvals.id == transfer_note.approval_id
            ).with_for_update().first()
            if approval_record:
                if approval_record.status != ApprovalStatus.PENDING.value:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Approval record is already {approval_record.status}"
                    )
                approval_record.status = ApprovalStatus.REJECTED.value
                approval_record.status_changed_by = user_id
                approval_record.remark = remarks or f"Rejected by user {user_id}"

        transfer_note.status = TransferNoteStatus.REJECTED

        items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note.id
        ).all()
        for item in items:
            if item.barcode:
                # Lock the stock item row before updating status
                stock_item = self.db.query(SalesStock).filter(
                    SalesStock.barcode == item.barcode
                ).with_for_update().first()
                if stock_item and stock_item.status in ["transfer_pending", "in_transit"]:
                    stock_item.status = StockStatus.AVAILABLE
                    stock_item.is_active = True

        self.db.commit()
        self.db.refresh(transfer_note)
        return transfer_note

# Item Transfer Note Items Service
class ItemTransferNoteItemService:
    def __init__(self, db: Session):
        self.db = db
    
    def create_item(self, item: schemas.ItemTransferNoteItemCreate) -> ItemTransferNoteItems:
        db_item = ItemTransferNoteItems(
            **item.model_dump(),
            created_date=tz.now()
        )
        self.db.add(db_item)
        # Note: Stock status is NOT changed here. It only changes to "transfer_pending" 
        # when the ITN is approved (see approve_transfer_note method)
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
        from sqlalchemy.orm import joinedload
        items = self.db.query(ItemTransferNoteItems).options(
            joinedload(ItemTransferNoteItems.product)
        ).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note_id
        ).all()
        
        # Populate product_name from relationship
        for item in items:
            if item.product:
                item.product_name = item.product.name or item.product.item_code
        
        return items
    
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

        # Check if all items in the ITN are now received
        itn_id = db_item.itemtransfernote_id
        all_items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == itn_id
        ).all()
        if all_items and all(i.item_recieved for i in all_items):
            # Mark ITN status as received
            itn = self.db.query(ItemTransferNote).filter(ItemTransferNote.id == itn_id).first()
            if itn:
                itn.status = "received"
                # Update linked quote items to itn_created
                if itn.sales_quote_id:
                    try:
                        from app.modules.sales.quotation_models import SalesQuote, SalesQuoteItem
                        # Get product_ids in this ITN
                        product_ids = {i.product_id for i in all_items if i.product_id}
                        for qi in self.db.query(SalesQuoteItem).filter(
                            SalesQuoteItem.quote_id == itn.sales_quote_id,
                            SalesQuoteItem.product_id.in_(product_ids),
                            SalesQuoteItem.item_status == "procurement"
                        ).all():
                            qi.item_status = "itn_created"
                            qi.stock_status = "in_stock"
                    except Exception as e:
                        import logging
                        logging.getLogger(__name__).warning(f"Failed to update quote items on ITN completion: {e}")
                self.db.commit()

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
            approved_date=tz.now()
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
        # Lock the approval row to prevent concurrent approve/reject race
        db_approval = self.db.query(ItemTransferNoteApproved).filter(
            ItemTransferNoteApproved.id == approval_id
        ).with_for_update().first()
        if not db_approval:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Approval record not found"
            )
        old_status = db_approval.approved_status

        # Guard against re-processing an already-decided approval
        if old_status in (1, 2) and approval.approved_status == old_status:
            return db_approval  # Idempotent — already in this state
        
        for key, value in approval.model_dump().items():
            setattr(db_approval, key, value)
        db_approval.approved_date = tz.now()
        
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
                        # Lock the stock row to prevent concurrent status changes
                        stock_item = self.db.query(SalesStock).filter(
                            SalesStock.barcode == item.barcode
                        ).with_for_update().first()
                        if stock_item:
                            stock_item.status = "transfer_pending"
        
        # If rejected (2), update transfer note status and restore stock
        elif approval.approved_status == 2:
            transfer_note = self.db.query(ItemTransferNote).filter(
                ItemTransferNote.id == approval.item_transfer_note_id
            ).first()
            if transfer_note:
                transfer_note.status = TransferNoteStatus.REJECTED
                
                # Restore stock items to available (same as reject_transfer_note)
                items = self.db.query(ItemTransferNoteItems).filter(
                    ItemTransferNoteItems.itemtransfernote_id == transfer_note.id
                ).all()
                for item in items:
                    if item.barcode:
                        # Lock the stock row to prevent concurrent status changes
                        stock_item = self.db.query(SalesStock).filter(
                            SalesStock.barcode == item.barcode
                        ).with_for_update().first()
                        if stock_item and stock_item.status in ("transfer_pending", "in_transit"):
                            stock_item.status = StockStatus.AVAILABLE
                            stock_item.is_active = True
        
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
            recieved_date=tz.now()
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
        from sqlalchemy.orm import aliased
        query = self.db.query(ItemReceiveNote)
        
        if filters.to_location_branch:
            itn_alias = aliased(ItemTransferNote)
            to_loc_alias = aliased(Locations)
            query = query.join(itn_alias, ItemReceiveNote.item_transfer_note).join(
                to_loc_alias, itn_alias.to_location
            ).filter(to_loc_alias.branch_code == filters.to_location_branch)
        elif filters.branch_codes:
            # Multi-branch filtering for branch-based access control
            itn_alias = aliased(ItemTransferNote)
            to_loc_alias = aliased(Locations)
            query = query.join(itn_alias, ItemReceiveNote.item_transfer_note).join(
                to_loc_alias, itn_alias.to_location
            ).filter(to_loc_alias.branch_code.in_(filters.branch_codes))
        
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
        db_receive_note.recieved_date = tz.now()
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

        if transfer_note.status not in [
            TransferNoteStatus.APPROVED,
            TransferNoteStatus.DISPATCHED,
            TransferNoteStatus.IN_TRANSIT,
            TransferNoteStatus.PARTIALLY_RECEIVED,
        ]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot receive items for transfer note with status: {transfer_note.status}"
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
            
            # Lock and update sales_stock
            stock_item = self.db.query(SalesStock).filter(
                SalesStock.barcode == barcode
            ).with_for_update().first()
            
            product_name = None
            if stock_item:
                # Update location to destination
                stock_item.location_id = transfer_note.to_location_id
                # Update branch_code to destination branch
                to_location = self.db.query(Locations).filter(
                    Locations.id == transfer_note.to_location_id
                ).first()
                if to_location and to_location.branch_code:
                    stock_item.branch_code = to_location.branch_code
                # Update status back to available
                stock_item.status = StockStatus.AVAILABLE
                stock_item.is_active = True
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

        # ── When fully received, mark linked quotation items as itn_created ──
        if already_received == total_items and transfer_note.sales_quote_id:
            try:
                from app.modules.sales.quotation_service import sales_quote_service
                product_ids = list({i.product_id for i in transfer_items if i.product_id})
                if product_ids:
                    sales_quote_service.mark_quote_items_itn_created_by_product(
                        self.db, transfer_note.sales_quote_id, product_ids
                    )
            except Exception as e:
                import logging
                logging.getLogger(__name__).warning(f"Failed to mark quote items itn_created on ITN bulk-receive: {e}")
        # ─────────────────────────────────────────────────────────────────
        
        # Create or update receive note
        # received_approval_status: 0=pending, 1=complete, 2=partial
        if already_received == total_items:
            recv_status = 1  # Complete
        elif already_received > 0:
            recv_status = 2  # Partial
        else:
            recv_status = 0  # Pending

        existing_receive_note = self.get_by_transfer_note(transfer_note_id)
        if existing_receive_note:
            existing_receive_note.received_note = request.received_note
            existing_receive_note.recieved_user = request.received_user_id
            existing_receive_note.recieved_date = tz.now()
            existing_receive_note.received_approval_status = recv_status
        else:
            new_receive_note = ItemReceiveNote(
                item_transfer_note_id=transfer_note_id,
                received_approval_status=recv_status,
                received_note=request.received_note,
                recieved_user=request.received_user_id,
                recieved_date=tz.now()
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
