"""
Centralized Approval Service for ERP
All approval workflows go through the Approvals table for audit trail and permission control.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, Optional

from app.modules.common.models import Approvals
from app.modules.settings.schemas import NotificationCreate
from app.modules.settings.service import NotificationService
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session


class ApprovalType(str, Enum):
    """Approval types for different modules"""

    SALES_ORDER = "sales_order"  # Credit sales orders
    SALE_RETURN = "sale_return"
    PURCHASE_ORDER = "purchase_order"
    PURCHASE_RETURN = "purchase_return"
    ITEM_TRANSFER = "item_transfer"
    PAYMENT_VOUCHER = "payment_voucher"
    EXPENSE = "expense"
    LEAVE = "leave"
    REIMBURSEMENT = "reimbursement"
    SALES_QUOTE = "sales_quote"
    # New approval types for finance integration (Gap A2)
    JOURNAL_ENTRY = "journal_entry"
    BANK_DEPOSIT = "bank_deposit"
    PAYROLL_BATCH = "payroll_batch"
    COMMISSION_PAYMENT = "commission_payment"
    CUSTOMER_CREDIT_SETTLEMENT = "customer_credit_settlement"


class ApprovalStatus(str, Enum):
    """Standard approval statuses"""

    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    CANCELLED = "cancelled"


class ApprovalService:
    """
    Centralized approval service that manages all approval workflows.
    All approval requests must go through this service to ensure:
    1. Approval record is created in approvals table
    2. Only permitted users can approve
    3. Status changes are tracked with audit trail
    """

    def create_approval_request(
        self,
        db: Session,
        approval_type: ApprovalType,
        reference_id: int,
        reference_no: str,
        branch_code: str,
        requested_by: int,
        remarks: Optional[str] = None,
        approval_group: Optional[str] = None,
    ) -> Approvals:
        """
        Create a new approval request in the approvals table.
        This should be called when creating records that need approval.

        Args:
            approval_type: Type of approval (sales_order, purchase_return, etc.)
            reference_id: ID of the record needing approval
            reference_no: Reference number (invoice_no, return_no, etc.)
            branch_code: Branch where the request originated
            requested_by: User ID who created the request
            remarks: Optional remarks
            approval_group: Optional group that can approve (e.g., "sales_managers")
        """
        approval = Approvals(
            approval_for=f"{approval_type.value}:{reference_id}:{reference_no}",
            status=ApprovalStatus.PENDING.value,
            status_changed_by=requested_by,
            next_approval_group=approval_group or f"{approval_type.value}_approvers",
            next_user_to_approve=None,  # Any user with permission can approve
            remark=remarks
            or f"Pending approval for {approval_type.value} - {reference_no}",
        )
        db.add(approval)
        db.flush()
        return approval

    def approve(
        self,
        db: Session,
        approval_id: int,
        approved_by: int,
        remarks: Optional[str] = None,
        on_approve_callback: Optional[Callable[[Session, int], Any]] = None,
    ) -> Approvals:
        """
        Approve a pending approval request.

        Args:
            approval_id: ID of the approval record
            approved_by: User ID who is approving
            remarks: Optional remarks for approval
            on_approve_callback: Optional callback function to execute after approval
                                 Called with (db, reference_id) to update the source record
        """
        # Lock the approval record to prevent concurrent approval/rejection
        approval = (
            db.query(Approvals)
            .filter(Approvals.id == approval_id)
            .with_for_update()
            .first()
        )

        if not approval:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Approval record not found",
            )

        if approval.status != ApprovalStatus.PENDING.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot approve. Current status: {approval.status}",
            )

        # Original requester is the one who created the pending record
        requester_id = approval.status_changed_by

        # Update approval record
        approval.status = ApprovalStatus.APPROVED.value
        approval.status_changed_by = approved_by
        approval.remark = remarks or f"Approved by user {approved_by}"

        # Extract reference_id from approval_for (format: "type:id:reference_no")
        reference_id = None
        if approval.approval_for:
            parts = approval.approval_for.split(":")
            if len(parts) >= 2:
                try:
                    reference_id = int(parts[1])
                except ValueError:
                    pass

        # Execute callback if provided
        if on_approve_callback and reference_id:
            on_approve_callback(db, reference_id)

        # Send Notification to the original requester
        if requester_id:
            try:
                reference_no = (
                    approval.approval_for.split(":")[-1]
                    if approval.approval_for
                    else "Approval"
                )
                approval_type_str = (
                    approval.approval_for.split(":")[0].replace("_", " ").title()
                    if approval.approval_for
                    else "Approval"
                )
                NotificationService(db).create_notification(
                    NotificationCreate(
                        user_id=requester_id,
                        title=f"{approval_type_str} Approved",
                        message=f"Your {approval_type_str} request ({reference_no}) has been approved.",
                        notification_type="success",
                    )
                )
            except Exception as e:
                # Log error but don't fail the approval transaction
                print(f"Failed to send approval notification: {str(e)}")

        db.flush()
        return approval

    def reject(
        self,
        db: Session,
        approval_id: int,
        rejected_by: int,
        remarks: str,
        on_reject_callback: Optional[Callable[[Session, int], Any]] = None,
    ) -> Approvals:
        """
        Reject a pending approval request.
        """
        # Lock the approval record to prevent concurrent approval/rejection
        approval = (
            db.query(Approvals)
            .filter(Approvals.id == approval_id)
            .with_for_update()
            .first()
        )

        if not approval:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Approval record not found",
            )

        if approval.status != ApprovalStatus.PENDING.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reject. Current status: {approval.status}",
            )

        # Original requester is the one who created the pending record
        requester_id = approval.status_changed_by

        # Update approval record
        approval.status = ApprovalStatus.REJECTED.value
        approval.status_changed_by = rejected_by
        approval.remark = remarks

        # Extract reference_id and execute callback
        reference_id = None
        if approval.approval_for:
            parts = approval.approval_for.split(":")
            if len(parts) >= 2:
                try:
                    reference_id = int(parts[1])
                except ValueError:
                    pass

        if on_reject_callback and reference_id:
            on_reject_callback(db, reference_id)

        # Send Notification to the original requester
        if requester_id:
            try:
                reference_no = (
                    approval.approval_for.split(":")[-1]
                    if approval.approval_for
                    else "Approval"
                )
                approval_type_str = (
                    approval.approval_for.split(":")[0].replace("_", " ").title()
                    if approval.approval_for
                    else "Approval"
                )
                NotificationService(db).create_notification(
                    NotificationCreate(
                        user_id=requester_id,
                        title=f"{approval_type_str} Rejected",
                        message=f"Your {approval_type_str} request ({reference_no}) has been rejected. Remark: {remarks}",
                        notification_type="error",
                    )
                )
            except Exception as e:
                print(f"Failed to send rejection notification: {str(e)}")

        db.flush()
        return approval

    def get_pending_approvals(
        self,
        db: Session,
        approval_type: Optional[ApprovalType] = None,
        approval_group: Optional[str] = None,
        skip: int = 0,
        limit: int = 100,
    ):
        """
        Get list of pending approvals, optionally filtered by type or group.
        """
        query = db.query(Approvals).filter(
            Approvals.status == ApprovalStatus.PENDING.value
        )

        if approval_type:
            query = query.filter(
                Approvals.approval_for.like(f"{approval_type.value}:%")
            )

        if approval_group:
            query = query.filter(Approvals.next_approval_group == approval_group)

        return query.offset(skip).limit(limit).all()

    def get_approval_by_reference(
        self, db: Session, approval_type: ApprovalType, reference_id: int
    ) -> Optional[Approvals]:
        """
        Get approval record for a specific reference.
        """
        return (
            db.query(Approvals)
            .filter(
                Approvals.approval_for.like(f"{approval_type.value}:{reference_id}:%")
            )
            .first()
        )

    def get_approval_statistics(self, db: Session) -> Dict[str, Any]:
        """Get approval statistics for dashboard."""
        total_pending = (
            db.query(func.count(Approvals.id))
            .filter(Approvals.status == ApprovalStatus.PENDING.value)
            .scalar()
            or 0
        )

        # Count by type
        pending_by_type = {}
        for approval_type in ApprovalType:
            count = (
                db.query(func.count(Approvals.id))
                .filter(
                    Approvals.status == ApprovalStatus.PENDING.value,
                    Approvals.approval_for.like(f"{approval_type.value}:%"),
                )
                .scalar()
                or 0
            )
            if count > 0:
                pending_by_type[approval_type.value] = count

        return {"total_pending": total_pending, "pending_by_type": pending_by_type}


# Singleton instance
approval_service = ApprovalService()
