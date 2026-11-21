"""Materials: Stock Item / Expense item types, optional brand, availability + design toggles

Revision ID: s139_material_item_type_toggles
Revises: s138_material_master_fields
Create Date: 2026-11-20
"""
import sqlalchemy as sa
from alembic import op

revision = 's139_material_item_type_toggles'
down_revision = 's138_material_master_fields'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Old product-style types: stocked ones become Stock Item, everything else Expense.
    op.execute("UPDATE materials SET item_type = CASE WHEN item_type IN ('inventory', 'raw', 'stock', 'stock_item') "
               "THEN 'stock_item' ELSE 'expense' END")
    op.create_check_constraint('ck_materials_item_type', 'materials', "item_type IN ('stock_item', 'expense')")
    op.alter_column('materials', 'items_brand_id', existing_type=sa.Integer(), nullable=True)
    op.add_column('materials', sa.Column('check_for_availability', sa.Boolean(), nullable=False,
                                         server_default=sa.text('false')))
    op.add_column('materials', sa.Column('design_required', sa.Boolean(), nullable=False,
                                         server_default=sa.text('false')))


def downgrade() -> None:
    op.drop_column('materials', 'design_required')
    op.drop_column('materials', 'check_for_availability')
    # A brand is required again: give brandless rows the first brand (there is always one).
    op.execute("UPDATE materials SET items_brand_id = (SELECT min(id) FROM items_brand) WHERE items_brand_id IS NULL")
    op.alter_column('materials', 'items_brand_id', existing_type=sa.Integer(), nullable=False)
    op.drop_constraint('ck_materials_item_type', 'materials', type_='check')
    op.execute("UPDATE materials SET item_type = CASE WHEN item_type = 'stock_item' THEN 'inventory' ELSE 'service' END")
