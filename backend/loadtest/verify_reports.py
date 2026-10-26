import sys, time, logging
sys.path.insert(0,'.'); logging.disable(logging.CRITICAL)
from datetime import date, timedelta
from app.db.base import Base
from app.models import *
from app.db.session import SessionLocal
from app.modules.finance.accounting_service import GeneralLedgerService as New
from app.modules.finance._old_acct_tmp import GeneralLedgerService as Old
db=SessionLocal(); y=date.today().year
def dump(r): return r.model_dump(exclude={"generated_at"}) if hasattr(r,"model_dump") else r
cases=[("income_statement",dict(fiscal_year=y)),("income_statement",dict(fiscal_year=y-1)),
 ("income_statement",dict(fiscal_year=y,fiscal_period=6)),
 ("income_statement",dict(fiscal_year=y,branch_code="BR-CMB01")),
 ("income_statement",dict(fiscal_year=y,branch_codes=["BR-CMB01","BR-ANR01"])),
 ("income_statement",dict(fiscal_year=y,date_from=date(y,2,1),date_to=date(y,8,1))),
 ("balance_sheet",dict(fiscal_year=y)),("balance_sheet",dict(fiscal_year=y,as_of_date=date(y-1,6,30))),
 ("balance_sheet",dict(fiscal_year=y,branch_code="BR-BTC01"))]
for name,kw in cases:
    t=time.perf_counter(); o=getattr(Old(db),"get_"+name)(**kw); to=time.perf_counter()-t
    t=time.perf_counter(); n=getattr(New(db),"get_"+name)(**kw); tn=time.perf_counter()-t
    same=dump(o)==dump(n)
    print("SAME" if same else "DIFF", f"old {to*1000:5.0f}ms new {tn*1000:5.0f}ms", name, {k:str(v) for k,v in kw.items()})
