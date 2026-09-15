"""make user email, gender, birthdate optional

Revision ID: s54_user_optional_fields
Revises: s53_supplier_tax_reg_number
Create Date: 2026-09-14 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

revision = 's54_user_optional_fields'
down_revision = 's53_supplier_tax_reg_number'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Email, gender, and birthdate are no longer required on the Users form
    # (roles/branches now drive access instead of these personal fields).
    op.alter_column('accounts_user', 'email',
               existing_type=sa.String(length=75),
               nullable=True)
    op.alter_column('accounts_user', 'gender',
               existing_type=sa.String(length=30),
               nullable=True)
    op.alter_column('accounts_user', 'birthdate',
               existing_type=sa.Date(),
               nullable=True)


def downgrade() -> None:
    # Revert: make these required again (existing NULLs must be resolved first)
    op.alter_column('accounts_user', 'birthdate',
               existing_type=sa.Date(),
               nullable=False)
    op.alter_column('accounts_user', 'gender',
               existing_type=sa.String(length=30),
               nullable=False)
    op.alter_column('accounts_user', 'email',
               existing_type=sa.String(length=75),
               nullable=False)
