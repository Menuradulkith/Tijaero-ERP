"""Supplier: foreign flag, accounting group and other currency

Revision ID: s132_supplier_foreign_acct_grp
Revises: s131_grn_cancel_approval
Create Date: 2026-11-18
"""
import sqlalchemy as sa
from alembic import op

revision = 's132_supplier_foreign_acct_grp'
down_revision = 's131_grn_cancel_approval'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('is_foreign', sa.Boolean(), nullable=False, server_default=sa.text('false')))
    op.add_column('supplier', sa.Column('accounting_group', sa.String(length=30), nullable=True))
    op.add_column('supplier', sa.Column('other_currency', sa.String(length=3), nullable=True))
    # Suppliers already marked as import tax area are overseas suppliers.
    op.execute("UPDATE supplier SET is_foreign = true WHERE tax_area = 'import'")


def downgrade() -> None:
    op.drop_column('supplier', 'other_currency')
    op.drop_column('supplier', 'accounting_group')
    op.drop_column('supplier', 'is_foreign')
