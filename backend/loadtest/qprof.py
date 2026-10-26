"""Per-statement timing of one endpoint, in-process. usage: qprof.py /api/v1/path"""
import sys, time, logging, re
sys.path.insert(0,'.'); logging.disable(logging.CRITICAL)
from app.db.base import Base
from app.models import *
from app.db.session import engine
from sqlalchemy import event
from fastapi.testclient import TestClient
from app.main import app
c=TestClient(app)
h={"Authorization":"Bearer "+c.post("/api/v1/auth/login",data={"username":"admin","password":"TjrAdmin@123"}).json()["access_token"]}
st=[]
@event.listens_for(engine,"before_cursor_execute")
def b(conn,cur,s,p,ctx,many): ctx._t=time.perf_counter()
@event.listens_for(engine,"after_cursor_execute")
def a(conn,cur,s,p,ctx,many): st.append((time.perf_counter()-ctx._t,s))
path=sys.argv[1]; c.get(path,headers=h); st.clear()
t=time.perf_counter(); r=c.get(path,headers=h); tot=time.perf_counter()-t
print(r.status_code, f"total {tot*1000:.0f} ms, {len(st)} queries, db {sum(d for d,_ in st)*1000:.0f} ms")
from collections import Counter
cnt=Counter(re.sub(r"\s+"," ",s)[:110] for _,s in st)
for k,v in cnt.most_common(int(sys.argv[2]) if len(sys.argv)>2 else 6): print(f"  {v:4d} x {k}")
