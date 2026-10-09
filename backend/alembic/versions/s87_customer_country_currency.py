"""Country on each customer address, and a customer currency

Revision ID: s87_customer_country_currency
Revises: s86_supplier_address_countries
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = 's87_customer_country_currency'
down_revision = 's86_supplier_address_countries'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("billing_country_id", "shipping_country_id"):
        op.add_column("customers", sa.Column(name, sa.Integer(), nullable=True))
        op.create_foreign_key(f"fk_customers_{name}", "customers", "country", [name], ["id"])
    op.add_column("customers", sa.Column("default_currency", sa.String(3), nullable=True))


def downgrade() -> None:
    op.drop_column("customers", "default_currency")
    for name in ("shipping_country_id", "billing_country_id"):
        op.drop_constraint(f"fk_customers_{name}", "customers", type_="foreignkey")
        op.drop_column("customers", name)
