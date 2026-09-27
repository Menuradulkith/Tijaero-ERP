"""Add lead_time_days to supplier

Revision ID: s61_supplier_lead_time
Revises: s60_product_unit_of_measure
Create Date: 2026-09-25

Manually-set planning default (in days) for how long a supplier is
expected to take to deliver — independent of the existing computed
average_lead_time_days (derived live from actual PO->GRN history in
SupplierRepository.get_average_lead_times, not a stored column).
"""
from alembic import op
import sqlalchemy as sa

revision = 's61_supplier_lead_time'
down_revision = 's60_product_unit_of_measure'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('lead_time_days', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier', 'lead_time_days')
