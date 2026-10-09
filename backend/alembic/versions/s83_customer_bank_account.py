"""Structured bank account fields on customers

Revision ID: s83_customer_bank_account
Revises: s82_roles_unique_ci
Create Date: 2026-10-09
"""
from alembic import op
import sqlalchemy as sa

revision = 's83_customer_bank_account'
down_revision = 's82_roles_unique_ci'
branch_labels = None
depends_on = None

_COLUMNS = [
    ("bank_account_name", 255),
    ("bank_name", 255),
    ("bank_account_no", 50),
    ("bank_branch", 255),
    ("bank_branch_code", 30),
    ("bank_swift_code", 20),
]


def upgrade() -> None:
    for name, length in _COLUMNS:
        op.add_column("customers", sa.Column(name, sa.String(length), nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column("customers", name)
