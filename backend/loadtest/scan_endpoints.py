"""Call every parameter-free GET endpoint once (in-process) and flag high query counts / slow responses."""
import sys, time, logging
sys.path.insert(0,'.'); logging.disable(logging.CRITICAL)
from app.db.base import Base
from app.models import *
from app.db.session import engine
from sqlalchemy import event
from fastapi.testclient import TestClient
from fastapi.routing import APIRoute
from app.main import app
c=TestClient(app, raise_server_exceptions=False)
h={"Authorization":"Bearer "+c.post("/api/v1/auth/login",data={"username":"admin","password":"TjrAdmin@123"}).json()["access_token"]}
n=[0]
@event.listens_for(engine,"before_cursor_execute")
def b(conn,cur,s,p,ctx,many): n[0]+=1
rows=[]
inner = getattr(app, "app", app)
for r in inner.routes:
    if not isinstance(r,APIRoute) or "GET" not in r.methods: continue
    if "{" in r.path or any(x in r.path for x in ("export","csv","pdf","download","documents","docs","chat","logout","stream")): continue
    if any(p.required for p in r.dependant.query_params): continue
    n[0]=0; t=time.perf_counter()
    try: resp=c.get(r.path,headers=h); code=resp.status_code; size=len(resp.content)
    except Exception as e: code="ERR"; size=0
    rows.append((n[0],(time.perf_counter()-t)*1000,code,size,r.path))
rows.sort(reverse=True)
print(f"{len(rows)} endpoints scanned")
print("queries   ms  status    KB  path (top by queries)")
for q,ms,code,size,path in rows[:18]: print(f"{q:7d} {ms:5.0f}  {code}  {size/1024:5.0f}  {path}")
print("slowest:")
for q,ms,code,size,path in sorted(rows,key=lambda x:-x[1])[:10]: print(f"{q:7d} {ms:5.0f}  {code}  {size/1024:5.0f}  {path}")
