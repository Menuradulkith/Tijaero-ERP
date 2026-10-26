"""Minimal async load test. usage: load.py BASE USERS SECONDS [think_seconds]"""
import asyncio, random, statistics, sys, time, httpx

BASES, USERS, SECS = sys.argv[1].split(","), int(sys.argv[2]), int(sys.argv[3])
BASE = BASES[0]
THINK = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
API = BASE + "/api/v1"
APIS = [b + "/api/v1" for b in BASES]

import os
EXCL = os.environ.get("EXCLUDE", "")
def scenario():
    while True:
        s = _scenario()
        if s[0] != EXCL and (not os.environ.get("ONLY") or s[0] == os.environ["ONLY"]): return s

def _scenario():
    inv = random.randint(1, 300000)
    return random.choice([
        ("invoice_list",   "GET", f"/sales/list?skip={random.randint(0,5000)}&limit=50"),
        ("invoice_list",   "GET", "/sales/list?skip=0&limit=50"),
        ("invoice_detail", "GET", f"/sales/{inv}"),
        ("product_paged",  "GET", f"/inventory/products/paged?page={random.randint(1,300)}&page_size=50"),
        ("product_search", "GET", f"/inventory/products/search?q=Product%20{random.randint(1,20000)}"),
        ("customer_paged", "GET", f"/customers/paged?page={random.randint(1,150)}&page_size=50"),
        ("sales_stats",    "GET", "/sales/statistics"),
        ("health",         "GET", "/health"),
    ])

async def user(client, hdr, stop, res, api):
    while time.time() < stop:
        name, m, path = scenario()
        t = time.perf_counter()
        try:
            r = await client.request(m, api + path, headers=hdr)
            code = r.status_code
        except Exception as e:
            code = type(e).__name__
        res.setdefault(name, []).append((time.perf_counter() - t, code))
        if THINK: await asyncio.sleep(random.uniform(0.5, 1.5) * THINK)

async def main():
    async with httpx.AsyncClient(timeout=60, limits=httpx.Limits(max_connections=USERS + 5)) as c:
        tok = (await c.post(API + "/auth/login", data={"username": "admin", "password": "TjrAdmin@123"})).json()["access_token"]
        hdr = {"Authorization": "Bearer " + tok}
        res, stop = {}, time.time() + SECS
        await asyncio.gather(*[user(c, hdr, stop, res, APIS[i % len(APIS)]) for i in range(USERS)])
    allr = [x for v in res.values() for x in v]
    ok = [l for l, c in allr if c == 200]
    print(f"\n=== {USERS} users, {SECS}s, think={THINK}s -> {len(allr)} req, {len(allr)/SECS:.1f} req/s, ok={len(ok)}")
    print(f"{'endpoint':16} {'n':>6} {'p50ms':>7} {'p95ms':>7} {'p99ms':>7}  status")
    for n, v in sorted(res.items()):
        ls = sorted(l for l, c in v if c == 200) or [0]
        codes = {}
        for _, c in v: codes[c] = codes.get(c, 0) + 1
        q = lambda p: ls[min(len(ls) - 1, int(len(ls) * p))] * 1000
        print(f"{n:16} {len(v):6} {q(.5):7.0f} {q(.95):7.0f} {q(.99):7.0f}  {codes}")
asyncio.run(main())
