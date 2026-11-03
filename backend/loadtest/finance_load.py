"""Finance load test: reports and ledger reads plus an expense write cycle.

usage: DATABASE_URL=.../erp_loadtest python finance_load.py BASE USERS SECONDS [think_seconds]
Mints its own token (no login rate limit). Never point it at the dev DB.
"""
import asyncio, os, random, sys, time
from datetime import date

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
assert os.environ.get("DATABASE_URL", "").endswith("/erp_loadtest"), "refusing: DATABASE_URL must point at erp_loadtest"

BASE, USERS, SECS = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
THINK = float(sys.argv[4]) if len(sys.argv) > 4 else 0.0
API = BASE + "/api/v1"
TODAY = date.today()
YEAR = TODAY.year
A = "/finance/accounting"


def token() -> str:
    import app.models  # noqa: F401
    from app.auth.models import User
    from app.core.security import create_access_token, get_password_marker
    from app.db.session import SessionLocal

    db = SessionLocal()
    u = db.query(User).filter(User.is_superuser.is_(True), User.is_active.is_(True)).first()
    return create_access_token({"sub": str(u.id), "pwd": get_password_marker(u.hashed_password)})


def branch() -> str:
    from sqlalchemy import text
    from app.db.session import SessionLocal

    return SessionLocal().execute(text("select branch_code from branches where active order by branch_code limit 1")).scalar()


READS = [
    ("trial_balance", f"{A}/general-ledger/trial-balance?fiscal_year={YEAR}"),
    ("balance_sheet", f"{A}/reports/balance-sheet?fiscal_year={YEAR}"),
    ("income_stmt", f"{A}/reports/income-statement?fiscal_year={YEAR}"),
    ("gl_list", f"{A}/general-ledger?skip={{skip}}&limit=50"),
    ("je_list", f"{A}/journal-entries?skip={{skip}}&limit=50"),
    ("cashbook", f"/finance/cashbook?date_from={TODAY.replace(day=1)}&date_to={TODAY}"),
    ("day_end", f"{A}/reports/day-end-reconciliation?date={TODAY}"),
    ("vat_return", f"{A}/reports/vat-return?date_from={TODAY.replace(day=1)}&date_to={TODAY}"),
    ("ar_aging", "/customers/reports/aging"),
    ("ar_outstanding", "/customers/outstanding-documents"),
    ("ap_aging", "/purchasing/reports/payables-aging"),
    ("expenses_list", "/finance/expenses?skip=0&limit=50"),
]


async def expense_cycle(c, hdr, br):
    """Create -> submit -> approve -> pay: one expense, one journal, one cashbook row."""
    r = await c.post(API + "/finance/expenses", headers=hdr, json={
        "expense_category": "Office Supplies", "expenses_method": "cash", "expense_amount": "10.00",
        "branch_code": br, "vendor_name": "LOAD-TEST", "description": "load test"})
    if r.status_code != 201:
        return r.status_code
    eid = r.json()["id"]
    for step, body in (("submit", None), ("approve", {}), ("process-payment", {"payment_method": "cash"})):
        r = await (c.post(f"{API}/finance/expenses/{eid}/{step}", headers=hdr, json=body) if body is not None
                   else c.post(f"{API}/finance/expenses/{eid}/{step}", headers=hdr))
        if r.status_code != 200:
            return r.status_code
    return 200


async def user(c, hdr, br, stop, res):
    while time.time() < stop:
        t = time.perf_counter()
        if random.random() < 0.15:
            name = "expense_cycle(4 req)"
            try:
                code = await expense_cycle(c, hdr, br)
            except Exception as e:  # noqa: BLE001
                code = type(e).__name__
        else:
            name, path = random.choice(READS)
            try:
                code = (await c.get(API + path.format(skip=random.randint(0, 20000)), headers=hdr)).status_code
            except Exception as e:  # noqa: BLE001
                code = type(e).__name__
        res.setdefault(name, []).append((time.perf_counter() - t, code))
        if THINK:
            await asyncio.sleep(random.uniform(0.5, 1.5) * THINK)


async def main():
    hdr = {"Authorization": "Bearer " + token()}
    br = branch()
    async with httpx.AsyncClient(timeout=60, limits=httpx.Limits(max_connections=USERS + 5)) as c:
        res, stop = {}, time.time() + SECS
        await asyncio.gather(*[user(c, hdr, br, stop, res) for _ in range(USERS)])
    allr = [x for v in res.values() for x in v]
    ok = [l for l, c in allr if c == 200]
    print(f"\n=== {USERS} users, {SECS}s, think={THINK}s -> {len(allr)} ops, {len(allr)/SECS:.1f} ops/s, ok={len(ok)}")
    print(f"{'operation':22} {'n':>5} {'p50ms':>7} {'p95ms':>7} {'p99ms':>7}  status")
    for n, v in sorted(res.items()):
        ls = sorted(l for l, c in v if c == 200) or [0]
        codes = {}
        for _, c in v:
            codes[c] = codes.get(c, 0) + 1
        q = lambda p: ls[min(len(ls) - 1, int(len(ls) * p))] * 1000  # noqa: E731
        print(f"{n:22} {len(v):5} {q(.5):7.0f} {q(.95):7.0f} {q(.99):7.0f}  {codes}")


asyncio.run(main())
