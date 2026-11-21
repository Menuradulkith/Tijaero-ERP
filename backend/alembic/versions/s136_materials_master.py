"""Material master: materials, material_minimum_price, material_suppliers + RBAC

Revision ID: s136_materials_master
Revises: s135_customer_tax_category
Create Date: 2026-11-18

A separate item catalog for materials. Columns mirror ``products``; categories
and brands are shared with the product catalog.
"""
import sqlalchemy as sa
from alembic import op

revision = 's136_materials_master'
down_revision = 's135_customer_tax_category'
branch_labels = None
depends_on = None

_ACTIONS = [
    ('view', 'View materials'),
    ('create', 'Create materials'),
    ('update', 'Update materials'),
    ('delete', 'Delete materials'),
]


def _audit_columns():
    return [
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        'materials',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('item_code', sa.String(255), nullable=False),
        sa.Column('model', sa.String(255), nullable=True),
        sa.Column('item_type', sa.String(30), nullable=False),
        sa.Column('unit_of_measure', sa.String(20), nullable=False, server_default='pcs'),
        sa.Column('tracking_type', sa.String(10), nullable=False, server_default='serial'),
        sa.Column('over_receipt_tolerance_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('under_receipt_tolerance_pct', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('shelf_life_days', sa.Integer(), nullable=True),
        sa.Column('requires_qc', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('website_active', sa.Boolean(), nullable=False),
        sa.Column('website_price', sa.Numeric(60, 2), nullable=True),
        sa.Column('selling_price', sa.Numeric(60, 2), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('cost_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('tax_rate', sa.Numeric(5, 2), nullable=False, server_default='0'),
        sa.Column('created_date', sa.Date(), nullable=False),
        sa.Column('category_id', sa.Integer(), sa.ForeignKey('category.id'), nullable=False),
        sa.Column('items_brand_id', sa.Integer(), sa.ForeignKey('items_brand.id'), nullable=False),
        sa.Column('added_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('image_url', sa.Text(), nullable=True),
        *_audit_columns(),
        sa.UniqueConstraint('item_code', name='materials_item_code_key'),
        sa.CheckConstraint("tracking_type IN ('serial', 'batch', 'none')", name='ck_materials_tracking_type'),
        sa.CheckConstraint('over_receipt_tolerance_pct >= 0 AND over_receipt_tolerance_pct <= 100',
                           name='ck_materials_over_tolerance'),
        sa.CheckConstraint('under_receipt_tolerance_pct >= 0 AND under_receipt_tolerance_pct <= 100',
                           name='ck_materials_under_tolerance'),
    )
    op.create_index('ix_materials_id', 'materials', ['id'])
    op.create_index('ix_materials_active', 'materials', ['active'])
    op.create_index('ix_materials_category_id', 'materials', ['category_id'])
    op.create_index('ix_materials_items_brand_id', 'materials', ['items_brand_id'])
    # Same case/whitespace-insensitive uniqueness as products (s85).
    op.execute('CREATE UNIQUE INDEX uq_materials_name_ci ON materials (lower(btrim(name)))')
    op.execute('CREATE UNIQUE INDEX uq_materials_item_code_ci ON materials (lower(btrim(item_code)))')

    op.create_table(
        'material_minimum_price',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('minimum_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('created_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id', ondelete='CASCADE'), nullable=False),
        *_audit_columns(),
    )
    op.create_index('ix_material_minimum_price_id', 'material_minimum_price', ['id'])
    op.create_index('ix_material_minimum_price_material_id', 'material_minimum_price', ['material_id'])

    op.create_table(
        'material_suppliers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('supplier_id', sa.Integer(), sa.ForeignKey('supplier.id', ondelete='CASCADE'), nullable=False),
        sa.Column('material_id', sa.Integer(), sa.ForeignKey('materials.id', ondelete='CASCADE'), nullable=False),
        sa.Column('supplier_sku', sa.String(255), nullable=True),
        sa.Column('cost_price', sa.Numeric(60, 2), nullable=False),
        sa.Column('minimum_order_qty', sa.Integer(), nullable=True),
        sa.Column('is_preferred', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('active', sa.Boolean(), nullable=False, server_default='true'),
        *_audit_columns(),
        sa.UniqueConstraint('supplier_id', 'material_id', name='uq_material_suppliers'),
    )
    op.create_index('ix_material_suppliers_id', 'material_suppliers', ['id'])
    op.create_index('ix_material_suppliers_supplier_id', 'material_suppliers', ['supplier_id'])
    op.create_index('ix_material_suppliers_material_id', 'material_suppliers', ['material_id'])
    # At most one preferred supplier per material (same as uq_supplier_product_preferred).
    op.execute('CREATE UNIQUE INDEX uq_material_suppliers_preferred ON material_suppliers (material_id) WHERE is_preferred')

    # RBAC resource "materials"; the Admin group gets it like every other resource.
    conn = op.get_bind()
    for action, description in _ACTIONS:
        conn.execute(sa.text(
            "insert into auth_permission (name, resource, action, description, created_at, updated_at) "
            "select cast(:name as varchar), 'materials', cast(:action as varchar), cast(:description as varchar), now(), now() "
            "where not exists (select 1 from auth_permission where resource = 'materials' and action = cast(:action as varchar))"
        ), {"name": f"{action}_materials", "action": action, "description": description})
    conn.execute(sa.text("""
        insert into auth_group_permissions (group_id, permission_id)
        select g.id, p.id from auth_group g join auth_permission p on p.resource = 'materials'
        where g.name = 'Admin'
          and not exists (select 1 from auth_group_permissions x where x.group_id = g.id and x.permission_id = p.id)
    """))


def downgrade() -> None:
    conn = op.get_bind()
    perm_ids = "select id from auth_permission where resource = 'materials'"
    conn.execute(sa.text(f"delete from auth_group_permissions where permission_id in ({perm_ids})"))
    conn.execute(sa.text(f"delete from accounts_user_user_permissions where permission_id in ({perm_ids})"))
    conn.execute(sa.text("delete from auth_permission where resource = 'materials'"))
    op.drop_table('material_suppliers')
    op.drop_table('material_minimum_price')
    op.drop_table('materials')
