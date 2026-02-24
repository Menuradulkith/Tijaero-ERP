"""
MySQL → PostgreSQL Data Migration Script
=========================================
Old system: unity_systems_pos (MySQL / Django POS)
New system: erp_db (PostgreSQL / TijaeroERP FastAPI)

Run:
    pip install mysql-connector-python psycopg2-binary
    python migrate.py

Edit MYSQL_CONFIG and PG_CONFIG below before running.
"""

import sys
import json
import logging
import traceback
from datetime import datetime, date, timezone

# ── third-party ─────────────────────────────────────────────────────────────
try:
    import mysql.connector
except ImportError:
    sys.exit("mysql-connector-python is required.  Run: pip install mysql-connector-python")

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    sys.exit("psycopg2 is required.  Run: pip install psycopg2-binary")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  CONFIGURATION  – edit these before running
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MYSQL_CONFIG = {
    "host":     "127.0.0.1",
    "port":     3306,
    "user":     "admin",
    "password": "admin",
    "database": "app",
    "charset":  "utf8mb4",
}

PG_CONFIG = {
    "host":     "51.79.226.133",
    "port":     5432,
    "user":     "erp_user",
    "password": "CHANGE_THIS_STRONG_PASSWORD_IN_PRODUCTION",
    "dbname":   "erp_db",
}

# Fallback branch_code when it cannot be inferred (used for good_received_locations)
DEFAULT_BRANCH_CODE = "BR01"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  LOGGING
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler("migration.log", encoding="utf-8"),
    ],
)
log = logging.getLogger("migration")

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  HELPERS
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

NOW = datetime.now()

def bool_val(v):
    """Coerce MySQL tinyint(1) / None to Python bool."""
    if v is None:
        return None
    return bool(int(v))

def ts(v):
    """Return v as-is (already datetime) or None."""
    return v if v else None

def ensure_ts(v, fallback=None):
    """Return v if it is a datetime, else fallback (defaults to NOW)."""
    if isinstance(v, datetime):
        return v
    if isinstance(v, date):
        return datetime(v.year, v.month, v.day)
    return fallback or NOW

def fetch_all(mysql_cur, query, params=None):
    mysql_cur.execute(query, params or ())
    return mysql_cur.fetchall()

def upsert_seq(pg_cur, table, max_id):
    """Advance the sequence so nextval() won't collide with imported IDs."""
    if max_id:
        pg_cur.execute(
            f"SELECT setval(pg_get_serial_sequence(%s, 'id'), %s, true)",
            (table, max_id),
        )

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  TABLE MIGRATION FUNCTIONS
#  Each returns (inserted, skipped) counts.
#  All are wrapped in a savepoint so a failed table doesn't abort the
#  whole migration.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

def migrate_country(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM country")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO country (id, iso, iso3, iso_numeric, fips, name, capital,
                    area, population, continent, tld, currency_code, currency_symbol,
                    currency_name, phone, postal_code_format, postal_code_regex,
                    languages, geonameid, neighbours, equivalent_fips_code)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (r['id'], r['iso'], r['iso3'], r['iso_numeric'], r['fips'],
                  r['name'], r['capital'], r['area'], r['population'],
                  r['continent'], r['tld'], r['currency_code'],
                  r['currency_symbol'], r['currency_name'], r['phone'],
                  r['postal_code_format'], r['postal_code_regex'],
                  r['languages'], r['geonameid'], r['neighbours'],
                  r['equivalent_fips_code']))
            ins += 1
        except Exception:
            skp += 1
            log.warning("country id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'country', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_branches(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM branches")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO branches (id, branch_name, address, email, contact_number,
                    branch_code, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (r['id'], r['branch_name'], r['address'], r['email'],
                  r['contact_number'], r['branch_code'], NOW, NOW))
            ins += 1
        except Exception:
            skp += 1
            log.warning("branches id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'branches', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_auth_group(mc, pg):
    """
    MySQL auth_group comes from Django and may conflict with the groups already
    seeded in the new DB.  We use ON CONFLICT DO UPDATE to keep the name but
    preserve created_at/updated_at from the new system if already present.
    """
    rows = fetch_all(mc, "SELECT * FROM auth_group")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO auth_group (id, name, created_at, updated_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE
                    SET name = EXCLUDED.name
            """, (r['id'], r['name'], NOW, NOW))
            ins += 1
        except Exception:
            skp += 1
            log.warning("auth_group id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'auth_group', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_accounts_user(mc, pg):
    """
    Key diff: MySQL column 'password' → PG column 'hashed_password'.
    PG adds created_at, updated_at.
    """
    rows = fetch_all(mc, "SELECT * FROM accounts_user")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO accounts_user (
                    id, hashed_password, last_login, is_superuser, username, email,
                    first_name, middle_name, last_name, gender, is_staff, is_active,
                    date_joined, birthdate, employee_id, verify, blocked, occupation,
                    country_id, profile_picture_id, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'],
                r['password'],            # MySQL 'password' → PG 'hashed_password'
                ts(r.get('last_login')),
                bool_val(r['is_superuser']),
                r['username'],
                r['email'],
                r['first_name'],
                r.get('middle_name'),
                r['last_name'],
                r['gender'],
                bool_val(r['is_staff']),
                bool_val(r['is_active']),
                r['date_joined'],
                r['birthdate'],
                r['employee_id'],
                bool_val(r['verify']),
                bool_val(r['blocked']),
                r['occupation'],
                r.get('country_id'),
                r.get('profile_picture_id'),
                ensure_ts(r.get('date_joined')),
                NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("accounts_user id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'accounts_user', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_accounts_user_branches(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM accounts_user_branches")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO accounts_user_branches (id, user_id, branches_id)
                VALUES (%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (r['id'], r['user_id'], r['branches_id']))
            ins += 1
        except Exception:
            skp += 1
            log.warning("accounts_user_branches id=%s skipped", r['id'])
    upsert_seq(cur, 'accounts_user_branches', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_accounts_user_groups(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM accounts_user_groups")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO accounts_user_groups (id, user_id, group_id)
                VALUES (%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (r['id'], r['user_id'], r['group_id']))
            ins += 1
        except Exception:
            skp += 1
            log.warning("accounts_user_groups id=%s skipped (group may not exist)", r['id'])
    upsert_seq(cur, 'accounts_user_groups', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_items_brand(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM items_brand")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO items_brand (id, brand_name, brand_code, description)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (r['id'], r['brand_name'], r['brand_code'], r.get('description')))
            ins += 1
        except Exception:
            skp += 1
            log.warning("items_brand id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'items_brand', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_category(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM category")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO category (id, name, category_code, memo, description,
                    active, created_date, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['name'], r['category_code'], r.get('memo'),
                r.get('description'), bool_val(r['active']),
                ensure_ts(r['created_date']), ensure_ts(r['created_date']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("category id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'category', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_customers(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM customers")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO customers (
                    id, title, customer_name, name_in_cheque_card, occupation,
                    company_name, payment_address, delivery_address, bank_details,
                    date_joined, birthdate, id_card_number, gender, civil_status,
                    passport_no, no_of_kids, email, home_contact_number,
                    mobile_contact_number, credit_days, max_credit_limit,
                    left_credit_amount, active, country_id, initial_credit_amount,
                    is_customer_agent, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                        %s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['title'], r['customer_name'],
                r.get('name_in_cheque_card'), r.get('occupation'),
                r.get('company_name'), r.get('payment_address'),
                r.get('delivery_address'), r.get('bank_details'),
                ensure_ts(r['date_joined']),
                r.get('birthdate'),
                r.get('id_card_number'), r['gender'], r['civil_status'],
                r.get('passport_no'), r['no_of_kids'],
                r.get('email'), r.get('home_contact_number'),
                r['mobile_contact_number'],
                r['credit_days'], r['max_credit_limit'],
                r.get('left_credit_amount'),
                bool_val(r['active']),
                r.get('country_id'), r.get('initial_credit_amount'),
                False,   # is_customer_agent – not in old system
                ensure_ts(r['date_joined']),
                NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("customers id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'customers', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_supplier(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM supplier")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO supplier (
                    id, title, full_name, name_in_cheque_card, occupation,
                    company_name, company_registration_number, company_postal_address,
                    company_contact_number, company_website, postal_address,
                    permenent_address, bank_details, date_joined, birthdate,
                    id_card_number, gender, civil_status, passport_no, no_of_kids,
                    email, home_contact_number, mobile_contact_number, credit_days,
                    max_credit_limit, left_credit_amount, initial_credit_amount,
                    active, country_id, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                        %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['title'], r['full_name'],
                r.get('name_in_cheque_card'), r.get('occupation'),
                r.get('company_name'), r.get('company_registration_number'),
                r.get('company_postal_address'), r.get('company_contact_number'),
                r.get('company_website'), r['postal_address'],
                r['permenent_address'], r.get('bank_details'),
                ensure_ts(r['date_joined']),
                r.get('birthdate'), r.get('id_card_number'),
                r['gender'], r['civil_status'],
                r.get('passport_no'), r['no_of_kids'],
                r.get('email'), r.get('home_contact_number'),
                r['mobile_contact_number'],
                r['credit_days'], r['max_credit_limit'],
                r.get('left_credit_amount'), r.get('initial_credit_amount'),
                bool_val(r['active']), r.get('country_id'),
                ensure_ts(r['date_joined']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("supplier id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'supplier', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_products(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM products")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO products (
                    id, name, item_code, model, item_type, description,
                    website_active, website_price, active, cost_price,
                    created_date, category_id, items_brand_id, added_date,
                    selling_price, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['name'], r['item_code'], r.get('model'),
                r['item_type'], r.get('description'),
                bool_val(r['website_active']), r.get('website_price'),
                bool_val(r['active']), r['cost_price'],
                r['created_date'], r['category_id'], r['items_brand_id'],
                ensure_ts(r['added_date']),
                r.get('website_price'),   # selling_price ← closest proxy
                ensure_ts(r['added_date']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("products id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'products', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_minimum_price(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM minimum_price")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO minimum_price (id, minimum_price, created_date,
                    product_id, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['minimum_price'],
                ensure_ts(r['created_date']),
                r['product_id'],
                ensure_ts(r['created_date']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("minimum_price id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'minimum_price', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_good_received_locations(mc, pg):
    """
    MySQL table lacks branch_code.  We fall back to DEFAULT_BRANCH_CODE.
    """
    rows = fetch_all(mc, "SELECT * FROM good_received_locations")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO good_received_locations (
                    id, name, branch_code, created_date, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['name'],
                DEFAULT_BRANCH_CODE,          # not stored in old system
                ensure_ts(r['created_date']),
                ensure_ts(r['created_date']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("good_received_locations id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'good_received_locations', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_purchasing_orders(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM purchasing_orders")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO purchasing_orders (
                    id, purchasing_order_no, purchasing_invoice_no, branch_code,
                    payment_method, purchasing_order_date, good_received_note_date,
                    remarks, credit_date, created_date, first_suppliers_id,
                    second_suppliers_id, added_date, approval_id, status,
                    sales_quote_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['purchasing_order_no'], r['purchasing_invoice_no'],
                r['branch_code'], r['payment_method'],
                r['purchasing_order_date'], r['good_received_note_date'],
                r.get('remarks'), r.get('credit_date'),
                r['created_date'], r['first_suppliers_id'],
                r['second_suppliers_id'],
                ensure_ts(r['added_date']),
                None,          # approval_id  – not in old system
                'completed',   # status default
                None,          # sales_quote_id – new field
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("purchasing_orders id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'purchasing_orders', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_purchasing_order_items(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM purchasing_order_items")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO purchasing_order_items (
                    id, quantity, unit_price, warrenty_month, remark,
                    created_date, product_id, purchasingorders_id, added_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['quantity'], r['unit_price'], r['warrenty_month'],
                r.get('remark'), r['created_date'], r['product_id'],
                r['purchasingorders_id'], ensure_ts(r['added_date']),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("purchasing_order_items id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'purchasing_order_items', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_good_received_note(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM good_received_note")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO good_received_note (
                    id, good_received_no, good_received_date, supplier_invoice_no,
                    supplier_invoice_date, remark, branch_code, created_date,
                    good_received_locations_id, purchasingorders_id, added_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['good_received_no'], r['good_received_date'],
                r['supplier_invoice_no'], r['supplier_invoice_date'],
                r.get('remark'), r['branch_code'], r['created_date'],
                r['good_received_locations_id'], r['purchasingorders_id'],
                ensure_ts(r['added_date']),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("good_received_note id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'good_received_note', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_good_received_items(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM good_received_items")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO good_received_items (
                    id, good_received_note, barcode, branch_code, active,
                    created_date, purchasing_order_items_id, added_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['good_received_note'], r['barcode'],
                r['branch_code'], bool_val(r['active']),
                r['created_date'], r['purchasing_order_items_id'],
                ensure_ts(r['added_date']),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("good_received_items id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'good_received_items', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_expenses(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM expenses")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO expenses (
                    id, expenses_no, expenses_method, expense_amount,
                    remarks, created_date, branch_code,
                    expense_type, expense_category, status,
                    created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['expenses_no'], r['expenses_method'],
                r['expense_amount'], r.get('remarks'),
                r['created_date'], r['branch_code'],
                'operational', 'miscellaneous', 'pending',
                NOW, NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("expenses id=%s skipped: %s", r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'expenses', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_bank_deposits(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM bank_deposits")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO bank_deposits (
                    id, deposits_amount, remarks, created_date, branch_code,
                    status)
                VALUES (%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['deposits_amount'], r.get('remarks'),
                ensure_ts(r['created_date']),
                r['branch_code'], 'pending',
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("bank_deposits id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'bank_deposits', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_advance_receipt(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM advance_receipt")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO advance_receipt (id, paid_price_currency, paid_price,
                    special_note, created_date)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['paid_price_currency'], r['paid_price'],
                r.get('special_note'), ensure_ts(r['created_date']),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("advance_receipt id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'advance_receipt', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_customer_advance_payments(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM customer_advance_payments")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO customer_advance_payments (
                    id, advance_payments_no, payment_method, branch_code,
                    payment_amount, remarks, created_date, customer_id,
                    cheque_date, active,
                    applied_amount, remaining_amount, is_fully_applied)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['advance_payments_no'], r['payment_method'],
                r['branch_code'], r['payment_amount'], r.get('remarks'),
                r['created_date'], r['customer_id'], r['cheque_date'],
                bool_val(r['active']),
                0, r['payment_amount'], False,   # new fields – defaults
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("customer_advance_payments id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'customer_advance_payments', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_customer_credits_settle(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM customer_credits_settle")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO customer_credits_settle (
                    id, customer_credits_settle_no, branch_code,
                    created_date, customer_id)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['customer_credits_settle_no'], r['branch_code'],
                ensure_ts(r['created_date']), r['customer_id'],
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("customer_credits_settle id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'customer_credits_settle', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_customer_credits_settle_transaction(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM customer_credits_settle_transaction")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO customer_credits_settle_transaction (
                    id, payment_method, cheque_date, payment_amount,
                    payment_method_number, remarks, created_date,
                    customer_credit_settle_id, invoice_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['payment_method'], r['cheque_date'],
                r['payment_amount'], r.get('payment_method_number'),
                r.get('remarks'), r['created_date'],
                r['customer_credit_settle_id'], r.get('invoice_id'),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("customer_credits_settle_transaction id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'customer_credits_settle_transaction',
               max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_customer_support(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM customer_support")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO customer_support (
                    id, job_number, job_type, date, job_description,
                    contact_person, branch_code, assigned_user_id,
                    customer_id, invoice_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['job_number'], r['job_type'], r['date'],
                r.get('job_description'), r['contact_person'],
                r['branch_code'], r['assigned_user_id'],
                r.get('customer_id'), r.get('invoice_id'),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("customer_support id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'customer_support', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_customer_call_log(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM customer_call_log")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO customer_call_log (
                    id, date, contact_person, comment, customer_support_id)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], ensure_ts(r['date']), r.get('contact_person'),
                r.get('comment'), r['customer_support_id'],
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("customer_call_log id=%s skipped", r['id'])
    upsert_seq(cur, 'customer_call_log', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_cs_job_item(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM cs_job_item")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO cs_job_item (
                    id, date, fault_type, job_status, quantity, active,
                    comment, customer_support_id, product_id, warrent_claim_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], ensure_ts(r['date']), r['fault_type'],
                r['job_status'], r.get('quantity'),
                bool_val(r['active']), r.get('comment'),
                r['customer_support_id'], r['product_id'],
                None,    # warrent_claim_id – new field
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("cs_job_item id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'cs_job_item', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_invoices(mc, pg):
    """
    Old invoices table has far fewer columns than the new one.
    New required columns get sensible defaults.
    IMPORTANT: PostgreSQL triggers will fire on INSERT and auto-populate
    cashbook_entries – so we temporarily disable them.
    """
    rows = fetch_all(mc, "SELECT * FROM invoices")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    # Disable triggers so we don't double-populate cashbook/audit
    cur.execute("ALTER TABLE invoices DISABLE TRIGGER ALL")
    for r in rows:
        try:
            # Derive totals from old data
            cash       = float(r.get('cash_amount') or 0)
            card_visa  = float(r.get('card_visa_amount') or 0)
            card_mc    = float(r.get('card_mastercard_amount') or 0)
            card_amex  = float(r.get('card_amex_amount') or 0)
            bank_tr    = float(r.get('bank_transfer_amount') or 0)
            cheque     = float(r.get('cheque_amount') or 0)
            credit     = float(r.get('credit_amount') or 0)
            advance    = 0  # advance_amount not tracked separately in old invoices
            paid       = cash + card_visa + card_mc + card_amex + bank_tr + cheque
            grand_tot  = paid + credit
            pmt_status = 'paid' if credit == 0 else ('partial' if paid > 0 else 'unpaid')

            cur.execute("""
                INSERT INTO invoices (
                    id, invoice_no, branch_code, payment_method, remarks,
                    created_date, customer_id, sale_rep_id, approval, approval_status,
                    customer_advance_payments_id,
                    bank_transfer_amount, card_amex_amount, card_mastercard_amount,
                    card_visa_amount, cash_amount, cheque_date, cheque_amount,
                    payment_adjustments, credit_amount,
                    cupon_amount, special, sys_code, created_date_time, status,
                    tax_rate, tax_amount, discount_percent, discount_amount,
                    subtotal, grand_total, paid_amount, balance_due,
                    payment_status, service_charge_rate, service_charge_amount,
                    gift_voucher_amount, credit_note_amount,
                    created_at, updated_at, is_tax_invoice)
                VALUES (
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['invoice_no'], r['branch_code'],
                r['payment_method'], r.get('remarks'),
                r['created_date'], r['customer_id'],
                r.get('sale_rep_id'),
                bool_val(r['approval']),
                'completed' if bool_val(r.get('status')) else 'pending',
                r.get('customer_advance_payments_id'),
                bank_tr, card_amex, card_mc, card_visa, cash,
                r.get('cheque_date'), cheque,
                float(r.get('payment_adjustments') or 0), credit,
                0,           # cupon_amount
                bool_val(r.get('special', 0)),
                r.get('sys_code'),
                ensure_ts(r.get('created_date_time') or r['created_date']),
                bool_val(r.get('status', 1)),
                0, 0, 0, 0,  # tax_rate, tax_amount, discount_percent, discount_amount
                grand_tot, grand_tot, paid, credit,
                pmt_status,
                0, 0,        # service_charge_rate, service_charge_amount
                0, 0,        # gift_voucher_amount, credit_note_amount
                ensure_ts(r.get('created_date_time') or r['created_date']),
                NOW,
                False,       # is_tax_invoice
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("invoices id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    cur.execute("ALTER TABLE invoices ENABLE TRIGGER ALL")
    upsert_seq(cur, 'invoices', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_invoice_items(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM invoice_items")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            sp = float(r.get('selling_price') or 0)
            qty = int(r.get('quantity') or 1)
            cur.execute("""
                INSERT INTO invoice_items (
                    id, warrenty_month, selling_price, created_date,
                    invoice_id, product_id, quantity, minimum_selling_price,
                    tax_rate, tax_amount, discount_percent, discount_amount,
                    line_total, created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['warrenty_month'], sp,
                ensure_ts(r['created_date']),
                r['invoice_id'], r['product_id'], qty,
                r['minimum_selling_price'],
                0, 0, 0, 0,                        # tax/discount defaults
                round(sp * qty, 2),                # line_total
                ensure_ts(r['created_date']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("invoice_items id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'invoice_items', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_invoice_items_barcode(mc, pg):
    """
    MySQL column: `invoice_Items_id`  → PG column: `invoice_items_id`
    """
    rows = fetch_all(mc, "SELECT * FROM invoice_items_barcode")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO invoice_items_barcode (
                    id, created_date, good_received_items_id, invoice_items_id)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'],
                ensure_ts(r['created_date']),
                r['good_received_items_id'],
                r['invoice_Items_id'],      # key name difference
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("invoice_items_barcode id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'invoice_items_barcode', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_item_transfer_note(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM item_transfer_note")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO item_transfer_note (
                    id, item_transfer_note, remark, created_date,
                    from_location_id, to_location_id, branch_code, added_date,
                    approval_id, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['item_transfer_note'], r.get('remark'),
                r['created_date'], r['from_location_id'],
                r['to_location_id'], r['branch_code'],
                ensure_ts(r['added_date']),
                None, 'completed',
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("item_transfer_note id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'item_transfer_note', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_item_transfer_note_item_product(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM item_transfer_note_item_product")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO item_transfer_note_item_product (
                    id, created_date, product_id, itemtransfernote_id)
                VALUES (%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], ensure_ts(r['created_date']),
                r['product_id'], r.get('itemtransfernote_id'),
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("item_transfer_note_item_product id=%s skipped", r['id'])
    upsert_seq(cur, 'item_transfer_note_item_product', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_item_transfer_note_items(mc, pg):
    """
    MySQL table name: `item_transfer_note_item_` (trailing underscore)
    PG table name:    `item_transfer_note_items`
    New PG column:    item_recieved (default False)
    """
    rows = fetch_all(mc, "SELECT * FROM `item_transfer_note_item_`")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO item_transfer_note_items (
                    id, remark, created_date, product_id, barcode,
                    branch_code, itemtransfernote_id, item_recieved)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r.get('remark'),
                ensure_ts(r['created_date']),
                r['product_id'], r.get('barcode'),
                r['branch_code'], r.get('itemtransfernote_id'),
                False,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("item_transfer_note_items id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'item_transfer_note_items', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_purchasing_return(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM purchasing_return")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO purchasing_return (
                    id, purchasing_return_no, branch_code, remark,
                    status, added_date, approved_date,
                    goodreceivednote_id, approval_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['purchasing_return_no'], r['branch_code'],
                r.get('remark'), 'approved',
                r['added_date'], None, r['goodreceivednote_id'], None,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("purchasing_return id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'purchasing_return', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_purchasing_return_items(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM purchasing_return_items")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO purchasing_return_items (
                    id, purchasing_price, return_price, barcode,
                    branch_code, added_date, product_id,
                    purchasingreturn_id, sales_stock_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['purchasing_price'], r['return_price'],
                r['barcode'], r['branch_code'],
                ensure_ts(r['added_date']),
                r['product_id'], r['purchasingreturn_id'],
                None,  # sales_stock_id – new field
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("purchasing_return_items id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'purchasing_return_items', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_sale_return(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM sale_return")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO sale_return (
                    id, sale_return_no, branch_code, remark, added_date,
                    good_received_locations_id, invoice_id, cheque_date,
                    payment_method, approval_id, status,
                    subtotal, tax_refund, total_refund,
                    refund_status, refund_amount,
                    created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['sale_return_no'], r['branch_code'],
                r.get('remark'), r['added_date'],
                r['good_received_locations_id'], r['invoice_id'],
                r['cheque_date'], r['payment_method'],
                None, 'approved',
                0, 0, 0, 'completed', 0, NOW, NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("sale_return id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'sale_return', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_sale_return_items(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM sale_return_items")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO sale_return_items (
                    id, barcode, return_price, branch_code, added_date,
                    sale_return_id, sold_price,
                    quantity, condition, restockable, restocked,
                    created_at, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['barcode'], r['return_price'],
                r['branch_code'], ensure_ts(r['added_date']),
                r['sale_return_id'], r['sold_price'],
                1, 'good', True, False,
                ensure_ts(r['added_date']), NOW,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("sale_return_items id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'sale_return_items', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_supplier_credits_settle(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM supplier_credits_settle")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO supplier_credits_settle (
                    id, supplier_credits_settle_no, branch_code,
                    created_date, suppliers_id,
                    status, verified_by, verified_date)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['supplier_credits_settle_no'], r['branch_code'],
                ensure_ts(r['created_date']), r['suppliers_id'],
                'completed', None, None,
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("supplier_credits_settle id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'supplier_credits_settle', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_supplier_credits_settle_transaction(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM supplier_credits_settle_transaction")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO supplier_credits_settle_transaction (
                    id, payment_method, cheque_date, payment_amount,
                    payment_method_number, remarks, created_date,
                    good_received_id, supplier_credit_settle_id)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['payment_method'], r['cheque_date'],
                r['payment_amount'], r.get('payment_method_number'),
                r.get('remarks'), ensure_ts(r['created_date']),
                r['good_received_id'], r['supplier_credit_settle_id'],
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("supplier_credits_settle_transaction id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    upsert_seq(cur, 'supplier_credits_settle_transaction',
               max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


def migrate_warranty_claims(mc, pg):
    rows = fetch_all(mc, "SELECT * FROM warranty_claims")
    if not rows:
        return 0, 0
    ins = skp = 0
    cur = pg.cursor()
    for r in rows:
        try:
            cur.execute("""
                INSERT INTO warranty_claims (
                    id, warranty_type, warranty_status,
                    product_barcode_old_code, product_barcode_new_code,
                    comment, created_date, order_id,
                    supplier_warrenty_claims)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (id) DO NOTHING
            """, (
                r['id'], r['warranty_type'], r['warranty_status'],
                r['product_barcode_old_code'],
                r.get('product_barcode_new_code'),
                r.get('comment'),
                ensure_ts(r['created_date']),
                r['order_id'],
                False,    # supplier_warrenty_claims – new field
            ))
            ins += 1
        except Exception:
            skp += 1
            log.warning("warranty_claims id=%s skipped: %s",
                        r['id'], traceback.format_exc(limit=1))
    if rows:
        upsert_seq(cur, 'warranty_claims', max(r['id'] for r in rows))
    pg.commit()
    cur.close()
    return ins, skp


# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ORCHESTRATOR
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

MIGRATION_STEPS = [
    # (label,                            function)
    ("country",                          migrate_country),
    ("branches",                         migrate_branches),
    ("auth_group",                       migrate_auth_group),
    ("accounts_user",                    migrate_accounts_user),
    ("accounts_user_branches",           migrate_accounts_user_branches),
    ("accounts_user_groups",             migrate_accounts_user_groups),
    ("items_brand",                      migrate_items_brand),
    ("category",                         migrate_category),
    ("customers",                        migrate_customers),
    ("supplier",                         migrate_supplier),
    ("products",                         migrate_products),
    ("minimum_price",                    migrate_minimum_price),
    ("good_received_locations",          migrate_good_received_locations),
    # ── purchasing chain ─────────────────────────────────────────────
    # purchasing_orders → FK: supplier (pre-existing), branches (pre-existing)
    ("purchasing_orders",                migrate_purchasing_orders),
    # purchasing_order_items → FK: purchasing_orders, products (pre-existing)
    ("purchasing_order_items",           migrate_purchasing_order_items),
    # good_received_note → FK: good_received_locations (pre-existing), purchasing_orders
    ("good_received_note",               migrate_good_received_note),
    # good_received_items → FK: good_received_note, purchasing_order_items
    ("good_received_items",              migrate_good_received_items),

    # ── financial / payment foundations ──────────────────────────────
    # expenses → FK: branches (pre-existing) only
    ("expenses",                         migrate_expenses),
    # bank_deposits → no FK to migrated tables
    ("bank_deposits",                    migrate_bank_deposits),
    # advance_receipt → no FK dependencies
    ("advance_receipt",                  migrate_advance_receipt),
    # customer_advance_payments → FK: customers (pre-existing)
    ("customer_advance_payments",        migrate_customer_advance_payments),
    # customer_credits_settle → FK: customers (pre-existing)
    ("customer_credits_settle",          migrate_customer_credits_settle),

    # ── invoices must come BEFORE any table that references invoice_id ─
    # invoices → FK: customers (pre-existing), accounts_user (pre-existing),
    #                customer_advance_payments (above)
    ("invoices",                         migrate_invoices),
    # invoice_items → FK: invoices, products (pre-existing)
    ("invoice_items",                    migrate_invoice_items),
    # invoice_items_barcode → FK: invoice_items, good_received_items
    ("invoice_items_barcode",            migrate_invoice_items_barcode),

    # ── tables that FK → invoices (must come after invoices) ─────────
    # customer_credits_settle_transaction → FK: customer_credits_settle, invoices
    ("customer_credits_settle_transact", migrate_customer_credits_settle_transaction),
    # customer_support → FK: customers (pre-existing), invoices, accounts_user (pre-existing)
    ("customer_support",                 migrate_customer_support),
    # customer_call_log → FK: customer_support
    ("customer_call_log",                migrate_customer_call_log),
    # cs_job_item → FK: customer_support, products (pre-existing)
    ("cs_job_item",                      migrate_cs_job_item),

    # ── item transfers ────────────────────────────────────────────────
    # item_transfer_note → FK: good_received_locations (pre-existing)
    ("item_transfer_note",               migrate_item_transfer_note),
    # item_transfer_note_item_product → FK: item_transfer_note, products (pre-existing)
    ("item_transfer_note_item_product",  migrate_item_transfer_note_item_product),
    # item_transfer_note_items → FK: item_transfer_note, products (pre-existing)
    ("item_transfer_note_items",         migrate_item_transfer_note_items),

    # ── returns ───────────────────────────────────────────────────────
    # purchasing_return → FK: good_received_note
    ("purchasing_return",                migrate_purchasing_return),
    # purchasing_return_items → FK: purchasing_return, products (pre-existing)
    ("purchasing_return_items",          migrate_purchasing_return_items),
    # sale_return → FK: invoices, good_received_locations (pre-existing)
    ("sale_return",                      migrate_sale_return),
    # sale_return_items → FK: sale_return
    ("sale_return_items",                migrate_sale_return_items),

    # ── supplier settlements ──────────────────────────────────────────
    # supplier_credits_settle → FK: supplier (pre-existing)
    ("supplier_credits_settle",          migrate_supplier_credits_settle),
    # supplier_credits_settle_transaction → FK: supplier_credits_settle, good_received_note
    ("supplier_credits_settle_transact", migrate_supplier_credits_settle_transaction),

    # ── warranty ─────────────────────────────────────────────────────
    # warranty_claims → FK: purchasing_order_items
    ("warranty_claims",                  migrate_warranty_claims),
]


def run_migration():
    log.info("=" * 60)
    log.info("  MySQL → PostgreSQL Migration")
    log.info("  Source: %s @ %s", MYSQL_CONFIG['database'], MYSQL_CONFIG['host'])
    log.info("  Target: %s @ %s", PG_CONFIG['dbname'], PG_CONFIG['host'])
    log.info("=" * 60)

    # ── connect ──────────────────────────────────────────────────────
    try:
        my_conn = mysql.connector.connect(**MYSQL_CONFIG)
        my_conn.autocommit = False
        mc = my_conn.cursor(dictionary=True)
        log.info("Connected to MySQL ✓")
    except Exception as e:
        log.error("Cannot connect to MySQL: %s", e)
        sys.exit(1)

    try:
        pg_conn = psycopg2.connect(**PG_CONFIG)
        pg_conn.autocommit = False
        log.info("Connected to PostgreSQL ✓")
    except Exception as e:
        log.error("Cannot connect to PostgreSQL: %s", e)
        my_conn.close()
        sys.exit(1)

    # ── run steps ────────────────────────────────────────────────────
    summary = []
    total_ins = total_skp = 0

    for label, func in MIGRATION_STEPS:
        log.info("Migrating %-40s …", label)
        sp_name = f"sp_{label.replace('-', '_')}"
        sp_cur = pg_conn.cursor()
        sp_cur.execute(f"SAVEPOINT {sp_name}")
        sp_cur.close()
        try:
            ins, skp = func(mc, pg_conn)
            # Commit this table's data and release the savepoint
            sp_cur2 = pg_conn.cursor()
            sp_cur2.execute(f"RELEASE SAVEPOINT {sp_name}")
            sp_cur2.close()
            pg_conn.commit()
            log.info("  ✓  inserted=%-6d  skipped=%d", ins, skp)
            summary.append((label, ins, skp, "OK"))
            total_ins += ins
            total_skp += skp
        except Exception as e:
            # Roll back only this table's changes; leave previous tables intact
            try:
                rb_cur = pg_conn.cursor()
                rb_cur.execute(f"ROLLBACK TO SAVEPOINT {sp_name}")
                rb_cur.execute(f"RELEASE SAVEPOINT {sp_name}")
                rb_cur.close()
            except Exception:
                pg_conn.rollback()
            log.error("  ✗  %s FAILED: %s", label, e)
            log.debug(traceback.format_exc())
            summary.append((label, 0, 0, f"FAILED: {e}"))

    # ── final report ─────────────────────────────────────────────────
    log.info("")
    log.info("=" * 60)
    log.info("  MIGRATION SUMMARY")
    log.info("=" * 60)
    log.info("  %-42s  %8s  %8s  %s", "Table", "Inserted", "Skipped", "Status")
    log.info("  " + "-" * 74)
    for label, ins, skp, status in summary:
        log.info("  %-42s  %8d  %8d  %s", label, ins, skp, status)
    log.info("  " + "-" * 74)
    log.info("  TOTAL                                      %8d  %8d",
             total_ins, total_skp)
    log.info("=" * 60)

    mc.close()
    my_conn.close()
    pg_conn.close()
    log.info("Done. See migration.log for full details.")


if __name__ == "__main__":
    run_migration()
