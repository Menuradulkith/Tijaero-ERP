"""
Chat Agent — API endpoints.

POST /chat-agent/chat streams SSE-style frames over a plain POST response
(the frontend consumes it with fetch + ReadableStream, so the Authorization
header works — no EventSource / query-param tokens).
"""
import json
from typing import List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.auth.dependencies import get_current_active_user
from app.auth.models import User
from app.auth.rbac import Permissions, require_permission
from app.db.session import get_db
from app.modules.chat_agent import models, schemas
from app.modules.chat_agent.service import ChatAgentService

router = APIRouter(
    prefix="/chat-agent",
    tags=["chat-agent"],
    dependencies=[Depends(require_permission(*Permissions.AI_ASSISTANT_VIEW))],
)


def _action_out(a: models.ChatPendingAction) -> schemas.PendingActionOut:
    def _loads(v: Optional[str]):
        if not v:
            return None
        try:
            return json.loads(v)
        except json.JSONDecodeError:
            return None

    return schemas.PendingActionOut(
        id=a.id,
        conversation_id=a.conversation_id,
        tool_name=a.tool_name,
        payload=_loads(a.payload) or {},
        preview=_loads(a.preview),
        status=a.status,
        result=_loads(a.result),
        error=a.error,
        created_at=a.created_at,
    )


@router.post("/chat")
def chat(
    payload: schemas.ChatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Stream an assistant reply (SSE frames over a POST response)."""
    svc = ChatAgentService(db, current_user)
    return StreamingResponse(
        svc.stream_chat(payload.conversation_id, payload.message),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/conversations", response_model=List[schemas.ConversationOut])
def list_conversations(
    limit: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    return (
        db.query(models.ChatConversation)
        .filter(
            models.ChatConversation.user_id == current_user.id,
            models.ChatConversation.is_archived == False,  # noqa: E712
        )
        .order_by(models.ChatConversation.updated_at.desc())
        .limit(min(limit, 50))
        .all()
    )


@router.get("/conversations/{conversation_id}", response_model=schemas.ConversationDetailOut)
def get_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from fastapi import HTTPException

    convo = (
        db.query(models.ChatConversation)
        .filter(
            models.ChatConversation.id == conversation_id,
            models.ChatConversation.user_id == current_user.id,
        )
        .first()
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    visible = [m for m in convo.messages if m.role in ("user", "assistant")]
    return schemas.ConversationDetailOut(
        conversation=schemas.ConversationOut.model_validate(convo),
        messages=[schemas.MessageOut.model_validate(m) for m in visible],
        pending_actions=[_action_out(a) for a in convo.pending_actions],
    )


@router.delete("/conversations/{conversation_id}", status_code=204)
def archive_conversation(
    conversation_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    from fastapi import HTTPException

    convo = (
        db.query(models.ChatConversation)
        .filter(
            models.ChatConversation.id == conversation_id,
            models.ChatConversation.user_id == current_user.id,
        )
        .first()
    )
    if not convo:
        raise HTTPException(status_code=404, detail="Conversation not found")
    convo.is_archived = True
    db.commit()
    return None


@router.post("/actions/{action_id}/approve", response_model=schemas.ActionResolveResponse)
def approve_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = ChatAgentService(db, current_user)
    action = svc.resolve_action(action_id, approve=True)
    result = json.loads(action.result) if action.result else None
    return schemas.ActionResolveResponse(
        id=action.id,
        status=action.status,
        result=result,
        error=action.error,
        summary=(result or {}).get("summary", "") if isinstance(result, dict) else "",
    )


@router.post("/actions/{action_id}/reject", response_model=schemas.ActionResolveResponse)
def reject_action(
    action_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    svc = ChatAgentService(db, current_user)
    action = svc.resolve_action(action_id, approve=False)
    return schemas.ActionResolveResponse(
        id=action.id, status=action.status, result=None, error=action.error, summary="Action rejected."
    )
