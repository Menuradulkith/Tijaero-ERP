"""
Centralized Approval Service for ERP
All approval workflows go through the Approvals table for audit trail and permission control.
"""

import logging
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, Optional

from app.modules.common.models import Approvals
from app.modules.settings.schemas import NotificationCreate
from app.modules.settings.service import NotificationService
from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


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
            except Exception:
                # Log error but don't fail the approval transaction
                logger.exception("Failed to send approval notification for approval_id=%s", approval.id)

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
            except Exception:
                logger.exception("Failed to send rejection notification for approval_id=%s", approval.id)

        db.flush()
        return approval

    # ------------------------------------------------------------------
    # Unified decision handling (shared by REST API and the chat agent)
    # ------------------------------------------------------------------
    @staticmethod
    def _parse_approval_for(approval_for: Optional[str]):
        """Return (approval_type, reference_id, reference_no) from an approval_for string."""
        if not approval_for:
            return None, None, None
        parts = approval_for.split(":")
        approval_type = parts[0] if len(parts) >= 1 else None
        reference_id = None
        if len(parts) >= 2:
            try:
                reference_id = int(parts[1])
            except (ValueError, TypeError):
                reference_id = None
        reference_no = parts[2] if len(parts) >= 3 else None
        return approval_type, reference_id, reference_no

    def required_permission_for(self, approval_for: Optional[str]):
        """Map an ``approval_for`` string to the specific approve permission tuple."""
        from app.auth.rbac import Permissions

        approval_type, _, _ = self._parse_approval_for(approval_for)
        mapping = {
            "sales_order": Permissions.SO_APPROVAL_APPROVE,
            "sale_return": Permissions.SALES_RETURN_APPROVAL_APPROVE,
            "purchase_order": Permissions.PO_APPROVAL_APPROVE,
            "purchase_return": Permissions.PURCHASE_RETURN_APPROVAL_APPROVE,
            "item_transfer": Permissions.ITN_APPROVAL_APPROVE,
            "payment_voucher": Permissions.PAYMENT_APPROVAL_APPROVE,
            "expense": Permissions.EXPENSE_APPROVAL_APPROVE,
            "leave": Permissions.LEAVE_APPROVAL_APPROVE,
            "reimbursement": Permissions.REIMBURSEMENT_APPROVAL_APPROVE,
            "journal_entry": Permissions.PAYMENT_APPROVAL_APPROVE,
            "bank_deposit": Permissions.PAYMENT_APPROVAL_APPROVE,
            "payroll_batch": Permissions.PAYROLL_APPROVAL_APPROVE,
            "commission_payment": Permissions.COMMISSION_PAYMENT_APPROVAL_APPROVE,
            "commission_approval": Permissions.COMMISSION_APPROVAL_APPROVE,
        }
        return mapping.get(approval_type, Permissions.COMMON_UPDATE)

    def can_user_resolve(self, user, approval_for: Optional[str]) -> bool:
        """
        Return True if ``user`` may approve/reject the given approval.

        Mirrors the REST dashboard rule exactly: the user needs the specific
        approve permission for that approval type OR the general
        ``common:update`` permission.
        """
        from app.auth.rbac import Permissions, user_has_permission

        required_perm = self.required_permission_for(approval_for)
        return user_has_permission(
            user, required_perm[0], required_perm[1]
        ) or user_has_permission(
            user, Permissions.COMMON_UPDATE[0], Permissions.COMMON_UPDATE[1]
        )

    def resolve_decision(
        self,
        db: Session,
        approval_id: int,
        user,
        approve: bool,
        remarks: Optional[str] = None,
    ) -> Approvals:
        """
        Approve or reject a pending approval and dispatch to the owning module
        service.

        This is the single source of truth used by BOTH the REST dashboard
        endpoints and the chat agent, so their behaviour stays identical for
        every approval type.
        """
        # A rejection always requires a reason.
        if not approve and not remarks:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Rejection reason is required",
            )

        # Lock the approval row to prevent concurrent approve/reject.
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

        # Permission: specific approve perm OR common:update (matches dashboard).
        if not self.can_user_resolve(user, approval.approval_for):
            required_perm = self.required_permission_for(approval.approval_for)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Permission denied. Required: "
                    f"{required_perm[0]}:{required_perm[1]} or common:update"
                ),
            )

        if approval.status != ApprovalStatus.PENDING.value:
            action_word = "approve" if approve else "reject"
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot {action_word}. Current status: {approval.status}",
            )

        approval_type, reference_id, _ = self._parse_approval_for(
            approval.approval_for
        )
        if approval_type and reference_id is not None:
            if approve:
                self._dispatch_approve(
                    db, approval, approval_type, reference_id, user, remarks
                )
            else:
                self._dispatch_reject(
                    db, approval, approval_type, reference_id, user, remarks
                )

        db.refresh(approval)
        return approval

    def _dispatch_approve(self, db, approval, approval_type, reference_id, user, remarks):
        """Route an approval to the owning module service (approve path)."""
        if approval_type == ApprovalType.SALES_ORDER.value:
            from app.modules.sales.service import sales_service

            sales_service.approve_invoice(db, reference_id, user.id)
        elif approval_type == ApprovalType.SALE_RETURN.value:
            from app.modules.sales.service import sales_service

            sales_service.approve_sale_return(db, reference_id, user.id)
        elif approval_type == ApprovalType.PURCHASE_RETURN.value:
            from app.modules.purchasing.service import PurchasingReturnService

            PurchasingReturnService(db).approve_return(
                reference_id, approve=True, remarks=remarks, user_id=user.id
            )
        elif approval_type == ApprovalType.PURCHASE_ORDER.value:
            from app.modules.purchasing.service import PurchasingOrderService

            PurchasingOrderService(db).approve_order(
                reference_id, approve=True, remarks=remarks, user_id=user.id
            )
        elif approval_type == ApprovalType.ITEM_TRANSFER.value:
            from app.modules.warehouse.service import ItemTransferNoteService

            ItemTransferNoteService(db).approve_transfer_note(
                reference_id, user_id=user.id, remarks=remarks
            )
        elif approval_type == ApprovalType.REIMBURSEMENT.value:
            from app.modules.hr.schemas import ReimbursementApprove
            from app.modules.hr.service import ReimbursementService

            ReimbursementService(db).approve_reimbursement(
                reference_id, ReimbursementApprove(remarks=remarks), user.id
            )
        else:
            approval.status = ApprovalStatus.APPROVED.value
            approval.status_changed_by = user.id
            approval.remark = remarks or f"Approved by user {user.id}"
            db.commit()

    def _dispatch_reject(self, db, approval, approval_type, reference_id, user, remarks):
        """Route an approval to the owning module service (reject path)."""
        if approval_type == ApprovalType.SALE_RETURN.value:
            from app.modules.sales.service import sales_service

            sales_service.reject_sale_return(db, reference_id, user.id, remarks)
        elif approval_type == ApprovalType.PURCHASE_RETURN.value:
            from app.modules.purchasing.service import PurchasingReturnService

            PurchasingReturnService(db).approve_return(
                reference_id, approve=False, remarks=remarks, user_id=user.id
            )
        elif approval_type == ApprovalType.PURCHASE_ORDER.value:
            from app.modules.purchasing.service import PurchasingOrderService

            PurchasingOrderService(db).approve_order(
                reference_id, approve=False, remarks=remarks, user_id=user.id
            )
        elif approval_type == ApprovalType.ITEM_TRANSFER.value:
            from app.modules.warehouse.service import ItemTransferNoteService

            ItemTransferNoteService(db).reject_transfer_note(
                reference_id, user_id=user.id, remarks=remarks
            )
        elif approval_type == ApprovalType.REIMBURSEMENT.value:
            from app.modules.hr.schemas import ReimbursementReject
            from app.modules.hr.service import ReimbursementService

            ReimbursementService(db).reject_reimbursement(
                reference_id,
                ReimbursementReject(rejection_reason=remarks or "Rejected"),
                user.id,
            )
        elif approval_type == ApprovalType.SALES_ORDER.value:
            from app.modules.sales.service import sales_service

            sales_service.cancel_invoice(db, reference_id, user.id)
            approval.status = ApprovalStatus.REJECTED.value
            approval.status_changed_by = user.id
            approval.remark = remarks
            db.commit()
        else:
            approval.status = ApprovalStatus.REJECTED.value
            approval.status_changed_by = user.id
            approval.remark = remarks
            db.commit()

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
