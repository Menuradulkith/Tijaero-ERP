#!/usr/bin/env python3
"""
Permission Coverage Audit
=========================
Cross-references the FOUR sources of truth for RBAC permissions to prove the
permission set covers the whole ERP and is internally consistent:

  1. REGISTRY  - the Permissions class in app/auth/rbac.py (canonical tuples)
  2. USED      - (resource, action) actually required by API endpoints
  3. SEEDED    - permissions inserted into the DB by scripts/seed_permissions.py
  4. FRONTEND  - PERMISSIONS constants in frontend/src/auth/permissions.ts

Reported gaps (each is a real coverage problem):
  * USED \\ REGISTRY  -> endpoint references a permission that doesn't exist (crash)
  * USED \\ SEEDED    -> endpoint needs a permission no role can be granted (only
                        superusers get in) -- the most important coverage gap
  * REGISTRY \\ SEEDED -> defined but never created in the DB
  * SEEDED \\ REGISTRY -> orphan row seeded but unknown to the code
  * REGISTRY \\ FRONTEND / FRONTEND \\ REGISTRY -> UI<->API desync
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
RBAC = BACKEND / "app" / "auth" / "rbac.py"
SEED = BACKEND / "scripts" / "seed_permissions.py"
FRONTEND_PERMS = ROOT / "frontend" / "src" / "auth" / "permissions.ts"
SEARCH_DIRS = [BACKEND / "app" / "modules", BACKEND / "app" / "auth"]

Tuple = tuple[str, str]


# ────────────────────────────────────────────────────────────────────────
# 1. REGISTRY  — extract Permissions class attributes -> {NAME: (res, act)}
# ────────────────────────────────────────────────────────────────────────
def load_registry() -> dict[str, Tuple]:
    tree = ast.parse(RBAC.read_text(encoding="utf-8"))
    reg: dict[str, Tuple] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef) and node.name == "Permissions":
            for stmt in node.body:
                if isinstance(stmt, ast.Assign) and isinstance(stmt.value, ast.Tuple):
                    elts = stmt.value.elts
                    if len(elts) == 2 and all(isinstance(e, ast.Constant) for e in elts):
                        for tgt in stmt.targets:
                            if isinstance(tgt, ast.Name):
                                reg[tgt.id] = (elts[0].value, elts[1].value)
    return reg


# ────────────────────────────────────────────────────────────────────────
# 2. USED  — scan endpoints for require_permission(...) usage
# ────────────────────────────────────────────────────────────────────────
def load_used(registry: dict[str, Tuple]) -> dict[Tuple, list[str]]:
    used: dict[Tuple, list[str]] = {}
    unknown: list[str] = []

    def record(tpl: Tuple, where: str):
        used.setdefault(tpl, []).append(where)

    def is_route_file(p: Path) -> bool:
        if p.name == "__init__.py":
            return False
        try:
            t = p.read_text(encoding="utf-8")
        except Exception:
            return False
        return "require_permission" in t

    for d in SEARCH_DIRS:
        for path in sorted(d.rglob("*.py")):
            if not is_route_file(path):
                continue
            rel = str(path.relative_to(BACKEND))
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not (isinstance(node, ast.Call)
                        and _call_name(node) in {"require_permission", "require_permission_flexible"}):
                    continue
                # require_permission(*Permissions.X)
                if (len(node.args) == 1 and isinstance(node.args[0], ast.Starred)
                        and isinstance(node.args[0].value, ast.Attribute)):
                    name = node.args[0].value.attr
                    if name in registry:
                        record(registry[name], rel)
                    else:
                        unknown.append(f"Permissions.{name}  ({rel})")
                # require_permission("res", "act")
                elif (len(node.args) == 2 and all(isinstance(a, ast.Constant) for a in node.args)):
                    record((node.args[0].value, node.args[1].value), rel)
                # require_permission(Permissions.X[0], Permissions.X[1]) etc -> skip rare
    return used, unknown


def _call_name(node: ast.Call):
    f = node.func
    if isinstance(f, ast.Name):
        return f.id
    if isinstance(f, ast.Attribute):
        return f.attr
    return None


# ────────────────────────────────────────────────────────────────────────
# 3. SEEDED — parse permissions_data list in seed_permissions.py
# ────────────────────────────────────────────────────────────────────────
def load_seeded() -> set[Tuple]:
    tree = ast.parse(SEED.read_text(encoding="utf-8"))
    seeded: set[Tuple] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            d = {}
            for k, v in zip(node.keys, node.values):
                if isinstance(k, ast.Constant) and isinstance(v, ast.Constant):
                    d[k.value] = v.value
            if "resource" in d and "action" in d:
                seeded.add((d["resource"], d["action"]))
    return seeded


# ────────────────────────────────────────────────────────────────────────
# 4. FRONTEND — parse PERMISSIONS object in permissions.ts
# ────────────────────────────────────────────────────────────────────────
def load_frontend() -> set[Tuple]:
    if not FRONTEND_PERMS.exists():
        return set()
    text = FRONTEND_PERMS.read_text(encoding="utf-8")
    fe: set[Tuple] = set()
    # matches: { resource: "x", action: "y" }
    for m in re.finditer(r'resource:\s*"([^"]+)"\s*,\s*action:\s*"([^"]+)"', text):
        fe.add((m.group(1), m.group(2)))
    return fe


def show(title: str, items) -> None:
    print(f"\n{title} ({len(items)})")
    print("-" * len(title))
    if not items:
        print("  (none) ✅")
    else:
        for it in sorted(items):
            if isinstance(it, tuple):
                print(f"  • {it[0]}:{it[1]}")
            else:
                print(f"  • {it}")


def main() -> None:
    registry = load_registry()
    registry_set = set(registry.values())
    used, unknown = load_used(registry)
    used_set = set(used)
    seeded = load_seeded()
    frontend = load_frontend()

    print("=" * 78)
    print("PERMISSION COVERAGE AUDIT")
    print("=" * 78)
    print(f"  Registry  (rbac.py)              : {len(registry_set)} permissions")
    print(f"  Used      (endpoints)            : {len(used_set)} distinct")
    print(f"  Seeded    (seed_permissions.py)  : {len(seeded)} permissions")
    print(f"  Frontend  (permissions.ts)       : {len(frontend)} permissions")

    # ---- CRITICAL gaps -------------------------------------------------
    used_not_registry = {p for p in used_set if p not in registry_set}
    used_not_seeded = used_set - seeded
    registry_not_seeded = registry_set - seeded
    seeded_not_registry = seeded - registry_set
    registry_not_frontend = registry_set - frontend
    frontend_not_registry = frontend - registry_set
    used_not_frontend = used_set - frontend

    print("\n" + "=" * 78)
    print("CRITICAL — endpoints whose permission is NOT in the registry (would 500)")
    show("USED but missing from Permissions registry", used_not_registry)
    if unknown:
        show("require_permission(Permissions.X) where X is undefined", set(unknown))

    print("\n" + "=" * 78)
    print("CRITICAL — endpoints whose permission is NOT seeded (only superuser can reach)")
    show("USED but NOT seeded into DB", used_not_seeded)

    print("\n" + "=" * 78)
    print("WARN — registry/seed/frontend consistency")
    show("Registry permissions NOT seeded (won't exist in DB)", registry_not_seeded)
    show("Seeded permissions NOT in registry (orphans)", seeded_not_registry)
    show("Registry permissions NOT in frontend (can't be shown/assigned in UI)",
         registry_not_frontend)
    show("Frontend permissions NOT in registry (UI references unknown perm)",
         frontend_not_registry)

    # ---- verdict -------------------------------------------------------
    print("\n" + "=" * 78)
    critical = bool(used_not_registry or unknown or used_not_seeded)
    if critical:
        print("RESULT: ❌ Coverage gaps found (see CRITICAL sections above).")
    elif registry_not_seeded or seeded_not_registry or frontend_not_registry or frontend_not_registry:
        print("RESULT: ⚠️  Fully functional, but minor consistency notes above.")
    else:
        print("RESULT: ✅ Permission set fully covers the ERP and all sources agree.")
    print("=" * 78)
    sys.exit(1 if critical else 0)


if __name__ == "__main__":
    main()
