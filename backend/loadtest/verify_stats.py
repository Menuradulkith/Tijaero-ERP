"""Compare get_sales_statistics against independent plain-SQL totals (run against the load-test DB)."""
import sys, time
sys.path.insert(0, '.')
from sqlalchemy import text
from app.db.base import Base  # noqa
from app.models import *  # noqa
from app.db.session import SessionLocal
from app.modules.sales.service import sales_service
from app.core import timezone as tz

db = SessionLocal()
for branches in (None, ['BR-CMB01']):
    t = time.perf_counter(); r = sales_service.get_sales_statistics(db, branches); dt = time.perf_counter() - t
    bf = "" if not branches else "AND i.branch_code = ANY(:b)"
    q = lambda extra="": db.execute(text(f"""
      SELECT count(*), coalesce(sum(i.grand_total - coalesce(r.refund,0)),0) FROM invoices i
      LEFT JOIN (SELECT invoice_id, sum(total_refund) refund FROM sale_return WHERE status='processed' GROUP BY 1) r ON r.invoice_id=i.id
      WHERE i.status AND i.approval_status IN ('approved','completed') {bf} {extra}"""), {"b": branches}).one()
    today = tz.today(); ms = today.replace(day=1)
    c, rev = q(); mc, mrev = q(f"AND i.created_date >= '{ms}'")
    ok = (r['total_orders'] == c and abs(r['total_revenue'] - float(rev)) < 0.01
          and r['current_month_orders'] == mc and abs(r['current_month_revenue'] - float(mrev)) < 0.01)
    print(branches, "OK" if ok else "MISMATCH", f"{dt*1000:.0f} ms", r['total_orders'], round(r['total_revenue'], 2), r['current_month_orders'],
          sum(d['orders'] for d in r['daily_sales']), sum(m['orders'] for m in r['monthly_sales']), len(r['top_customers']), len(r['top_invoices']), len(r['recent_invoices']))
