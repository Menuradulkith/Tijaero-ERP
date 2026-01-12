from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.db.session import get_db
from . import schemas, service

router = APIRouter(prefix="/warehouse", tags=["warehouse"])

# Item Transfer Note Endpoints
@router.post("/transfer-notes", response_model=schemas.ItemTransferNote, status_code=status.HTTP_201_CREATED)
def create_transfer_note(
    transfer_note: schemas.ItemTransferNoteCreate,
    db: Session = Depends(get_db)
):
    """Create a new item transfer note"""
    transfer_note_service = service.ItemTransferNoteService(db)
    return transfer_note_service.create_transfer_note(transfer_note)

@router.get("/transfer-notes/{transfer_note_id}", response_model=schemas.ItemTransferNote)
def get_transfer_note(transfer_note_id: int, db: Session = Depends(get_db)):
    """Get transfer note by ID"""
    transfer_note_service = service.ItemTransferNoteService(db)
    return transfer_note_service.get_transfer_note(transfer_note_id)

@router.get("/transfer-notes", response_model=List[schemas.ItemTransferNote])
def list_transfer_notes(
    branch_code: Optional[str] = None,
    from_location_id: Optional[int] = None,
    to_location_id: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all transfer notes with optional filters"""
    transfer_note_service = service.ItemTransferNoteService(db)
    filters = schemas.WarehouseListFilter(
        branch_code=branch_code,
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return transfer_note_service.list_transfer_notes(filters)

@router.put("/transfer-notes/{transfer_note_id}", response_model=schemas.ItemTransferNote)
def update_transfer_note(
    transfer_note_id: int,
    transfer_note: schemas.ItemTransferNoteCreate,
    db: Session = Depends(get_db)
):
    """Update a transfer note"""
    transfer_note_service = service.ItemTransferNoteService(db)
    return transfer_note_service.update_transfer_note(transfer_note_id, transfer_note)

@router.delete("/transfer-notes/{transfer_note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer_note(transfer_note_id: int, db: Session = Depends(get_db)):
    """Delete a transfer note"""
    transfer_note_service = service.ItemTransferNoteService(db)
    transfer_note_service.delete_transfer_note(transfer_note_id)

# Item Transfer Note Items Endpoints
@router.post("/transfer-note-items", response_model=schemas.ItemTransferNoteItem, status_code=status.HTTP_201_CREATED)
def create_transfer_note_item(
    item: schemas.ItemTransferNoteItemCreate,
    db: Session = Depends(get_db)
):
    """Create a new transfer note item"""
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.create_item(item)

@router.get("/transfer-note-items/{item_id}", response_model=schemas.ItemTransferNoteItem)
def get_transfer_note_item(item_id: int, db: Session = Depends(get_db)):
    """Get transfer note item by ID"""
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.get_item(item_id)

@router.get("/transfer-notes/{transfer_note_id}/items", response_model=List[schemas.ItemTransferNoteItem])
def list_transfer_note_items(transfer_note_id: int, db: Session = Depends(get_db)):
    """List all items for a transfer note"""
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.list_items_by_transfer_note(transfer_note_id)

@router.put("/transfer-note-items/{item_id}", response_model=schemas.ItemTransferNoteItem)
def update_transfer_note_item(
    item_id: int,
    item: schemas.ItemTransferNoteItemCreate,
    db: Session = Depends(get_db)
):
    """Update a transfer note item"""
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.update_item(item_id, item)

@router.patch("/transfer-note-items/{item_id}/receive", response_model=schemas.ItemTransferNoteItem)
def mark_item_as_received(item_id: int, db: Session = Depends(get_db)):
    """Mark a transfer note item as received"""
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.mark_as_received(item_id)

@router.delete("/transfer-note-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transfer_note_item(item_id: int, db: Session = Depends(get_db)):
    """Delete a transfer note item"""
    item_service = service.ItemTransferNoteItemService(db)
    item_service.delete_item(item_id)

# Transfer Note Approval Endpoints
@router.post("/transfer-note-approvals", response_model=schemas.ItemTransferNoteApproved, status_code=status.HTTP_201_CREATED)
def create_transfer_note_approval(
    approval: schemas.ItemTransferNoteApprovedCreate,
    db: Session = Depends(get_db)
):
    """Create a transfer note approval"""
    approval_service = service.ItemTransferNoteApprovalService(db)
    return approval_service.create_approval(approval)

@router.get("/transfer-note-approvals/{approval_id}", response_model=schemas.ItemTransferNoteApproved)
def get_transfer_note_approval(approval_id: int, db: Session = Depends(get_db)):
    """Get transfer note approval by ID"""
    approval_service = service.ItemTransferNoteApprovalService(db)
    return approval_service.get_approval(approval_id)

@router.get("/transfer-notes/{transfer_note_id}/approval", response_model=schemas.ItemTransferNoteApproved)
def get_transfer_note_approval_by_note(transfer_note_id: int, db: Session = Depends(get_db)):
    """Get approval for a transfer note"""
    approval_service = service.ItemTransferNoteApprovalService(db)
    approval = approval_service.get_by_transfer_note(transfer_note_id)
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found for this transfer note"
        )
    return approval

@router.put("/transfer-note-approvals/{approval_id}", response_model=schemas.ItemTransferNoteApproved)
def update_transfer_note_approval(
    approval_id: int,
    approval: schemas.ItemTransferNoteApprovedCreate,
    db: Session = Depends(get_db)
):
    """Update a transfer note approval"""
    approval_service = service.ItemTransferNoteApprovalService(db)
    return approval_service.update_approval(approval_id, approval)

# Receive Note Endpoints
@router.post("/receive-notes", response_model=schemas.ItemReceiveNote, status_code=status.HTTP_201_CREATED)
def create_receive_note(
    receive_note: schemas.ItemReceiveNoteCreate,
    db: Session = Depends(get_db)
):
    """Create a new receive note"""
    receive_note_service = service.ItemReceiveNoteService(db)
    return receive_note_service.create_receive_note(receive_note)

@router.get("/receive-notes/{receive_note_id}", response_model=schemas.ItemReceiveNote)
def get_receive_note(receive_note_id: int, db: Session = Depends(get_db)):
    """Get receive note by ID"""
    receive_note_service = service.ItemReceiveNoteService(db)
    return receive_note_service.get_receive_note(receive_note_id)

@router.get("/transfer-notes/{transfer_note_id}/receive-note", response_model=schemas.ItemReceiveNote)
def get_receive_note_by_transfer_note(transfer_note_id: int, db: Session = Depends(get_db)):
    """Get receive note for a transfer note"""
    receive_note_service = service.ItemReceiveNoteService(db)
    receive_note = receive_note_service.get_by_transfer_note(transfer_note_id)
    if not receive_note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receive note not found for this transfer note"
        )
    return receive_note

@router.get("/receive-notes", response_model=List[schemas.ItemReceiveNote])
def list_receive_notes(
    approved_status: Optional[int] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db)
):
    """List all receive notes with optional filters"""
    receive_note_service = service.ItemReceiveNoteService(db)
    filters = schemas.WarehouseListFilter(
        approved_status=approved_status,
        skip=skip,
        limit=limit
    )
    return receive_note_service.list_receive_notes(filters)

@router.put("/receive-notes/{receive_note_id}", response_model=schemas.ItemReceiveNote)
def update_receive_note(
    receive_note_id: int,
    receive_note: schemas.ItemReceiveNoteCreate,
    db: Session = Depends(get_db)
):
    """Update a receive note"""
    receive_note_service = service.ItemReceiveNoteService(db)
    return receive_note_service.update_receive_note(receive_note_id, receive_note)


# Barcode Validation for Transfer Notes
@router.post("/transfer-notes/validate-barcode", response_model=schemas.BarcodeValidationResponse)
def validate_barcode_for_transfer(
    request: schemas.BarcodeValidationRequest,
    db: Session = Depends(get_db)
):
    """
    Validate a barcode for transfer.
    Checks:
    - Barcode exists in sales_stock
    - Item status is 'available'
    - Item is in the specified from_location
    """
    transfer_service = service.ItemTransferNoteService(db)
    return transfer_service.validate_barcode_for_transfer(request)


# Dispatch Transfer Note (mark as dispatched and update stock status)
@router.post("/transfer-notes/{transfer_note_id}/dispatch", response_model=schemas.ItemTransferNote)
def dispatch_transfer_note(
    transfer_note_id: int,
    db: Session = Depends(get_db)
):
    """
    Dispatch a transfer note:
    - Updates transfer note status to 'dispatched'
    - Marks all stock items as 'in_transit'
    """
    transfer_service = service.ItemTransferNoteService(db)
    return transfer_service.dispatch_transfer_note(transfer_note_id)


# Receive Items (receiving side workflow)
@router.post("/transfer-notes/{transfer_note_id}/receive-items", response_model=schemas.ReceiveItemsResponse)
def receive_transfer_items(
    transfer_note_id: int,
    request: schemas.ReceiveItemsRequest,
    db: Session = Depends(get_db)
):
    """
    Receive items from a transfer note:
    - Validates each barcode is in this transfer note
    - Marks item_transfer_note_items.item_recieved = true
    - Updates sales_stock location and status
    - Creates/updates item_receive_note
    """
    receive_service = service.ItemReceiveNoteService(db)
    return receive_service.receive_items(transfer_note_id, request)


# Get Transfer Note Status Summary
@router.get("/transfer-notes/{transfer_note_id}/status", response_model=schemas.TransferNoteStatusResponse)
def get_transfer_note_status(
    transfer_note_id: int,
    db: Session = Depends(get_db)
):
    """Get detailed status of a transfer note including received items count"""
    transfer_service = service.ItemTransferNoteService(db)
    return transfer_service.get_transfer_status(transfer_note_id)
