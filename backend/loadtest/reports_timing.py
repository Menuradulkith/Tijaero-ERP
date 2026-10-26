"""Time report/dashboard endpoints in-process against the load-test DB (1 user, warm).
usage: reports_timing.py [--seed]   (--seed: chart of accounts + spread the bulk GL rows)"""
import sys, time
sys.path.insert(0, '.')
from app.db.base import Base  # noqa
from app.models import *  # noqa
from app.db.session import engine
from sqlalchemy import event, text
from fastapi.testclient import TestClient
from app.main import app
import logging; logging.disable(logging.CRITICAL)

c = TestClient(app)
tok = c.post("/api/v1/auth/login", data={"username": "admin", "password": "TjrAdmin@123"}).json()["access_token"]
h = {"Authorization": "Bearer " + tok}

if "--seed" in sys.argv:
    print("seed accounts:", c.post("/api/v1/finance/accounting/chart-of-accounts/seed?force=true", headers=h).status_code)
    with engine.begin() as cx:
        cx.execute(text("SET session_replication_role = replica"))
        n = cx.execute(text("select count(*) from chart_of_accounts")).scalar()
        cx.execute(text("""UPDATE general_ledger SET
            account_id = (SELECT min(id) FROM chart_of_accounts) + (id % :n),
            debit_amount = CASE WHEN id % 2 = 0 THEN (id % 997) + 10 ELSE 0 END,
            credit_amount = CASE WHEN id % 2 = 1 THEN (id % 997) + 10 ELSE 0 END,
            branch_code = (ARRAY['BR-ANR01','BR-BTC01','BR-CMB01'])[1 + id % 3],
            reference_type = 'invoice', reference_id = 1 + id % 300000"""), {"n": n})
        cx.execute(text("ANALYZE general_ledger"))
    print("accounts:", n, "- GL spread done")

n = [0]
@event.listens_for(engine, "before_cursor_execute")
def _b(conn, cur, s, p, ctx, many): n[0] += 1

y = time.localtime().tm_year
EP = [
 ("GET", "/api/v1/reporting/dashboard", None),
 ("GET", "/api/v1/reporting/quick-stats", None),
 ("GET", "/api/v1/finance/accounting/dashboard/stats", None),
 ("GET", f"/api/v1/finance/accounting/general-ledger/trial-balance?fiscal_year={y}", None),
 ("GET", f"/api/v1/finance/accounting/general-ledger/trial-balance?fiscal_year={y-1}", None),
 ("GET", f"/api/v1/finance/accounting/reports/income-statement?fiscal_year={y}", None),
 ("GET", f"/api/v1/finance/accounting/reports/balance-sheet?fiscal_year={y}", None),
 ("GET", f"/api/v1/finance/accounting/reports/reconciliation-check?fiscal_year={y}&fiscal_period=6", None),
 ("GET", "/api/v1/finance/accounting/reports/day-end-reconciliation", None),
 ("GET", "/api/v1/finance/accounting/general-ledger?limit=50", None),
 ("GET", "/api/v1/finance/accounting/journal-entries?limit=50", None),
 ("GET", "/api/v1/finance/accounting/audit-trail?limit=50", None),
 ("GET", "/api/v1/finance/cashbook", None),
 ("GET", "/api/v1/finance/cashbook/summary", None),
 ("GET", "/api/v1/inventory/sales-stock/stock-summary", None),
 ("GET", "/api/v1/inventory/sales-stock/paginated", None),
 ("POST", "/api/v1/reporting/sales", {"start_date": f"{y-5}-01-01", "end_date": f"{y}-12-31"}),
 ("POST", "/api/v1/reporting/finance", {"start_date": f"{y-5}-01-01", "end_date": f"{y}-12-31", "report_type": "income"}),
 ("POST", "/api/v1/reporting/inventory", {}),
 ("POST", "/api/v1/reporting/hr", {"start_date": f"{y-5}-01-01", "end_date": f"{y}-12-31"}),
 ("POST", "/api/v1/reporting/warehouse", {"start_date": f"{y-5}-01-01", "end_date": f"{y}-12-31"}),
 ("GET", "/api/v1/sales/debtors/list", None),
 ("GET", "/api/v1/sales/debtors/aging-report", None),
]
print(f"{'endpoint':78} {'st':>3} {'queries':>7} {'cold ms':>8} {'warm ms':>8} {'KB':>6}")
for m, path, body in EP:
    res = []
    for _ in range(2):
        n[0] = 0; t = time.perf_counter()
        r = c.request(m, path, headers=h, json=body) if body is not None else c.request(m, path, headers=h)
        res.append((time.perf_counter() - t) * 1000)
    print(f"{path[:78]:78} {r.status_code:>3} {n[0]:>7} {res[0]:>8.0f} {res[1]:>8.0f} {len(r.content)/1024:>6.0f}")
