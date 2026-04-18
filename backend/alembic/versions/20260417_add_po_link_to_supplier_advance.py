"""Add purchasing_order_id to supplier_advance_payment

Revision ID: 20260417_adv_po_link
Revises: s11_15_quote_enhance
Create Date: 2026-04-17

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = '20260417_adv_po_link'
down_revision = 's11_15_quote_enhance'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'supplier_advance_payment',
        sa.Column('purchasing_order_id', sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        'fk_supplier_advance_payment_purchasing_order_id',
        'supplier_advance_payment',
        'purchasing_orders',
        ['purchasing_order_id'],
        ['id'],
    )
    op.create_index(
        op.f('ix_supplier_advance_payment_purchasing_order_id'),
        'supplier_advance_payment',
        ['purchasing_order_id'],
        unique=False,
    )


def downgrade():
    op.drop_index(
        op.f('ix_supplier_advance_payment_purchasing_order_id'),
        table_name='supplier_advance_payment',
    )
    op.drop_constraint(
        'fk_supplier_advance_payment_purchasing_order_id',
        'supplier_advance_payment',
        type_='foreignkey',
    )
    op.drop_column('supplier_advance_payment', 'purchasing_order_id')
