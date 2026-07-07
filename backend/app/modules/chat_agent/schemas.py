"""Chat Agent — API schemas."""
from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    conversation_id: Optional[int] = None
    message: str = Field(..., min_length=1, max_length=4000)


class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    tool_name: Optional[str] = None
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PendingActionOut(BaseModel):
    id: int
    conversation_id: int
    tool_name: str
    payload: Dict[str, Any] = {}
    preview: Optional[Dict[str, Any]] = None
    status: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: Optional[datetime] = None


class ActionResolveResponse(BaseModel):
    id: int
    status: str
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    summary: str = ""


class ConversationDetailOut(BaseModel):
    conversation: ConversationOut
    messages: List[MessageOut]
    pending_actions: List[PendingActionOut]
