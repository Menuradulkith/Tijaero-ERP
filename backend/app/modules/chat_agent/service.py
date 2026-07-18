"""
Chat Agent — orchestration service.

Runs the OpenAI tool-calling loop with streaming, enforces the monthly cost
budget, persists conversation history and creates pending actions for write
tools (two-phase confirm).

The HTTP layer streams Server-Sent-Event style frames produced by
``stream_chat``:

    {"type": "meta", "conversation_id": 12}
    {"type": "token", "content": "..."}            — assistant text delta
    {"type": "tool_call", "name": "...", "label": "..."}
    {"type": "pending_action", "action": {...}}    — needs user confirmation
    {"type": "done", "message_id": 5, "usage": {...}}
    {"type": "error", "message": "..."}
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict, Generator, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth.models import User
from app.core import timezone as tz
from app.core.config import settings
from app.modules.chat_agent import models
from app.modules.chat_agent.tools import (
    ToolError,
    ToolSpec,
    get_allowed_tools,
    json_ready,
    openai_tool_defs,
)

logger = logging.getLogger(__name__)

MAX_TOOL_RESULT_CHARS = 6000


def _friendly_llm_error(exc: Exception) -> str:
    """Translate an OpenAI/transport exception into a clear, non-leaky message
    for the end user. Falls back to a generic message for unknown errors."""
    status = getattr(exc, "status_code", None)
    code = None
    body = getattr(exc, "body", None)
    if isinstance(body, dict):
        code = (body.get("error") or {}).get("code") if isinstance(body.get("error"), dict) else body.get("code")
    text = str(exc).lower()

    if code == "insufficient_quota" or "insufficient_quota" in text or "exceeded your current quota" in text:
        return (
            "The AI assistant is temporarily unavailable: the OpenAI account has run out of "
            "quota/credit. Please ask your administrator to check the OpenAI plan and billing."
        )
    if status == 429 or "rate limit" in text:
        return (
            "The AI assistant is busy right now (rate limited by OpenAI). "
            "Please wait a few seconds and try again."
        )
    if status == 401 or "authentication" in text or "invalid_api_key" in text or code == "invalid_api_key":
        return (
            "The AI assistant is misconfigured: the OpenAI API key was rejected. "
            "Please ask your administrator to verify OPENAI_API_KEY."
        )
    if status in (500, 502, 503) or "overloaded" in text or "service unavailable" in text:
        return "OpenAI is temporarily unavailable. Please try again in a moment."
    return "The AI assistant hit an unexpected error. Please try again; if it persists, contact your administrator."


def _sse(payload: Dict[str, Any]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _clip(text: str, limit: int = MAX_TOOL_RESULT_CHARS) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f'... [truncated, {len(text) - limit} chars omitted]'


class ChatAgentService:
    def __init__(self, db: Session, user: User):
        self.db = db
        self.user = user

    # ─── budget ────────────────────────────────────────────────────────
    def _month_spend_usd(self) -> float:
        now = tz.now()
        month_start = datetime(now.year, now.month, 1)
        total = (
            self.db.query(func.coalesce(func.sum(models.ChatMessage.cost_usd), 0))
            .filter(models.ChatMessage.created_at >= month_start)
            .scalar()
        )
        return float(total or 0)

    @staticmethod
    def _cost_usd(prompt_tokens: int, completion_tokens: int) -> Decimal:
        cost = (
            prompt_tokens * settings.CHAT_AGENT_INPUT_COST_PER_1M
            + completion_tokens * settings.CHAT_AGENT_OUTPUT_COST_PER_1M
        ) / 1_000_000
        return Decimal(str(round(cost, 6)))

    # ─── conversation plumbing ─────────────────────────────────────────
    def _get_or_create_conversation(
        self, conversation_id: Optional[int], first_message: str
    ) -> models.ChatConversation:
        if conversation_id:
            convo = (
                self.db.query(models.ChatConversation)
                .filter(
                    models.ChatConversation.id == conversation_id,
                    models.ChatConversation.user_id == self.user.id,
                )
                .first()
            )
            if convo:
                return convo
        convo = models.ChatConversation(
            user_id=self.user.id,
            title=(first_message[:57] + "...") if len(first_message) > 60 else first_message,
            created_by=self.user.id,
        )
        self.db.add(convo)
        self.db.commit()
        self.db.refresh(convo)
        return convo

    def _history_messages(self, conversation_id: int) -> List[Dict[str, str]]:
        rows = (
            self.db.query(models.ChatMessage)
            .filter(
                models.ChatMessage.conversation_id == conversation_id,
                models.ChatMessage.role.in_(["user", "assistant", "system"]),
            )
            .order_by(models.ChatMessage.id.desc())
            .limit(settings.CHAT_AGENT_HISTORY_MESSAGES)
            .all()
        )
        return [
            {"role": r.role, "content": r.content or ""}
            for r in reversed(rows)
            if (r.content or "").strip()
        ]

    # ─── system prompt ─────────────────────────────────────────────────
    def _system_prompt(self, specs: List[ToolSpec]) -> str:
        branches = (
            "ALL branches (superuser)"
            if self.user.is_superuser
            else ", ".join(b.branch_code for b in self.user.branches) or "NONE"
        )
        write_tools = [s.name for s in specs if s.is_write]
        return (
            "You are Tijaero Assistant, the built-in AI for TijaeroERP — an ERP used in Sri Lanka "
            "(currency: Sri Lankan Rupees, format amounts as `Rs. 1,234.56`).\n"
            f"Today's date: {tz.today().isoformat()}.\n"
            f"Current user: {self.user.first_name} {self.user.last_name} (username: {self.user.username}).\n"
            f"User's branch access: {branches}. All data you see is already filtered to these branches — "
            "never claim to show data outside them.\n\n"
            "RULES:\n"
            "1. NEVER invent ERP data. Always call tools to answer data questions. If a tool returns nothing, say so.\n"
            "2. Answer in English only. Be concise. Use markdown tables for lists of records.\n"
            "3. Inventory is unit-serialized: a 'stock level' is the COUNT of available units.\n"
            f"4. Write actions ({', '.join(write_tools) or 'none available to this user'}) are NOT executed "
            "immediately — they create a pending confirmation card the user must Approve in the UI. "
            "After calling a write tool, tell the user to review and confirm the card. NEVER say the action "
            "is done until a system message confirms execution.\n"
            "5. Before proposing a write, gather every required field from the user; ask follow-up questions "
            "if anything is missing or ambiguous. Look up IDs (supplier, product) with the read tools first.\n"
            "6. If the user asks for something outside your tools or permissions, say what you can't do and why.\n"
        )

    # ─── tool execution (read tools + write proposals) ────────────────
    def _run_tool(
        self, spec: ToolSpec, args: Dict[str, Any], conversation_id: int
    ) -> Dict[str, Any]:
        """Returns the JSON payload handed back to the model."""
        try:
            if spec.is_write:
                preview = spec.handler(self.db, self.user, args)  # validate
                action = models.ChatPendingAction(
                    conversation_id=conversation_id,
                    user_id=self.user.id,
                    tool_name=spec.name,
                    payload=json.dumps(json_ready(args), ensure_ascii=False),
                    preview=json.dumps(json_ready(preview), ensure_ascii=False),
                    status="pending",
                    created_by=self.user.id,
                )
                self.db.add(action)
                self.db.commit()
                self.db.refresh(action)
                return {
                    "status": "awaiting_user_confirmation",
                    "action_id": action.id,
                    "preview": preview,
                    "note": "A confirmation card was shown to the user. The action will only run after they approve it.",
                    "_pending_action": {
                        "id": action.id,
                        "conversation_id": conversation_id,
                        "tool_name": spec.name,
                        "payload": json_ready(args),
                        "preview": json_ready(preview),
                        "status": "pending",
                    },
                }
            result = spec.handler(self.db, self.user, args)
            nav = result.pop("_navigation", None) if isinstance(result, dict) else None
            payload: Dict[str, Any] = {"result": json_ready(result)}
            if nav:
                payload["_navigation"] = json_ready(nav)
            return payload
        except ToolError as exc:
            self.db.rollback()
            return {"error": str(exc)}
        except Exception as exc:  # noqa: BLE001 — surface as tool error, never 500
            self.db.rollback()
            detail = getattr(exc, "detail", None) or str(exc)
            logger.warning("Chat tool %s failed: %s", spec.name, detail, exc_info=True)
            return {"error": f"Tool failed: {detail}"}

    # ─── LLM provider resolution ──────────────────────────────────────
    @staticmethod
    def _resolve_llm() -> Optional[Dict[str, str]]:
        """
        Resolve the OpenAI credentials from OPENAI_API_KEY
        (+ optional OPENAI_BASE_URL for an OpenAI-compatible endpoint).
        """
        if settings.OPENAI_API_KEY:
            return {
                "api_key": settings.OPENAI_API_KEY,
                "base_url": settings.OPENAI_BASE_URL or None,
                "model": settings.OPENAI_MODEL,
            }
        return None

    def _create_stream(self, client, model: str, messages, tool_defs):
        """Open a streaming completion; retry without stream_options for
        OpenAI-compatible endpoints that reject it."""
        kwargs: Dict[str, Any] = dict(
            model=model,
            messages=messages,
            tools=tool_defs or None,
            temperature=0.2,
            stream=True,
        )
        try:
            return client.chat.completions.create(
                **kwargs, stream_options={"include_usage": True}
            )
        except Exception as exc:  # noqa: BLE001
            if "stream_options" in str(exc):
                return client.chat.completions.create(**kwargs)
            raise

    # ─── content moderation ───────────────────────────────────────────
    def _moderate_input(self, client, text: str) -> Optional[str]:
        """Screen a user message against content policy.

        Returns a short reason (flagged category names, for logging) when the
        message should be blocked, or ``None`` to allow it. Uses OpenAI's free
        moderation endpoint. Fails OPEN — any error (endpoint unsupported by an
        OpenAI-compatible base URL, network, quota) logs a warning and allows
        the message, so a moderation hiccup never bricks the assistant.
        """
        if not settings.CHAT_AGENT_MODERATION_ENABLED:
            return None
        if not (text or "").strip():
            return None
        try:
            resp = client.moderations.create(
                model=settings.CHAT_AGENT_MODERATION_MODEL,
                input=text,
            )
            result = resp.results[0]
            if not result.flagged:
                return None
            try:
                categories = result.categories.model_dump()
            except AttributeError:  # older SDK returns a plain dict
                categories = dict(result.categories or {})
            flagged = [name for name, hit in categories.items() if hit]
            return ", ".join(flagged) or "content policy"
        except Exception as exc:  # noqa: BLE001 — moderation must never hard-fail chat
            logger.warning(
                "Chat moderation check failed (allowing message, user=%s): %s",
                self.user.id, exc,
            )
            return None

    # ─── main streaming loop ───────────────────────────────────
    def stream_chat(
        self, conversation_id: Optional[int], message: str
    ) -> Generator[str, None, None]:
        llm = self._resolve_llm()
        if not llm:
            yield _sse(
                {
                    "type": "error",
                    "message": "No LLM credentials configured — set OPENAI_API_KEY on the server.",
                }
            )
            return

        spend = self._month_spend_usd()
        if spend >= settings.CHAT_AGENT_MONTHLY_BUDGET_USD:
            yield _sse(
                {
                    "type": "error",
                    "message": (
                        f"The AI assistant's monthly budget "
                        f"(${settings.CHAT_AGENT_MONTHLY_BUDGET_USD:.2f}) has been reached. "
                        "It resets next month — contact your administrator to raise it."
                    ),
                }
            )
            return

        try:
            from openai import OpenAI
        except ImportError:
            yield _sse({"type": "error", "message": "The 'openai' package is not installed on the server."})
            return

        convo = self._get_or_create_conversation(conversation_id, message)
        yield _sse({"type": "meta", "conversation_id": convo.id, "title": convo.title})

        self.db.add(
            models.ChatMessage(
                conversation_id=convo.id, role="user", content=message, created_by=self.user.id
            )
        )
        self.db.commit()

        specs = get_allowed_tools(self.user)
        tool_defs = openai_tool_defs(specs)
        specs_by_name = {s.name: s for s in specs}

        messages: List[Dict[str, Any]] = [
            {"role": "system", "content": self._system_prompt(specs)},
            *self._history_messages(convo.id)[:-1],  # history already includes the new user msg
            {"role": "user", "content": message},
        ]

        client = OpenAI(
            api_key=llm["api_key"],
            base_url=llm["base_url"],
        )

        # ── Content moderation (pre-flight) ──
        # Screen the user message before spending any tokens or touching tools.
        # A flagged message is refused as a normal assistant turn (visible in the
        # transcript) and the expensive tool-calling loop is skipped entirely.
        flagged = self._moderate_input(client, message)
        if flagged:
            logger.info(
                "Chat message blocked by moderation (user=%s, categories=%s)",
                self.user.id, flagged,
            )
            refusal = (
                "I can't help with that request. Please keep messages professional "
                "and related to your work in TijaeroERP."
            )
            yield _sse({"type": "token", "content": refusal})
            assistant_msg = models.ChatMessage(
                conversation_id=convo.id,
                role="assistant",
                content=refusal,
                created_by=self.user.id,
            )
            self.db.add(assistant_msg)
            self.db.commit()
            yield _sse(
                {
                    "type": "done",
                    "message_id": assistant_msg.id,
                    "conversation_id": convo.id,
                    "usage": {
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "cost_usd": 0.0,
                        "month_spend_usd": round(spend, 4),
                        "monthly_budget_usd": settings.CHAT_AGENT_MONTHLY_BUDGET_USD,
                    },
                }
            )
            return

        total_prompt = total_completion = 0
        final_text_parts: List[str] = []
        tools_used: List[str] = []

        try:
            for _round in range(settings.CHAT_AGENT_MAX_TOOL_ROUNDS):
                stream = self._create_stream(client, llm["model"], messages, tool_defs)

                round_text = ""
                tool_calls: Dict[int, Dict[str, Any]] = {}
                finish_reason = None

                for chunk in stream:
                    if chunk.usage:
                        total_prompt += chunk.usage.prompt_tokens or 0
                        total_completion += chunk.usage.completion_tokens or 0
                    if not chunk.choices:
                        continue
                    choice = chunk.choices[0]
                    if choice.finish_reason:
                        finish_reason = choice.finish_reason
                    delta = choice.delta
                    if delta is None:
                        continue
                    if delta.content:
                        round_text += delta.content
                        yield _sse({"type": "token", "content": delta.content})
                    for tc in delta.tool_calls or []:
                        slot = tool_calls.setdefault(
                            tc.index, {"id": "", "name": "", "arguments": ""}
                        )
                        if tc.id:
                            slot["id"] = tc.id
                        if tc.function and tc.function.name:
                            slot["name"] = tc.function.name
                        if tc.function and tc.function.arguments:
                            slot["arguments"] += tc.function.arguments

                if finish_reason == "tool_calls" and tool_calls:
                    ordered = [tool_calls[i] for i in sorted(tool_calls)]
                    messages.append(
                        {
                            "role": "assistant",
                            "content": round_text or None,
                            "tool_calls": [
                                {
                                    "id": c["id"],
                                    "type": "function",
                                    "function": {"name": c["name"], "arguments": c["arguments"]},
                                }
                                for c in ordered
                            ],
                        }
                    )
                    if round_text:
                        final_text_parts.append(round_text)

                    for call in ordered:
                        name = call["name"]
                        tools_used.append(name)
                        try:
                            args = json.loads(call["arguments"] or "{}")
                        except json.JSONDecodeError:
                            args = {}
                        spec = specs_by_name.get(name)
                        yield _sse(
                            {"type": "tool_call", "name": name, "is_write": bool(spec and spec.is_write)}
                        )
                        if spec is None:
                            payload: Dict[str, Any] = {"error": f"Unknown or unauthorized tool: {name}"}
                        else:
                            payload = self._run_tool(spec, args, convo.id)
                        pending = payload.pop("_pending_action", None)
                        if pending:
                            yield _sse({"type": "pending_action", "action": pending})
                        nav = payload.pop("_navigation", None)
                        if nav:
                            yield _sse(
                                {
                                    "type": "navigate",
                                    "route": nav["route"],
                                    "label": nav["label"],
                                }
                            )
                        messages.append(
                            {
                                "role": "tool",
                                "tool_call_id": call["id"],
                                "content": _clip(json.dumps(payload, ensure_ascii=False, default=str)),
                            }
                        )
                    continue  # next round — let the model use the tool results

                # No tool calls → this round's text is the final answer
                if round_text:
                    final_text_parts.append(round_text)
                break
            else:
                warn = "\n\n_(Stopped: too many tool steps in one turn — please narrow the request.)_"
                final_text_parts.append(warn)
                yield _sse({"type": "token", "content": warn})

            final_text = "".join(final_text_parts).strip()
            cost = self._cost_usd(total_prompt, total_completion)
            assistant_msg = models.ChatMessage(
                conversation_id=convo.id,
                role="assistant",
                content=final_text,
                tool_payload=json.dumps(tools_used) if tools_used else None,
                prompt_tokens=total_prompt,
                completion_tokens=total_completion,
                cost_usd=cost,
                created_by=self.user.id,
            )
            self.db.add(assistant_msg)
            self.db.commit()

            yield _sse(
                {
                    "type": "done",
                    "message_id": assistant_msg.id,
                    "conversation_id": convo.id,
                    "usage": {
                        "prompt_tokens": total_prompt,
                        "completion_tokens": total_completion,
                        "cost_usd": float(cost),
                        "month_spend_usd": round(spend + float(cost), 4),
                        "monthly_budget_usd": settings.CHAT_AGENT_MONTHLY_BUDGET_USD,
                    },
                }
            )
        except GeneratorExit:  # client disconnected mid-stream
            raise
        except Exception as exc:  # noqa: BLE001
            logger.error("Chat agent stream failed: %s", exc, exc_info=True)
            self.db.rollback()
            yield _sse({"type": "error", "message": _friendly_llm_error(exc)})

    # ─── pending action resolution ─────────────────────────────────────
    def resolve_action(self, action_id: int, approve: bool) -> models.ChatPendingAction:
        from fastapi import HTTPException

        action = (
            self.db.query(models.ChatPendingAction)
            .filter(
                models.ChatPendingAction.id == action_id,
                models.ChatPendingAction.user_id == self.user.id,
            )
            .with_for_update()
            .first()
        )
        if not action:
            raise HTTPException(status_code=404, detail="Pending action not found")
        if action.status != "pending":
            raise HTTPException(status_code=400, detail=f"Action already {action.status}")

        from app.modules.chat_agent.tools import TOOLS_BY_NAME, user_can_use_tool

        spec = TOOLS_BY_NAME.get(action.tool_name)

        if not approve:
            action.status = "rejected"
            action.resolved_at = tz.now()
            self._append_action_note(action, f"[User rejected action #{action.id} ({action.tool_name}).]")
            self.db.commit()
            self.db.refresh(action)
            return action

        if spec is None or spec.execute is None:
            action.status = "failed"
            action.error = "Tool no longer exists."
            action.resolved_at = tz.now()
            self.db.commit()
            raise HTTPException(status_code=400, detail="This action's tool is no longer available.")

        # Re-check permission at execution time (defense in depth). Approval
        # tools carry a custom check (specific approve perm OR common:update)
        # so behaviour matches the REST dashboard.
        if not user_can_use_tool(self.user, spec):
            action.status = "failed"
            action.error = "Permission denied at execution time."
            action.resolved_at = tz.now()
            self.db.commit()
            required = f"{spec.permission[0]}:{spec.permission[1]}"
            if spec.permission_check is not None:
                required += " (or common:update)"
            raise HTTPException(
                status_code=403,
                detail=f"Permission denied. Required: {required}",
            )

        args = json.loads(action.payload or "{}")
        try:
            spec.handler(self.db, self.user, args)  # re-validate against current data
            result = spec.execute(self.db, self.user, args)
            action.status = "executed"
            action.result = json.dumps(json_ready(result), ensure_ascii=False)
            action.resolved_at = tz.now()
            summary = result.get("summary") if isinstance(result, dict) else None
            self._append_action_note(
                action,
                f"[Action #{action.id} ({action.tool_name}) executed successfully: "
                f"{summary or json.dumps(json_ready(result))[:300]}]",
            )
            self.db.commit()
            self.db.refresh(action)
            return action
        except (ToolError, Exception) as exc:  # noqa: BLE001
            self.db.rollback()
            detail = getattr(exc, "detail", None) or str(exc)
            action = (
                self.db.query(models.ChatPendingAction)
                .filter(models.ChatPendingAction.id == action_id)
                .first()
            )
            if action:
                action.status = "failed"
                action.error = detail[:2000]
                action.resolved_at = tz.now()
                self._append_action_note(
                    action, f"[Action #{action.id} ({action.tool_name}) FAILED: {detail[:300]}]"
                )
                self.db.commit()
                self.db.refresh(action)
            raise HTTPException(status_code=400, detail=f"Action failed: {detail}")

    def _append_action_note(self, action: models.ChatPendingAction, note: str) -> None:
        """Give the model conversation-visible context about action outcomes."""
        self.db.add(
            models.ChatMessage(
                conversation_id=action.conversation_id,
                role="system",
                content=note,
                tool_name=action.tool_name,
                created_by=self.user.id,
            )
        )
