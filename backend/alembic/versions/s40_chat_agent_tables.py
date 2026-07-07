"""s40 chat agent tables

Creates chat_conversations, chat_messages and chat_pending_actions for the
AI chat assistant (conversation history, token/cost accounting and the
two-phase write confirmation queue).

Revision ID: s40_chat_agent_tables
Revises: 874888ed5142
Create Date: 2026-07-06
"""
import sqlalchemy as sa
from alembic import op

revision = "s40_chat_agent_tables"
down_revision = "874888ed5142"
branch_labels = None
depends_on = None


def _audit_columns():
    return [
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=False, index=True),
        sa.Column("title", sa.String(255), nullable=False, server_default="New conversation"),
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default="false"),
        *_audit_columns(),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text(), nullable=False, server_default=""),
        sa.Column("tool_name", sa.String(100), nullable=True),
        sa.Column("tool_payload", sa.Text(), nullable=True),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("completion_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=False, server_default="0"),
        *_audit_columns(),
    )

    op.create_table(
        "chat_pending_actions",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "conversation_id",
            sa.Integer(),
            sa.ForeignKey("chat_conversations.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=False, index=True),
        sa.Column("tool_name", sa.String(100), nullable=False),
        sa.Column("payload", sa.Text(), nullable=False, server_default="{}"),
        sa.Column("preview", sa.Text(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
        sa.Column("result", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("resolved_at", sa.DateTime(), nullable=True),
        *_audit_columns(),
    )


def downgrade() -> None:
    op.drop_table("chat_pending_actions")
    op.drop_table("chat_messages")
    op.drop_table("chat_conversations")
