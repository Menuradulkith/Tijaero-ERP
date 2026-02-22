"""
Simple in-memory rate limiter for FastAPI using Depends.
Avoids dependency hell with slowapi/limits/pkg_resources.
"""
from collections import defaultdict
from datetime import datetime, timedelta
from fastapi import Request, HTTPException
import threading


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


def rate_limit(requests_per_minute: int):
    """Return a FastAPI Depends-compatible dependency that enforces a per-IP rate limit."""
    def dependency(request: Request):
        client_ip = request.client.host if request.client else "unknown"
        key = f"{client_ip}:{request.url.path}"
        if not _limiter.is_allowed(key, requests_per_minute):
            raise HTTPException(status_code=429, detail="Rate limit exceeded. Try again later.")
    return dependency
