"""Add performance indexes for FK columns and composite (branch_code, status)

Revision ID: s34_perf_indexes
Revises: s33_manual_je_approval
Create Date: 2025-01-01

Adds indexes on frequently-filtered FK columns and composite indexes
on (branch_code, status) for the hottest list endpoints.
"""
from alembic import op
from sqlalchemy import text

revision = "s34_perf_indexes"
down_revision = "s33_manual_je_approval"
branch_labels = None
depends_on = None

# Use CREATE INDEX IF NOT EXISTS so each statement is idempotent and never
# aborts the transaction when the index already exists.
_INDEXES = [
    # ── Purchasing ──────────────────────────────────────────────────────────
    ("ix_purchasing_orders_branch_status",      "purchasing_orders",              "branch_code, status"),
    ("ix_purchasing_orders_first_supplier",     "purchasing_orders",              "first_suppliers_id"),
    ("ix_purchasing_orders_second_supplier",    "purchasing_orders",              "second_suppliers_id"),
    ("ix_good_received_note_branch",            "good_received_note",             "branch_code"),
    ("ix_good_received_note_po",                "good_received_note",             "purchasingorders_id"),
    ("ix_good_received_items_grn",              "good_received_items",            "good_received_note"),
    ("ix_purchasing_order_items_po",            "purchasing_order_items",         "purchasingorders_id"),
    ("ix_purchasing_order_items_product",       "purchasing_order_items",         "product_id"),
    ("ix_purchasing_return_grn",                "purchasing_return",              "goodreceivednote_id"),
    ("ix_purchasing_return_branch_status",      "purchasing_return",              "branch_code, status"),
    ("ix_supplier_payments_branch_status",      "supplier_payments",              "branch_code, status"),
    ("ix_supplier_payments_supplier",           "supplier_payments",              "supplier_id"),
    ("ix_supplier_payments_po",                 "supplier_payments",              "purchasing_order_id"),
    ("ix_supplier_advance_payment_branch",      "supplier_advance_payment",       "branch_code"),
    ("ix_supplier_advance_payment_supplier",    "supplier_advance_payment",       "supplier_id"),
    # ── Sales ───────────────────────────────────────────────────────────────
    ("ix_invoices_customer",                    "invoices",                       "customer_id"),
    ("ix_invoice_items_invoice",                "invoice_items",                  "invoice_id"),
    ("ix_invoice_items_product",                "invoice_items",                  "product_id"),
    ("ix_sale_return_branch",                   "sale_return",                    "branch_code"),
    ("ix_sale_return_invoice",                  "sale_return",                    "invoice_id"),
    ("ix_customer_credit_notes_customer",       "customer_credit_notes",          "customer_id"),
    # ── Finance ─────────────────────────────────────────────────────────────
    ("ix_expenses_branch_status",               "expenses",                       "branch_code, status"),
    ("ix_expenses_created_date",                "expenses",                       "created_date"),
    ("ix_bank_deposits_branch",                 "bank_deposits",                  "branch_code"),
    ("ix_card_payments_branch",                 "card_payments",                  "branch_code"),
    ("ix_cheque_payments_branch",               "cheque_payments",                "branch_code"),
    ("ix_petty_cash_branch",                    "petty_cash",                     "branch_code"),
    # ── Accounting ──────────────────────────────────────────────────────────
    ("ix_journal_entries_branch_status",        "journal_entries",                "branch_code, status"),
    ("ix_journal_entries_entry_date",           "journal_entries",                "entry_date"),
    ("ix_journal_entry_lines_je",               "journal_entry_lines",            "journal_entry_id"),
    ("ix_journal_entry_lines_account",          "journal_entry_lines",            "account_id"),
    # ── Warehouse ───────────────────────────────────────────────────────────
    ("ix_itn_branch_status",                    "item_transfer_note",             "branch_code, status"),
    ("ix_itn_items_itn",                        "item_transfer_note_items",       "itemtransfernote_id"),
    ("ix_itn_items_product",                    "item_transfer_note_items",       "product_id"),
    # ── Support ─────────────────────────────────────────────────────────────
    ("ix_customer_support_branch",              "customer_support",               "branch_code"),
    ("ix_customer_support_customer",            "customer_support",               "customer_id"),
    ("ix_customer_support_assigned",            "customer_support",               "assigned_user_id"),
    ("ix_cs_job_item_ticket",                   "cs_job_item",                    "customer_support_id"),
    ("ix_customer_call_log_ticket",             "customer_call_log",              "customer_support_id"),
    # ── HR / Employees ──────────────────────────────────────────────────────
    ("ix_salary_deductions_employee",           "salary_deductions",              "employee_id"),
    ("ix_employee_payroll_employee",            "employee_payroll",               "employee_id"),
    ("ix_employee_promotions_employee",         "employee_promotions",            "employee_id"),
    ("ix_employee_salary_profile_employee",     "employee_salary_profile",        "employee_id"),
    ("ix_payroll_batches_status",               "payroll_batches",                "status"),
    # ── Attendance ──────────────────────────────────────────────────────────
    ("ix_leaves_employee",                      "leaves",                         "employee_id"),
    # ── Inventory ───────────────────────────────────────────────────────────
    ("ix_sales_stock_product",                  "sales_stock",                    "product_id"),
    ("ix_sales_stock_branch",                   "sales_stock",                    "branch_code"),
    ("ix_sales_stock_grn",                      "sales_stock",                    "good_received_note_id"),
    ("ix_company_assets_branch",                "company_assets",                 "branch_code"),
    ("ix_company_assets_grn",                   "company_assets",                 "good_received_note_id"),
    # ── Customers ───────────────────────────────────────────────────────────
    ("ix_coupon_usage_coupon",                  "coupon_usage",                   "coupon_id"),
    ("ix_coupon_usage_customer",                "coupon_usage",                   "customer_id"),
    ("ix_voucher_usage_voucher",                "voucher_usage",                  "voucher_id"),
]


def upgrade() -> None:
    conn = op.get_bind()

    # Pre-load existing tables and their columns from the DB so we can skip
    # any index whose table or column doesn't exist yet.
    meta_rows = conn.execute(text(
        "SELECT table_name, column_name FROM information_schema.columns "
        "WHERE table_schema = 'public'"
    ))
    db_cols: dict[str, set[str]] = {}
    for table, col in meta_rows:
        db_cols.setdefault(table, set()).add(col)

    for name, table, columns in _INDEXES:
        if table not in db_cols:
            print(f"  SKIP (no table): {name}")
            continue
        missing = [c.strip() for c in columns.split(",") if c.strip() not in db_cols[table]]
        if missing:
            print(f"  SKIP (missing cols {missing}): {name}")
            continue
        conn.execute(text(
            f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})"
        ))
        print(f"  OK: {name}")


def downgrade() -> None:
    conn = op.get_bind()
    for name, table, _columns in _INDEXES:
        conn.execute(text(f"DROP INDEX IF EXISTS {name}"))
