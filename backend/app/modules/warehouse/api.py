from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from datetime import date
from app.db.session import get_db
from app.auth.models import User
from app.auth.dependencies import get_current_user, get_user_branch_filter, validate_branch_access
from app.auth.rbac import Permissions, require_permission
from app.core import timezone as tz
from . import schemas, service
from .models import ItemReceiveNote, ItemTransferNoteApproved, ItemTransferNoteItems

router = APIRouter(prefix="/warehouse", tags=["warehouse"])


def _ensure_itn_access(db: Session, user: User, transfer_note_id: Optional[int]) -> None:
    """403 unless the user works at the sending branch or at the receiving location's branch.
    A missing transfer note falls through so the service raises its usual 404."""
    from app.modules.common.models import Locations
    from .models import ItemTransferNote

    itn = (
        db.query(ItemTransferNote.branch_code, ItemTransferNote.to_location_id)
        .filter(ItemTransferNote.id == transfer_note_id)
        .first()
    )
    if not itn or validate_branch_access(user, itn.branch_code):
        return
    dest_branch = db.query(Locations.branch_code).filter(Locations.id == itn.to_location_id).scalar()
    if dest_branch and validate_branch_access(user, dest_branch):
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {itn.branch_code}")


def _itn_id_of(db: Session, model, column, row_id: int) -> Optional[int]:
    return db.query(column).filter(model.id == row_id).scalar()


# Item Transfer Note Endpoints
@router.post("/transfer-notes", response_model=schemas.ItemTransferNote, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.ITN_CREATE))])
def create_transfer_note(
    transfer_note: schemas.ItemTransferNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Create a new item transfer note"""
    # Validate user has access to the specified branch
    if not validate_branch_access(current_user, transfer_note.branch_code):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Access denied to branch: {transfer_note.branch_code}"
        )
    transfer_note_service = service.ItemTransferNoteService(db)
    created = transfer_note_service.create_transfer_note(
        transfer_note, user_id=current_user.id
    )

    # Notify the originating branch, and the receiving branch about incoming stock.
    from app.modules.notifications import dispatcher as notify
    from app.modules.common.models import Locations

    notify.branch(
        created.branch_code,
        title="Stock Transfer Created",
        message=f"Transfer note {created.item_transfer_note} was created.",
        notification_type=notify.INFO,
        category=notify.WAREHOUSE,
        action_url="/warehouse/item-transfer-notes",
        exclude_user_id=current_user.id,
    )

    dest_branch = (
        db.query(Locations.branch_code)
        .filter(Locations.id == created.to_location_id)
        .scalar()
    )
    if dest_branch and dest_branch != created.branch_code:
        notify.branch(
            dest_branch,
            title="Incoming Stock Transfer",
            message=f"Transfer note {created.item_transfer_note} is incoming to your branch.",
            notification_type=notify.INFO,
            category=notify.WAREHOUSE,
            action_url="/warehouse/item-transfer-notes",
            exclude_user_id=current_user.id,
        )
    return created

@router.get("/transfer-notes/{transfer_note_id}", response_model=schemas.ItemTransferNote, dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
def get_transfer_note(transfer_note_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get transfer note by ID"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    transfer_note_service = service.ItemTransferNoteService(db)
    return transfer_note_service.get_transfer_note(transfer_note_id)

@router.get("/transfer-notes", response_model=List[schemas.ItemTransferNote], dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
def list_transfer_notes(
    branch_code: Optional[str] = None,
    from_location_id: Optional[int] = None,
    to_location_id: Optional[int] = None,
    to_location_branch: Optional[str] = Query(None, description="Filter by receiving location's branch code"),
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter)
):
    """List all transfer notes with optional filters"""
    # Apply branch-based access control
    if branch_code:
        if user_branches is not None and branch_code not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {branch_code}"
            )
        filter_branch = branch_code
    else:
        filter_branch = None
    
    transfer_note_service = service.ItemTransferNoteService(db)
    filters = schemas.WarehouseListFilter(
        branch_code=filter_branch,
        branch_codes=user_branches,  # Pass list of allowed branches for filtering
        from_location_id=from_location_id,
        to_location_id=to_location_id,
        to_location_branch=to_location_branch,
        date_from=date.fromisoformat(date_from) if date_from else None,
        date_to=date.fromisoformat(date_to) if date_to else None,
        skip=skip,
        limit=limit
    )
    return transfer_note_service.list_transfer_notes(filters)

@router.put("/transfer-notes/{transfer_note_id}", response_model=schemas.ItemTransferNote, dependencies=[Depends(require_permission(*Permissions.ITN_UPDATE))])
def update_transfer_note(
    transfer_note_id: int,
    transfer_note: schemas.ItemTransferNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a transfer note"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    if not validate_branch_access(current_user, transfer_note.branch_code):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"Access denied to branch: {transfer_note.branch_code}")
    transfer_note_service = service.ItemTransferNoteService(db)
    return transfer_note_service.update_transfer_note(transfer_note_id, transfer_note)

@router.delete("/transfer-notes/{transfer_note_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_permission(*Permissions.ITN_DELETE))])
def delete_transfer_note(transfer_note_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete a transfer note"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    transfer_note_service = service.ItemTransferNoteService(db)
    transfer_note_service.delete_transfer_note(transfer_note_id)

# Item Transfer Note Items Endpoints
@router.post("/transfer-note-items", response_model=schemas.ItemTransferNoteItem, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.ITN_CREATE))])
def create_transfer_note_item(
    item: schemas.ItemTransferNoteItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new transfer note item"""
    _ensure_itn_access(db, current_user, item.itemtransfernote_id)
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.create_item(item)

@router.get("/transfer-note-items/{item_id}", response_model=schemas.ItemTransferNoteItem, dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
def get_transfer_note_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get transfer note item by ID"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemTransferNoteItems, ItemTransferNoteItems.itemtransfernote_id, item_id))
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.get_item(item_id)

@router.get("/transfer-notes/{transfer_note_id}/items", response_model=List[schemas.ItemTransferNoteItem], dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
def list_transfer_note_items(transfer_note_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """List all items for a transfer note"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.list_items_by_transfer_note(transfer_note_id)

@router.put("/transfer-note-items/{item_id}", response_model=schemas.ItemTransferNoteItem, dependencies=[Depends(require_permission(*Permissions.ITN_UPDATE))])
def update_transfer_note_item(
    item_id: int,
    item: schemas.ItemTransferNoteItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a transfer note item"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemTransferNoteItems, ItemTransferNoteItems.itemtransfernote_id, item_id))
    _ensure_itn_access(db, current_user, item.itemtransfernote_id)
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.update_item(item_id, item)

@router.patch("/transfer-note-items/{item_id}/receive", response_model=schemas.ItemTransferNoteItem, dependencies=[Depends(require_permission(*Permissions.ITN_UPDATE))])
def mark_item_as_received(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Mark a transfer note item as received"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemTransferNoteItems, ItemTransferNoteItems.itemtransfernote_id, item_id))
    item_service = service.ItemTransferNoteItemService(db)
    return item_service.mark_as_received(item_id)

@router.delete("/transfer-note-items/{item_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_permission(*Permissions.ITN_DELETE))])
def delete_transfer_note_item(item_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete a transfer note item"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemTransferNoteItems, ItemTransferNoteItems.itemtransfernote_id, item_id))
    item_service = service.ItemTransferNoteItemService(db)
    item_service.delete_item(item_id)

# Transfer Note Approval Endpoints
@router.post("/transfer-note-approvals", response_model=schemas.ItemTransferNoteApproved, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.ITN_APPROVAL_APPROVE))])
def create_transfer_note_approval(
    approval: schemas.ItemTransferNoteApprovedCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a (pending) transfer note approval record.

    Decisions go through PUT /transfer-note-approvals/{id} (or the central /approvals
    endpoints), which run the pending-status and stock-availability guards.
    """
    _ensure_itn_access(db, current_user, approval.item_transfer_note_id)
    if approval.approved_status != 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="New approval records must be pending; approve or reject them afterwards.")
    approval = approval.model_copy(update={"approved_user_id": None})
    approval_service = service.ItemTransferNoteApprovalService(db)
    return approval_service.create_approval(approval)

@router.get("/transfer-note-approvals/{approval_id}", response_model=schemas.ItemTransferNoteApproved, dependencies=[Depends(require_permission(*Permissions.ITN_APPROVAL_VIEW))])
def get_transfer_note_approval(approval_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get transfer note approval by ID"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemTransferNoteApproved, ItemTransferNoteApproved.item_transfer_note_id, approval_id))
    approval_service = service.ItemTransferNoteApprovalService(db)
    return approval_service.get_approval(approval_id)

@router.get("/transfer-notes/{transfer_note_id}/approval", response_model=schemas.ItemTransferNoteApproved, dependencies=[Depends(require_permission(*Permissions.ITN_APPROVAL_VIEW))])
def get_transfer_note_approval_by_note(transfer_note_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get approval for a transfer note"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    approval_service = service.ItemTransferNoteApprovalService(db)
    approval = approval_service.get_by_transfer_note(transfer_note_id)
    if not approval:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Approval not found for this transfer note"
        )
    return approval

@router.put("/transfer-note-approvals/{approval_id}", response_model=schemas.ItemTransferNoteApproved, dependencies=[Depends(require_permission(*Permissions.ITN_APPROVAL_APPROVE))])
def update_transfer_note_approval(
    approval_id: int,
    approval: schemas.ItemTransferNoteApprovedCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Approve (1) or reject (2) a transfer note through its approval record.

    The transfer note comes from the stored record, never from the body, and the decision
    runs through ItemTransferNoteService.approve/reject_transfer_note so the pending-status
    and stock-availability guards apply. The approver is always the caller.
    """
    approval_service = service.ItemTransferNoteApprovalService(db)
    db_approval = approval_service.get_approval(approval_id)
    itn_id = db_approval.item_transfer_note_id
    _ensure_itn_access(db, current_user, itn_id)
    if approval.item_transfer_note_id != itn_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An approval record cannot be moved to another transfer note.")
    if approval.approved_status not in (1, 2):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="approved_status must be 1 (approve) or 2 (reject).")

    transfer_service = service.ItemTransferNoteService(db)
    if approval.approved_status == 1:
        transfer_service.approve_transfer_note(itn_id, user_id=current_user.id, remarks=approval.approval_note)
    else:
        transfer_service.reject_transfer_note(itn_id, user_id=current_user.id, remarks=approval.approval_note)

    db_approval = approval_service.get_approval(approval_id)
    db_approval.approved_status = approval.approved_status
    db_approval.approval_note = approval.approval_note
    db_approval.approved_user_id = current_user.id
    db_approval.approved_date = tz.now()
    db.commit()
    db.refresh(db_approval)
    return db_approval

# Receive Note Endpoints
@router.post("/receive-notes", response_model=schemas.ItemReceiveNote, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_permission(*Permissions.RECEIVE_NOTE_CREATE))])
def create_receive_note(
    receive_note: schemas.ItemReceiveNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new receive note"""
    _ensure_itn_access(db, current_user, receive_note.item_transfer_note_id)
    receive_note_service = service.ItemReceiveNoteService(db)
    return receive_note_service.create_receive_note(receive_note)

@router.get("/receive-notes/{receive_note_id}", response_model=schemas.ItemReceiveNote, dependencies=[Depends(require_permission(*Permissions.RECEIVE_NOTE_VIEW))])
def get_receive_note(receive_note_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get receive note by ID"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemReceiveNote, ItemReceiveNote.item_transfer_note_id, receive_note_id))
    receive_note_service = service.ItemReceiveNoteService(db)
    return receive_note_service.get_receive_note(receive_note_id)

@router.get("/transfer-notes/{transfer_note_id}/receive-note", response_model=schemas.ItemReceiveNote, dependencies=[Depends(require_permission(*Permissions.RECEIVE_NOTE_VIEW))])
def get_receive_note_by_transfer_note(transfer_note_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Get receive note for a transfer note"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    receive_note_service = service.ItemReceiveNoteService(db)
    receive_note = receive_note_service.get_by_transfer_note(transfer_note_id)
    if not receive_note:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Receive note not found for this transfer note"
        )
    return receive_note

@router.get("/receive-notes", response_model=List[schemas.ItemReceiveNote], dependencies=[Depends(require_permission(*Permissions.RECEIVE_NOTE_VIEW))])
def list_receive_notes(
    approved_status: Optional[int] = None,
    to_location_branch: Optional[str] = Query(None, description="Filter by receiving branch"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    user_branches: Optional[List[str]] = Depends(get_user_branch_filter)
):
    """List all receive notes with optional filters"""
    # Apply branch-based access control for to_location_branch
    if to_location_branch:
        if user_branches is not None and to_location_branch not in user_branches:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied to branch: {to_location_branch}"
            )
    
    receive_note_service = service.ItemReceiveNoteService(db)
    filters = schemas.WarehouseListFilter(
        approved_status=approved_status,
        to_location_branch=to_location_branch,
        branch_codes=user_branches,  # For multi-branch access control
        skip=skip,
        limit=limit
    )
    return receive_note_service.list_receive_notes(filters)

@router.put("/receive-notes/{receive_note_id}", response_model=schemas.ItemReceiveNote, dependencies=[Depends(require_permission(*Permissions.RECEIVE_NOTE_UPDATE))])
def update_receive_note(
    receive_note_id: int,
    receive_note: schemas.ItemReceiveNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a receive note"""
    _ensure_itn_access(db, current_user, _itn_id_of(db, ItemReceiveNote, ItemReceiveNote.item_transfer_note_id, receive_note_id))
    _ensure_itn_access(db, current_user, receive_note.item_transfer_note_id)
    receive_note_service = service.ItemReceiveNoteService(db)
    return receive_note_service.update_receive_note(receive_note_id, receive_note)


# Barcode Validation for Transfer Notes
@router.post("/transfer-notes/validate-barcode", response_model=schemas.BarcodeValidationResponse, dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
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


@router.post("/transfer-notes/validate-lot", response_model=schemas.LotValidationResponse, dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
def validate_lot_for_transfer(
    request: schemas.LotValidationRequest,
    db: Session = Depends(get_db)
):
    """Validate a quantity of a batch/none-tracked product for transfer (availability at the source location)."""
    return service.ItemTransferNoteService(db).validate_lot_for_transfer(request)


# Dispatch Transfer Note (mark as dispatched and update stock status)
@router.post("/transfer-notes/{transfer_note_id}/dispatch", response_model=schemas.ItemTransferNote, dependencies=[Depends(require_permission(*Permissions.ITN_UPDATE))])
def dispatch_transfer_note(
    transfer_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Dispatch a transfer note:
    - Updates transfer note status to 'dispatched'
    - Marks all stock items as 'in_transit'
    """
    _ensure_itn_access(db, current_user, transfer_note_id)
    transfer_service = service.ItemTransferNoteService(db)
    return transfer_service.dispatch_transfer_note(transfer_note_id)


# Receive Items (receiving side workflow)
@router.post("/transfer-notes/{transfer_note_id}/receive-items", response_model=schemas.ReceiveItemsResponse, dependencies=[Depends(require_permission(*Permissions.RECEIVE_NOTE_CREATE))])
def receive_transfer_items(
    transfer_note_id: int,
    request: schemas.ReceiveItemsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Receive items from a transfer note:
    - Validates each barcode is in this transfer note
    - Marks item_transfer_note_items.item_recieved = true
    - Updates sales_stock location and status
    - Creates/updates item_receive_note
    """
    _ensure_itn_access(db, current_user, transfer_note_id)
    receive_service = service.ItemReceiveNoteService(db)
    request.received_user_id = current_user.id  # the receiver is the signed-in user, never a client claim
    return receive_service.receive_items(transfer_note_id, request)


# Get Transfer Note Status Summary
@router.get("/transfer-notes/{transfer_note_id}/status", response_model=schemas.TransferNoteStatusResponse, dependencies=[Depends(require_permission(*Permissions.ITN_VIEW))])
def get_transfer_note_status(
    transfer_note_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get detailed status of a transfer note including received items count"""
    _ensure_itn_access(db, current_user, transfer_note_id)
    transfer_service = service.ItemTransferNoteService(db)
    return transfer_service.get_transfer_status(transfer_note_id)
