#!/usr/bin/env python3
"""
Runtime verification of authorization wiring.

Uses FastAPI dependency overrides to confirm that the permission-aware
flexible auth (require_permission_flexible) on the reporting /documents/*
endpoints actually enforces RBAC:

  * a user WITHOUT the required permission  -> 403
  * a superuser / user WITH the permission  -> passes the auth gate
    (status is NOT 401/403; the body may 404/500 with the dummy DB, which
     still proves the authorization layer let the request through)

Run:  python scripts/verify_authz_runtime.py
"""
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import app.models  # noqa: F401  (register SQLAlchemy mappers)
from fastapi.testclient import TestClient

from app.main import app
from app.auth.dependencies import get_current_user_flexible
from app.db.session import get_db


def _perm(resource: str, action: str):
    return SimpleNamespace(resource=resource, action=action)


def _user(perms, superuser=False):
    return SimpleNamespace(
        id=1,
        is_active=True,
        is_superuser=superuser,
        permissions=[_perm(r, a) for r, a in perms],
        groups=[],
    )


# Endpoint under test and the permission it should require
URL = "/api/v1/reporting/documents/payroll"
REQUIRED = ("payroll", "view")
WRONG = ("customers", "view")

client = TestClient(app, raise_server_exceptions=False)
app.dependency_overrides[get_db] = lambda: MagicMock()

results = []


def run(label, user, expect_403):
    app.dependency_overrides[get_current_user_flexible] = lambda: user
    resp = client.get(URL)
    blocked = resp.status_code == 403
    ok = blocked == expect_403
    results.append(ok)
    print(
        f"  [{'PASS' if ok else 'FAIL'}] {label:42} "
        f"status={resp.status_code} (blocked={blocked}, expected_blocked={expect_403})"
    )


print(f"\nVerifying RBAC on {URL}  (requires {REQUIRED[0]}:{REQUIRED[1]})")
print("-" * 80)
run("user WITHOUT payroll:view -> 403", _user([WRONG]), expect_403=True)
run("user WITH payroll:view    -> allowed", _user([REQUIRED]), expect_403=False)
run("superuser                 -> allowed", _user([], superuser=True), expect_403=False)

app.dependency_overrides.clear()

print("-" * 80)
if all(results):
    print(f"ALL {len(results)} CHECKS PASSED")
    sys.exit(0)
else:
    print(f"{results.count(False)} CHECK(S) FAILED")
    sys.exit(1)
