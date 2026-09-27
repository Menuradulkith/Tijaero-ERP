"""Database-level uniqueness guards for suppliers

Revision ID: s67_supplier_unique_guards
Revises: s66_catalog_unique_guards
Create Date: 2026-09-26

SupplierService / SupplierContactPersonService check for duplicates before
saving (check-then-act), but two concurrent requests can both pass. These
indexes make the database the final arbiter. Matching mirrors the services'
lookups (case- and whitespace-insensitive), and blank values are exempt
since those fields are optional.

- supplier: company_name, company_registration_number,
  tax_registration_number, email
- supplier_contact_person: id_card_number, passport_no, email
- supplier_payment_method: at most one default per supplier (partial index)
"""
from alembic import op

revision = 's67_supplier_unique_guards'
down_revision = 's66_catalog_unique_guards'
branch_labels = None
depends_on = None


def _ci(col: str) -> tuple:
    """(expression, predicate) for a case/whitespace-insensitive unique
    index that ignores NULL and blank values."""
    return f"lower(trim({col}))", f"coalesce(trim({col}), '') <> ''"


_INDEXES = [
    ("uq_supplier_company_name", "supplier", *_ci("company_name")),
    ("uq_supplier_company_reg_no", "supplier", *_ci("company_registration_number")),
    ("uq_supplier_tax_reg_no", "supplier", *_ci("tax_registration_number")),
    ("uq_supplier_email", "supplier", *_ci("email")),
    ("uq_supplier_contact_id_card", "supplier_contact_person", *_ci("id_card_number")),
    ("uq_supplier_contact_passport", "supplier_contact_person", *_ci("passport_no")),
    ("uq_supplier_contact_email", "supplier_contact_person", *_ci("email")),
    ("uq_supplier_payment_method_default", "supplier_payment_method", "supplier_id", "is_default"),
]


def upgrade() -> None:
    for name, table, expr, where in _INDEXES:
        op.execute(f"CREATE UNIQUE INDEX IF NOT EXISTS {name} ON {table} ({expr}) WHERE {where}")


def downgrade() -> None:
    for name, *_ in reversed(_INDEXES):
        op.execute(f"DROP INDEX IF EXISTS {name}")
