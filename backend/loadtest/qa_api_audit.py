"""OpenAPI-driven API audit. Run ONLY against a scratch-DB backend (it writes data).

usage: qa_api_audit.py BASE PHASES [PATH_PREFIX]
  BASE         e.g. http://127.0.0.1:8030
  PHASES       comma list of: authn, rbac, fuzz, query, mass
  PATH_PREFIX  optional, e.g. /api/v1/sales (limits the run to one module)
Writes findings as JSON lines to qa_api_audit_<phase>.jsonl and prints a summary.
"""
import asyncio, json, os, re, sys, time, random, string
import httpx

BASE = sys.argv[1].rstrip("/")
PHASES = sys.argv[2].split(",")
PREFIX = sys.argv[3] if len(sys.argv) > 3 else "/api/v1"
API = BASE + "/api/v1"
ADMIN = ("admin", os.environ.get("QA_ADMIN_PASSWORD", "admin123"))
CONC = int(os.environ.get("QA_CONC", "8"))

PUBLIC = re.compile(r"/(health|auth/login|auth/refresh|auth/token|openapi|docs|redoc)\b|^/api/v1/?$|/public/|/version")
# never mutate these: could lock out the admin, cost money (AI), or wipe the scratch DB for later phases
NO_MUTATE = re.compile(r"/(auth|users|groups|roles|permissions|chat|ai|assistant|backup|restore|purge|seed|migrat|import)", re.I)

XSS = '<img src=x onerror=alert(1)>"\'><script>alert(1)</script>'
SQLI = "' OR 1=1 --"


def load_spec():
    return httpx.get(API + "/openapi.json", timeout=60).json()


def resolve(spec, s, depth=0):
    if not isinstance(s, dict) or depth > 8:
        return s or {}
    if "$ref" in s:
        name = s["$ref"].split("/")[-1]
        return resolve(spec, spec["components"]["schemas"][name], depth + 1)
    for key in ("allOf",):
        if key in s:
            merged = {"type": "object", "properties": {}, "required": []}
            for sub in s[key]:
                r = resolve(spec, sub, depth + 1)
                merged["properties"].update(r.get("properties", {}))
                merged["required"] += r.get("required", [])
            return merged
    if "anyOf" in s:
        non_null = [x for x in s["anyOf"] if x.get("type") != "null"]
        if non_null:
            r = dict(resolve(spec, non_null[0], depth + 1))
            r["_nullable"] = True
            return r
    return s


def sample(spec, s, depth=0, field=""):
    s = resolve(spec, s)
    if "default" in s and s["default"] is not None:
        return s["default"]
    if "enum" in s:
        return s["enum"][0]
    t = s.get("type")
    if t == "object" or "properties" in s:
        if depth > 3:
            return {}
        return {k: sample(spec, v, depth + 1, k) for k, v in s.get("properties", {}).items()
                if k in s.get("required", [])}
    if t == "array":
        mn = s.get("minItems", 0)
        return [sample(spec, s.get("items", {}), depth + 1, field) for _ in range(max(mn, 1))] if depth < 3 else []
    if t == "integer":
        return max(1, s.get("minimum", 1))
    if t == "number":
        return max(1, s.get("minimum", 1))
    if t == "boolean":
        return False
    if t == "string":
        f = s.get("format")
        if f == "date":
            return "2026-11-05"
        if f == "date-time":
            return "2026-11-05T10:00:00"
        if f == "email":
            return "qa.fuzz@example.com"
        if "phone" in field or "contact" in field or "mobile" in field:
            return "+94771234567"
        n = s.get("minLength", 1)
        base = "QA-fz" + "".join(random.choices(string.ascii_lowercase, k=6))
        mx = s.get("maxLength")
        v = base if n <= len(base) else base + "x" * (n - len(base))
        return v[:mx] if mx else v
    return "QA-fz"


def path_params(path):
    return re.findall(r"{([^}]+)}", path)


def fill_path(path, value="1"):
    return re.sub(r"{[^}]+}", str(value), path)


class Client:
    def __init__(self):
        self.c = httpx.AsyncClient(timeout=60, limits=httpx.Limits(max_connections=CONC + 4))
        self.sem = asyncio.Semaphore(CONC)

    async def req(self, method, url, **kw):
        async with self.sem:
            t = time.perf_counter()
            try:
                r = await self.c.request(method, url, **kw)
                return r.status_code, r.text[:400], (time.perf_counter() - t) * 1000, r.headers
            except Exception as e:
                return "ERR:" + type(e).__name__, "", (time.perf_counter() - t) * 1000, {}

    async def login(self, u, p):
        r = await self.c.post(API + "/auth/login", data={"username": u, "password": p})
        r.raise_for_status()
        return {"Authorization": "Bearer " + r.json()["access_token"]}


def operations(spec):
    for path, item in spec["paths"].items():
        if not path.startswith(PREFIX):
            continue
        for m, op in item.items():
            if m in ("get", "post", "put", "patch", "delete"):
                yield path, m.upper(), op


def body_schema(spec, op):
    rb = op.get("requestBody", {}).get("content", {})
    if "application/json" in rb:
        return resolve(spec, rb["application/json"].get("schema", {}))
    return None


def write(phase, rows):
    with open(f"qa_api_audit_{phase}.jsonl", "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, default=str) + "\n")


# ---------------- phases ----------------

async def phase_authn(spec, cl):
    """No token and a forged token must give 401/403 on every non-public route."""
    rows, tasks = [], []
    forged = {"Authorization": "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.forged"}
    for path, m, op in operations(spec):
        if PUBLIC.search(path):
            continue
        url = API.replace("/api/v1", "") + fill_path(path)
        for label, hdr in (("none", {}), ("forged", forged)):
            kw = {"headers": hdr}
            if m in ("POST", "PUT", "PATCH"):
                kw["json"] = {}
            tasks.append((label, path, m, cl.req(m, url, **kw)))
    res = await asyncio.gather(*[t[3] for t in tasks])
    for (label, path, m, _), (code, body, ms, _h) in zip(tasks, res):
        if code in (401, 403):
            continue
        sev = "High" if isinstance(code, int) and code < 300 else ("High" if code == 422 else "Medium")
        rows.append({"phase": "authn", "token": label, "method": m, "path": path, "status": code,
                     "sev": sev, "body": body[:200]})
    return rows, len(tasks)


async def phase_rbac(spec, cl, admin_hdr):
    """A user with a role that holds NO permissions calls every GET; any 2xx with data is a leak."""
    suffix = "".join(random.choices(string.digits, k=5))
    code, body, *_ = await cl.req("POST", API + "/groups/", headers=admin_hdr,
                                  json={"name": f"QA-NoPerm-{suffix}", "permission_ids": []})
    gid = int(re.search(r'"id":\s*(\d+)', body).group(1)) if code in (200, 201) else None
    code2, body2, *_ = await cl.req("GET", API + "/branches/?page=1&size=1", headers=admin_hdr)
    bid = int(re.search(r'"id":\s*(\d+)', body2).group(1))
    uname = f"qa-noperm-{suffix}"
    pw = "QaNoPerm#2026x"
    code3, body3, *_ = await cl.req("POST", API + "/users/", headers=admin_hdr, json={
        "username": uname, "first_name": "QA", "last_name": "NoPerm", "password": pw,
        "employee_id": f"QA-NP-{suffix}", "branch_ids": [bid], "primary_branch_id": bid, "group_ids": [gid],
        "email": f"{uname}@example.com"})
    if code3 not in (200, 201):
        return [{"phase": "rbac", "error": f"setup failed group={code} user={code3} {body3[:200]}"}], 0
    hdr = await cl.login(uname, pw)
    # change-password trap: some apps force it on first login; note it and continue
    rows, tasks = [], []
    for path, m, op in operations(spec):
        if m != "GET" or PUBLIC.search(path):
            continue
        url = API.replace("/api/v1", "") + fill_path(path)
        tasks.append((path, cl.req("GET", url, headers=hdr)))
    res = await asyncio.gather(*[t[1] for t in tasks])
    for (path, _), (code, body, ms, _h) in zip(tasks, res):
        if code in (401, 403, 404, 405, 422):
            continue
        empty = body.strip() in ("[]", "{}", "null", "") or re.match(r'^\{"items":\[\],"total":0', body.strip())
        rows.append({"phase": "rbac", "path": path, "status": code, "empty": bool(empty),
                     "sev": "Info" if empty or code != 200 else "High", "body": body[:200]})
    rows.append({"phase": "rbac", "user": uname, "group_id": gid})
    return rows, len(tasks)


def mutations(spec, schema):
    """Yield (label, field, value) for per-field bad values."""
    props = schema.get("properties", {})
    for k, v in list(props.items())[:25]:
        r = resolve(spec, v)
        t = r.get("type")
        if t == "string" and r.get("format") not in ("date", "date-time") and "enum" not in r:
            yield "str10k", k, "QA-" + "x" * 10000
            yield "xss", k, XSS
            yield "ws", k, "   "
        elif t == "string" and r.get("format") == "date":
            yield "baddate", k, "2026-02-30"
            yield "date9999", k, "9999-12-31"
        elif t == "integer":
            yield "int64", k, 2 ** 63
            yield "neg", k, -1
            yield "zero", k, 0
        elif t == "number":
            yield "huge", k, 1e308
            yield "neg", k, -1
            yield "manydec", k, 1.123456789123
        elif "enum" in r:
            yield "enum", k, "zz_not_in_enum"
        elif t == "array":
            yield "bigarray", k, [sample(spec, r.get("items", {}))] * 2000
        yield "wrongtype", k, {"x": [1]}


async def first_id(cl, hdr, coll):
    """One real id per collection so PUT/PATCH /{id} hits a real row (bodies are truncated, so regex)."""
    for q in ("?limit=1", "?page=1&size=1", "?page=1&page_size=1", ""):
        code, body, *_ = await cl.req("GET", API.replace("/api/v1", "") + coll + q, headers=hdr)
        if code == 200:
            m = re.search(r'"id":\s*(\d+)', body)
            return m.group(1) if m else None
    return None


async def phase_fuzz(spec, cl, hdr):
    rows, n = [], 0
    jobs = []
    for path, m, op in operations(spec):
        if m not in ("POST", "PUT", "PATCH") or NO_MUTATE.search(path):
            continue
        sch = body_schema(spec, op)
        if not sch or not sch.get("properties"):
            continue
        jobs.append((path, m, sch))
    print(f"fuzz: {len(jobs)} write operations")
    id_cache = {}
    for i, (path, m, sch) in enumerate(jobs):
        url_path = path
        if path_params(path):
            coll = path.split("/{")[0]
            if coll not in id_cache:
                id_cache[coll] = await first_id(cl, hdr, coll + ("/" if not coll.endswith("/") else ""))
            url_path = fill_path(path, id_cache[coll] or 1)
        url = API.replace("/api/v1", "") + url_path
        base = sample(spec, sch)
        bcode, bbody, *_ = await cl.req(m, url, headers=hdr, json=base)
        n += 1
        if bcode == "ERR" or (isinstance(bcode, int) and bcode >= 500) or str(bcode).startswith("ERR"):
            rows.append({"phase": "fuzz", "method": m, "path": path, "case": "base", "status": bcode,
                         "sev": "High", "body": bbody[:300]})
        tasks = []
        for label, field, val in mutations(spec, sch):
            b = dict(base)
            b[field] = val
            tasks.append((label, field, cl.req(m, url, headers=hdr, json=b)))
        res = await asyncio.gather(*[t[2] for t in tasks])
        n += len(tasks)
        for (label, field, _), (code, body, ms, _h) in zip(tasks, res):
            if str(code).startswith("ERR") or (isinstance(code, int) and code >= 500):
                rows.append({"phase": "fuzz", "method": m, "path": path, "case": label, "field": field,
                             "status": code, "base_status": bcode, "sev": "High", "body": body[:300]})
            elif isinstance(code, int) and code < 300 and label in ("str10k", "int64", "huge", "baddate", "bigarray", "wrongtype"):
                rows.append({"phase": "fuzz", "method": m, "path": path, "case": label, "field": field,
                             "status": code, "base_status": bcode, "sev": "Medium", "body": body[:160]})
            elif isinstance(code, int) and code < 300 and label == "neg" and re.search(
                    r"(qty|quantity|price|amount|cost|rate|total|discount|salary|days|limit)", field, re.I):
                rows.append({"phase": "fuzz", "method": m, "path": path, "case": label, "field": field,
                             "status": code, "base_status": bcode, "sev": "Medium", "body": body[:160]})
            elif isinstance(code, int) and code < 300 and label == "ws":
                rows.append({"phase": "fuzz", "method": m, "path": path, "case": label, "field": field,
                             "status": code, "base_status": bcode, "sev": "Low", "body": body[:120]})
            if code in (500,) and re.search(r"(Traceback|psycopg|sqlalchemy|File \")", body):
                rows[-1]["leak"] = True
        if i % 25 == 0:
            print(f"  {i}/{len(jobs)} ops, {n} requests, {len(rows)} findings", flush=True)
    return rows, n


async def phase_query(spec, cl, hdr):
    """Bad query parameters on every GET: negative paging, huge limits, injection, bad dates."""
    rows, tasks = [], []
    for path, m, op in operations(spec):
        if m != "GET" or path_params(path) or re.search(r"(export|pdf|download|stream|chat)", path):
            continue
        params = [p for p in op.get("parameters", []) if p.get("in") == "query"]
        if not params:
            continue
        for p in params:
            s = resolve(spec, p.get("schema", {}))
            t, nm = s.get("type"), p["name"]
            vals = []
            if t == "integer":
                vals = [-1, 2 ** 63, "abc"]
            elif t == "string" and s.get("format") == "date":
                vals = ["2026-02-30", "0001-01-01"]
            elif t == "string":
                vals = [SQLI, "%", "_", "\\", "x" * 5000]
            for v in vals:
                url = API.replace("/api/v1", "") + path
                tasks.append((path, nm, v, cl.req("GET", url, headers=hdr, params={nm: v})))
    res = await asyncio.gather(*[t[3] for t in tasks])
    for (path, nm, v, _), (code, body, ms, _h) in zip(tasks, res):
        if str(code).startswith("ERR") or (isinstance(code, int) and code >= 500) or ms > 5000:
            rows.append({"phase": "query", "path": path, "param": nm, "value": str(v)[:40], "status": code,
                         "ms": round(ms), "sev": "High" if code != 200 else "Medium", "body": body[:200]})
    return rows, len(tasks)


async def phase_mass(spec, cl, hdr):
    """Create with privileged extras; flag if the response echoes the injected value."""
    extras = {"id": 987654, "created_by": 987654, "updated_by": 987654, "is_superuser": True,
              "status": "approved", "approved": True, "is_approved": True, "approved_by": 987654,
              "branch_code": "ZZQA", "version": "zz", "paid_amount": 999999, "balance": -999999,
              "customer_no": "QA-MASS-1", "supplier_no": "QA-MASS-1"}
    rows, n = [], 0
    for path, m, op in operations(spec):
        if m != "POST" or path_params(path) or NO_MUTATE.search(path):
            continue
        sch = body_schema(spec, op)
        if not sch or not sch.get("properties"):
            continue
        b = sample(spec, sch)
        b.update({k: v for k, v in extras.items() if k not in b})
        code, body, *_ = await cl.req("POST", API.replace("/api/v1", "") + path, headers=hdr, json=b)
        n += 1
        if isinstance(code, int) and code < 300:
            try:
                d = json.loads(body) if body.endswith("}") else {}
            except Exception:
                d = {}
            echoed = [k for k, v in extras.items() if isinstance(d, dict) and d.get(k) == v]
            if echoed:
                rows.append({"phase": "mass", "path": path, "status": code, "echoed": echoed, "sev": "High"})
        elif isinstance(code, int) and code >= 500:
            rows.append({"phase": "mass", "path": path, "status": code, "sev": "High", "body": body[:200]})
    return rows, n


async def phase_scope(spec, cl, admin_hdr):
    """Full-permission user limited to ONE branch: lists must not return, and /{id} must not open,
    records of other branches."""
    suffix = "".join(random.choices(string.digits, k=5))
    code, body, *_ = await cl.req("GET", API + "/groups/?limit=200", headers=admin_hdr)
    groups = json.loads((await cl.c.get(API + "/groups/?limit=200", headers=admin_hdr)).text)
    groups = groups.get("items", groups) if isinstance(groups, dict) else groups
    adm = max(groups, key=lambda g: len(g.get("permissions") or []))
    perm_ids = [p["id"] if isinstance(p, dict) else p for p in adm.get("permissions") or []]
    code, body, *_ = await cl.req("POST", API + "/groups/", headers=admin_hdr,
                                  json={"name": f"QA-Scope-{suffix}", "permission_ids": perm_ids})
    gid = int(re.search(r'"id":\s*(\d+)', body).group(1))
    br = json.loads((await cl.c.get(API + "/branches/?page=1&size=200", headers=admin_hdr)).text)
    br = br.get("items", br) if isinstance(br, dict) else br
    mine = next(b for b in br if b["branch_code"] == os.environ.get("QA_SCOPE_BRANCH", "QA-BR-A"))
    uname, pw = f"qa-scope-{suffix}", "QaScope#2026xY"
    code3, body3, *_ = await cl.req("POST", API + "/users/", headers=admin_hdr, json={
        "username": uname, "first_name": "QA", "last_name": "Scope", "password": pw,
        "employee_id": f"QA-SC-{suffix}", "branch_ids": [mine["id"]], "primary_branch_id": mine["id"],
        "group_ids": [gid], "email": f"{uname}@example.com"})
    if code3 not in (200, 201):
        return [{"phase": "scope", "error": f"user create {code3} {body3[:200]}"}], 0
    hdr = await cl.login(uname, pw)
    my = mine["branch_code"]
    print(f"scope user {uname} on branch {my}, {len(perm_ids)} permissions")
    rows, n = [], 0
    by_id = {}
    for path, m, op in operations(spec):
        if m == "GET" and re.fullmatch(r".*/\{[a-z_]*id\}", path) and path.count("{") == 1:
            by_id[path.rsplit("/{", 1)[0]] = path
    for path, m, op in operations(spec):
        if m != "GET" or path_params(path) or re.search(r"(export|pdf|download|stream|chat|csv|print)", path):
            continue
        url = API.replace("/api/v1", "") + path
        ra = await cl.c.get(url, headers=admin_hdr, params={"limit": 200, "size": 200, "page_size": 200})
        if ra.status_code != 200:
            continue
        try:
            d = ra.json()
        except Exception:
            continue
        items = d.get("items", d) if isinstance(d, dict) else d
        if not isinstance(items, list) or not items or not isinstance(items[0], dict) or "branch_code" not in items[0]:
            continue
        foreign = [x for x in items if x.get("branch_code") and x["branch_code"] != my]
        if not foreign:
            continue
        ru = await cl.c.get(url, headers=hdr, params={"limit": 200, "size": 200, "page_size": 200})
        n += 2
        if ru.status_code == 200:
            du = ru.json()
            iu = du.get("items", du) if isinstance(du, dict) else du
            leak = [x.get("branch_code") for x in iu if isinstance(x, dict) and x.get("branch_code") and x["branch_code"] != my] if isinstance(iu, list) else []
            if leak:
                rows.append({"phase": "scope", "kind": "list", "path": path, "foreign_rows": len(leak),
                             "branches": sorted(set(leak))[:5], "sev": "High"})
        key = path.rstrip("/")
        detail = by_id.get(key)
        if detail and "id" in foreign[0]:
            rd = await cl.c.get(API.replace("/api/v1", "") + fill_path(detail, foreign[0]["id"]), headers=hdr)
            n += 1
            if rd.status_code == 200:
                rows.append({"phase": "scope", "kind": "by-id", "path": detail, "id": foreign[0]["id"],
                             "branch": foreign[0]["branch_code"], "sev": "High"})
    rows.append({"phase": "scope", "user": uname, "group_id": gid, "branch": my})
    return rows, n


async def main():
    spec = load_spec()
    cl = Client()
    admin = await cl.login(*ADMIN)
    for ph in PHASES:
        t = time.time()
        if ph == "authn":
            rows, n = await phase_authn(spec, cl)
        elif ph == "rbac":
            rows, n = await phase_rbac(spec, cl, admin)
        elif ph == "fuzz":
            rows, n = await phase_fuzz(spec, cl, admin)
        elif ph == "query":
            rows, n = await phase_query(spec, cl, admin)
        elif ph == "mass":
            rows, n = await phase_mass(spec, cl, admin)
        elif ph == "scope":
            rows, n = await phase_scope(spec, cl, admin)
        else:
            continue
        write(ph, rows)
        sev = {}
        for r in rows:
            sev[r.get("sev", "?")] = sev.get(r.get("sev", "?"), 0) + 1
        print(f"[{ph}] {n} requests in {time.time() - t:.0f}s -> {len(rows)} rows {sev}", flush=True)


asyncio.run(main())
