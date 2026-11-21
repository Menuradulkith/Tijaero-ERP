"""Product Design Brief: the Item Catalog items a product needs (tags, stickers, bags, ...), each
with its design brief. One brief per product; draft -> confirmed (locked) or rejected (reason).

Revision ID: s146_product_design_brief
Revises: s145_costing_counts
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's146_product_design_brief'
down_revision = 's145_costing_counts'
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
        'product_design_briefs',
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
        sa.UniqueConstraint('product_id', name='uq_product_design_briefs_product_id'),
        sa.CheckConstraint("status IN ('draft', 'confirmed', 'rejected')", name='ck_product_design_briefs_status'),
    )
    op.create_index('ix_product_design_briefs_id', 'product_design_briefs', ['id'])

    op.create_table(
        'product_design_brief_lines',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('brief_id', sa.Integer(), sa.ForeignKey('product_design_briefs.id', ondelete='CASCADE'),
                  nullable=False),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id'), nullable=False),
        sa.Column('item_code', sa.String(255), nullable=False),
        sa.Column('item_name', sa.String(255), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=True),
        sa.Column('category_name', sa.String(255), nullable=True),
        sa.Column('brief', sa.Text(), nullable=False),
        sa.Column('reference_url', sa.String(500), nullable=True),
        sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
        *_audit(),
        sa.UniqueConstraint('brief_id', 'material_id', name='uq_product_design_brief_lines_item'),
    )
    op.create_index('ix_product_design_brief_lines_id', 'product_design_brief_lines', ['id'])
    op.create_index('ix_product_design_brief_lines_brief_id', 'product_design_brief_lines', ['brief_id'])
    op.create_index('ix_product_design_brief_lines_material_id', 'product_design_brief_lines', ['material_id'])


def downgrade() -> None:
    op.drop_table('product_design_brief_lines')
    op.drop_table('product_design_briefs')
