"""Add supplier_product mapping table

Revision ID: s58_supplier_products
Revises: s57_user_security_fields
Create Date: 2026-09-15

Which suppliers can supply a given product, and on what terms (the
"approved vendor list"). A many-to-many junction rather than a single
supplier_id on Product, since a product commonly has more than one
approved supplier, each with their own cost/lead-time/MOQ.
"""
from alembic import op
import sqlalchemy as sa

revision = 's58_supplier_products'
down_revision = 's57_user_security_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'supplier_product',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('supplier_id', sa.Integer(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('supplier_sku', sa.String(255), nullable=True),
        sa.Column('cost_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('lead_time_days', sa.Integer(), nullable=True),
        sa.Column('minimum_order_qty', sa.Integer(), nullable=True),
        sa.Column('is_preferred', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        # AuditMixin columns
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['supplier_id'], ['supplier.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('supplier_id', 'product_id', name='uq_supplier_product'),
    )
    op.create_index('ix_supplier_product_id', 'supplier_product', ['id'], unique=False)
    op.create_index('ix_supplier_product_supplier_id', 'supplier_product', ['supplier_id'], unique=False)
    op.create_index('ix_supplier_product_product_id', 'supplier_product', ['product_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_supplier_product_product_id', table_name='supplier_product')
    op.drop_index('ix_supplier_product_supplier_id', table_name='supplier_product')
    op.drop_index('ix_supplier_product_id', table_name='supplier_product')
    op.drop_table('supplier_product')
