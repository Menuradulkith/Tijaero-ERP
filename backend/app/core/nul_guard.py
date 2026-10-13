"""Reject NUL characters in request input with a clean 422.

PostgreSQL text columns cannot store U+0000, so a NUL in any string field used
to surface as an unhandled DB error (HTTP 500) on every create/update endpoint
(QA audit 2026-10-11). Checking once at the edge covers all of them.

Checked: JSON request bodies (every string value and key) and the query
string. Multipart uploads are left alone.
"""
import json
from urllib.parse import unquote_to_bytes

_MAX_SCANNED_BODY = 2 * 1024 * 1024  # bytes; larger JSON bodies are passed through unscanned
_BODY_METHODS = {b"POST", b"PUT", b"PATCH"}


def _contains_nul(value) -> bool:
    if isinstance(value, str):
        return "\x00" in value
    if isinstance(value, list):
        return any(_contains_nul(v) for v in value)
    if isinstance(value, dict):
        return any(_contains_nul(k) or _contains_nul(v) for k, v in value.items())
    return False


class RejectNulMiddleware:
    def __init__(self, app):
        self.app = app

    async def _reject(self, send, where: str):
        body = json.dumps({"detail": f"NUL characters are not allowed in {where}."}).encode()
        await send({"type": "http.response.start", "status": 422,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        if b"\x00" in unquote_to_bytes(scope.get("query_string", b"")):
            await self._reject(send, "the query string")
            return

        headers = {k.lower(): v for k, v in scope.get("headers", [])}
        is_json = headers.get(b"content-type", b"").lower().startswith(b"application/json")
        method = scope.get("method", "GET").encode()
        if not (is_json and method in _BODY_METHODS):
            await self.app(scope, receive, send)
            return

        try:
            declared = int(headers.get(b"content-length", b"0"))
        except ValueError:
            declared = 0
        if declared > _MAX_SCANNED_BODY:
            await self.app(scope, receive, send)
            return

        # Buffer the body so it can be inspected and then replayed unchanged.
        chunks, more = [], True
        while more:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunks.append(message.get("body", b""))
            more = message.get("more_body", False)
        body = b"".join(chunks)

        try:
            payload = json.loads(body) if body else None
        except ValueError:
            payload = None  # not valid JSON: let FastAPI produce its usual 422
        if payload is not None and _contains_nul(payload):
            await self._reject(send, "request fields")
            return

        replayed = False

        async def replay():
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        await self.app(scope, replay, send)
