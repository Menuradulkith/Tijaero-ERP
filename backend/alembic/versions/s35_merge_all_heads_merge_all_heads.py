"""merge_all_heads

Revision ID: s35_merge_all_heads
Revises: 20260424_hr_leaves_workflow, merge_branches_ca_fields, s34_perf_indexes
Create Date: 2026-04-25 00:30:56.039038

"""
from alembic import op
import sqlalchemy as sa


revision = 's35_merge_all_heads'
down_revision = ('20260424_hr_leaves_workflow', 'merge_branches_ca_fields', 's34_perf_indexes')
branch_labels = None
depends_on = None

def upgrade() -> None:
    pass

def downgrade() -> None:
    pass
