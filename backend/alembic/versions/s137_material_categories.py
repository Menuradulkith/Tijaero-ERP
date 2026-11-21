"""Material master gets its own categories (material_categories)

Revision ID: s137_material_categories
Revises: s136_materials_master
Create Date: 2026-11-19

Brands stay shared with the product catalog, but categories do not: this adds
``material_categories`` (same shape and uniqueness as ``category``) and moves
``materials.category_id`` onto it. Any existing materials keep their category:
each referenced product category is copied across and the rows are remapped
before the foreign key is switched.
"""
import sqlalchemy as sa
from alembic import op

revision = 's137_material_categories'
down_revision = 's136_materials_master'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'material_categories',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('category_code', sa.String(255), nullable=False),
        sa.Column('memo', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('active', sa.Boolean(), nullable=False),
        sa.Column('created_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
    )
    op.create_index('ix_material_categories_id', 'material_categories', ['id'])
    # Same case/whitespace-insensitive uniqueness as category (s85).
    op.execute('CREATE UNIQUE INDEX uq_material_categories_name_ci ON material_categories (lower(btrim(name)))')
    op.execute('CREATE UNIQUE INDEX uq_material_categories_code_ci ON material_categories (lower(btrim(category_code)))')

    # Copy the product categories existing materials use, then remap (a temporary
    # column carries the old id so the remap is exact).
    op.add_column('material_categories', sa.Column('source_category_id', sa.Integer(), nullable=True))
    op.execute("""
        INSERT INTO material_categories (name, category_code, memo, description, active, created_date,
                                         created_by, updated_by, created_at, updated_at, source_category_id)
        SELECT c.name, c.category_code, c.memo, c.description, c.active, c.created_date,
               c.created_by, c.updated_by, c.created_at, c.updated_at, c.id
        FROM category c
        WHERE c.id IN (SELECT DISTINCT category_id FROM materials)
    """)
    op.drop_constraint('materials_category_id_fkey', 'materials', type_='foreignkey')
    op.execute("""
        UPDATE materials m SET category_id = mc.id
        FROM material_categories mc WHERE mc.source_category_id = m.category_id
    """)
    op.drop_column('material_categories', 'source_category_id')
    op.create_foreign_key('materials_category_id_fkey', 'materials', 'material_categories', ['category_id'], ['id'])


def downgrade() -> None:
    # Map each material back to a product category with the same (trimmed,
    # case-insensitive) name, creating one where none exists.
    op.drop_constraint('materials_category_id_fkey', 'materials', type_='foreignkey')
    op.execute("""
        INSERT INTO category (name, category_code, memo, description, active, created_date,
                              created_by, updated_by, created_at, updated_at)
        SELECT mc.name, mc.category_code, mc.memo, mc.description, mc.active, mc.created_date,
               mc.created_by, mc.updated_by, mc.created_at, mc.updated_at
        FROM material_categories mc
        WHERE mc.id IN (SELECT DISTINCT category_id FROM materials)
          AND NOT EXISTS (SELECT 1 FROM category c WHERE lower(btrim(c.name)) = lower(btrim(mc.name)))
        ON CONFLICT DO NOTHING
    """)
    op.execute("""
        UPDATE materials m SET category_id = c.id
        FROM material_categories mc JOIN category c ON lower(btrim(c.name)) = lower(btrim(mc.name))
        WHERE mc.id = m.category_id
    """)
    op.create_foreign_key('materials_category_id_fkey', 'materials', 'category', ['category_id'], ['id'])
    op.drop_table('material_categories')
