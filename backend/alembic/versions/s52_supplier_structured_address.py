"""Supplier: structured billing/shipping address, seed country reference data

Revision ID: s52_supplier_structured_address
Revises: s51_supplier_drop_bank_details
Create Date: 2026-09-13

Replaces the two free-text "postal_address" / "permenent_address" blobs
(leftovers from when Supplier modeled a person, with a person-style
"permanent address" framing) with a proper structured address split into
Billing Address and Shipping Address, each with line1/line2/city/state/
postal code — the standard ERP pattern, and matching what the Country
dropdown needs to be useful (Country pairs naturally with City/State/Postal
Code, not a single text blob).

Existing free-text data is carried forward into the new *_address_line1
columns (postal_address -> billing_address_line1, permenent_address ->
shipping_address_line1) rather than discarded, even though the current
database only has placeholder test suppliers.

Also seeds the `country` reference table with the full ISO-3166 country
list (name, ISO codes, currency, phone code) — the table existed since the
initial migration but was never populated, so the Country dropdown this
change adds would otherwise have nothing to show.
"""
from datetime import datetime

from alembic import op
import sqlalchemy as sa
from sqlalchemy import table, column

from app.common.country_seed_data import COUNTRIES

revision = 's52_supplier_structured_address'
down_revision = 's51_supplier_drop_bank_details'
branch_labels = None
depends_on = None


country_table = table(
    "country",
    column("iso", sa.String),
    column("iso3", sa.String),
    column("iso_numeric", sa.Integer),
    column("name", sa.String),
    column("currency_code", sa.String),
    column("currency_symbol", sa.String),
    column("phone", sa.String),
    column("created_at", sa.DateTime),
    column("updated_at", sa.DateTime),
)


def upgrade() -> None:
    # --- 1. Structured address columns ---
    op.add_column('supplier', sa.Column('billing_address_line1', sa.String(255), nullable=True))
    op.add_column('supplier', sa.Column('billing_address_line2', sa.String(255), nullable=True))
    op.add_column('supplier', sa.Column('billing_city', sa.String(120), nullable=True))
    op.add_column('supplier', sa.Column('billing_state', sa.String(120), nullable=True))
    op.add_column('supplier', sa.Column('billing_postal_code', sa.String(20), nullable=True))
    op.add_column('supplier', sa.Column('shipping_address_line1', sa.String(255), nullable=True))
    op.add_column('supplier', sa.Column('shipping_address_line2', sa.String(255), nullable=True))
    op.add_column('supplier', sa.Column('shipping_city', sa.String(120), nullable=True))
    op.add_column('supplier', sa.Column('shipping_state', sa.String(120), nullable=True))
    op.add_column('supplier', sa.Column('shipping_postal_code', sa.String(20), nullable=True))

    # Carry existing free-text values forward instead of discarding them.
    op.execute(
        """
        UPDATE supplier
        SET billing_address_line1 = postal_address,
            shipping_address_line1 = permenent_address
        """
    )

    op.alter_column('supplier', 'billing_address_line1', nullable=False)

    op.drop_column('supplier', 'postal_address')
    op.drop_column('supplier', 'permenent_address')

    # --- 2. Seed country reference data (only if empty, so this migration is
    # safe to run against a database someone already seeded by hand) ---
    conn = op.get_bind()
    existing = conn.execute(sa.text("SELECT COUNT(*) FROM country")).scalar()
    if not existing:
        now = datetime.utcnow()
        op.bulk_insert(
            country_table,
            [
                {
                    "iso": iso, "iso3": iso3, "iso_numeric": iso_numeric, "name": name,
                    "currency_code": currency_code, "currency_symbol": currency_symbol, "phone": phone,
                    "created_at": now, "updated_at": now,
                }
                for iso, iso3, iso_numeric, name, currency_code, currency_symbol, phone in COUNTRIES
            ],
        )


def downgrade() -> None:
    op.add_column('supplier', sa.Column('postal_address', sa.Text(), nullable=True))
    op.add_column('supplier', sa.Column('permenent_address', sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE supplier
        SET postal_address = billing_address_line1,
            permenent_address = COALESCE(shipping_address_line1, billing_address_line1)
        """
    )
    op.alter_column('supplier', 'postal_address', nullable=False)
    op.alter_column('supplier', 'permenent_address', nullable=False)

    op.drop_column('supplier', 'billing_address_line1')
    op.drop_column('supplier', 'billing_address_line2')
    op.drop_column('supplier', 'billing_city')
    op.drop_column('supplier', 'billing_state')
    op.drop_column('supplier', 'billing_postal_code')
    op.drop_column('supplier', 'shipping_address_line1')
    op.drop_column('supplier', 'shipping_address_line2')
    op.drop_column('supplier', 'shipping_city')
    op.drop_column('supplier', 'shipping_state')
    op.drop_column('supplier', 'shipping_postal_code')

    # Country seed data intentionally left in place on downgrade — other
    # tables (users, customers) may already reference these rows by id.
