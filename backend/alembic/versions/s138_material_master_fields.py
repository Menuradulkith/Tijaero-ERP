"""Material master: dimensions, HS code, certificate, colour, valuation/issuing method, family, design URL

Revision ID: s138_material_master_fields
Revises: s137_material_categories
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's138_material_master_fields'
down_revision = 's137_material_categories'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('materials', sa.Column('unit_dimensions', sa.String(length=120), nullable=True))
    op.add_column('materials', sa.Column('hs_code', sa.String(length=20), nullable=True))
    op.add_column('materials', sa.Column('required_certificate', sa.String(length=255), nullable=True))
    op.add_column('materials', sa.Column('colour', sa.String(length=60), nullable=True))
    op.add_column('materials', sa.Column('inventory_valuation_method', sa.String(length=20), nullable=False,
                                         server_default='fifo'))
    op.add_column('materials', sa.Column('stock_issuing_method', sa.String(length=10), nullable=False,
                                         server_default='fifo'))
    op.add_column('materials', sa.Column('product_family', sa.String(length=120), nullable=True))
    op.add_column('materials', sa.Column('design_url', sa.String(length=500), nullable=True))
    op.create_check_constraint(
        'ck_materials_inventory_valuation_method', 'materials',
        "inventory_valuation_method IN ('fifo', 'lifo', 'weighted_average')",
    )
    op.create_check_constraint(
        'ck_materials_stock_issuing_method', 'materials', "stock_issuing_method IN ('fifo', 'fefo')",
    )


def downgrade() -> None:
    op.drop_constraint('ck_materials_stock_issuing_method', 'materials', type_='check')
    op.drop_constraint('ck_materials_inventory_valuation_method', 'materials', type_='check')
    for col in ('design_url', 'product_family', 'stock_issuing_method', 'inventory_valuation_method',
                'colour', 'required_certificate', 'hs_code', 'unit_dimensions'):
        op.drop_column('materials', col)
