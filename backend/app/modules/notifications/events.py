"""Business-event notifications for the header bell.

Call :func:`tell_branch`, :func:`tell_user`, or :func:`tell_approvers` after the
business transaction has committed. Approval requests are queued with
:func:`after_commit` because they are written before the caller's commit.
"""

from __future__ import annotations

import logging
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from sqlalchemy import event
from sqlalchemy.orm import Session, selectinload

logger = logging.getLogger(__name__)

_QUEUE = "notification_after_commit"
_HOOK = "notification_after_commit_hook"

# approval_type -> (category, action_url, label)
_APPROVALS: Dict[str, Tuple[str, str, str]] = {
    "sales_order": ("sales", "/sales/approvals/so-approvals", "Sales order"),
    "sale_return": ("sales", "/sales/approvals/return-approvals", "Sale return"),
    "sales_quote": ("sales", "/sales/approvals/quotation-approvals", "Quotation"),
    "purchase_order": ("purchasing", "/purchasing/approvals/po-approvals", "Purchase order"),
    "purchase_return": ("purchasing", "/purchasing/approvals/return-approvals", "Purchase return"),
    "item_transfer": ("warehouse", "/warehouse/item-transfer-notes", "Stock transfer"),
    "payment_voucher": ("finance", "/finance/approvals/payment-approvals", "Payment"),
    "expense": ("finance", "/finance/approvals/expense-approvals", "Expense"),
    "journal_entry": ("finance", "/finance/journal-entries", "Journal entry"),
    "bank_deposit": ("finance", "/finance/customer-payment-methods/bank-deposits", "Bank deposit"),
    "leave": ("hr", "/hr/approvals/leave-approvals", "Leave"),
    "reimbursement": ("hr", "/hr/approvals/reimbursement-approvals", "Reimbursement"),
    "payroll_batch": ("hr", "/hr/approvals/payroll-approvals", "Payroll"),
    "commission_payment": ("finance", "/finance/approvals/commission-payment-approvals", "Commission payment"),
    "commission_approval": ("sales", "/sales/approvals/commission-approvals", "Commission"),
    "customer_credit_settlement": ("finance", "/finance/customer-payments", "Customer credit settlement"),
}


def after_commit(db: Session, callback: Callable[[], None]) -> None:
    """Run ``callback`` once the session's outermost transaction commits."""
    db.info.setdefault(_QUEUE, []).append(callback)
    if db.info.get(_HOOK):
        return
    db.info[_HOOK] = True

    def _on_commit(session: Session) -> None:
        drain(session)

    event.listen(db, "after_commit", _on_commit)


def drain(db: Session) -> None:
    """Run queued notifications now. Production also does this from ``after_commit``."""
    callbacks = list(db.info.pop(_QUEUE, []))
    for callback in callbacks:
        try:
            callback()
        except Exception:
            logger.exception("Notification callback failed")


def welcome(user_id: int) -> None:
    tell_user(
        user_id,
        title="Welcome to TijaeroERP",
        message="Your account has been created. You can sign in and start working.",
        category="system",
        notification_type="info",
        action_url="/dashboard",
    )


def tell_user(
    user_id: Optional[int],
    *,
    title: str,
    message: str,
    category: str = "system",
    notification_type: str = "info",
    action_url: Optional[str] = None,
    exclude_user_id: Optional[int] = None,
    extra_data: Optional[Dict[str, Any]] = None,
) -> None:
    if not user_id or user_id == exclude_user_id:
        return
    from . import dispatcher as notify

    notify.user(
        user_id,
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        extra_data=extra_data,
    )


def tell_users(
    user_ids: Sequence[int],
    *,
    title: str,
    message: str,
    category: str = "system",
    notification_type: str = "info",
    action_url: Optional[str] = None,
    exclude_user_id: Optional[int] = None,
    extra_data: Optional[Dict[str, Any]] = None,
    branch_code: Optional[str] = None,
) -> None:
    ids = [uid for uid in dict.fromkeys(user_ids) if uid and uid != exclude_user_id]
    if not ids:
        return
    from . import dispatcher as notify

    notify.users(
        ids,
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        extra_data=extra_data,
        branch_code=branch_code,
    )


def tell_branch(
    branch_code: Optional[str],
    *,
    title: str,
    message: str,
    category: str,
    notification_type: str = "info",
    action_url: Optional[str] = None,
    exclude_user_id: Optional[int] = None,
    extra_data: Optional[Dict[str, Any]] = None,
) -> None:
    if not branch_code:
        return
    from . import dispatcher as notify

    notify.branch(
        branch_code,
        title=title,
        message=message,
        notification_type=notification_type,
        category=category,
        action_url=action_url,
        exclude_user_id=exclude_user_id,
        extra_data=extra_data,
    )


def tell_approvers(
    branch_code: Optional[str],
    resource: str,
    action: str,
    *,
    title: str,
    message: str,
    category: str,
    action_url: Optional[str] = None,
    exclude_user_id: Optional[int] = None,
    notification_type: str = "warning",
) -> None:
    """Notify people in the branch who can approve, else active superusers."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        ids = approver_ids(db, branch_code or "", resource, action, exclude_user_id)
    finally:
        db.close()
    tell_users(
        ids,
        title=title,
        message=message,
        category=category,
        notification_type=notification_type,
        action_url=action_url,
        branch_code=branch_code,
    )


def tell_permission_holders(
    resource: str,
    action: str,
    *,
    title: str,
    message: str,
    category: str,
    action_url: Optional[str] = None,
    exclude_user_id: Optional[int] = None,
    notification_type: str = "info",
) -> None:
    """Notify every active user who holds a permission, regardless of branch."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        ids = _matching_ids(db, resource, action, exclude_user_id, branch_code=None)
    finally:
        db.close()
    tell_users(
        ids,
        title=title,
        message=message,
        category=category,
        notification_type=notification_type,
        action_url=action_url,
    )


def approver_ids(
    db: Session,
    branch_code: str,
    resource: str,
    action: str,
    exclude_user_id: Optional[int] = None,
) -> List[int]:
    return _matching_ids(db, resource, action, exclude_user_id, branch_code=branch_code)


def queue_approval_requested(
    db: Session,
    *,
    approval_type: str,
    reference_no: str,
    branch_code: str,
    requested_by: int,
) -> None:
    category, url, label = _approval_meta(approval_type)
    resource, action = _approval_permission(approval_type)

    def _send() -> None:
        tell_approvers(
            branch_code,
            resource,
            action,
            title=f"{label} waiting for approval",
            message=f"{label} {reference_no} needs a decision.",
            category=category,
            action_url=url,
            exclude_user_id=requested_by,
            notification_type="warning",
        )

    after_commit(db, _send)


def queue_approval_decided(
    db: Session,
    *,
    approval_type: str,
    reference_no: str,
    requested_by: Optional[int],
    approved: bool,
    remarks: Optional[str] = None,
) -> None:
    category, url, label = _approval_meta(approval_type)
    if approved:
        title = f"{label} Approved"
        message = f"Your {label.lower()} request ({reference_no}) was approved."
        kind = "success"
    else:
        title = f"{label} Rejected"
        message = f"Your {label.lower()} request ({reference_no}) was rejected."
        if remarks:
            message = f"{message} Remark: {remarks}"
        kind = "error"

    def _send() -> None:
        tell_user(
            requested_by,
            title=title,
            message=message,
            category=category,
            notification_type=kind,
            action_url=url,
        )

    after_commit(db, _send)


def _approval_meta(approval_type: str) -> Tuple[str, str, str]:
    return _APPROVALS.get(
        approval_type,
        ("approvals", "/dashboard", (approval_type or "Request").replace("_", " ").title()),
    )


def _approval_permission(approval_type: str) -> Tuple[str, str]:
    from app.modules.common.approval_service import ApprovalService

    resource, action = ApprovalService().required_permission_for(f"{approval_type}:0:ref")
    return resource, action


def _matching_ids(
    db: Session,
    resource: str,
    action: str,
    exclude_user_id: Optional[int],
    branch_code: Optional[str],
) -> List[int]:
    from app.auth.models import Branch, Group, User

    query = db.query(User).filter(User.is_active.is_(True))
    if branch_code:
        query = query.join(User.branches).filter(Branch.branch_code == branch_code)
    users = (
        query.options(
            selectinload(User.permissions),
            selectinload(User.groups).selectinload(Group.permissions),
        )
        .distinct()
        .all()
    )
    ids = [
        user.id
        for user in users
        if user.id != exclude_user_id and (_holds(user, resource, action) or _holds(user, "common", "update"))
    ]
    if ids or not branch_code:
        if ids:
            return ids
        # Company-wide search found nobody with the permission: fall through to superusers.
    supers = (
        db.query(User.id)
        .filter(User.is_active.is_(True), User.is_superuser.is_(True))
        .all()
    )
    return [uid for (uid,) in supers if uid != exclude_user_id]


def _holds(user, resource: str, action: str) -> bool:
    """Permission check that does not treat every superuser as a match."""
    for permission in user.permissions:
        if permission.resource == resource and permission.action == action:
            return True
    for group in user.groups:
        for permission in group.permissions:
            if permission.resource == resource and permission.action == action:
                return True
    return False
