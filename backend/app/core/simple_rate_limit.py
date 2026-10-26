"""
Simple in-memory rate limiter for FastAPI using Depends.
Avoids dependency hell with slowapi/limits/pkg_resources.
"""
import os
import threading
from collections import defaultdict
from datetime import datetime, timedelta

from fastapi import Request, HTTPException

from app.core.audit_context import current_user_id

# Limits are enforced per worker process (in memory), so with N workers the
# effective limit is up to N x the configured value.
LOGIN_RATE_LIMIT_PER_MIN = int(os.getenv("LOGIN_RATE_LIMIT_PER_MIN", "20"))


class _RateLimiter:
    """Thread-safe in-memory rate limiter using sliding window."""

    def __init__(self):
        self._storage: dict = defaultdict(list)
        self._lock = threading.Lock()

    def is_allowed(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        now = datetime.utcnow()
        cutoff = now - timedelta(seconds=window_seconds)
        with self._lock:
            history = self._storage[key]
            history[:] = [ts for ts in history if ts > cutoff]
            if len(history) >= limit:
                return False
            history.append(now)
            return True


_limiter = _RateLimiter()


def rate_limit(requests_per_minute: int, per_user: bool = False):
    """Return a FastAPI Depends-compatible dependency that enforces a rate limit.

    Keyed per client IP by default. With ``per_user=True`` an authenticated caller is
    keyed by user id instead, so colleagues behind one office/NAT address do not share
    a budget (unauthenticated callers still fall back to the IP).
    """
    def dependency(request: Request):
        uid = current_user_id.get() if per_user else None
        if uid is not None:
            who = f"user:{uid}"
        else:
            who = request.client.host if request.client else "unknown"
        key = f"{who}:{request.url.path}"
        if not _limiter.is_allowed(key, requests_per_minute):
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")
    return dependency
