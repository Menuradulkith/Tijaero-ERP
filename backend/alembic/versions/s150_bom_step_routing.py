"""Product BOM Structure routing: each step is a routing operation done at a Manufacturing work
center, with setup time per batch, workers, move/wait time and (outside work centers) a cost per unit.
The step's existing minutes_per_unit is the run time per unit.

Revision ID: s150_bom_step_routing
Revises: s149_product_bom_structure
Create Date: 2026-11-22
"""
import sqlalchemy as sa
from alembic import op

revision = 's150_bom_step_routing'
down_revision = 's149_product_bom_structure'
branch_labels = None
depends_on = None

T = 'product_bom_steps'


def upgrade() -> None:
    op.add_column(T, sa.Column('work_center_id', sa.Integer(),
                               sa.ForeignKey('mfg_work_centers.id', ondelete='SET NULL'), nullable=True))
    op.add_column(T, sa.Column('setup_minutes', sa.Numeric(10, 2), nullable=True))
    op.add_column(T, sa.Column('move_minutes', sa.Numeric(10, 2), nullable=True))
    op.add_column(T, sa.Column('workers', sa.Integer(), nullable=True))
    op.add_column(T, sa.Column('outside_unit_cost', sa.Numeric(14, 2), nullable=True))
    op.create_index('ix_product_bom_steps_work_center_id', T, ['work_center_id'])
    op.create_check_constraint('ck_product_bom_steps_setup', T, 'setup_minutes IS NULL OR setup_minutes >= 0')
    op.create_check_constraint('ck_product_bom_steps_move', T, 'move_minutes IS NULL OR move_minutes >= 0')
    op.create_check_constraint('ck_product_bom_steps_workers', T, 'workers IS NULL OR workers >= 1')
    op.create_check_constraint('ck_product_bom_steps_outside_cost', T,
                               'outside_unit_cost IS NULL OR outside_unit_cost >= 0')


def downgrade() -> None:
    for name in ('outside_cost', 'workers', 'move', 'setup'):
        op.drop_constraint(f'ck_product_bom_steps_{name}', T, type_='check')
    op.drop_index('ix_product_bom_steps_work_center_id', table_name=T)
    for col in ('outside_unit_cost', 'workers', 'move_minutes', 'setup_minutes', 'work_center_id'):
        op.drop_column(T, col)
