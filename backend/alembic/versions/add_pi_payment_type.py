"""add payment_type to purchase_invoices

Revision ID: add_pi_payment_type
Revises: add_purchase_invoices
Create Date: 2026-05-02

"""
from alembic import op
import sqlalchemy as sa


revision = 'add_pi_payment_type'
down_revision = 'add_purchase_invoices'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('purchase_invoices', sa.Column('payment_type', sa.String(30), nullable=False, server_default='non_credit'))
    op.create_index('ix_purchase_invoices_payment_type', 'purchase_invoices', ['payment_type'])


def downgrade() -> None:
    op.drop_index('ix_purchase_invoices_payment_type', table_name='purchase_invoices')
    op.drop_column('purchase_invoices', 'payment_type')
