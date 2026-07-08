"""Store supplier credit amounts as Numeric(18,2) instead of Integer

The supplier credit columns (max_credit_limit, left_credit_amount,
initial_credit_amount) were historically typed as Integer, which forced lossy
int()/round() casts and silently truncated cents (ERP_STANDARDS F1 - money
must be Decimal). Widen all three to Numeric(18,2) so fractional currency is
preserved end-to-end.

Revision ID: s42_supplier_credit_numeric
Revises: s41_advance_application_invoice_link
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "s42_supplier_credit_numeric"
down_revision = "s41_advance_application_invoice_link"
branch_labels = None
depends_on = None


_COLUMNS = (
    ("max_credit_limit", False),
    ("left_credit_amount", True),
    ("initial_credit_amount", True),
)


def upgrade() -> None:
    for column_name, nullable in _COLUMNS:
        op.alter_column(
            "supplier",
            column_name,
            existing_type=sa.Integer(),
            type_=sa.Numeric(precision=18, scale=2),
            existing_nullable=nullable,
            postgresql_using=f"{column_name}::numeric(18,2)",
        )


def downgrade() -> None:
    for column_name, nullable in _COLUMNS:
        op.alter_column(
            "supplier",
            column_name,
            existing_type=sa.Numeric(precision=18, scale=2),
            type_=sa.Integer(),
            existing_nullable=nullable,
            postgresql_using=f"round({column_name})::integer",
        )
