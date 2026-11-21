"""Products: product types + HS codes lists; product type, HS code, family, target market, certificate

Revision ID: s140_product_master_general
Revises: s139_material_item_type_toggles
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's140_product_master_general'
down_revision = 's139_material_item_type_toggles'
branch_labels = None
depends_on = None


def _audit_cols():
    return [
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'product_types',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(120), nullable=False),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        *_audit_cols(),
    )
    op.create_index('ix_product_types_id', 'product_types', ['id'])
    op.execute("CREATE UNIQUE INDEX uq_product_types_name_ci ON product_types (lower(btrim(name)))")
    op.create_table(
        'hs_codes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False),
        sa.Column('description', sa.String(255), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        *_audit_cols(),
    )
    op.create_index('ix_hs_codes_id', 'hs_codes', ['id'])
    op.execute("CREATE UNIQUE INDEX uq_hs_codes_code_ci ON hs_codes (lower(btrim(code)))")
    op.add_column('products', sa.Column('product_type_id', sa.Integer(), sa.ForeignKey('product_types.id'), nullable=True))
    op.add_column('products', sa.Column('hs_code_id', sa.Integer(), sa.ForeignKey('hs_codes.id'), nullable=True))
    op.add_column('products', sa.Column('product_family', sa.String(120), nullable=True))
    op.add_column('products', sa.Column('target_market', sa.String(120), nullable=True))
    op.add_column('products', sa.Column('required_certificate', sa.String(255), nullable=True))
    op.create_index('ix_products_product_type_id', 'products', ['product_type_id'])
    op.create_index('ix_products_hs_code_id', 'products', ['hs_code_id'])


def downgrade() -> None:
    op.drop_index('ix_products_hs_code_id', 'products')
    op.drop_index('ix_products_product_type_id', 'products')
    for col in ('required_certificate', 'target_market', 'product_family', 'hs_code_id', 'product_type_id'):
        op.drop_column('products', col)
    op.drop_table('hs_codes')
    op.drop_table('product_types')
