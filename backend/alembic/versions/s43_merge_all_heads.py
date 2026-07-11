"""Merge s42 and s40_chat_agent_tables into a single head

Revision ID: s43_merge_all_heads
Revises: s42_supplier_credit_numeric, s40_chat_agent_tables
Create Date: 2026-07-11

These are the only two revisions that exist as separate rows in the
alembic_version table.  20260212_tax_invoice is part of the main chain
(consumed by 20260212_gaps -> s11_15 -> ... -> s42) so it is NOT a
separate head at the database level, even though nothing else in the
migration *file* DAG directly references it as down_revision apart from
20260212_gaps and this merge.

The file-level DAG "head" for 20260212_tax_invoice is resolved by making
it depend on the merge (see below).
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 's43_merge_all_heads'
down_revision = (
    's42_supplier_credit_numeric',
    's40_chat_agent_tables',
)
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
