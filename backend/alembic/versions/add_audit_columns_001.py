"""Add audit columns (created_by, updated_by) to all major transaction tables.

Revision ID: add_audit_columns_001
Revises: 
Create Date: 2026-06-01
"""

from alembic import op
import sqlalchemy as sa


# revision identifiers
revision = 'add_audit_columns_001'
down_revision = '5d756a167033'
branch_labels = None
depends_on = None

# Tables that need created_by and updated_by audit columns.
# Tables that already have created_by are excluded from created_by addition.
TABLES_NEEDING_BOTH = [
    # Purchasing
    "good_received_note",
    "purchasing_orders",
    "purchasing_return",
    "supplier_credits_settle",
    "supplier_credits_settle_transaction",
    # Customers
    "customers",
    "customer_advance_payments",
    "customer_credit_notes",
    "customer_credits_settle",
    "customer_credits_settle_transaction",
    "customer_gift_voucher",
    # Finance
    "bank_deposits",
    "card_payments",
    "cheque_payments",
    "credit_payments",
    "expenses",
    "petty_cash",
    "petty_cash_transaction",
    # Sales
    "invoice_items",
    # Warehouse
    "item_transfer_note",
    "item_receive_note",
    # Inventory
    "company_assets",
    "sales_stock",
    # Products
    "products",
    "category",
    "items_brand",
    # Support
    "customer_support",
    "warranty_claims",
    # Common
    "approvals",
]

# Tables that already have created_by but need updated_by
TABLES_NEEDING_UPDATED_BY = [
    "invoices",
    "sale_return",
    "supplier_payments",
    "supplier_advance_payment",
    "salary_deductions",
    "payroll_batches",
    "employees",
    "attendance",
    "leaves",
]


def _col_exists(table: str, column: str) -> bool:
    """Check if a column exists in a table (PostgreSQL)."""
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_name = :table AND column_name = :col"
    ), {"table": table, "col": column})
    return result.fetchone() is not None


def upgrade() -> None:
    for table in TABLES_NEEDING_BOTH:
        if not _col_exists(table, "created_by"):
            op.add_column(table, sa.Column("created_by", sa.Integer(), nullable=True))
        if not _col_exists(table, "updated_by"):
            op.add_column(table, sa.Column("updated_by", sa.Integer(), nullable=True))

    for table in TABLES_NEEDING_UPDATED_BY:
        if not _col_exists(table, "updated_by"):
            op.add_column(table, sa.Column("updated_by", sa.Integer(), nullable=True))


def downgrade() -> None:
    for table in TABLES_NEEDING_BOTH:
        if _col_exists(table, "created_by"):
            op.drop_column(table, "created_by")
        if _col_exists(table, "updated_by"):
            op.drop_column(table, "updated_by")

    for table in TABLES_NEEDING_UPDATED_BY:
        if _col_exists(table, "updated_by"):
            op.drop_column(table, "updated_by")
