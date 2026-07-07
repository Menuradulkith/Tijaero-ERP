"""
Chat Agent — database models.

Stores conversations, messages (with token/cost accounting for the monthly
budget guard) and pending write-actions that require explicit user
confirmation before execution.
"""
from app.common.base_models import AuditMixin
from app.db.base import Base
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.orm import relationship


class ChatConversation(Base, AuditMixin):
    __tablename__ = "chat_conversations"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        Integer, ForeignKey("accounts_user.id"), nullable=False, index=True
    )
    title = Column(String(255), nullable=False, default="New conversation")
    is_archived = Column(Boolean, nullable=False, default=False, server_default="false")

    messages = relationship(
        "ChatMessage",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ChatMessage.id",
    )
    pending_actions = relationship(
        "ChatPendingAction",
        back_populates="conversation",
        cascade="all, delete-orphan",
    )


class ChatMessage(Base, AuditMixin):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(
        Integer,
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    role = Column(String(20), nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False, default="")
    tool_name = Column(String(100), nullable=True)
    tool_payload = Column(Text, nullable=True)  # JSON string of tool calls made
    prompt_tokens = Column(Integer, nullable=False, default=0)
    completion_tokens = Column(Integer, nullable=False, default=0)
    cost_usd = Column(Numeric(12, 6), nullable=False, default=0)

    conversation = relationship("ChatConversation", back_populates="messages")


class ChatPendingAction(Base, AuditMixin):
    """
    A write operation proposed by the agent. It is NOT executed until the
    user explicitly approves it in the UI (two-phase confirm). The underlying
    RBAC permission is re-checked at execution time.
    """

    __tablename__ = "chat_pending_actions"

    id = Column(Integer, primary_key=True, index=True)
    conversation_id = Column(
        Integer,
        ForeignKey("chat_conversations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        Integer, ForeignKey("accounts_user.id"), nullable=False, index=True
    )
    tool_name = Column(String(100), nullable=False)
    payload = Column(Text, nullable=False, default="{}")  # JSON args
    preview = Column(Text, nullable=True)  # JSON human-readable summary
    status = Column(
        String(20), nullable=False, default="pending", index=True
    )  # pending | approved | rejected | executed | failed
    result = Column(Text, nullable=True)  # JSON execution result
    error = Column(Text, nullable=True)
    resolved_at = Column(DateTime, nullable=True)

    conversation = relationship("ChatConversation", back_populates="pending_actions")
