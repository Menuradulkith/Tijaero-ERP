"""Customers: store the title the way the form's Title select uses it ('Mr' -> 'mr', 'Dr.' -> 'dr') and SWIFT
codes upper-case, so existing customers show their title and can be saved under the new input checks.
Values that do not fit are left as they are (the form then asks for a valid one).

Revision ID: s151_customer_title_swift
Revises: s150_bom_step_routing
Create Date: 2026-11-22
"""
from alembic import op

revision = 's151_customer_title_swift'
down_revision = 's150_bom_step_routing'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        UPDATE customers SET title = lower(rtrim(btrim(title), '.'))
        WHERE title IS NOT NULL AND lower(rtrim(btrim(title), '.')) IN ('mr', 'mrs', 'miss', 'dr')
          AND title <> lower(rtrim(btrim(title), '.'))
    """)
    for col in ('bank_swift_code', 'correspondent_bank_swift_code'):
        op.execute(f"""
            UPDATE customers SET {col} = upper(replace(btrim({col}), ' ', ''))
            WHERE {col} IS NOT NULL AND upper(replace(btrim({col}), ' ', '')) ~ '^[A-Z0-9]{{8}}([A-Z0-9]{{3}})?$'
              AND {col} <> upper(replace(btrim({col}), ' ', ''))
        """)


def downgrade() -> None:
    # Normalising case is not reversible and needs no undo.
    pass
