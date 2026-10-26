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

def _item_stock(db, item):
    """The (locked) sales_stock row a transfer line refers to: by the lot row
    it was allocated to, or by barcode for serial units."""
    query = db.query(SalesStock)
    if item.sales_stock_id:
        query = query.filter(SalesStock.id == item.sales_stock_id)
    elif item.barcode:
        query = query.filter(SalesStock.barcode == item.barcode)
    else:
        return None
    return query.with_for_update().first()


def _product_tracking(db, product_id: int) -> str:
    from app.modules.products.models import Product

    return db.query(Product.tracking_type).filter(Product.id == product_id).scalar() or "serial"


def _reserve_lots(db, transfer_note, items) -> list:
    """Allocate every unallocated batch/none line of a transfer note to real
    stock at the source location, splitting lots so exactly the requested
    units are committed. A line that spans several lots is expanded into one
    line per lot. Returns the stock rows to move to transfer_pending."""
    from sqlalchemy import or_
    from app.modules.inventory.lots import FEFO_ORDER, take_units, units_in

    source = db.query(Locations).filter(Locations.id == transfer_note.from_location_id).first()
    pieces_all: list = []
    for item in list(items):
        if item.barcode or item.sales_stock_id:
            continue
        if _product_tracking(db, item.product_id) == "serial":
            continue  # product-only line of a serial product: no stock effect (as before)
        needed = item.quantity or 1
        rows = (
            db.query(SalesStock)
            .filter(
                SalesStock.product_id == item.product_id,
                SalesStock.branch_code == (source.branch_code if source and source.branch_code else item.branch_code),
                SalesStock.status == StockStatus.AVAILABLE,
                SalesStock.is_active == True,  # noqa: E712
                or_(SalesStock.location_id == transfer_note.from_location_id, SalesStock.location_id.is_(None)),
            )
            .order_by(*FEFO_ORDER)
            .with_for_update()
            .limit(needed)
            .all()
        )
        pieces = take_units(db, rows, needed)
        if units_in(pieces) < needed:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Only {units_in(pieces)} unit(s) of product ID {item.product_id} are available at the "
                    f"source location ({needed} requested). They may have been sold or committed elsewhere."
                ),
            )
        for piece in pieces:
            # Commit now, so a second line of the same product on this note cannot take the same units.
            piece.status = StockStatus.TRANSFER_PENDING
        db.flush()
        first = pieces[0]
        item.sales_stock_id = first.id
        item.quantity = first.quantity
        for extra in pieces[1:]:
            db.add(ItemTransferNoteItems(
                product_id=item.product_id,
                branch_code=item.branch_code,
                itemtransfernote_id=item.itemtransfernote_id,
                remark=item.remark,
                created_date=tz.now(),
                quantity=extra.quantity,
                sales_stock_id=extra.id,
                item_recieved=False,
            ))
        pieces_all.extend(pieces)
    db.flush()
    return pieces_all


def _apply_receipt(db, stock_item, transfer_note):
    """Move a received stock row to the destination location/branch."""
    stock_item.location_id = transfer_note.to_location_id
    to_location = db.query(Locations).filter(Locations.id == transfer_note.to_location_id).first()
    if to_location and to_location.branch_code:
        stock_item.branch_code = to_location.branch_code
    stock_item.status = StockStatus.AVAILABLE
    stock_item.is_active = True


def _note_unit_totals(db, note_ids):
    """{transfer note id: (total units, received units)}; lots count by quantity."""
    from sqlalchemy import case, func
    if not note_ids:
        return {}
    rows = (
        db.query(
            ItemTransferNoteItems.itemtransfernote_id,
            func.coalesce(func.sum(ItemTransferNoteItems.quantity), 0),
            func.coalesce(func.sum(case((ItemTransferNoteItems.item_recieved.is_(True), ItemTransferNoteItems.quantity), else_=0)), 0),
        )
        .filter(ItemTransferNoteItems.itemtransfernote_id.in_(list(note_ids)))
        .group_by(ItemTransferNoteItems.itemtransfernote_id)
        .all()
    )
    return {r[0]: (int(r[1]), int(r[2])) for r in rows}


def _user_names(db, user_ids):
    from app.auth.models import User
    ids = {i for i in user_ids if i}
    if not ids:
        return {}
    out = {}
    for u in db.query(User).filter(User.id.in_(list(ids))).all():
        out[u.id] = f"{u.first_name or ''} {u.last_name or ''}".strip() or u.username
    return out


# Item Transfer Note Service
class ItemTransferNoteService:
    def __init__(self, db: Session):
        self.db = db

    def _validate_header(self, transfer_note: schemas.ItemTransferNoteCreate) -> None:
        """Locations must exist, differ, and the source must belong to the note's branch (that is the stock
        the note draws on); the page's pickers enforce this, so the API must too."""
        if transfer_note.from_location_id == transfer_note.to_location_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The source and destination locations must be different.",
            )
        locations = {
            loc.id: loc
            for loc in self.db.query(Locations).filter(
                Locations.id.in_([transfer_note.from_location_id, transfer_note.to_location_id])
            ).all()
        }
        source, destination = locations.get(transfer_note.from_location_id), locations.get(transfer_note.to_location_id)
        if source is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Source location not found.")
        if destination is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Destination location not found.")
        if source.branch_code and source.branch_code != transfer_note.branch_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The source location belongs to branch {source.branch_code}, not {transfer_note.branch_code}.",
            )

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
        self._validate_header(transfer_note)

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
        
        transfer_notes = query.order_by(ItemTransferNote.id.desc()).offset(filters.skip).limit(filters.limit).all()
        
        # Populate location names for each transfer note
        for tn in transfer_notes:
            if tn.from_location:
                tn.from_location_name = tn.from_location.name
            if tn.to_location:
                tn.to_location_name = tn.to_location.name
        totals = _note_unit_totals(self.db, [tn.id for tn in transfer_notes])
        names = _user_names(self.db, [tn.created_by for tn in transfer_notes])
        for tn in transfer_notes:
            tn.total_units = totals.get(tn.id, (0, 0))[0]
            tn.created_by_name = names.get(tn.created_by)
        
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
        self._validate_header(transfer_note)

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
    
    def validate_lot_for_transfer(self, request: schemas.LotValidationRequest) -> schemas.LotValidationResponse:
        """Check that `quantity` units of a batch/none product are available at the source location."""
        from sqlalchemy import func, or_
        from app.modules.products.models import Product

        product = self.db.query(Product).filter(Product.id == request.product_id).first()
        source = self.db.query(Locations).filter(Locations.id == request.from_location_id).first()

        def reply(valid, message, available=0):
            return schemas.LotValidationResponse(
                valid=valid,
                message=message,
                product_id=request.product_id,
                product_name=product.name if product else None,
                available_quantity=available,
            )

        if not product:
            return reply(False, "Product not found")
        if (product.tracking_type or "serial") == "serial":
            return reply(False, "This product is serial-tracked; transfer it by barcode.")
        query = self.db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
            SalesStock.product_id == request.product_id,
            SalesStock.status == StockStatus.AVAILABLE,
            SalesStock.is_active == True,  # noqa: E712
            or_(SalesStock.location_id == request.from_location_id, SalesStock.location_id.is_(None)),
        )
        if source and source.branch_code:
            query = query.filter(SalesStock.branch_code == source.branch_code)
        available = int(query.scalar() or 0)
        if available < request.quantity:
            return reply(False, f"Only {available} unit(s) available at the source location.", available)
        return reply(True, "Valid - quantity can be transferred", available)

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
            if item.barcode or item.sales_stock_id:
                # Lock the stock item row before updating
                stock_item = _item_stock(self.db, item)
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
        # Lock the transfer note row itself so a concurrent approve/reject on
        # the same note can't both pass the pending-status check below — this
        # no longer depends on approval_id being populated.
        transfer_note = self.db.query(ItemTransferNote).filter(
            ItemTransferNote.id == transfer_note_id
        ).with_for_update().first()
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

        items = self.db.query(ItemTransferNoteItems).filter(
            ItemTransferNoteItems.itemtransfernote_id == transfer_note.id
        ).all()
        if not items:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This transfer note has no items; add at least one item before it can be approved.",
            )

        # Lock and validate every referenced stock item BEFORE flipping any
        # status, so a barcode that's no longer available (already sold, or
        # already committed to another transfer note) blocks the whole
        # approval instead of being silently overwritten to transfer_pending.
        locked_stock_items = []
        for item in items:
            if item.barcode or item.sales_stock_id:
                stock_item = _item_stock(self.db, item)
                if stock_item and stock_item.status != StockStatus.AVAILABLE:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"Item {item.barcode} is no longer available for transfer "
                            f"(current status: {stock_item.status}). It may have been sold "
                            f"or already committed to another transfer."
                        ),
                    )
                if stock_item:
                    locked_stock_items.append(stock_item)

        # Batch/none lines: allocate + split real stock now (fails the whole approval if short).
        locked_stock_items.extend(_reserve_lots(self.db, transfer_note, items))

        transfer_note.status = TransferNoteStatus.APPROVED

        for stock_item in locked_stock_items:
            stock_item.status = StockStatus.TRANSFER_PENDING

        self.db.commit()
        self.db.refresh(transfer_note)
        return transfer_note

    def reject_transfer_note(self, transfer_note_id: int, user_id: int = 0, remarks: Optional[str] = None) -> ItemTransferNote:
        transfer_note = self.get_transfer_note(transfer_note_id)
        # Lock the transfer note row itself so a concurrent approve/reject on
        # the same note can't both pass the pending-status check below — this
        # no longer depends on approval_id being populated.
        transfer_note = self.db.query(ItemTransferNote).filter(
            ItemTransferNote.id == transfer_note_id
        ).with_for_update().first()
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

        # Only a pending note can be rejected, and a pending note holds no stock: units are taken
        # (transfer_pending) when a note is approved. Touching the units here would free the ones
        # that another, approved note holds, so rejecting leaves stock alone.

        self.db.commit()
        self.db.refresh(transfer_note)
        return transfer_note

# Item Transfer Note Items Service
class ItemTransferNoteItemService:
    # A unit on a note in one of these states is spoken for; rejected / cancelled / received notes release it.
    _OPEN_NOTE_STATUSES = (
        TransferNoteStatus.PENDING,
        TransferNoteStatus.APPROVED,
        TransferNoteStatus.DISPATCHED,
        TransferNoteStatus.IN_TRANSIT,
        TransferNoteStatus.PARTIALLY_RECEIVED,
    )

    def __init__(self, db: Session):
        self.db = db

    def _editable_note(self, note_id: int) -> ItemTransferNote:
        note = self.db.query(ItemTransferNote).filter(ItemTransferNote.id == note_id).first()
        if not note:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Transfer note not found")
        if note.status != TransferNoteStatus.PENDING:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Items can only be changed on a pending transfer note (this one is '{note.status}').",
            )
        return note

    def _check_lot_quantity(self, note: ItemTransferNote, item: schemas.ItemTransferNoteItemCreate, exclude_item_id: Optional[int] = None) -> None:
        """A lot line cannot ask for more than the source location holds, counting the note's other lines of the same product."""
        from sqlalchemy import func, or_
        held = self.db.query(func.coalesce(func.sum(SalesStock.quantity), 0)).filter(
            SalesStock.product_id == item.product_id,
            SalesStock.branch_code == note.branch_code,
            SalesStock.status == StockStatus.AVAILABLE,
            SalesStock.is_active.is_(True),
            or_(SalesStock.location_id.is_(None), SalesStock.location_id == note.from_location_id),
        ).scalar() or 0
        others = self.db.query(func.coalesce(func.sum(ItemTransferNoteItems.quantity), 0)).filter(
            ItemTransferNoteItems.itemtransfernote_id == note.id,
            ItemTransferNoteItems.product_id == item.product_id,
        )
        if exclude_item_id is not None:
            others = others.filter(ItemTransferNoteItems.id != exclude_item_id)
        left = int(held) - int(others.scalar() or 0)
        if item.quantity > left:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Only {max(left, 0)} unit(s) left at the source location for this product.",
            )

    def _validate_line(self, note: ItemTransferNote, item: schemas.ItemTransferNoteItemCreate, exclude_item_id: Optional[int] = None) -> None:
        """What the scan box checks in the page, enforced for every caller: the unit exists, is the product
        named, is free, sits at the note's branch and source location, and is on no other open note."""
        tracking = _product_tracking(self.db, item.product_id)
        if tracking == "serial" and item.quantity != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Serial-tracked products are transferred one unit per barcode.",
            )
        if tracking != "serial" and item.barcode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcodes are not used for '{tracking}'-tracked products; enter a quantity.",
            )
        if item.branch_code != note.branch_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"The line's branch ({item.branch_code}) must be the transfer note's branch ({note.branch_code}).",
            )
        if not item.barcode:
            if tracking != "serial":
                self._check_lot_quantity(note, item, exclude_item_id)
            return
        unit = self.db.query(SalesStock).filter(SalesStock.barcode == item.barcode).first()
        if unit is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Barcode {item.barcode} not found in inventory.")
        if unit.product_id != item.product_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcode {item.barcode} belongs to a different product than the line.",
            )
        if unit.status != StockStatus.AVAILABLE or not unit.is_active:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcode {item.barcode} is not available for transfer (status: {unit.status}).",
            )
        if unit.branch_code != note.branch_code:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcode {item.barcode} is stocked at branch {unit.branch_code}, not {note.branch_code}.",
            )
        if unit.location_id is not None and unit.location_id != note.from_location_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcode {item.barcode} is not at this note's source location.",
            )
        clash = (
            self.db.query(ItemTransferNoteItems.id, ItemTransferNote.item_transfer_note)
            .join(ItemTransferNote, ItemTransferNote.id == ItemTransferNoteItems.itemtransfernote_id)
            .filter(
                ItemTransferNoteItems.barcode == item.barcode,
                ItemTransferNote.status.in_(self._OPEN_NOTE_STATUSES),
            )
        )
        if exclude_item_id is not None:
            clash = clash.filter(ItemTransferNoteItems.id != exclude_item_id)
        found = clash.first()
        if found:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcode {item.barcode} is already on transfer note {found[1]}.",
            )

    def create_item(self, item: schemas.ItemTransferNoteItemCreate) -> ItemTransferNoteItems:
        note = self._editable_note(item.itemtransfernote_id)
        self._validate_line(note, item)
        tracking = _product_tracking(self.db, item.product_id)
        if tracking == "serial" and item.quantity != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Serial-tracked products are transferred one unit per barcode.",
            )
        if tracking != "serial" and item.barcode:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Barcodes are not used for '{tracking}'-tracked products; enter a quantity.",
            )
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
        lot_ids = [i.sales_stock_id for i in items if i.sales_stock_id]
        lots = {
            l.id: l for l in (self.db.query(SalesStock).filter(SalesStock.id.in_(lot_ids)).all() if lot_ids else [])
        }
        for item in items:
            if item.product:
                item.product_name = item.product.name or item.product.item_code
            lot = lots.get(item.sales_stock_id)
            item.batch_no = lot.batch_no if lot else None
            item.expiry_date = lot.expiry_date if lot else None
        
        return items
    
    def update_item(
        self, item_id: int, item: schemas.ItemTransferNoteItemCreate
    ) -> ItemTransferNoteItems:
        db_item = self.get_item(item_id)
        self._editable_note(db_item.itemtransfernote_id)  # the line's current note must still be pending
        note = self._editable_note(item.itemtransfernote_id)
        self._validate_line(note, item, exclude_item_id=item_id)
        for key, value in item.model_dump().items():
            setattr(db_item, key, value)
        self.db.commit()
        self.db.refresh(db_item)
        return db_item

    def delete_item(self, item_id: int):
        db_item = self.get_item(item_id)
        self._editable_note(db_item.itemtransfernote_id)
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
                    if item.barcode or item.sales_stock_id:
                        # Lock the stock row to prevent concurrent status changes
                        stock_item = _item_stock(self.db, item)
                        if stock_item:
                            stock_item.status = "transfer_pending"

                for piece in _reserve_lots(self.db, transfer_note, items):
                    piece.status = "transfer_pending"
        
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
                    if item.barcode or item.sales_stock_id:
                        # Lock the stock row to prevent concurrent status changes
                        stock_item = _item_stock(self.db, item)
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
        
        notes = query.order_by(ItemReceiveNote.id.desc()).offset(filters.skip).limit(filters.limit).all()
        totals = _note_unit_totals(self.db, [n.item_transfer_note_id for n in notes])
        names = _user_names(self.db, [n.recieved_user for n in notes])
        for n in notes:
            n.total_units, n.received_units = totals.get(n.item_transfer_note_id, (0, 0))
            n.received_by_name = names.get(n.recieved_user)
            itn = n.item_transfer_note
            if itn is not None:
                n.from_location_name = itn.from_location.name if itn.from_location else None
                n.to_location_name = itn.to_location.name if itn.to_location else None
        return notes
    
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
        id_to_item = {i.id: i for i in transfer_items}

        # Damage / notes the receiver entered per line. They must belong to a line that is being received in
        # this request and cannot exceed what is received: a line cannot be more damaged than it is large.
        line_by_barcode = {}
        line_by_item = {}
        for line in request.lines:
            if line.barcode:
                if line.barcode not in request.barcodes or line.barcode not in barcode_to_item:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Damage / note given for {line.barcode}, which is not being received on this transfer note.",
                    )
                limit = 1  # one serial unit
                line_by_barcode[line.barcode] = line
                label = line.barcode
            elif line.item_id:
                lot_line = id_to_item.get(line.item_id)
                if line.item_id not in request.item_ids or lot_line is None or lot_line.barcode:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Damage / note given for line {line.item_id}, which is not being received on this transfer note.",
                    )
                limit = lot_line.quantity or 1
                line_by_item[line.item_id] = line
                label = f"line {line.item_id}"
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A receive line needs a barcode or an item id.")
            if line.damaged_quantity > limit:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Damaged quantity {line.damaged_quantity} for {label} is more than the {limit} received.",
                )

        results = []
        received_count = 0
        damaged_total = 0

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
            
            # Lock and check the unit first: only a unit that is on its way (approved / dispatched) can arrive.
            stock_item = self.db.query(SalesStock).filter(
                SalesStock.barcode == barcode
            ).with_for_update().first()
            if stock_item is not None and stock_item.status not in (StockStatus.TRANSFER_PENDING, StockStatus.IN_TRANSIT):
                results.append(schemas.ReceivedItemResult(
                    barcode=barcode,
                    success=False,
                    message=f"Unit is not in transit (status: {stock_item.status}) and cannot be received",
                ))
                continue

            # Mark as received
            transfer_item.item_recieved = True

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

            # What the receiver found: a damaged unit arrives but is not sellable; the line note is kept.
            line = line_by_barcode.get(barcode)
            damaged_here = bool(line and line.damaged_quantity > 0)
            if line and line.note:
                transfer_item.remark = line.note
            if damaged_here and stock_item:
                stock_item.status = StockStatus.DAMAGED
                damaged_total += 1

            results.append(schemas.ReceivedItemResult(
                barcode=barcode,
                success=True,
                message="Item received, marked damaged" if damaged_here else "Item received successfully",
                product_name=product_name
            ))
            received_count += 1

        # Batch/none lines have no barcode: they are received whole, by item id.
        for item_id in request.item_ids:
            lot_item = id_to_item.get(item_id)
            if lot_item is None or lot_item.barcode:
                results.append(schemas.ReceivedItemResult(
                    item_id=item_id, success=False, message="Line not found in this transfer note"
                ))
                continue
            if lot_item.item_recieved:
                results.append(schemas.ReceivedItemResult(
                    item_id=item_id, success=False, message="Item already received"
                ))
                continue
            lot_stock = _item_stock(self.db, lot_item)
            if lot_stock is None:
                results.append(schemas.ReceivedItemResult(
                    item_id=item_id, success=False, message="This line has no allocated stock (transfer not approved?)"
                ))
                continue
            if lot_stock.status not in (StockStatus.TRANSFER_PENDING, StockStatus.IN_TRANSIT):
                results.append(schemas.ReceivedItemResult(
                    item_id=item_id, success=False,
                    message=f"Stock is not in transit (status: {lot_stock.status}) and cannot be received",
                ))
                continue
            lot_item.item_recieved = True
            _apply_receipt(self.db, lot_stock, transfer_note)
            lot_line = line_by_item.get(item_id)
            damaged_units = lot_line.damaged_quantity if lot_line else 0
            if lot_line and lot_line.note:
                lot_item.remark = lot_line.note
            if damaged_units > 0:
                from app.modules.inventory.lots import split_lot

                # split off exactly the damaged units; the rest of the lot stays sellable
                split_lot(self.db, lot_stock, min(damaged_units, lot_stock.quantity)).status = StockStatus.DAMAGED
                damaged_total += damaged_units
            results.append(schemas.ReceivedItemResult(
                item_id=item_id,
                success=True,
                message=f"Received {lot_item.quantity} unit(s)" + (f", {damaged_units} damaged" if damaged_units else ""),
                product_name=lot_stock.product.name if lot_stock.product else None,
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

        receive_note_text = request.received_note
        if damaged_total:
            receive_note_text = f"{(receive_note_text or '').strip()} [Damaged on arrival: {damaged_total} unit(s)]".strip()[:355]

        existing_receive_note = self.get_by_transfer_note(transfer_note_id)
        if existing_receive_note:
            # Each receipt adds to the note instead of replacing what earlier receipts recorded.
            joined = " | ".join(t for t in (existing_receive_note.received_note, receive_note_text) if t and t.strip())
            existing_receive_note.received_note = joined[-355:] if joined else receive_note_text
            existing_receive_note.recieved_user = request.received_user_id
            existing_receive_note.recieved_date = tz.now()
            existing_receive_note.received_approval_status = recv_status
        else:
            new_receive_note = ItemReceiveNote(
                item_transfer_note_id=transfer_note_id,
                received_approval_status=recv_status,
                received_note=receive_note_text,
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
