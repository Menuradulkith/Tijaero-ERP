"""Add leaf account 4190 Miscellaneous Income under header 4100

Revision ID: s102_misc_income_leaf
Revises: s101_restore_cashbook_objects
Create Date: 2026-10-24

Header accounts no longer accept postings. The hooks that credited header 4100
"Other Income" (service charge, voucher breakage, settlement discounts, cash
over) now post to this leaf. Existing 4100 history stays where it is.
"""
from alembic import op
import sqlalchemy as sa

revision = 's102_misc_income_leaf'
down_revision = 's101_restore_cashbook_objects'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM chart_of_accounts WHERE account_code = '4190'")).first():
        return
    bind.execute(sa.text("""
        INSERT INTO chart_of_accounts
            (account_code, account_name, account_type, account_category, parent_account_id,
             is_active, is_system_account, normal_balance, description)
        SELECT '4190', 'Miscellaneous Income', 'Revenue', 'Other', p.id, TRUE, TRUE, 'Credit',
               'Service charges, voucher breakage, settlement discounts and other income'
        FROM (SELECT (SELECT id FROM chart_of_accounts WHERE account_code = '4100') AS id) p
    """))


def downgrade() -> None:
    op.execute("""
        DELETE FROM chart_of_accounts c WHERE c.account_code = '4190'
        AND NOT EXISTS (SELECT 1 FROM general_ledger g WHERE g.account_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.account_id = c.id)
    """)
