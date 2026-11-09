#!/usr/bin/env python3
"""
Seed the SALES DEMO database (erp_demo) with realistic Sri Lankan sample data.

Everything goes through the real API (FastAPI TestClient, in-process), so stock,
GL postings, VAT and payroll come out exactly as real use would produce them.
The app clock (app.core.timezone) is frozen to each business day, so documents
get realistic dates spread over the last ~5 weeks.

    # 1. fresh database (drops erp_demo!) + migrations + permissions + admin
    python scripts/seed_demo_lk.py --reset
    # 2. seed
    python scripts/seed_demo_lk.py

Then run the demo stack: launch configs "backend-demo" (:8031) and "frontend-demo" (:3001).
It refuses to run against any database other than erp_demo.
"""
from __future__ import annotations

import argparse
import os
import random
import re
import subprocess
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

DEMO_DB = "erp_demo"


def _demo_url() -> str:
    env = (BACKEND / ".env").read_text(encoding="utf-8")
    url = re.search(r"^DATABASE_URL=(.+)$", env, re.M).group(1).strip()
    return re.sub(r"/[^/?]+(\?|$)", f"/{DEMO_DB}\\1", url, count=1)


os.environ["DATABASE_URL"] = _demo_url()
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
if not os.environ["DATABASE_URL"].rstrip("/").split("?")[0].endswith("/" + DEMO_DB):
    sys.exit("Refusing to run: DATABASE_URL does not point at erp_demo")


# ----------------------------------------------------------------------------------------------
# reset
# ----------------------------------------------------------------------------------------------
def reset_database() -> None:
    from sqlalchemy import create_engine, text

    admin_url = re.sub(r"/[^/?]+(\?|$)", "/postgres\\1", os.environ["DATABASE_URL"], count=1)
    admin_url = re.sub(r"^postgresql(\+psycopg2)?://", "postgresql+psycopg://", admin_url)
    eng = create_engine(admin_url, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(text(f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DEMO_DB}' AND pid <> pg_backend_pid()"))
        c.execute(text(f"DROP DATABASE IF EXISTS {DEMO_DB}"))
        c.execute(text(f"CREATE DATABASE {DEMO_DB}"))
    py = sys.executable
    env = {**os.environ}
    for cmd in ([py, "-m", "alembic", "upgrade", "head"], [py, "scripts/init_permissions.py"],
                [py, "scripts/ensure_admin.py"], [py, "scripts/seed_chart_of_accounts.py"]):
        print("$", " ".join(cmd[1:]))
        subprocess.run(cmd, check=True, env=env, stdout=subprocess.DEVNULL)
    print("erp_demo recreated.")


# ----------------------------------------------------------------------------------------------
# frozen clock + API client
# ----------------------------------------------------------------------------------------------
class Clock:
    current: datetime | None = None


def install_clock() -> None:
    from app.core import timezone as tzmod

    real = tzmod._dt

    class FrozenDatetime(real):  # type: ignore[misc, valid-type]
        @classmethod
        def now(cls, tz=None):  # noqa: D401
            if Clock.current is None:
                return real.now(tz)
            return Clock.current.replace(tzinfo=tz) if tz else Clock.current

    tzmod._dt = FrozenDatetime


def at(d: date, hour: int = 10, minute: int = 0) -> None:
    Clock.current = datetime(d.year, d.month, d.day, hour, minute)


class Api:
    def __init__(self) -> None:
        from fastapi.testclient import TestClient
        from app.main import app as asgi

        # app.main wraps FastAPI in ProxyHeadersMiddleware; TestClient accepts any ASGI app.
        self.c = TestClient(asgi, base_url="http://localhost")
        self.c.headers["Authorization"] = f"Bearer {self._admin_token()}"

    @staticmethod
    def _admin_token() -> str:
        import app.models  # noqa: F401
        from sqlalchemy import select
        from app.auth.models import User
        from app.core.security import create_access_token, get_password_marker
        from app.db.session import SessionLocal

        db = SessionLocal()
        try:
            u = db.execute(select(User).where(User.username == "admin")).scalars().first()
            return create_access_token({"sub": str(u.id), "pwd": get_password_marker(u.hashed_password)}, timedelta(hours=12))
        finally:
            db.close()

    def _do(self, method: str, path: str, ok=(200, 201), **kw):
        r = self.c.request(method, "/api/v1" + path, **kw)
        if r.status_code not in ok:
            raise RuntimeError(f"{method} {path} -> {r.status_code}: {r.text[:800]}")
        return r.json() if r.content else None

    def get(self, path, **kw):
        return self._do("GET", path, **kw)

    def post(self, path, json=None, **kw):
        return self._do("POST", path, json=json, **kw)

    def put(self, path, json=None, **kw):
        return self._do("PUT", path, json=json, **kw)


def items_of(resp):
    if isinstance(resp, list):
        return resp
    for k in ("items", "data", "results"):
        if isinstance(resp, dict) and isinstance(resp.get(k), list):
            return resp[k]
    return []


# ----------------------------------------------------------------------------------------------
# reference data
# ----------------------------------------------------------------------------------------------
TODAY = date(2026, 11, 7)
START = date(2026, 10, 1)

BRANCHES = [
    ("CMB", "Colombo (Head Office)", "No. 145, Union Place", "Colombo 02", "Western", "00200", "0112 345 678"),
    ("KDY", "Kandy", "No. 22, Peradeniya Road", "Kandy", "Central", "20000", "0812 224 455"),
    ("GLE", "Galle", "No. 8, Wakwella Road", "Galle", "Southern", "80000", "0912 234 567"),
    ("KUR", "Kurunegala", "No. 61, Colombo Road", "Kurunegala", "North Western", "60000", "0372 221 334"),
    ("JFN", "Jaffna", "No. 34, Hospital Road", "Jaffna", "Northern", "40000", "0212 223 344"),
]

CATEGORIES = ["Tea & Beverages", "Dairy", "Rice & Grains", "Spices", "Biscuits & Snacks", "Household Care"]
BRANDS = ["Hill Leaf", "Island Fresh", "Lanka Harvest", "Spice Coast", "Golden Crisp", "PureHome"]

# name, category, brand, uom, cost, selling, tax%
PRODUCTS = [
    ("Hill Leaf BOP Tea 400g", 0, 0, "pcs", 780, 1050, 0),
    ("Hill Leaf Green Tea 100 Bags", 0, 0, "pcs", 640, 890, 0),
    ("Hill Leaf Premium Black Tea 1kg", 0, 0, "pcs", 1750, 2350, 0),
    ("Island Fresh Full Cream Milk Powder 400g", 1, 1, "pcs", 1020, 1290, 0),
    ("Island Fresh Set Yoghurt 80g (24 pack)", 1, 1, "pack", 1300, 1680, 0),
    ("Island Fresh Butter 200g", 1, 1, "pcs", 720, 950, 0),
    ("Lanka Harvest Keeri Samba Rice 5kg", 2, 2, "bag", 1450, 1850, 0),
    ("Lanka Harvest Red Raw Rice 5kg", 2, 2, "bag", 1180, 1520, 0),
    ("Lanka Harvest Wheat Flour 1kg", 2, 2, "pcs", 230, 295, 0),
    ("Spice Coast Chilli Powder 250g", 3, 3, "pcs", 380, 520, 18),
    ("Spice Coast Roasted Curry Powder 250g", 3, 3, "pcs", 410, 560, 18),
    ("Spice Coast Cinnamon Sticks 100g", 3, 3, "pcs", 520, 750, 18),
    ("Spice Coast Turmeric Powder 100g", 3, 3, "pcs", 190, 260, 18),
    ("Golden Crisp Cream Crackers 490g", 4, 4, "pcs", 380, 480, 18),
    ("Golden Crisp Chocolate Biscuits 200g", 4, 4, "pcs", 210, 280, 18),
    ("Golden Crisp Lemon Puff 200g", 4, 4, "pcs", 220, 290, 18),
    ("PureHome Dishwash Liquid 500ml", 5, 5, "pcs", 310, 420, 18),
    ("PureHome Laundry Powder 1kg", 5, 5, "pcs", 520, 690, 18),
    ("PureHome Floor Cleaner 1L", 5, 5, "pcs", 450, 610, 18),
]

# company, city, branch, mobile, product indexes supplied
SUPPLIERS = [
    ("Hill Country Tea Estates (Pvt) Ltd", "Nuwara Eliya", "0772 114 220", [0, 1, 2]),
    ("Western Dairy Farms (Pvt) Ltd", "Gampaha", "0773 225 331", [3, 4, 5]),
    ("Southern Flour & Rice Mills", "Ambalangoda", "0714 336 442", [6, 7, 8]),
    ("Lanka Spice Growers Co-op", "Matale", "0765 447 553", [9, 10, 11, 12]),
    ("Ceylon Biscuit Manufacturers Ltd", "Biyagama", "0776 558 664", [13, 14, 15]),
    ("Island Home Care Products (Pvt) Ltd", "Ja-Ela", "0717 669 775", [16, 17, 18]),
]

# name, city, branch, credit limit (LKR), credit days
CUSTOMERS = [
    ("Lanka Fresh Traders", "Colombo 10", "CMB", 1500000, 30),
    ("Metro Super Center", "Colombo 05", "CMB", 2500000, 30),
    ("Maharagama Family Mart", "Maharagama", "CMB", 800000, 21),
    ("Nugegoda Daily Needs", "Nugegoda", "CMB", 600000, 14),
    ("Coastal Mini Mart", "Negombo", "CMB", 500000, 14),
    ("Hill Country Stores", "Kandy", "KDY", 1200000, 30),
    ("Kandy City Grocers", "Kandy", "KDY", 700000, 21),
    ("Peradeniya Food Mart", "Peradeniya", "KDY", 400000, 14),
    ("Badulla Hill Mart", "Badulla", "KDY", 450000, 21),
    ("Galle Bake House", "Galle", "GLE", 350000, 14),
    ("Southern Star Supermarket", "Matara", "GLE", 1500000, 30),
    ("Unawatuna Beach Cafe", "Unawatuna", "GLE", 250000, 7),
    ("Wayamba Wholesale", "Kurunegala", "KUR", 1800000, 30),
    ("Kuliyapitiya Traders", "Kuliyapitiya", "KUR", 500000, 21),
    ("Anuradhapura Sacred City Stores", "Anuradhapura", "KUR", 600000, 21),
    ("Northern Agro Supplies", "Jaffna", "JFN", 1400000, 30),
    ("Jaffna Central Stores", "Jaffna", "JFN", 900000, 21),
    ("Nallur Provision Stores", "Nallur", "JFN", 300000, 14),
]

# first, last, title, department index, branch, basic salary
STAFF = [
    ("Nimal", "Perera", "Finance Manager", 0, "CMB", 285000),
    ("Dilani", "Fernando", "Accountant", 0, "CMB", 165000),
    ("Chamari", "Dissanayake", "HR Executive", 1, "CMB", 135000),
    ("Kasun", "Jayasinghe", "Sales Manager", 2, "CMB", 240000),
    ("Mohamed", "Rizwan", "Warehouse Supervisor", 3, "CMB", 120000),
    ("Lahiru", "Herath", "Production Supervisor", 4, "CMB", 140000),
    ("Tharindu", "Silva", "Sales Representative", 2, "KDY", 95000),
    ("Sanduni", "Ekanayake", "Branch Manager", 2, "KDY", 175000),
    ("Ishara", "Wickramasinghe", "Sales Representative", 2, "GLE", 92000),
    ("Anusha", "Kumari", "Cashier", 0, "GLE", 78000),
    ("Ruwan", "Bandara", "Storekeeper", 3, "KUR", 85000),
    ("Sahan", "Gunawardena", "Van Sales Representative", 2, "KUR", 90000),
    ("Priya", "Rajendran", "Branch Manager", 2, "JFN", 170000),
    ("Kumaran", "Sivakumar", "Sales Representative", 2, "JFN", 90000),
]
DEPARTMENTS = [("FIN", "Finance"), ("HR", "Human Resources"), ("SAL", "Sales"), ("WH", "Warehouse & Logistics"), ("PRD", "Production")]


def business_days(start: date, end: date):
    d = start
    while d <= end:
        if d.weekday() != 6 and d not in (date(2026, 10, 20), date(2026, 11, 4)):  # Sundays + poya days
            yield d
        d += timedelta(days=1)


# ----------------------------------------------------------------------------------------------
# seeding
# ----------------------------------------------------------------------------------------------
class Seeder:
    def __init__(self, api: Api) -> None:
        self.api = api
        self.rng = random.Random(2026)
        self.branch_ids: dict[str, int] = {}
        self.location_ids: dict[str, int] = {}
        self.product_ids: list[int] = []
        self.supplier_ids: list[int] = []
        self.customers: list[tuple[int, str, str]] = []  # id, name, branch
        self.vat_mismatch: list[tuple[str, float, float]] = []  # method, sent, app-expected
        self.open_credit: list[tuple[int, date, int, float]] = []  # invoice id, date, credit days, amount
        self.payables: list[tuple[int, int, str, date, float]] = []  # purchase invoice id, supplier idx, branch, date, total

    # --- setup -------------------------------------------------------------------------------
    def setup(self) -> None:
        a = self.api
        at(START - timedelta(days=10))
        a.put("/settings/company", {
            "company_name": "Lanka Trading Company (Pvt) Ltd",
            "company_address": "No. 145, Union Place, Colombo 02",
            "company_telephone_number": "0112 345 678",
            "company_email": "accounts@lankatrading.example",
            "default_currency": "LKR",
            "default_timezone": "Asia/Colombo",
            "default_tax_rate": 18,
            "tax_registration_number": "123456789-7000",
            "business_registration_number": "PV 00123456",
            "bank_name": "Bank of Ceylon",
            "bank_branch": "Union Place",
            "bank_account_name": "Lanka Trading Company (Pvt) Ltd",
            "bank_account_number": "0001 2345 6789",
        })
        try:
            a.post("/finance/accounting/periods/generate", {"fiscal_year": 2026, "start_month": 1})
        except RuntimeError as e:
            print("  periods:", str(e)[:120])
        a.put("/settings/profile", {"first_name": "Nimal", "last_name": "Perera"}, ok=(200, 201, 422))

        for code, name, addr, city, prov, post, tel in BRANCHES:
            b = a.post("/branches/", {"branch_code": code, "branch_name": name, "address_line1": addr, "city": city,
                                      "state": prov, "postal_code": post, "contact_number": tel, "address": f"{addr}, {city}"})
            self.branch_ids[code] = b["id"]
            loc = a.post("/common/locations", {"name": f"{name.split(' (')[0]} Main Store", "branch_code": code})
            self.location_ids[code] = loc["id"]
        print("  branches", self.branch_ids)

        cat_ids = [a.post("/inventory/categories/", {"name": n})["id"] for n in CATEGORIES]
        brand_ids = [a.post("/inventory/brands/", {"brand_name": n})["id"] for n in BRANDS]
        for name, ci, bi, uom, cost, sell, tax in PRODUCTS:
            p = a.post("/inventory/products/", {
                "name": name, "item_type": "inventory", "unit_of_measure": uom, "tracking_type": "none",
                # VAT is charged at invoice level (tax invoices); product-level tax stays 0 so totals are consistent.
                # The minimum price leaves room for VAT-inclusive pricing on tax invoices (price / 1.18).
                "cost_price": cost, "selling_price": sell, "minimum_selling_price": round(sell * 0.80),
                "tax_rate": 0, "category_id": cat_ids[ci], "items_brand_id": brand_ids[bi],
            })
            self.product_ids.append(p["id"])
        print("  products", len(self.product_ids))

        for company, city, mobile, _ in SUPPLIERS:
            s = a.post("/purchasing/suppliers", {
                "company_name": company, "billing_address_line1": city, "billing_city": city,
                "mobile_contact_number": mobile, "credit_days": 30, "max_credit_limit": "5000000",
                "tax_area": "domestic_standard", "lead_time_days": 5,
                "email": re.sub(r"[^a-z]", "", company.lower())[:18] + "@example.lk",
            })
            self.supplier_ids.append(s["id"])

        for name, city, br, limit, days in CUSTOMERS:
            mob = f"07{self.rng.choice([0,1,2,5,6,7,8])} {self.rng.randint(100,999)} {self.rng.randint(1000,9999)}"
            c = a.post("/customers/", {
                "customer_name": name, "company_name": name, "customer_type": "business",
                "billing_address_line1": city, "billing_city": city, "mobile_contact_number": mob,
                "email": "accounts@" + re.sub(r"[^a-z]", "", name.lower())[:20] + ".example.lk",
                "max_credit_limit": limit, "credit_days": days,
            })
            self.customers.append((c["id"], name, br))
        print("  suppliers", len(self.supplier_ids), "customers", len(self.customers))

    # --- people --------------------------------------------------------------------------------
    def people(self) -> None:
        a = self.api
        at(START - timedelta(days=9))
        groups = {g["name"]: g["id"] for g in items_of(a.get("/groups/"))}
        def group_for(title: str) -> int:
            for key in ("Accountant", "HR", "Sales", "Warehouse", "Production", "Branch Manager"):
                if key.lower() in title.lower():
                    for gname, gid in groups.items():
                        if key.lower().split()[0] in gname.lower():
                            return gid
            return groups.get("Viewer") or next(iter(groups.values()))

        dept_ids = [a.post("/hr/departments", {"code": c, "name": n})["id"] for c, n in DEPARTMENTS]
        desig_ids: dict[str, int] = {}
        for _, _, title, di, _, _ in STAFF:
            if title not in desig_ids:
                desig_ids[title] = a.post("/hr/designations", {"name": title, "department_id": dept_ids[di]})["id"]
        emp_types = items_of(a.get("/hr/employment-types")) if self._has("/hr/employment-types") else []
        permanent = next((t["id"] for t in emp_types if "perm" in str(t.get("name", "")).lower()), None)

        for i, (first, last, title, di, br, basic) in enumerate(STAFF, start=1):
            emp_code = f"LTC{i:03d}"
            uname = f"{first}.{last}".lower()
            if first == "Nimal":
                continue  # Nimal Perera is the admin login (renamed above); payroll still covers the rest
            u = a.post("/users/", {
                "username": uname, "first_name": first, "last_name": last, "email": f"{uname}@lankatrading.example",
                "password": f"Demo-{self.rng.randint(10**7, 10**8)}!aA", "employee_id": emp_code,
                "branch_ids": [self.branch_ids[br]], "primary_branch_id": self.branch_ids[br],
                "group_ids": [group_for(title)], "date_joined": "2024-03-01",
            })
            joined = date(2022 + i % 4, 1 + (i * 3) % 12, 1 + (i * 7) % 27)
            # Creating the user already created its employee record; fill in the HR details.
            emp = next(e for e in items_of(a.get("/employees/")) if e.get("user_id") == u["id"] or e.get("employee_id") == emp_code)
            a.put(f"/employees/{emp['id']}", {
                "name_with_initials": f"{first[0]}. {last}",
                "department_id": dept_ids[di], "designation_id": desig_ids[title], "branch_code": br,
                "employment_type_id": permanent, "date_of_joining": joined.isoformat(),
                "gender": "female" if first in ("Dilani", "Chamari", "Sanduni", "Ishara", "Anusha", "Priya") else "male",
                "nationality": "Sri Lankan", "city": dict((b[0], b[3]) for b in BRANCHES)[br],
                "epf_no": f"EPF{1000 + i}", "etf_no": f"ETF{1000 + i}", "bank_name": "Commercial Bank",
                "bank_account_no": f"80{self.rng.randint(10**8, 10**9)}",
            })
            a.post("/hr/salary-profiles", {
                "employee_id": emp_code, "basic_salary": basic, "revision_reason": "joining",
                "effective_from_date": "2026-01-01",
                "allowances": [{"name": "Travelling allowance", "amount": round(basic * 0.08, -2), "epf_liable": False, "taxable": True}],
            })
        print("  staff", len(STAFF) - 1)

    def _has(self, path: str) -> bool:
        r = self.api.c.get("/api/v1" + path)
        return r.status_code == 200

    # --- purchasing ----------------------------------------------------------------------------
    def approve_pending(self, kind_hint: str = "") -> int:
        n = 0
        for ap in items_of(self.api.get("/common/approvals/pending")):
            if kind_hint and kind_hint not in str(ap).lower():
                continue
            self.api.post(f"/common/approvals/{ap['id']}/approve", {"remarks": "Approved"})
            n += 1
        return n

    def purchase(self, d: date, branch: str, supplier_idx: int, qty_scale: float = 1.0) -> None:
        a = self.api
        at(d, 9, 30)
        _, _, _, prod_idx = SUPPLIERS[supplier_idx]
        items = [{"product_id": self.product_ids[i], "quantity": int(self.rng.randint(80, 160) * qty_scale),
                  "unit_price": PRODUCTS[i][4], "warrenty_month": "0"} for i in prod_idx]
        po = a.post("/purchasing/orders", {
            "branch_code": branch, "payment_method": "credit", "purchasing_order_date": d.isoformat(),
            "good_received_note_date": d.isoformat(), "first_suppliers_id": self.supplier_ids[supplier_idx],
            "credit_date": 30, "items": items,
        })
        self.approve_pending()
        po = a.get(f"/purchasing/orders/{po['id']}")
        lines = [{"purchasing_order_items_id": it["id"], "quantity": it["quantity"]}
                 for it in po.get("items") or po.get("purchasing_order_items") or []]
        at(d, 14, 0)
        sinv = f"SINV-{d:%y%m}-{po['id']:05d}"
        grn = a.post("/purchasing/grn/receive", {
            "good_received_date": d.isoformat(), "supplier_invoice_no": sinv,
            "supplier_invoice_date": d.isoformat(), "branch_code": branch,
            "good_received_locations_id": self.location_ids[branch], "purchasingorders_id": po["id"], "lines": lines,
        })
        grn_id = grn.get("id") or (grn.get("grn") or {}).get("id") or grn.get("grn_id")
        # Supplier's tax invoice: input VAT on the VAT-able lines (spices, biscuits, household care).
        inv_items, sub, vat = [], 0.0, 0.0
        for it in items:
            i = self.product_ids.index(it["product_id"])
            line = it["quantity"] * PRODUCTS[i][4]
            tax = round(line * PRODUCTS[i][6] / 100, 2)
            inv_items.append({"grn_id": grn_id, "purchasing_order_id": po["id"], "product_id": it["product_id"],
                              "quantity": it["quantity"], "unit_price": PRODUCTS[i][4], "line_total": line, "tax_amount": tax})
            sub += line
            vat += tax
        at(d, 15, 0)
        try:
            pi = a.post("/purchasing/invoices", {
                "supplier_invoice_no": sinv, "supplier_invoice_date": d.isoformat(), "supplier_id": self.supplier_ids[supplier_idx],
                "branch_code": branch, "received_date": d.isoformat(), "due_date": (d + timedelta(days=30)).isoformat(),
                "payment_type": "credit", "subtotal": round(sub, 2), "tax_amount": round(vat, 2),
                "total_amount": round(sub + vat, 2), "items": inv_items,
            })
            self.payables.append((pi["id"], supplier_idx, branch, d, round(sub + vat, 2)))
        except RuntimeError as e:
            print("   supplier invoice skipped:", str(e)[:200])

    def pay_suppliers(self, d: date) -> None:
        """Friday payment run: settle supplier bills older than two weeks, by bank transfer."""
        due = [p for p in self.payables if (d - p[3]).days >= 14]
        self.payables = [p for p in self.payables if (d - p[3]).days < 14]
        groups: dict[tuple[int, str], list] = {}
        for p in due:
            groups.setdefault((p[1], p[2]), []).append(p)
        at(d, 11, 0)
        for (si, br), bills in groups.items():
            total = round(sum(b[4] for b in bills), 2)
            try:
                self.api.post("/purchasing/invoices/pay", {
                    "supplier_id": self.supplier_ids[si], "payment_date": d.isoformat(), "payment_method": "bank_transfer",
                    "payment_amount": total, "reference_number": f"PAY-{d:%y%m%d}-{si}{br}", "bank_name": "Bank of Ceylon",
                    "branch_code": br, "allocations": [{"purchase_invoice_id": b[0], "allocated_amount": b[4]} for b in bills],
                })
            except RuntimeError as e:
                print("   supplier payment skipped:", str(e)[:200])
        self.approve_pending()
        self.verify_supplier_payments(d)

    def opening_stock(self) -> None:
        # The app allows 5 POs per branch per day, so opening stock arrives over two days.
        for br in self.branch_ids:
            for si in range(len(SUPPLIERS)):
                d = START - timedelta(days=4 if si < 3 else 3)
                self.purchase(d, br, si, qty_scale=1.5 if br == "CMB" else 1.0)
            print("  opening stock", br)

    # --- sales ---------------------------------------------------------------------------------
    def sale(self, d: date, hour: int) -> None:
        a = self.api
        cid, cname, br = self.rng.choice(self.customers)
        lines = self.rng.sample(range(len(PRODUCTS)), self.rng.randint(2, 6))
        items = []
        subtotal = 0
        for i in lines:
            q = self.rng.choice([6, 12, 12, 24, 24, 36, 48])
            price = PRODUCTS[i][5]
            items.append({"product_id": self.product_ids[i], "quantity": q, "selling_price": price,
                          "minimum_selling_price": round(price * 0.80), "warrenty_month": "0"})
            subtotal += q * price
        subtotal = round(subtotal, 2)
        method = self.rng.choices(["credit", "cash", "bank_transfer", "card_visa"], [55, 20, 15, 10])[0]
        body = {"branch_code": br, "customer_id": cid, "payment_method": method, "items": items}
        if self.rng.random() < 0.6:  # VAT-registered buyers ask for a tax invoice
            body.update(is_tax_invoice=True, tax_rate=18)
        at(d, hour, self.rng.randint(0, 59))
        body[{"credit": "credit_amount", "cash": "cash_amount", "bank_transfer": "bank_transfer_amount",
              "card_visa": "card_visa_amount"}[method]] = subtotal
        if method == "bank_transfer":
            body.update(bank_transfer_ref=f"BT{self.rng.randint(100000, 999999)}", bank_name="Commercial Bank")
        if method == "card_visa":
            body.update(card_ref_number=str(self.rng.randint(100000, 999999)), card_holder_name=cname)
        amount_key = next(k for k in body if k.endswith("_amount"))
        inv = None
        for _attempt in range(6):
            try:
                inv = a.post("/sales/", body)
                break
            except RuntimeError as e:
                msg = str(e)
                short = re.search(r"Insufficient stock for product ID (\d+)", msg)
                due = re.search(r"(?:amount due|invoice total) \(([\d.]+)\)", msg)
                if short:  # drop the short line and re-total
                    pid = int(short.group(1))
                    gone = [it for it in body["items"] if it["product_id"] == pid]
                    body["items"] = [it for it in body["items"] if it["product_id"] != pid]
                    if not body["items"]:
                        return
                    for it in gone:
                        tax = PRODUCTS[self.product_ids.index(pid)][6]
                        body[amount_key] = round(body[amount_key] - it["quantity"] * it["selling_price"] * (1 + tax / 100), 2)
                elif "Credit limit exceeded" in msg and method == "credit":
                    method = "cash"
                    body["payment_method"] = "cash"
                    body["cash_amount"] = body.pop("credit_amount")
                    amount_key = "cash_amount"
                elif due:
                    # The app's expected total differs by payment method (line VAT in or out); use the figure it states.
                    self.vat_mismatch.append((method, body[amount_key], float(due.group(1))))
                    body[amount_key] = float(due.group(1))
                else:
                    raise
        if inv is None:
            return
        if inv.get("approval_status") == "pending_bank_verification":
            at(d, 17, 30)  # finance confirms the day's transfers against the bank statement
            a.post(f"/sales/{inv['id']}/bank-transfer/verify", ok=(200, 201, 204))
        if method == "credit":
            days = next(c[4] for c in CUSTOMERS if c[0] == cname)
            self.open_credit.append((inv["id"], d, days, body[amount_key]))
        if inv.get("approval_status") == "pending_approval":  # e.g. large credit sales go to a manager
            at(d, min(hour + 1, 18), 15)
            try:
                a.post(f"/sales/{inv['id']}/approve")
            except RuntimeError:
                self.approve_pending()

    def verify_supplier_payments(self, d: date | None = None) -> None:
        """Finance verifies supplier payments (only verified payments reduce Trade Creditors)."""
        from sqlalchemy import text
        from app.db.session import SessionLocal

        db = SessionLocal()
        try:
            rows = db.execute(text("SELECT id, payment_date::date FROM supplier_payments WHERE status = 'pending' ORDER BY id")).all()
        finally:
            db.close()
        for pid, paid_on in rows:
            at(d or paid_on, 16, 30)
            self.api.post(f"/purchasing/supplier-payments/{pid}/verify", ok=(200, 201, 204))

    def verify_all(self) -> None:
        self.verify_settlements()
        self.verify_supplier_payments()

    def verify_settlements(self, d: date | None = None) -> None:
        """Finance confirms bank-transfer collections against the statement (same day)."""
        from sqlalchemy import text
        from app.db.session import SessionLocal

        db = SessionLocal()
        try:
            rows = db.execute(text(
                "SELECT id, created_date::date FROM customer_credits_settle_transaction "
                "WHERE payment_method = 'bank_transfer' AND status = 'pending_verification' ORDER BY id")).all()
        finally:
            db.close()
        for tx_id, created in rows:
            at(d or created, 17, 40)
            self.api.post(f"/sales/credit-settlement/{tx_id}/bank-transfer/verify", ok=(200, 201, 204))

    def collect(self, d: date) -> None:
        """Customers pay most credit invoices around their due date; a few stay overdue."""
        still_open = []
        for inv_id, inv_date, days, amount in self.open_credit:
            age = (d - inv_date).days
            if age >= max(3, int(days * 0.7)) and self.rng.random() < 0.8:
                at(d, self.rng.randint(10, 16), self.rng.randint(0, 59))
                how = self.rng.choice(["bank_transfer", "bank_transfer", "cheque", "cash"])
                body = {"invoice_id": inv_id, "payment_method": how, "payment_amount": amount, "payment_date": d.isoformat()}
                if how == "bank_transfer":
                    body.update(bank_transfer_ref=f"BT{self.rng.randint(100000, 999999)}", bank_name="Sampath Bank")
                if how == "cheque":
                    body.update(cheque_number=str(self.rng.randint(100000, 999999)), cheque_bank="Hatton National Bank", cheque_date=d.isoformat())
                try:
                    self.api.post(f"/sales/{inv_id}/settle-payment", body)
                except RuntimeError as e:
                    bal = re.search(r"available balance \(Rs\. ([\d,.]+)\)", str(e))
                    if not bal:
                        print("   settle skipped:", str(e)[:140])
                        continue
                    body["payment_amount"] = float(bal.group(1).replace(",", ""))
                    self.api.post(f"/sales/{inv_id}/settle-payment", body)
                if how == "bank_transfer":
                    self.verify_settlements(d)
            else:
                still_open.append((inv_id, inv_date, days, amount))
        self.open_credit = still_open

    # --- month-end and odds & ends --------------------------------------------------------------
    def payroll(self, year: int, month: int, run_day: date, pay_day: date, finish: bool = True) -> None:
        a = self.api
        at(run_day, 10)
        b = a.post("/hr/payroll/run", {"payroll_month": month, "payroll_year": year,
                                       "description": f"Monthly salaries {date(year, month, 1):%B %Y}"})
        bid = b["id"]
        a.post(f"/hr/payroll/batches/{bid}/submit")
        at(run_day, 15)
        a.post(f"/hr/payroll/batches/{bid}/approve", {"remarks": "Checked against attendance"})
        if not finish:
            return
        at(pay_day, 9)
        a.post(f"/hr/payroll/batches/{bid}/process-payment", {"payment_method": "bank_transfer",
               "payment_reference": f"SAL-{year}{month:02d}", "payment_date": pay_day.isoformat()})
        sd = pay_day + timedelta(days=5)
        at(sd, 11)
        a.post(f"/hr/payroll/batches/{bid}/process-statutory", {"epf_reference": f"EPF-C-{year}{month:02d}",
               "etf_reference": f"ETF-{year}{month:02d}", "payment_date": sd.isoformat()})
        a.post(f"/hr/payroll/batches/{bid}/complete")
        print(f"  payroll {year}-{month:02d} done")

    def transfers(self) -> None:
        a = self.api
        for d, to_br, picks in ((date(2026, 10, 14), "JFN", [0, 6, 9]), (date(2026, 10, 22), "GLE", [3, 13, 16]),
                                (date(2026, 11, 3), "KDY", [1, 7, 10, 17]), (date(2026, 11, 6), "KUR", [2, 14])):
            at(d, 9, 15)
            try:
                a.post("/warehouse/transfer-notes", {
                    "created_date": d.isoformat(), "from_location_id": self.location_ids["CMB"],
                    "to_location_id": self.location_ids[to_br], "branch_code": "CMB",
                    "remark": f"Stock top-up for {to_br}",
                    "items": [{"product_id": self.product_ids[i], "quantity": self.rng.choice([24, 36, 48]), "branch_code": "CMB"} for i in picks],
                })
            except RuntimeError as e:
                print("   transfer skipped:", str(e)[:160])
        self.approve_pending()
        print("  transfers done")

    def quotations(self) -> None:
        a = self.api
        for k in range(5):
            d = TODAY - timedelta(days=k * 2 + 1)
            at(d, 11)
            cid, cname, br = self.rng.choice(self.customers)
            picks = self.rng.sample(range(len(PRODUCTS)), 4)
            try:
                a.post("/sales/quotes/", {
                    "branch_code": br, "customer_id": cid, "valid_until": (d + timedelta(days=14)).isoformat(),
                    "payment_terms": "30 days credit", "delivery_terms": "Delivered to store",
                    "items": [{"product_id": self.product_ids[i], "quantity": self.rng.choice([48, 96, 120]),
                               "selling_price": PRODUCTS[i][5], "minimum_selling_price": round(PRODUCTS[i][5] * 0.92),
                               "warrenty_month": "0", "tax_rate": PRODUCTS[i][6]} for i in picks],
                })
            except RuntimeError as e:
                print("   quote skipped:", str(e)[:160])
        print("  quotations done")

    def extras(self) -> None:
        for step in (lambda: self.payroll(2026, 9, date(2026, 9, 26), date(2026, 9, 28)),
                     lambda: self.payroll(2026, 10, date(2026, 10, 27), date(2026, 10, 28)),
                     self.transfers, self.quotations):
            try:
                step()
            except RuntimeError as e:
                print("   step failed:", str(e)[:300])

    def run_days(self) -> None:
        days = list(business_days(START, TODAY))
        for n, d in enumerate(days):
            self.collect(d)
            if d.weekday() == 4:
                self.pay_suppliers(d)
            busy = 1.3 if d.day in range(25, 32) or d.day < 4 else 1.0
            for _ in range(int(self.rng.randint(4, 8) * busy)):
                self.sale(d, self.rng.randint(9, 17))
            if d.weekday() in (0, 1) and n:  # weekly restock: half the suppliers Monday, half Tuesday
                for br in self.branch_ids:
                    for si in (range(0, 3) if d.weekday() == 0 else range(3, 6)):
                        self.purchase(d, br, si, qty_scale=0.65 if br == "CMB" else 0.45)
            print(f"  {d}  done", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reset", action="store_true", help="drop and recreate erp_demo, then exit")
    ap.add_argument("--only", choices=["setup", "people", "stock", "days", "extras", "verify"], help="run a single phase (debugging)")
    args = ap.parse_args()
    if args.reset:
        reset_database()
        return
    import logging

    logging.disable(logging.INFO)  # request logs are noise here; warnings and errors still show
    install_clock()
    s = Seeder(Api())
    phases = ["setup", "people", "stock", "days", "extras"] if not args.only else [args.only]
    for ph in phases:
        print(f"== {ph}", flush=True)
        {"setup": s.setup, "people": s.people, "stock": s.opening_stock, "days": s.run_days, "extras": s.extras, "verify": s.verify_all}[ph]()
    if s.vat_mismatch:
        from collections import Counter
        print("Total corrected by the app, per payment method:", dict(Counter(m for m, _, _ in s.vat_mismatch)))
        print("  e.g.", s.vat_mismatch[:3])
    print("Done.")


if __name__ == "__main__":
    main()
