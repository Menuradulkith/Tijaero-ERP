"""Tiny in-process TTL cache with single-flight computation.

For expensive, slowly-changing read endpoints (dashboard aggregates over the whole
invoice history). When many users open the dashboard at once, only one request
computes the value; the others wait for it and reuse the result.

Per worker process. A ttl of 0 (or less) disables caching entirely.
"""
from __future__ import annotations

import threading
import time
from typing import Any, Callable, Dict, Hashable, Tuple


class TTLCache:
    def __init__(self, ttl_seconds: float, max_entries: int = 256):
        self.ttl = ttl_seconds
        self.max_entries = max_entries
        self._data: Dict[Hashable, Tuple[float, Any]] = {}
        self._locks: Dict[Hashable, threading.Lock] = {}
        self._guard = threading.Lock()

    def get_or_compute(self, key: Hashable, compute: Callable[[], Any]) -> Any:
        if self.ttl <= 0:
            return compute()
        now = time.monotonic()
        hit = self._data.get(key)
        if hit and now - hit[0] < self.ttl:
            return hit[1]
        with self._guard:
            lock = self._locks.setdefault(key, threading.Lock())
        with lock:
            # Another request may have filled it while we waited for the lock.
            hit = self._data.get(key)
            if hit and time.monotonic() - hit[0] < self.ttl:
                return hit[1]
            value = compute()
            with self._guard:
                if len(self._data) >= self.max_entries:
                    oldest = min(self._data, key=lambda k: self._data[k][0])
                    self._data.pop(oldest, None)
                    self._locks.pop(oldest, None)
                self._data[key] = (time.monotonic(), value)
            return value

    def clear(self) -> None:
        with self._guard:
            self._data.clear()
