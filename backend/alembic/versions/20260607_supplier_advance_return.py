"""Add return fields to supplier_advance_payment

Revision ID: 20260607_adv_return
Revises: 20260429_tax_norm
Create Date: 2026-06-07

"""
from alembic import op
import sqlalchemy as sa

revision = '20260607_adv_return'
down_revision = '20260429_tax_norm'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('supplier_advance_payment', sa.Column('returned_amount', sa.Numeric(18, 2), nullable=False, server_default='0'))
    op.add_column('supplier_advance_payment', sa.Column('return_date', sa.Date(), nullable=True))
    op.add_column('supplier_advance_payment', sa.Column('return_method', sa.String(30), nullable=True))
    op.add_column('supplier_advance_payment', sa.Column('return_reference', sa.String(100), nullable=True))
    op.add_column('supplier_advance_payment', sa.Column('return_remarks', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('supplier_advance_payment', 'return_remarks')
    op.drop_column('supplier_advance_payment', 'return_reference')
    op.drop_column('supplier_advance_payment', 'return_method')
    op.drop_column('supplier_advance_payment', 'return_date')
    op.drop_column('supplier_advance_payment', 'returned_amount')
