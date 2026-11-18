"""Seed a Distributor Lanka demo company for website screenshots, through the real API (http://127.0.0.1:8000).

Fictional Sri Lankan FMCG agency, three branches, four trucks, ~3 weeks of history up to today.
Test credentials are generated once and kept in creds.json next to this file (never printed).
See README.md in this folder for the full steps.
"""
import json, os, random, secrets, subprocess, sys
from datetime import date, timedelta
from pathlib import Path
import httpx

HERE = Path(__file__).parent
API = 'http://127.0.0.1:8000/api/v1'
BACKEND = Path(r'C:\MyProjects\Distribution-Cloud\backend')
ENV = {**os.environ, 'DATABASE_URL': 'postgresql://postgres:postgres@127.0.0.1:5441/distribution_cloud', 'ENVIRONMENT': 'development'}
random.seed(42)
TODAY = date.today()
DAYS = 45

cf = HERE / 'creds.json'
if cf.exists():
    creds = json.loads(cf.read_text())
else:
    creds = {'platform': {'email': 'platform@demo.example.com', 'password': secrets.token_urlsafe(14)},
             'owner': {'email': 'nimal@lankafresh.example.com', 'password': secrets.token_urlsafe(14)}}
    cf.write_text(json.dumps(creds, indent=2))


def ok(r: httpx.Response):
    if r.status_code >= 400:
        raise SystemExit(f'{r.request.method} {r.request.url.path} -> {r.status_code}: {r.text[:400]}')
    return r.json() if r.content else None


def login(who):
    r = ok(httpx.post(f'{API}/auth/login', json={'email': creds[who]['email'], 'password': creds[who]['password'], 'device_name': 'seed', 'sign_out_other_devices': True}))
    return httpx.Client(base_url=API, headers={'Authorization': f"Bearer {r['token']}"}, timeout=60)


# 1. platform admin (script) and the company
subprocess.run([sys.executable, '-m', 'scripts.create_platform_admin', creds['platform']['email'], '--name', 'Demo Platform'],
               cwd=BACKEND, env={**ENV, 'PLATFORM_ADMIN_PASSWORD': creds['platform']['password']}, check=True, stdout=subprocess.DEVNULL)
pa = login('platform')
plans = {p['code']: p for p in ok(pa.get('/platform/plans'))}
tenants = ok(pa.get('/platform/tenants'))
if not any(t['name'] == 'Lanka Fresh Distributors' for t in tenants):
    ok(pa.post('/platform/tenants', json={'name': 'Lanka Fresh Distributors', 'slug': 'lanka-fresh', 'plan_id': plans['business']['id'],
        'contact_phone': '+94 37 222 4180', 'owner': {'full_name': 'Nimal Perera', **{k: creds['owner'][k] for k in ('email', 'password')}}}))
c = login('owner')
if ok(c.get('/products')):
    raise SystemExit('company already has data; drop the demo DB volume to reseed')

ok(c.patch('/settings', json={'company_name': 'Lanka Fresh Distributors', 'legal_name': 'Lanka Fresh Distributors (Pvt) Ltd',
    'registration_no': 'PV 00123456', 'phone': '+94 37 222 4180', 'email': 'office@lankafresh.example.com', 'address': '42 Puttalam Road',
    'city': 'Kurunegala', 'country': 'Sri Lanka', 'currency': 'LKR'}))

# 2. branches (main one exists already)
branches = ok(c.get('/branches'))
main = branches[0]
ok(c.patch(f"/branches/{main['id']}", json={'name': 'Kurunegala (Main)', 'city': 'Kurunegala', 'phone': '037 222 4180', 'address': '42 Puttalam Road'}))
kandy = ok(c.post('/branches', json={'name': 'Kandy', 'city': 'Kandy', 'phone': '081 223 5561', 'address': '18 Katugastota Road', 'status': 'active'}))
puttalam = ok(c.post('/branches', json={'name': 'Puttalam', 'city': 'Puttalam', 'phone': '032 226 5520', 'address': '7 Kurunegala Road', 'status': 'active'}))
B = [main['id'], kandy['id'], puttalam['id']]

# 3. roles + employees
roles = {r['name']: r['id'] for r in ok(c.get('/roles'))}
for name in ('Sales rep', 'Driver', 'Storekeeper'):
    if name not in roles:
        roles[name] = ok(c.post('/roles', json={'name': name}))['id']
people = [('Kasun', 'Bandara', 'Sales rep'), ('Ruwan', 'Jayasinghe', 'Sales rep'), ('Chamara', 'Dissanayake', 'Sales rep'),
          ('Isuru', 'Rathnayake', 'Sales rep'), ('Saman', 'Kumara', 'Driver'), ('Pradeep', 'Wijesekara', 'Driver'),
          ('Dilani', 'Fernando', 'Storekeeper'), ('Tharindu', 'Herath', 'Storekeeper')]
emps = []
for i, (f, l, r) in enumerate(people):
    emps.append(ok(c.post('/employees', json={'first_name': f, 'last_name': l, 'email': f'{f.lower()}@lankafresh.example.com', 
        'role_id': roles[r], 'status': 'active', 'hire_date': str(TODAY - timedelta(days=400 + i * 37))})))
reps = emps[:4]

# 4. trucks
truck_specs = [('NW LK-3482', 'Isuzu', 'Elf', 2019, 3500), ('NW LJ-7715', 'Mitsubishi', 'Canter', 2020, 3000),
               ('CP LH-2209', 'Tata', 'Ultra 1014', 2021, 4500), ('NW PH-6031', 'Toyota', 'Dyna', 2018, 2500)]
trucks = []
for (reg, make, model, yr, kg), rep in zip(truck_specs, reps):
    t = ok(c.post('/trucks', json={'registration_no': reg, 'make': make, 'model': model, 'year': yr, 'capacity_kg': kg, 'status': 'available'}))
    ok(c.put(f"/trucks/{t['id']}/assignment", json={'employee_id': rep['id']}))
    trucks.append(t)
routes = ['Kurunegala town · Wariyapola', 'Kuliyapitiya · Narammala', 'Kandy · Katugastota · Akurana', 'Puttalam · Chilaw']
truck_branch = [B[0], B[0], B[1], B[2]]

# 5. suppliers + products
sup = {n: ok(c.post('/suppliers', json={'name': n, 'contact_person': p, 'phone': ph, 'city': city, 'status': 'active'}))['id'] for n, p, ph, city in [
    ('Island Biscuit Company', 'Mahesh Silva', '011 245 7781', 'Colombo'), ('Highland Tea Packers', 'Roshan Gunawardena', '081 238 4410', 'Kandy'),
    ('Ceylon Dairy Foods', 'Anoma Peris', '011 290 3317', 'Ja-Ela'), ('Lanka Home Care', 'Nuwan Abeysekara', '011 257 6620', 'Ekala'),
    ('Golden Grain Mills', 'Sunil Rajapaksha', '037 223 1904', 'Kurunegala')]}
P = [  # sku, name, category, unit, cost, price, supplier
    ('BIS-CC190', 'Cream crackers 190g', 'Biscuits', 'pack', 168, 200, 'Island Biscuit Company'),
    ('BIS-MAR400', 'Marie biscuits 400g', 'Biscuits', 'pack', 255, 300, 'Island Biscuit Company'),
    ('BIS-CHC100', 'Chocolate cream 100g', 'Biscuits', 'pack', 118, 140, 'Island Biscuit Company'),
    ('TEA-BOP400', 'BOP tea 400g', 'Tea', 'pack', 610, 720, 'Highland Tea Packers'),
    ('TEA-BAG50', 'Tea bags 50s', 'Tea', 'box', 345, 410, 'Highland Tea Packers'),
    ('DRY-MP400', 'Full cream milk powder 400g', 'Dairy', 'pack', 980, 1150, 'Ceylon Dairy Foods'),
    ('DRY-MP1KG', 'Full cream milk powder 1kg', 'Dairy', 'pack', 2380, 2750, 'Ceylon Dairy Foods'),
    ('DRY-YOG80', 'Set yoghurt 80g', 'Dairy', 'cup', 62, 80, 'Ceylon Dairy Foods'),
    ('HC-SOAP100', 'Herbal soap 100g', 'Home care', 'bar', 118, 145, 'Lanka Home Care'),
    ('HC-WP1KG', 'Washing powder 1kg', 'Home care', 'pack', 540, 640, 'Lanka Home Care'),
    ('HC-DW500', 'Dishwash liquid 500ml', 'Home care', 'bottle', 330, 395, 'Lanka Home Care'),
    ('GR-NDL400', 'Rice noodles 400g', 'Grocery', 'pack', 205, 250, 'Golden Grain Mills'),
    ('GR-FLR1KG', 'Wheat flour 1kg', 'Grocery', 'pack', 215, 255, 'Golden Grain Mills'),
    ('GR-SOY90', 'Soya meat 90g', 'Grocery', 'pack', 88, 110, 'Golden Grain Mills'),
]
prods = []
for i, (sku, name, cat, unit, cost, price, s) in enumerate(P):
    prods.append(ok(c.post('/products', json={'sku': sku, 'barcode': f'479{1000000000 + i * 7919:010d}', 'name': name, 'category': cat, 'unit': unit,
        'cost_price': cost, 'selling_price': price, 'status': 'active', 'supplier_id': sup[s]})))
price = {p['id']: float(p['selling_price']) for p in prods}
sup_of = {pr['id']: sup[spec[6]] for pr, spec in zip(prods, P)}
cost = {p['id']: float(p['cost_price']) for p in prods}

# 6. customers (shops along each route)
shops = [
    ('Perera Stores', 'Kurunegala', 0), ('Sampath Grocery', 'Wariyapola', 0), ('New Lanka Traders', 'Kurunegala', 0), ('Malkanthi Stores', 'Wariyapola', 0),
    ('Dimuthu Super', 'Kuliyapitiya', 1), ('Ranasinghe Mini Mart', 'Narammala', 1), ('Gamini Stores', 'Kuliyapitiya', 1), ('Hiru Food City', 'Narammala', 1),
    ('Hill Top Stores', 'Kandy', 2), ('Akurana Traders', 'Akurana', 2), ('Katugastota Super', 'Katugastota', 2), ('Mahanuwara Grocery', 'Kandy', 2),
    ('Sea View Stores', 'Puttalam', 3), ('Chilaw Mini Mart', 'Chilaw', 3), ('Fathima Stores', 'Puttalam', 3), ('Wennappuwa Traders', 'Chilaw', 3),
]
custs = {r: [] for r in range(4)}
for name, city, r in shops:
    cu = ok(c.post('/customers', json={'name': name, 'customer_type': 'wholesale' if 'Traders' in name else 'retail', 'city': city,
        'contact_person': random.choice(['Mr. Perera', 'Mrs. Silva', 'Mr. Fernando', 'Mr. Nazeer', 'Mrs. Kumari']), 
        'credit_limit': random.choice([50000, 75000, 100000, 150000]), 'payment_terms_days': random.choice([7, 14, 30]), 'status': 'active'}))
    custs[r].append(cu)
walkin = ok(c.post('/customers', json={'name': 'Cash customer', 'customer_type': 'retail', 'city': 'Kurunegala', 'credit_limit': 0, 'payment_terms_days': 0, 'status': 'active'}))

# 7. finance accounts
cash = ok(c.post('/finance/accounts', json={'name': 'Office cash', 'kind': 'cash', 'opening_balance': 150000, 'opening_date': str(TODAY - timedelta(days=DAYS + 2)), 'is_default': True}))
bank = ok(c.post('/finance/accounts', json={'name': 'Current account', 'kind': 'bank', 'bank_name': 'People’s Bank', 'account_no': '058-1-001-2-4471',
    'opening_balance': 1850000, 'opening_date': str(TODAY - timedelta(days=DAYS + 2)), 'is_default': False}))


# opening stock + weekly deliveries per branch, by supplier
for d in range(DAYS + 1, -1, -7):
    day = TODAY - timedelta(days=d)
    for bi, b in enumerate(B):
        for s_name, s_id in sup.items():
            ls = [{'product_id': p['id'], 'quantity': int(random.randint(90, 170) * (1.6 if bi == 0 else 1)), 'free_qty': random.choice([0, 0, 6, 12]), 'unit_cost': cost[p['id']]}
                  for p in prods if sup_of[p['id']] == s_id]
            ok(c.post('/inventory/grns', json={'branch_id': b, 'supplier_id': s_id, 'supplier_ref': f'INV-{random.randint(10000, 99999)}',
                'received_date': str(day), 'lines': ls, 'note': None}))
print('stock in')

sheets_today = []
for d in range(DAYS, -1, -1):
    day = TODAY - timedelta(days=d)
    if day.weekday() == 6:  # Sunday off
        continue
    for ti, t in enumerate(trucks):
        if d > 0 and random.random() < 0.12:
            continue  # truck in for service now and then
        picks = random.sample(prods, random.randint(8, 12))
        lines = [{'product_id': p['id'], 'quantity': random.randint(18, 48), 'unit_price': price[p['id']]} for p in picks]
        sheet = ok(c.post('/loading-sheets', json={'branch_id': truck_branch[ti], 'truck_id': t['id'], 'driver_id': reps[ti]['id'], 'route': routes[ti],
            'load_date': str(day), 'lines': lines}))
        left = {l['product_id']: l['quantity'] for l in lines}
        n_orders = random.randint(2, 4) if d == 0 else random.randint(4, 7)
        for cu in random.sample(custs[ti] * 2, min(n_orders, 8)):
            avail = [pid for pid, q in left.items() if q >= 4]
            if not avail:
                break
            ol = []
            for pid in random.sample(avail, min(len(avail), random.randint(3, 6))):
                q = random.randint(2, max(2, min(12, left[pid] // 2)))
                left[pid] -= q
                ol.append({'product_id': pid, 'quantity': q, 'unit_price': price[pid]})
            total = sum(l['quantity'] * l['unit_price'] for l in ol)
            how = random.choices(['cash', 'credit', 'cheque', 'bank_transfer', 'partial'], [45, 22, 13, 8, 12])[0]
            body = {'order_type': 'truck', 'order_date': str(day), 'customer_id': cu['id'], 'employee_id': reps[ti]['id'], 'loading_sheet_id': sheet['id'],
                    'discount': 0, 'delivered': True, 'lines': ol}
            if how == 'cash':
                body.update(payment_method='cash', amount_paid=total, cash_received=total)
            elif how == 'credit':
                body.update(payment_method='credit', amount_paid=0)
            elif how == 'cheque':
                body.update(payment_method='cheque', amount_paid=total, cheque_bank=random.choice(['BOC', 'Commercial Bank', 'HNB', 'Sampath Bank']),
                            cheque_date=str(day + timedelta(days=random.choice([0, 7, 14]))), payment_reference=f'{random.randint(100000, 999999)}')
            elif how == 'bank_transfer':
                body.update(payment_method='bank_transfer', amount_paid=total, payment_reference=f'TRF{random.randint(10000, 99999)}')
            else:
                body.update(payment_method='cash', amount_paid=round(total * 0.5, -2), cash_received=round(total * 0.5, -2))
            r = c.post('/orders', json=body)
            if r.status_code == 409 and 'credit' in r.text.lower():  # over the credit limit: pay cash instead
                body.update(payment_method='cash', amount_paid=total, cash_received=total)
                r = c.post('/orders', json=body)
            ok(r)
        if d == 0:
            sheets_today.append(sheet)
            continue  # today's trucks are still on the road
        ret = []
        for pid, q in left.items():
            if q <= 0:
                continue
            short = 1 if random.random() < 0.06 else 0
            dmg = 1 if random.random() < 0.05 and q - short > 1 else 0
            back = max(q - short, 0)
            ret.append({'product_id': pid, 'returned_qty': back, 'damaged_qty': min(dmg, back)})
        if ret:
            ok(c.post(f"/loading-sheets/{sheet['id']}/unload", json={'lines': ret, 'note': None}))

    # counter sales at the main branch
    if day.weekday() != 6:
        for _ in range(random.randint(1, 3)):
            ol = [{'product_id': p['id'], 'quantity': random.randint(1, 6), 'unit_price': price[p['id']]} for p in random.sample(prods, random.randint(2, 4))]
            total = sum(l['quantity'] * l['unit_price'] for l in ol)
            ok(c.post('/orders', json={'order_type': 'onsite', 'order_date': str(day), 'customer_id': walkin['id'], 'branch_id': B[0],
                'payment_method': 'cash', 'amount_paid': total, 'cash_received': total, 'discount': 0, 'delivered': True, 'lines': ol}))
        # running costs
        for ti, t in enumerate(trucks):
            if random.random() < 0.6:
                ok(c.post('/finance/expenses', json={'spent_on': str(day), 'category': 'Fuel', 'amount': random.choice([6500, 7200, 8100, 9400]), 'account_id': cash['id'],
                    'branch_id': truck_branch[ti], 'truck_id': t['id'], 'payee': 'Ceypetco filling station'}))
        if day.weekday() == 5:
            ok(c.post('/finance/expenses', json={'spent_on': str(day), 'category': 'Vehicle repairs', 'amount': random.choice([12500, 18400, 24000]), 'account_id': cash['id'],
                'truck_id': random.choice(trucks)['id'], 'payee': 'Wijaya Motors'}))
        if day.day == 1 or d == DAYS:
            ok(c.post('/finance/expenses', json={'spent_on': str(day), 'category': 'Rent', 'amount': 85000, 'account_id': bank['id'], 'branch_id': B[1], 'payee': 'Kandy store landlord'}))
    print('day', day)

# pay suppliers part of what we owe
for s_id in sup.values():
    ok(c.post('/finance/supplier-payments', json={'supplier_id': s_id, 'paid_on': str(TODAY - timedelta(days=3)), 'amount': random.choice([250000, 400000, 600000]),
        'method': 'bank_transfer', 'account_id': bank['id'], 'reference': f'TRF{random.randint(10000, 99999)}'}))
# bank the cash
for d in range(DAYS - 1, 0, -3):
    ok(c.post('/finance/entries', json={'entry_date': str(TODAY - timedelta(days=d)), 'kind': 'transfer', 'amount': 350000, 'account_id': cash['id'],
        'to_account_id': bank['id'], 'description': 'Cash banked'}))
# a few reorder levels so low-stock alerts show
for p in prods[:6]:
    ok(c.patch(f"/inventory/{B[1]}/{p['id']}", json={'reorder_level': 400}))
print('done; trucks on route today:', len(sheets_today))
