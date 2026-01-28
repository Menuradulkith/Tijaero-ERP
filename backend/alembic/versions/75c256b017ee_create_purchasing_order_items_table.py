"""create purchasing_order_items table

Revision ID: 75c256b017ee
Revises: 8ab2dbb61732
Create Date: 2026-01-29 00:30:55.261473

"""
from alembic import op
import sqlalchemy as sa


revision = '75c256b017ee'
down_revision = '8ab2dbb61732'
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.create_table(
        'purchasing_order_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('unit_price', sa.Numeric(precision=60, scale=2), nullable=False),
        sa.Column('warrenty_month', sa.String(length=30), nullable=False),
        sa.Column('remark', sa.String(length=200), nullable=True),
        sa.Column('created_date', sa.Date(), nullable=False),
        sa.Column('product_id', sa.Integer(), nullable=False),
        sa.Column('purchasingorders_id', sa.Integer(), nullable=False),
        sa.Column('added_date', sa.TIMESTAMP(), nullable=False),
        sa.ForeignKeyConstraint(['product_id'], ['products.id'], ),
        sa.ForeignKeyConstraint(['purchasingorders_id'], ['purchasing_orders.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_purchasing_order_items_id'), 'purchasing_order_items', ['id'], unique=False)

def downgrade() -> None:
    op.drop_index(op.f('ix_purchasing_order_items_id'), table_name='purchasing_order_items')
    op.drop_table('purchasing_order_items')
