"""Notifications reach the bell inbox for every module that needs them.

The header reads ``/notifications``. Approvals and the welcome message used to
write the old ``user_notifications`` table, which the bell never reads, and
most modules never emitted an event at all.
"""

from app.modules.common.approval_service import ApprovalService, ApprovalType
from app.modules.notifications import events
from app.modules.notifications.models import Notification, NotificationRecipient
from app.modules.notifications.service import NotificationService
from app.modules.settings.models import UserNotification, UserPreferences


def _titles_for(db, user_id):
    rows = (
        db.query(Notification.title)
        .join(NotificationRecipient, NotificationRecipient.notification_id == Notification.id)
        .filter(NotificationRecipient.user_id == user_id)
        .all()
    )
    return [title for (title,) in rows]


def test_dispatch_skips_users_who_turned_notifications_off(db, make_user):
    opted_out, _ = make_user()
    still_on, _ = make_user()
    db.add(UserPreferences(user_id=opted_out.id, notifications_enabled=False, email_notifications=False))
    db.flush()

    NotificationService(db).dispatch(
        title="Stock arrived",
        message="GRN posted",
        user_ids=[opted_out.id, still_on.id],
    )

    assert _titles_for(db, opted_out.id) == []
    assert _titles_for(db, still_on.id) == ["Stock arrived"]


def test_approval_request_notifies_branch_approvers_on_the_bell(db, make_user, make_branch):
    branch = make_branch()
    other = make_branch()
    requester, _ = make_user(branches=[branch])
    approver, _ = make_user(
        permissions=[("expense_approvals", "approve")],
        branches=[branch],
    )
    outsider, _ = make_user(
        permissions=[("expense_approvals", "approve")],
        branches=[other],
    )

    ApprovalService().create_approval_request(
        db,
        approval_type=ApprovalType.EXPENSE,
        reference_id=41,
        reference_no="EXP-41",
        branch_code=branch.branch_code,
        requested_by=requester.id,
    )
    events.drain(db)

    assert _titles_for(db, approver.id) == ["Expense waiting for approval"]
    assert _titles_for(db, requester.id) == []
    assert _titles_for(db, outsider.id) == []
    assert db.query(UserNotification).filter(UserNotification.user_id == approver.id).count() == 0


def test_approval_decision_reaches_the_requester_on_the_bell(db, make_user, make_branch):
    branch = make_branch()
    requester, _ = make_user(branches=[branch])
    approver, _ = make_user(branches=[branch])
    approval = ApprovalService().create_approval_request(
        db,
        approval_type=ApprovalType.LEAVE,
        reference_id=7,
        reference_no="LV-7",
        branch_code=branch.branch_code,
        requested_by=requester.id,
    )
    events.drain(db)

    ApprovalService().approve(db, approval.id, approved_by=approver.id, remarks="ok")
    events.drain(db)

    assert "Leave Approved" in _titles_for(db, requester.id)
    assert db.query(UserNotification).filter(UserNotification.user_id == requester.id).count() == 0


def test_welcome_lands_in_the_bell_inbox(db, make_user):
    user, _ = make_user()
    events.welcome(user.id)
    assert _titles_for(db, user.id) == ["Welcome to TijaeroERP"]


def test_branch_money_event_uses_the_new_inbox(db, make_user, make_branch):
    branch = make_branch()
    cashier, _ = make_user(branches=[branch])
    colleague, _ = make_user(branches=[branch])

    events.tell_branch(
        branch.branch_code,
        title="Cheque received",
        message="Cheque 1001 recorded.",
        category="finance",
        action_url="/finance/customer-payment-methods/cheque-payments",
        exclude_user_id=cashier.id,
    )

    assert _titles_for(db, colleague.id) == ["Cheque received"]
    assert _titles_for(db, cashier.id) == []
