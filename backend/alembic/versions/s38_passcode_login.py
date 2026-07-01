"""Add user_passcodes, user_passcode_history tables and passcode_expiry_days to settings

Revision ID: s38_passcode_login
Revises: s37_merge_all_final_heads
Create Date: 2026-07-01

Changes:
- Creates user_passcodes table (active 6-digit hashed PIN per user with lockout state)
- Creates user_passcode_history table (rolling last-5 hashes for reuse prevention)
- Adds passcode_expiry_days column to settings table (default 30, mandatory monthly cap)
"""
from alembic import op
import sqlalchemy as sa


revision = "s38_passcode_login"
down_revision = ("s37_merge_all_final_heads", "20260614_notifications")
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── user_passcodes ────────────────────────────────────────────────────────
    op.create_table(
        "user_passcodes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=False),
        sa.Column("hashed_passcode", sa.String(128), nullable=False),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("locked_out", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at_ts", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        # AuditMixin columns
        sa.Column("created_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_user_passcodes_user_id", "user_passcodes", ["user_id"])

    # ── user_passcode_history ─────────────────────────────────────────────────
    op.create_table(
        "user_passcode_history",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=False),
        sa.Column("hashed_passcode", sa.String(128), nullable=False),
        sa.Column("set_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        # AuditMixin columns
        sa.Column("created_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_passcode_history_user_id", "user_passcode_history", ["user_id"])

    # ── settings.passcode_expiry_days ─────────────────────────────────────────
    op.add_column(
        "settings",
        sa.Column("passcode_expiry_days", sa.Integer(), nullable=False, server_default="30"),
    )


def downgrade() -> None:
    op.drop_column("settings", "passcode_expiry_days")
    op.drop_index("ix_user_passcode_history_user_id", table_name="user_passcode_history")
    op.drop_table("user_passcode_history")
    op.drop_index("ix_user_passcodes_user_id", table_name="user_passcodes")
    op.drop_table("user_passcodes")
