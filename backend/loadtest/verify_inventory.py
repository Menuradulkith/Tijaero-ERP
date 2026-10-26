import sys, time, logging
sys.path.insert(0,'.'); logging.disable(logging.CRITICAL)
from app.db.base import Base
from app.models import *
from app.db.session import SessionLocal
from app.modules.reporting import schemas
from app.modules.reporting.service import ReportingService as New
from app.modules.reporting._old_rep_tmp import ReportingService as Old
db=SessionLocal()
for req in (schemas.InventoryReportRequest(),):
    t=time.perf_counter(); o=Old(db).get_inventory_report(req); to=time.perf_counter()-t
    t=time.perf_counter(); n=New(db).get_inventory_report(req); tn=time.perf_counter()-t
    d=lambda r:r.model_dump()
    od,nd=d(o),d(n)
    same_lists = sorted(map(str,od["low_stock_items"]))==sorted(map(str,nd["low_stock_items"]))
    print("SAME" if (same_lists and abs(od["total_stock_value"]-nd["total_stock_value"])<0.01 and od["total_products"]==nd["total_products"] and od["stock_by_category"]==nd["stock_by_category"]) else "DIFF",
      f"old {to*1000:.0f}ms new {tn*1000:.0f}ms", nd["total_products"], round(nd["total_stock_value"],2), len(nd["low_stock_items"]), "cat=",req.category)
