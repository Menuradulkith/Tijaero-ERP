"""Admission control: cap in-flight HTTP requests below the DB pool size.

Each request keeps its pooled DB connection from the first query until the
response is finished, including while it waits for a free worker thread. With
more concurrent requests than connections, everything queued on the pool and
timed out. Holding the surplus requests *before* they take a connection keeps
latency proportional to load and turns overload into a clean 503.
"""
import asyncio
import json


class AdmissionControlMiddleware:
    def __init__(self, app, max_concurrent: int = 32, queue_timeout: float = 15.0):
        self.app = app
        self.max_concurrent = max_concurrent
        self.queue_timeout = queue_timeout
        self._sem = None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if self._sem is None:
            self._sem = asyncio.Semaphore(self.max_concurrent)
        try:
            await asyncio.wait_for(self._sem.acquire(), self.queue_timeout)
        except asyncio.TimeoutError:
            body = json.dumps({"detail": "The server is busy. Please try again in a moment."}).encode()
            await send({"type": "http.response.start", "status": 503,
                        "headers": [(b"content-type", b"application/json"), (b"retry-after", b"2"),
                                    (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        try:
            await self.app(scope, receive, send)
        finally:
            self._sem.release()
