"""Store cheque_payments identifiers (cheque_number, branch_code) as strings

Cheque numbers are identifiers (they may carry leading zeros or be
alphanumeric) and branch codes are strings everywhere else in the system.
The ``cheque_payments`` table historically typed them as ``Numeric``/``Integer``,
which forced lossy ``int()`` casts and a hard-coded ``branch_code = 0`` at the
sales call sites. Widen both columns to text so the real values can be stored.

Revision ID: s40_cheque_identifier_types
Revises: s39_audit_passcode
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "s40_cheque_identifier_types"
down_revision = "s39_audit_passcode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "cheque_payments",
        "cheque_number",
        existing_type=sa.Numeric(precision=10, scale=0),
        type_=sa.String(length=50),
        existing_nullable=False,
        postgresql_using="cheque_number::varchar",
    )
    op.alter_column(
        "cheque_payments",
        "branch_code",
        existing_type=sa.Integer(),
        type_=sa.String(length=200),
        existing_nullable=False,
        postgresql_using="branch_code::varchar",
    )


def downgrade() -> None:
    op.alter_column(
        "cheque_payments",
        "branch_code",
        existing_type=sa.String(length=200),
        type_=sa.Integer(),
        existing_nullable=False,
        postgresql_using="branch_code::integer",
    )
    op.alter_column(
        "cheque_payments",
        "cheque_number",
        existing_type=sa.String(length=50),
        type_=sa.Numeric(precision=10, scale=0),
        existing_nullable=False,
        postgresql_using="cheque_number::numeric",
    )
