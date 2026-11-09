#!/usr/bin/env python3
"""
Run the backend against the sales-demo database (erp_demo) instead of erp_db.

Reads DATABASE_URL from backend/.env, swaps the database name, and starts uvicorn.
No credentials live in this file or in .claude/launch.json.

    python scripts/run_demo_server.py [port]      # default port 8031

Create/refresh the demo database first: see scripts/seed_demo_lk.py.
"""
import os
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
DEMO_DB = os.environ.get("DEMO_DB_NAME", "erp_demo")


def demo_database_url() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        env = (BACKEND / ".env").read_text(encoding="utf-8")
        m = re.search(r"^DATABASE_URL=(.+)$", env, re.M)
        if not m:
            sys.exit("DATABASE_URL not found in backend/.env")
        url = m.group(1).strip()
    return re.sub(r"/[^/?]+(\?|$)", f"/{DEMO_DB}\\1", url, count=1) if url.count("/") >= 3 else url


if __name__ == "__main__":
    port = sys.argv[1] if len(sys.argv) > 1 else "8031"
    os.environ["DATABASE_URL"] = demo_database_url()
    # The demo frontend runs on :3002 (launch config "frontend-demo").
    os.environ.setdefault("BACKEND_CORS_ORIGINS", '["http://localhost:3002","http://127.0.0.1:3002"]')
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    import uvicorn

    uvicorn.run("app.main:app", host="127.0.0.1", port=int(port))
