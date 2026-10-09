"""Structured address on branches

Revision ID: s81_branch_structured_address
Revises: s80_auth_revoked_token
Create Date: 2026-10-08

Adds supplier-style structured address columns (line 1/2, city, state, postal
code) to branches. The existing single-line `address` text is carried into
`address_line1` so nothing is lost; the legacy column stays and is kept in
sync on save.
"""
from alembic import op
import sqlalchemy as sa

revision = 's81_branch_structured_address'
down_revision = 's80_auth_revoked_token'
branch_labels = None
depends_on = None

_COLUMNS = [
    ('address_line1', 255),
    ('address_line2', 255),
    ('city', 120),
    ('state', 120),
    ('postal_code', 20),
]


def upgrade() -> None:
    for name, length in _COLUMNS:
        op.add_column('branches', sa.Column(name, sa.String(length), nullable=True))
    # line1 is varchar(255); trim the old free text to fit.
    op.execute("UPDATE branches SET address_line1 = LEFT(address, 255) WHERE address IS NOT NULL AND address <> ''")


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column('branches', name)
