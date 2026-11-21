"""Product Design Detail: the spec after a confirmed Design Brief — per line Quantity (M), colour, size,
design URL; plus special and packing / loading instructions. draft -> confirmed (locked) or rejected.

Revision ID: s147_product_design_detail
Revises: s146_product_design_brief
Create Date: 2026-11-21
"""
import sqlalchemy as sa
from alembic import op

revision = 's147_product_design_detail'
down_revision = 's146_product_design_brief'
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
        'product_design_details',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('product_id', sa.Integer(), sa.ForeignKey('products.id', ondelete='CASCADE'), nullable=False),
        sa.Column('status', sa.String(20), nullable=False, server_default='draft'),
        sa.Column('special_instructions', sa.Text(), nullable=True),
        sa.Column('packing_instructions', sa.Text(), nullable=True),
        sa.Column('confirmed_by', sa.Integer(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(), nullable=True),
        sa.Column('rejected_by', sa.Integer(), nullable=True),
        sa.Column('rejected_at', sa.DateTime(), nullable=True),
        sa.Column('reject_reason', sa.Text(), nullable=True),
        *_audit(),
        sa.UniqueConstraint('product_id', name='uq_product_design_details_product_id'),
        sa.CheckConstraint("status IN ('draft', 'confirmed', 'rejected')", name='ck_product_design_details_status'),
    )
    op.create_index('ix_product_design_details_id', 'product_design_details', ['id'])

    op.create_table(
        'product_design_detail_lines',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('detail_id', sa.Integer(), sa.ForeignKey('product_design_details.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=False),
        sa.Column('item_code', sa.String(255), nullable=False),
        sa.Column('item_name', sa.String(255), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('category_name', sa.String(255), nullable=True),
        sa.Column('brief', sa.Text(), nullable=True),
        sa.Column('quantity', sa.Numeric(18, 3), nullable=False),
        sa.Column('colour', sa.String(120), nullable=False),
        sa.Column('size', sa.String(120), nullable=False),
        sa.Column('design_url', sa.String(500), nullable=False),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        *_audit(),
        sa.UniqueConstraint('detail_id', 'material_id', name='uq_product_design_detail_lines_item'),
        sa.CheckConstraint('quantity > 0', name='ck_product_design_detail_lines_quantity'),
    )
    op.create_index('ix_product_design_detail_lines_id', 'product_design_detail_lines', ['id'])
    op.create_index('ix_product_design_detail_lines_detail_id', 'product_design_detail_lines', ['detail_id'])
    op.create_index('ix_product_design_detail_lines_material_id', 'product_design_detail_lines', ['material_id'])


def downgrade() -> None:
    op.drop_table('product_design_detail_lines')
    op.drop_table('product_design_details')
