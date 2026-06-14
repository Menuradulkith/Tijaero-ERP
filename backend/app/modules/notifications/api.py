"""Notification API endpoints (prefix ``/notifications``)."""

from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.db.session import get_db

from . import schemas, service

router = APIRouter(prefix="/notifications", tags=["notifications"])


def _require_superuser(user: User) -> None:
    """Guard admin-only endpoints (manual sends + alert digests)."""
    if not user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can perform this action.",
        )


@router.get("", response_model=List[schemas.NotificationOut])
def list_notifications(
    unread_only: bool = Query(False),
    category: Optional[str] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100000),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """List the current user's notifications (newest first)."""
    return service.NotificationService(db).list_for_user(
        user_id=current_user.id,
        unread_only=unread_only,
        category=category,
        skip=skip,
        limit=limit,
    )


@router.get("/stats", response_model=schemas.NotificationStats)
def notification_stats(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Total / unread / read counts for the badge."""
    return service.NotificationService(db).get_stats(current_user.id)


@router.post("/{recipient_id}/read", response_model=schemas.NotificationOut)
def mark_read(
    recipient_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Mark a single notification as read."""
    return service.NotificationService(db).mark_as_read(
        recipient_id, current_user.id
    )


@router.post("/read-all", response_model=schemas.MessageResponse)
def mark_all_read(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Mark every unread notification for the current user as read."""
    count = service.NotificationService(db).mark_all_as_read(current_user.id)
    return schemas.MessageResponse(message=f"Marked {count} notifications as read")


@router.delete("/{recipient_id}", response_model=schemas.MessageResponse)
def delete_notification(
    recipient_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Remove a notification from the current user's inbox."""
    service.NotificationService(db).delete_for_user(recipient_id, current_user.id)
    return schemas.MessageResponse(message="Notification deleted")


@router.post(
    "",
    response_model=schemas.MessageResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_notification(
    payload: schemas.NotificationCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Manually send a notification to users / branches / everyone.

    Restricted to superusers -- used for announcements and ops messaging.
    """
    _require_superuser(current_user)

    svc = service.NotificationService(db)

    # Explicit users and/or broadcast → one dispatch (not tagged to a branch).
    if payload.broadcast or payload.user_ids:
        svc.dispatch(
            title=payload.title,
            message=payload.message,
            notification_type=payload.notification_type,
            category=payload.category,
            action_url=payload.action_url,
            extra_data=payload.extra_data,
            user_ids=payload.user_ids,
            broadcast=payload.broadcast,
        )

    # One dispatch per branch so each notification is tagged with its branch_code.
    for code in payload.branch_codes or []:
        svc.dispatch(
            title=payload.title,
            message=payload.message,
            notification_type=payload.notification_type,
            category=payload.category,
            action_url=payload.action_url,
            extra_data=payload.extra_data,
            branch_code=code,
        )

    return schemas.MessageResponse(message="Notification sent")


@router.post("/alerts/low-stock", response_model=schemas.MessageResponse)
def run_low_stock_alerts(
    threshold: int = Query(
        5, ge=1, le=100000, description="Available-units reorder threshold"
    ),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Scan stock and notify each branch about products at/below ``threshold``.

    Aggregated, branch-scoped and superuser-only (ops/admin trigger; can be
    scheduled later).
    """
    _require_superuser(current_user)
    from .alerts import run_low_stock_digest

    summary = run_low_stock_digest(threshold)
    return schemas.MessageResponse(
        message=(
            f"Low-stock alerts sent to {summary['branches']} branch(es) "
            f"for {summary['products']} product(s)."
        )
    )


@router.post("/alerts/outstanding-payments", response_model=schemas.MessageResponse)
def run_outstanding_payment_alerts(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Notify each branch about its unpaid customer invoices (receivables)."""
    _require_superuser(current_user)
    from .alerts import run_outstanding_payments_digest

    summary = run_outstanding_payments_digest()
    return schemas.MessageResponse(
        message=(
            f"Outstanding-payment alerts sent to {summary['branches']} "
            f"branch(es) for {summary['invoices']} invoice(s) "
            f"(Rs. {summary['total_outstanding']:,.2f})."
        )
    )
