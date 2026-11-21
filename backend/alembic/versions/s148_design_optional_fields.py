"""Design Brief / Design Detail field changes: the brief's reference link is dropped; brief text, and the
detail's colour, size and design URL become optional (Quantity (M) stays required).

Revision ID: s148_design_optional_fields
Revises: s147_product_design_detail
Create Date: 2026-11-21
"""
import sqlalchemy as sa
from alembic import op

revision = 's148_design_optional_fields'
down_revision = 's147_product_design_detail'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('product_design_brief_lines', 'reference_url')
    op.alter_column('product_design_brief_lines', 'brief', existing_type=sa.Text(), nullable=True)
    op.alter_column('product_design_detail_lines', 'colour', existing_type=sa.String(120), nullable=True)
    op.alter_column('product_design_detail_lines', 'size', existing_type=sa.String(120), nullable=True)
    op.alter_column('product_design_detail_lines', 'design_url', existing_type=sa.String(500), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE product_design_detail_lines SET colour = '' WHERE colour IS NULL")
    op.execute("UPDATE product_design_detail_lines SET size = '' WHERE size IS NULL")
    op.execute("UPDATE product_design_detail_lines SET design_url = '' WHERE design_url IS NULL")
    op.execute("UPDATE product_design_brief_lines SET brief = '' WHERE brief IS NULL")
    op.alter_column('product_design_detail_lines', 'design_url', existing_type=sa.String(500), nullable=False)
    op.alter_column('product_design_detail_lines', 'size', existing_type=sa.String(120), nullable=False)
    op.alter_column('product_design_detail_lines', 'colour', existing_type=sa.String(120), nullable=False)
    op.alter_column('product_design_brief_lines', 'brief', existing_type=sa.Text(), nullable=False)
    op.add_column('product_design_brief_lines', sa.Column('reference_url', sa.String(500), nullable=True))
