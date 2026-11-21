"""Product BOM Structure: the steps a product goes through until it is packed, with the Item Catalog
materials used in each step. One per product; draft -> confirmed (locked) or rejected (reason).

Revision ID: s149_product_bom_structure
Revises: s148_design_optional_fields
Create Date: 2026-11-21
"""
import sqlalchemy as sa
from alembic import op

revision = 's149_product_bom_structure'
down_revision = 's148_design_optional_fields'
branch_labels = None
depends_on = None


def _audit():
    return [
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'product_bom_structures',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('confirmed_by', sa.Integer(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(), nullable=True),
        sa.Column('rejected_by', sa.Integer(), nullable=True),
        sa.Column('rejected_at', sa.DateTime(), nullable=True),
        sa.Column('reject_reason', sa.Text(), nullable=True),
        *_audit(),
        sa.UniqueConstraint('product_id', name='uq_product_bom_structures_product_id'),
        sa.CheckConstraint("status IN ('draft', 'confirmed', 'rejected')", name='ck_product_bom_structures_status'),
    )
    op.create_index('ix_product_bom_structures_id', 'product_bom_structures', ['id'])

    op.create_table(
        'product_bom_steps',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('structure_id', sa.Integer(), sa.ForeignKey('product_bom_structures.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('name', sa.String(150), nullable=False),
        sa.Column('work_area', sa.String(150), nullable=True),
        sa.Column('minutes_per_unit', sa.Numeric(10, 2), nullable=True),
        sa.Column('instructions', sa.Text(), nullable=True),
        *_audit(),
        sa.CheckConstraint('minutes_per_unit IS NULL OR minutes_per_unit >= 0', name='ck_product_bom_steps_minutes'),
    )
    op.create_index('ix_product_bom_steps_id', 'product_bom_steps', ['id'])
    op.create_index('ix_product_bom_steps_structure_id', 'product_bom_steps', ['structure_id'])

    op.create_table(
        'product_bom_materials',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('step_id', sa.Integer(), sa.ForeignKey('product_bom_steps.id', ondelete='CASCADE'), nullable=False),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=False),
        sa.Column('item_code', sa.String(255), nullable=False),
        sa.Column('item_name', sa.String(255), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('category_name', sa.String(255), nullable=True),
        sa.Column('unit_of_measure', sa.String(20), nullable=True),
        sa.Column('quantity', sa.Numeric(18, 4), nullable=False),
        sa.Column('scrap_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        *_audit(),
        sa.UniqueConstraint('step_id', 'material_id', name='uq_product_bom_materials_step_item'),
        sa.CheckConstraint('quantity > 0', name='ck_product_bom_materials_quantity'),
        sa.CheckConstraint('scrap_pct >= 0 AND scrap_pct < 100', name='ck_product_bom_materials_scrap'),
    )
    op.create_index('ix_product_bom_materials_id', 'product_bom_materials', ['id'])
    op.create_index('ix_product_bom_materials_step_id', 'product_bom_materials', ['step_id'])
    op.create_index('ix_product_bom_materials_material_id', 'product_bom_materials', ['material_id'])


def downgrade() -> None:
    op.drop_table('product_bom_materials')
    op.drop_table('product_bom_steps')
    op.drop_table('product_bom_structures')
