#!/usr/bin/env python3
"""
Authorization QA Audit
=======================
Static analysis of every FastAPI route in app/modules + app/auth to verify
that each endpoint enforces an RBAC permission (require_permission) or is an
intentional self-scoped / public exception.

It inspects three places a guard can live:
  1. Router-level `dependencies=[...]`           (APIRouter(...))
  2. Route-decorator `dependencies=[...]`         (@router.get(..., dependencies=[...]))
  3. Function parameter defaults                  (x: User = Depends(require_permission(...)))

Output: a per-file table plus a summary of UNGUARDED routes (auth-only or open).
"""
from __future__ import annotations

import ast
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

BACKEND = Path(__file__).resolve().parent.parent
SEARCH_DIRS = [BACKEND / "app" / "modules", BACKEND / "app" / "auth"]

# Calls that mean "permission enforced"
PERMISSION_FUNCS = {"require_permission", "require_permission_flexible"}
# Calls that mean "authenticated only" (no specific permission)
AUTH_ONLY_FUNCS = {
    "get_current_user",
    "get_current_active_user",
    "get_current_user_flexible",
    "get_user_branch_filter",
}

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


@dataclass
class RouteInfo:
    file: str
    func: str
    method: str
    path: str
    lineno: int
    permissions: list[str] = field(default_factory=list)
    auth_only: list[str] = field(default_factory=list)
    has_superuser_check: bool = False

    @property
    def guarded(self) -> bool:
        return bool(self.permissions)

    @property
    def status(self) -> str:
        if self.permissions:
            return "OK"
        if self.has_superuser_check:
            return "SUPERUSER"
        if self.auth_only:
            return "AUTH-ONLY"
        return "OPEN"


def _call_name(node: ast.AST) -> Optional[str]:
    """Return the simple function name of a Call node."""
    if isinstance(node, ast.Call):
        f = node.func
        if isinstance(f, ast.Name):
            return f.id
        if isinstance(f, ast.Attribute):
            return f.attr
    return None


def _extract_permission_arg(call: ast.Call) -> Optional[str]:
    """From require_permission(*Permissions.FOO) or require_permission('x','y')
    return a readable label."""
    parts = []
    for a in call.args:
        if isinstance(a, ast.Starred) and isinstance(a.value, ast.Attribute):
            parts.append(a.value.attr)
        elif isinstance(a, ast.Attribute):
            parts.append(a.attr)
        elif isinstance(a, ast.Constant):
            parts.append(str(a.value))
    return ".".join(parts) if parts else "?"


def _scan_dependency_list(elts: list[ast.expr], route: RouteInfo) -> None:
    """Scan a list of Depends(...) entries."""
    for el in elts:
        # Depends(require_permission(*Permissions.X)) OR Security(...)
        if isinstance(el, ast.Call) and _call_name(el) in {"Depends", "Security"}:
            if el.args:
                inner = el.args[0]
                inner_name = _call_name(inner)
                if inner_name in PERMISSION_FUNCS and isinstance(inner, ast.Call):
                    route.permissions.append(_extract_permission_arg(inner))
                elif inner_name in AUTH_ONLY_FUNCS:
                    route.auth_only.append(inner_name)
                elif isinstance(inner, ast.Name) and inner.id in AUTH_ONLY_FUNCS:
                    route.auth_only.append(inner.id)


def _scan_router_level(tree: ast.Module) -> tuple[list[str], list[str]]:
    """Find APIRouter(dependencies=[...]) guards applied to all routes."""
    perms: list[str] = []
    auth: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and _call_name(node) == "APIRouter":
            for kw in node.keywords:
                if kw.arg == "dependencies" and isinstance(kw.value, ast.List):
                    tmp = RouteInfo("", "", "", "", 0)
                    _scan_dependency_list(kw.value.elts, tmp)
                    perms += tmp.permissions
                    auth += tmp.auth_only
    return perms, auth


def _func_has_superuser_check(func: ast.FunctionDef) -> bool:
    src_names = set()
    for node in ast.walk(func):
        if isinstance(node, ast.Attribute) and node.attr == "is_superuser":
            return True
        if isinstance(node, ast.Call):
            n = _call_name(node)
            if n and "superuser" in n.lower():
                return True
        if isinstance(node, ast.Name):
            src_names.add(node.id)
    return any("superuser" in n.lower() for n in src_names)


def scan_file(path: Path) -> list[RouteInfo]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    router_perms, router_auth = _scan_router_level(tree)
    routes: list[RouteInfo] = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for dec in node.decorator_list:
            if not isinstance(dec, ast.Call):
                continue
            dname = _call_name(dec)
            # decorator must be @router.<method>(...)
            if not (isinstance(dec.func, ast.Attribute) and dec.func.attr in HTTP_METHODS):
                continue
            method = dec.func.attr
            path_arg = ""
            if dec.args and isinstance(dec.args[0], ast.Constant):
                path_arg = str(dec.args[0].value)

            route = RouteInfo(
                file=str(path.relative_to(BACKEND)),
                func=node.name,
                method=method.upper(),
                path=path_arg,
                lineno=node.lineno,
            )
            # 1. router-level guards
            route.permissions += list(router_perms)
            route.auth_only += list(router_auth)
            # 2. decorator-level dependencies=[...]
            for kw in dec.keywords:
                if kw.arg == "dependencies" and isinstance(kw.value, ast.List):
                    _scan_dependency_list(kw.value.elts, route)
            # 3. function-parameter defaults
            for default in node.args.defaults:
                if isinstance(default, ast.Call) and _call_name(default) in {"Depends", "Security"}:
                    if default.args:
                        inner = default.args[0]
                        inner_name = _call_name(inner)
                        if inner_name in PERMISSION_FUNCS and isinstance(inner, ast.Call):
                            route.permissions.append(_extract_permission_arg(inner))
                        elif inner_name in AUTH_ONLY_FUNCS:
                            route.auth_only.append(inner_name)
                        elif isinstance(inner, ast.Name) and inner.id in AUTH_ONLY_FUNCS:
                            route.auth_only.append(inner.id)
            route.has_superuser_check = _func_has_superuser_check(node)
            routes.append(route)
    return routes


def _is_route_file(path: Path) -> bool:
    """Any python file that defines FastAPI routes (@router.<method>)."""
    if path.name == "__init__.py":
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except Exception:
        return False
    return "@router." in text and "APIRouter" in text


def main() -> None:
    all_routes: list[RouteInfo] = []
    seen: set[Path] = set()
    for d in SEARCH_DIRS:
        for path in sorted(d.rglob("*.py")):
            if path in seen or not _is_route_file(path):
                continue
            seen.add(path)
            all_routes.extend(scan_file(path))

    # Group by file
    by_file: dict[str, list[RouteInfo]] = {}
    for r in all_routes:
        by_file.setdefault(r.file, []).append(r)

    unguarded: list[RouteInfo] = []
    print("=" * 100)
    print("AUTHORIZATION AUDIT — per endpoint")
    print("=" * 100)
    for file in sorted(by_file):
        print(f"\n### {file}")
        for r in sorted(by_file[file], key=lambda x: x.lineno):
            perm = ",".join(sorted(set(r.permissions))) or "-"
            flag = "" if r.status == "OK" else f"   <== {r.status}"
            print(f"  [{r.status:9}] {r.method:6} {r.path:55} {perm}{flag}")
            if r.status in {"AUTH-ONLY", "OPEN"}:
                unguarded.append(r)

    print("\n" + "=" * 100)
    print(f"SUMMARY: {len(all_routes)} routes scanned")
    print("=" * 100)
    counts: dict[str, int] = {}
    for r in all_routes:
        counts[r.status] = counts.get(r.status, 0) + 1
    for k in ("OK", "SUPERUSER", "AUTH-ONLY", "OPEN"):
        print(f"  {k:10}: {counts.get(k, 0)}")

    if unguarded:
        print("\n" + "-" * 100)
        print(f"ENDPOINTS WITHOUT A SPECIFIC PERMISSION ({len(unguarded)}):")
        print("-" * 100)
        for r in unguarded:
            auth = ",".join(sorted(set(r.auth_only))) or "none"
            print(f"  {r.status:9} {r.method:6} {r.path:50} [{r.file}:{r.lineno}] (auth={auth}) {r.func}")


if __name__ == "__main__":
    main()
