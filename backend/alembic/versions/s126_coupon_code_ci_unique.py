"""Coupon codes unique regardless of case and surrounding spaces

Revision ID: s126_coupon_code_ci_unique
Revises: s125_po_line_tax
Create Date: 2026-11-05
"""
from alembic import op

revision = 's126_coupon_code_ci_unique'
down_revision = 's125_po_line_tax'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE customer_cupon_codes SET cupon_code = btrim(cupon_code) WHERE cupon_code <> btrim(cupon_code)")
    # Older case/space variants of one code: keep the first, suffix the rest with their id.
    op.execute(
        """
        UPDATE customer_cupon_codes c
           SET cupon_code = left(c.cupon_code, 40) || '-DUP' || c.id
          FROM (
                SELECT id, row_number() OVER (PARTITION BY upper(cupon_code) ORDER BY id) AS rn
                  FROM customer_cupon_codes
               ) d
         WHERE d.id = c.id AND d.rn > 1
        """
    )
    op.execute("CREATE UNIQUE INDEX uq_customer_cupon_codes_upper ON customer_cupon_codes (upper(cupon_code))")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_customer_cupon_codes_upper")
