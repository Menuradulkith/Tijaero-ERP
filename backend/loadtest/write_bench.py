"""Invoice-create benchmark against the load-test DB.
Builds an isolated branch with N serial-tracked stock units, then:
  1) creates invoices one at a time (latency + query count)
  2) creates invoices from T threads at once (throughput, errors)
usage: write_bench.py [N=120] [THREADS=12]"""
import sys, time, uuid, threading, logging, statistics
sys.path.insert(0, '.'); logging.disable(logging.CRITICAL)
from datetime import date, datetime
from app.db.base import Base  # noqa
from app.models import *  # noqa
from sqlalchemy import event
from app.db.session import SessionLocal, engine
from app.modules.sales.service import SalesService
from app.modules.sales import schemas as ss
from app.auth.models import Branch
from app.modules.customers.models import Customer
from app.modules.customers.repository import CustomerRepository
from app.modules.purchasing.models import (Supplier, PurchasingOrder, PurchasingOrderItems,
                                           GoodReceivedNote, GoodReceivedItems)
from app.modules.purchasing.repository import SupplierRepository
from app.modules.products.models import Product, Category, ItemsBrand
from app.modules.common.models import Locations
from app.modules.inventory.models import SalesStock

N = int(sys.argv[1]) if len(sys.argv) > 1 else 120
T = int(sys.argv[2]) if len(sys.argv) > 2 else 12
B = int(sys.argv[3]) if len(sys.argv) > 3 else 1  # branches the threads are spread over
u = lambda p: f"{p}_{uuid.uuid4().hex[:8]}"
def build():
    db = SessionLocal()
    branch = Branch(branch_name=u("WB"), branch_code=u("WBR").upper()[:15], address="x", active=True); db.add(branch); db.flush()
    cust = Customer(customer_no=CustomerRepository().get_next_customer_no(db), title="Mr", customer_name=u("Cust"),
        email=f"{u('c')}@example.com", payment_address="a", delivery_address="a", gender="male", civil_status="single",
        no_of_kids="0", mobile_contact_number="0770000000", credit_days=30, max_credit_limit=50000, left_credit_amount=50000,
        initial_credit_amount=50000, active=True, is_customer_agent=False, date_joined=datetime.utcnow()); db.add(cust)
    sup = Supplier(supplier_no=SupplierRepository(db).get_next_supplier_no(), company_name=u("Supp"), billing_address_line1="b",
        mobile_contact_number="0770000000", credit_days=30, max_credit_limit=1000000, active=True, date_joined=datetime.utcnow()); db.add(sup)
    cat = Category(name=u("Cat"), category_code=u("C")[:10], active=True, created_date=datetime.utcnow())
    brand = ItemsBrand(brand_name=u("Br"), brand_code=uuid.uuid4().hex[:4].upper()); db.add_all([cat, brand]); db.flush()
    prod = Product(name=u("Prod"), item_code=u("ITM")[:10], item_type="general", website_active=False, active=True, cost_price=100.0,
        selling_price=150.0, created_date=date.today(), category_id=cat.id, items_brand_id=brand.id, added_date=datetime.utcnow()); db.add(prod)
    loc = Locations(name=u("Loc"), branch_code=branch.branch_code, created_date=datetime.utcnow()); db.add(loc); db.flush()
    po = PurchasingOrder(purchasing_order_no=u("PO"), branch_code=branch.branch_code, payment_method="cash", purchasing_order_date=date.today(),
        good_received_note_date=date.today(), created_date=date.today(), first_suppliers_id=sup.id, added_date=datetime.utcnow(), status="approved"); db.add(po); db.flush()
    poi = PurchasingOrderItems(quantity=N * 2, unit_price=100.0, warrenty_month="12", created_date=date.today(), product_id=prod.id,
        purchasingorders_id=po.id, added_date=datetime.utcnow()); db.add(poi); db.flush()
    grn = GoodReceivedNote(good_received_no=u("GRN"), good_received_date=date.today(), supplier_invoice_no=u("SINV"), supplier_invoice_date=date.today(),
        branch_code=branch.branch_code, created_date=date.today(), good_received_locations_id=loc.id, purchasingorders_id=po.id, added_date=datetime.utcnow())
    db.add(grn); db.flush()
    barcodes = [u("BC") for _ in range(N * 2)]
    for bc in barcodes:
        db.add(GoodReceivedItems(good_received_note=grn.good_received_no, barcode=bc, branch_code=branch.branch_code, active=True,
            created_date=date.today(), purchasing_order_items_id=poi.id, added_date=datetime.utcnow()))
        db.add(SalesStock(product_id=prod.id, barcode=bc, branch_code=branch.branch_code, location_id=loc.id, good_received_note_id=grn.id,
            purchasing_order_items_id=poi.id, warranty_month="12", status="available", is_active=True, added_date=datetime.utcnow()))
    db.commit()
    ids = dict(branch=branch.branch_code, cust=cust.id, prod=prod.id)
    db.close()
    return ids, barcodes

FIX = [build() for _ in range(B)]
print(f"fixtures ready: {B} branch(es) x {N*2} stock units")

def make(ids, bc):
    return ss.InvoiceCreate(branch_code=ids["branch"], customer_id=ids["cust"], sale_rep_id=1, payment_method="cash", cash_amount=150.0,
        items=[ss.InvoiceItemCreate(product_id=ids["prod"], quantity=1, selling_price=150.0, minimum_selling_price=120.0, warrenty_month="12", barcode=bc)])

nq = [0]
@event.listens_for(engine, "before_cursor_execute")
def _q(conn, cur, s, p, ctx, many): nq[0] += 1

# 1) sequential
lat, qs, errs = [], [], []
ids0, bcs0 = FIX[0]
for bc in bcs0[:N]:
    s = SessionLocal(); nq[0] = 0; t = time.perf_counter()
    try:
        SalesService().create_invoice(s, make(ids0, bc), user_id=1); s.commit()
        lat.append((time.perf_counter() - t) * 1000); qs.append(nq[0])
    except Exception as e:
        s.rollback(); errs.append(f"{type(e).__name__}: {str(e)[:120]}")
    finally: s.close()
if lat:
    lat.sort()
    print(f"sequential: {len(lat)} ok / {len(errs)} failed | p50 {statistics.median(lat):.0f} ms  p95 {lat[int(len(lat)*.95)-1]:.0f} ms  max {lat[-1]:.0f} ms | ~{statistics.median(qs):.0f} queries each")
if errs: print("  first error:", errs[0])

# 2) concurrent
work = [(ids, bc) for i in range(N) for ids, bcs in FIX for bc in [bcs[N + i]]][::-1]; lock = threading.Lock(); res = []; cerrs = []
def worker():
    while True:
        with lock:
            if not work: return
            ids_, bc = work.pop()
        s = SessionLocal(); t = time.perf_counter()
        try:
            SalesService().create_invoice(s, make(ids_, bc), user_id=1); s.commit()
            with lock: res.append((time.perf_counter() - t) * 1000)
        except Exception as e:
            s.rollback()
            with lock: cerrs.append(f"{type(e).__name__}: {str(e)[:140]}")
        finally: s.close()
t0 = time.perf_counter(); th = [threading.Thread(target=worker) for _ in range(T)]
[x.start() for x in th]; [x.join() for x in th]; dt = time.perf_counter() - t0
if res:
    res.sort()
    print(f"{T} threads over {B} branch(es): {len(res)} ok / {len(cerrs)} failed in {dt:.1f}s = {len(res)/dt:.1f} invoices/s | p50 {statistics.median(res):.0f} ms  p95 {res[int(len(res)*.95)-1]:.0f} ms  max {res[-1]:.0f} ms")
if cerrs:
    from collections import Counter
    for k, v in Counter(cerrs).most_common(4): print(f"  {v}x {k}")
