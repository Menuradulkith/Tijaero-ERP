"""Add sequential display numbers to supplier and customers

Revision ID: s75_supplier_customer_display_no
Revises: s74_po_cancel_short_close
Create Date: 2026-10-01

Adds `supplier_no` / `customer_no` — zero-padded sequential numbers
(0001, 0002, ...) shown as each grid's first column, generated at create
time (SupplierRepository.get_next_supplier_no / CustomerRepository.
get_next_customer_no). Distinct from the internal `id` PK, which is never
shown to users. Existing rows are backfilled in `id` order before the
column is made NOT NULL/unique.
"""
from alembic import op
import sqlalchemy as sa

revision = 's75_supplier_customer_display_no'
down_revision = 's74_po_cancel_short_close'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('supplier', sa.Column('supplier_no', sa.String(10), nullable=True))
    op.execute(
        "UPDATE supplier s SET supplier_no = sub.n FROM ("
        "  SELECT id, LPAD(ROW_NUMBER() OVER (ORDER BY id)::text, 4, '0') AS n FROM supplier"
        ") sub WHERE s.id = sub.id"
    )
    op.alter_column('supplier', 'supplier_no', existing_type=sa.String(10), nullable=False)
    op.create_unique_constraint('uq_supplier_supplier_no', 'supplier', ['supplier_no'])
    op.create_index('ix_supplier_supplier_no', 'supplier', ['supplier_no'])

    op.add_column('customers', sa.Column('customer_no', sa.String(10), nullable=True))
    op.execute(
        "UPDATE customers c SET customer_no = sub.n FROM ("
        "  SELECT id, LPAD(ROW_NUMBER() OVER (ORDER BY id)::text, 4, '0') AS n FROM customers"
        ") sub WHERE c.id = sub.id"
    )
    op.alter_column('customers', 'customer_no', existing_type=sa.String(10), nullable=False)
    op.create_unique_constraint('uq_customers_customer_no', 'customers', ['customer_no'])
    op.create_index('ix_customers_customer_no', 'customers', ['customer_no'])


def downgrade() -> None:
    op.drop_index('ix_customers_customer_no', table_name='customers')
    op.drop_constraint('uq_customers_customer_no', 'customers', type_='unique')
    op.drop_column('customers', 'customer_no')

    op.drop_index('ix_supplier_supplier_no', table_name='supplier')
    op.drop_constraint('uq_supplier_supplier_no', 'supplier', type_='unique')
    op.drop_column('supplier', 'supplier_no')
