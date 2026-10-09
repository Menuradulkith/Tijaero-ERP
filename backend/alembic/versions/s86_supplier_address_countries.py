"""Country on each supplier address

Revision ID: s86_supplier_address_countries
Revises: s85_catalog_unique_trim
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = 's86_supplier_address_countries'
down_revision = 's85_catalog_unique_trim'
branch_labels = None
depends_on = None


def upgrade() -> None:
    for name in ("billing_country_id", "shipping_country_id"):
        op.add_column("supplier", sa.Column(name, sa.Integer(), nullable=True))
        op.create_foreign_key(f"fk_supplier_{name}", "supplier", "country", [name], ["id"])


def downgrade() -> None:
    for name in ("shipping_country_id", "billing_country_id"):
        op.drop_constraint(f"fk_supplier_{name}", "supplier", type_="foreignkey")
        op.drop_column("supplier", name)
