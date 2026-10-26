import sys, time
sys.path.insert(0,'.')
from app.db.base import Base
from app.models import *
from app.db.session import engine
from sqlalchemy import event
from fastapi.testclient import TestClient
from app.main import app
c=TestClient(app)
tok=c.post("/api/v1/auth/login",data={"username":"admin","password":"TjrAdmin@123"}).json()["access_token"]
h={"Authorization":"Bearer "+tok}
n=[0]; st=[]
@event.listens_for(engine,"before_cursor_execute")
def b(conn,cur,s,p,ctx,many): n[0]+=1; st.append(s[:70].replace("\n"," "))
for path in ["/api/v1/health","/api/v1/inventory/products/paged?page=3&page_size=50","/api/v1/customers/paged?page=3&page_size=50","/api/v1/sales/list","/api/v1/sales/1234"]:
    for _ in range(2):
        n[0]=0; st.clear(); t=time.perf_counter(); r=c.get(path,headers=h); dt=(time.perf_counter()-t)*1000
    print(f"{path[:55]:55} {r.status_code} {n[0]:3d} queries {dt:.0f} ms")
    if "products/paged" in path:
        from collections import Counter
        for k,v in Counter(st).most_common(8): print("     ",v,"x",k)
