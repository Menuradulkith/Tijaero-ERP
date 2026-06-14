"""Notifications module.

A standard, dedicated notification system supporting both **user-based** and
**branch-based** delivery. Business events across the ERP emit notifications
through the safe :mod:`app.modules.notifications.dispatcher` facade, and users
read them via the ``/notifications`` API.

Data model
----------
* ``Notification``           – the message/content, created once per event.
* ``NotificationRecipient``  – per-user delivery + read state (fan-out on write).

Targeting a branch creates one recipient row for every active user assigned to
that branch, so the same event is delivered to everyone who should see it while
each user keeps an independent read/unread state.
"""
