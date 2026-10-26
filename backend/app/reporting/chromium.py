"""Headless Chromium for PDF output (documents and report exports).

Playwright starts its driver as an asyncio subprocess. On Windows that needs the
Proactor event loop, but `uvicorn --reload` installs the Selector loop policy for the
whole process, so every PDF failed with NotImplementedError on a Windows dev server.
The Proactor policy is switched in only while Playwright creates its own loop (under a
lock), then restored; the server's running loop is not touched. Other platforms are
unaffected.
"""

from __future__ import annotations

import asyncio
import sys
import threading
from contextlib import contextmanager
from typing import Iterator

_policy_lock = threading.Lock()


def _start_playwright():
    from playwright.sync_api import sync_playwright

    manager = sync_playwright()
    if sys.platform != "win32":
        return manager, manager.__enter__()
    with _policy_lock:
        previous = asyncio.get_event_loop_policy()
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        try:
            return manager, manager.__enter__()
        finally:
            asyncio.set_event_loop_policy(previous)


@contextmanager
def chromium() -> Iterator[object]:
    """A launched headless Chromium browser, closed (with Playwright) on exit."""
    try:
        manager, playwright = _start_playwright()
    except ModuleNotFoundError as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=503, detail="PDF output is not available on this server") from exc
    try:
        browser = playwright.chromium.launch(args=["--no-sandbox"])
        try:
            yield browser
        finally:
            browser.close()
    finally:
        manager.__exit__(None, None, None)
