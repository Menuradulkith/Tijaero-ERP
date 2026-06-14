"""Notification system: notifications + notification_recipients

Revision ID: 20260614_notifications
Revises: b9b20b18c650
Create Date: 2026-06-14 00:00:00.000000

Adds a standard, dedicated notification system supporting user-based and
branch-based delivery:

* ``notifications``            – the message/content (one row per event), with an
  optional ``branch_code`` for branch-scoped messages.
* ``notification_recipients``  – per-user delivery + read state (fan-out on
  write); a unique ``(notification_id, user_id)`` prevents duplicate delivery.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260614_notifications"
down_revision = "b9b20b18c650"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── notifications ──────────────────────────────────────────────────────
    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "notification_type",
            sa.String(length=50),
            nullable=False,
            server_default="info",
        ),
        sa.Column(
            "category",
            sa.String(length=50),
            nullable=False,
            server_default="system",
        ),
        sa.Column("action_url", sa.String(length=500), nullable=True),
        sa.Column("extra_data", sa.JSON(), nullable=True),
        sa.Column("branch_code", sa.String(length=255), nullable=True),
        sa.Column(
            "created_date",
            sa.DateTime(),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # Audit columns (AuditMixin)
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
    )
    op.create_index("ix_notifications_id", "notifications", ["id"])
    op.create_index("ix_notifications_category", "notifications", ["category"])
    op.create_index("ix_notifications_branch_code", "notifications", ["branch_code"])
    op.create_index("ix_notifications_created_date", "notifications", ["created_date"])

    # ── notification_recipients ────────────────────────────────────────────
    op.create_table(
        "notification_recipients",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("notification_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column(
            "is_read", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
        sa.Column("read_date", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(
            ["notification_id"],
            ["notifications.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["accounts_user.id"]),
        sa.UniqueConstraint(
            "notification_id", "user_id", name="uq_notification_recipient"
        ),
    )
    op.create_index(
        "ix_notification_recipients_id", "notification_recipients", ["id"]
    )
    op.create_index(
        "ix_notification_recipients_notification_id",
        "notification_recipients",
        ["notification_id"],
    )
    op.create_index(
        "ix_notification_recipients_user_id",
        "notification_recipients",
        ["user_id"],
    )
    op.create_index(
        "ix_notification_recipient_user_unread",
        "notification_recipients",
        ["user_id", "is_read"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_notification_recipient_user_unread",
        table_name="notification_recipients",
    )
    op.drop_index(
        "ix_notification_recipients_user_id",
        table_name="notification_recipients",
    )
    op.drop_index(
        "ix_notification_recipients_notification_id",
        table_name="notification_recipients",
    )
    op.drop_index(
        "ix_notification_recipients_id", table_name="notification_recipients"
    )
    op.drop_table("notification_recipients")

    op.drop_index("ix_notifications_created_date", table_name="notifications")
    op.drop_index("ix_notifications_branch_code", table_name="notifications")
    op.drop_index("ix_notifications_category", table_name="notifications")
    op.drop_index("ix_notifications_id", table_name="notifications")
    op.drop_table("notifications")
