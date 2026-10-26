"""Supplier Advances (2020) is a prepayment asset, not a liability

Revision ID: s100_supplier_advances_asset
Revises: s99_general_ledger_order_indexes
Create Date: 2026-10-24

Every posting debits 2020 when we pay a supplier in advance and credits it when the
advance is applied to a GRN / invoice or refunded, i.e. it behaves as an asset. It was
seeded as a Liability with a Credit normal balance under 2000 Accounts Payable, so a
50,000 advance showed as a -50,000 liability instead of a +50,000 current asset.

Only the classification of the account row changes; no ledger amounts move. Both
directions are idempotent (they set fixed values on the single row with code 2020 and
are a no-op when the row does not exist).
"""
from alembic import op
import sqlalchemy as sa

revision = 's100_supplier_advances_asset'
down_revision = 's99_general_ledger_order_indexes'
branch_labels = None
depends_on = None

_SET = sa.text(
    """
    UPDATE chart_of_accounts
       SET account_type = :account_type,
           account_category = :account_category,
           normal_balance = :normal_balance,
           description = :description,
           parent_account_id = (
               SELECT p.id FROM chart_of_accounts p WHERE p.account_code = :parent_code
           )
     WHERE account_code = '2020'
    """
)

UPGRADE_PARAMS = {
    "account_type": "Asset",
    "account_category": "Prepayment",
    "normal_balance": "Debit",
    "description": "Advance payments made to suppliers (prepayment, applied to later purchases)",
    "parent_code": "1100",
}

DOWNGRADE_PARAMS = {
    "account_type": "Liability",
    "account_category": "Payable",
    "normal_balance": "Credit",
    "description": "Advance payments received from suppliers",
    "parent_code": "2000",
}


def upgrade() -> None:
    op.get_bind().execute(_SET, UPGRADE_PARAMS)


def downgrade() -> None:
    op.get_bind().execute(_SET, DOWNGRADE_PARAMS)
