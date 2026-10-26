import sys, time, logging
sys.path.insert(0,'.'); logging.disable(logging.CRITICAL)
from datetime import date, timedelta
from app.db.base import Base
from app.models import *
from app.db.session import SessionLocal
from app.modules.finance import accounting_schemas as schemas
from app.modules.finance.accounting_service import GeneralLedgerService as New
from app.modules.finance._old_acct_tmp import GeneralLedgerService as Old
db=SessionLocal()
today=date.today()
cases=[
 dict(date_from=today-timedelta(days=3), date_to=today, limit=50, skip=0),
 dict(date_from=today-timedelta(days=3), date_to=today, limit=40, skip=60),
 dict(date_from=today-timedelta(days=1), date_to=today, limit=200, skip=0, entry_type="JE"),
 dict(date_from=today-timedelta(days=1), date_to=today, limit=30, skip=10, entry_type="GL"),
 dict(date_from=today-timedelta(days=10), date_to=today-timedelta(days=9), limit=25, skip=0, include_reversed=False),
 dict(date_from=today-timedelta(days=2), date_to=today, limit=1000, skip=0, search="Test JE 4"),
]
for c in cases:
    f=schemas.AuditTrailFilter(**c)
    t=time.perf_counter(); o=Old(db).get_audit_trail(f); to=time.perf_counter()-t
    t=time.perf_counter(); n=New(db).get_audit_trail(f); tn=time.perf_counter()-t
    so=[(i.entry_type,i.id) for i in o.items]; sn=[(i.entry_type,i.id) for i in n.items]
    print("SAME" if (so==sn and o.total==n.total) else f"DIFF total {o.total}/{n.total}", len(sn), f"old {to*1000:.0f}ms new {tn*1000:.0f}ms", {k:v for k,v in c.items() if k in('entry_type','search','skip','limit')})
