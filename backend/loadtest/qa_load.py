"""Cross-module load test. Run ONLY against a scratch-DB backend (it creates customers).

usage: qa_load.py BASE STEPS SECONDS [think_seconds]
  STEPS  comma list of virtual-user counts, e.g. 5,25,50 (ramped in order)
Stops ramping when a step has > 5 % 5xx / timeouts.
"""
import asyncio, os, random, sys, time
import httpx

BASE = sys.argv[1].rstrip("/") + "/api/v1"
STEPS = [int(x) for x in sys.argv[2].split(",")]
SECS = int(sys.argv[3])
THINK = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
ADMIN = ("admin", os.environ.get("QA_ADMIN_PASSWORD", "admin123"))

READS = [
    ("sales_list", "/sales/?skip={r300}&limit=50"),
    ("sales_pending", "/sales/pending-approval?skip=0&limit=50"),
    ("sales_returns", "/sales/returns/?skip=0&limit=50"),
    ("quotes", "/sales/quotes/?skip=0&limit=50"),
    ("customers_paged", "/customers/paged?page={r5}&page_size=50"),
    ("products_paged", "/inventory/products/paged?page={r5}&page_size=50"),
    ("products_search", "/inventory/products/search?q=QA"),
    ("suppliers", "/purchasing/suppliers?skip=0&limit=50"),
    ("po_list", "/purchasing/orders?skip=0&limit=50"),
    ("grn_list", "/purchasing/grn?skip=0&limit=50"),
    ("pi_outstanding", "/purchasing/invoices/outstanding"),
    ("cashbook", "/finance/cashbook?date_from=2026-10-01&date_to=2026-11-05"),
    ("journals", "/finance/accounting/journal-entries?limit=25"),
    ("coa", "/finance/accounting/chart-of-accounts"),
    ("day_end", "/finance/accounting/reports/day-end-reconciliation?date=2026-11-05"),
    ("employees", "/employees/?skip=0&limit=50"),
    ("transfer_notes", "/warehouse/transfer-notes?skip=0&limit=50"),
    ("report_catalog", "/reporting/center/catalog"),
    ("reference_data", "/common/reference-data?include=branches,products&products_limit=500"),
    ("notif_stats", "/notifications/stats"),
]
WEIGHTS = {"create_customer": 4, "login": 1}


def pick():
    if random.random() < 0.05:
        return random.choices(list(WEIGHTS), weights=list(WEIGHTS.values()))[0], None
    name, path = random.choice(READS)
    return name, path.replace("{r300}", str(random.randint(0, 300))).replace("{r5}", str(random.randint(1, 5)))


async def user(c, hdr, stop, res):
    while time.time() < stop:
        name, path = pick()
        t = time.perf_counter()
        try:
            if name == "create_customer":
                n = random.randint(10_000_000, 99_999_999)
                r = await c.post(BASE + "/customers/", headers=hdr, json={
                    "customer_name": f"QA-Load {n}", "title": "Mr", "gender": "m", "civil_status": "single",
                    "no_of_kids": "0", "mobile_contact_number": f"+9477{n % 10_000_000:07d}"})
            elif name == "login":
                r = await c.post(BASE + "/auth/login", data={"username": ADMIN[0], "password": ADMIN[1]})
            else:
                r = await c.get(BASE + path, headers=hdr)
            code = r.status_code
        except Exception as e:
            code = type(e).__name__
        res.setdefault(name, []).append((time.perf_counter() - t, code))
        await asyncio.sleep(random.uniform(0.4, 1.6) * THINK)


def report(vus, res, secs):
    allr = [x for v in res.values() for x in v]
    bad = [c for _, c in allr if not (isinstance(c, int) and c < 500)]
    print(f"\n=== {vus} VUs, {secs}s -> {len(allr)} req, {len(allr) / secs:.1f} req/s, 5xx/timeouts {len(bad)} ({100 * len(bad) / max(1, len(allr)):.2f} %)")
    print(f"{'endpoint':16} {'n':>5} {'p50':>6} {'p95':>6} {'p99':>6}  status")
    for n, v in sorted(res.items(), key=lambda kv: -sorted(l for l, _ in kv[1])[len(kv[1]) // 2]):
        ls = sorted(l for l, c in v) or [0]
        codes = {}
        for _, c in v:
            codes[c] = codes.get(c, 0) + 1
        q = lambda p: ls[min(len(ls) - 1, int(len(ls) * p))] * 1000
        print(f"{n:16} {len(v):5} {q(.5):6.0f} {q(.95):6.0f} {q(.99):6.0f}  {codes}")
    return len(bad) / max(1, len(allr))


async def main():
    async with httpx.AsyncClient(timeout=60, limits=httpx.Limits(max_connections=max(STEPS) + 10)) as c:
        tok = (await c.post(BASE + "/auth/login", data={"username": ADMIN[0], "password": ADMIN[1]})).json()["access_token"]
        hdr = {"Authorization": "Bearer " + tok}
        print("warm-up:", {n: (await c.get(BASE + p.replace("{r300}", "0").replace("{r5}", "1"), headers=hdr)).status_code for n, p in READS})
        for vus in STEPS:
            res, stop = {}, time.time() + SECS
            await asyncio.gather(*[user(c, hdr, stop, res) for _ in range(vus)])
            if report(vus, res, SECS) > 0.05:
                print("stopping: > 5 % errors")
                break

asyncio.run(main())
