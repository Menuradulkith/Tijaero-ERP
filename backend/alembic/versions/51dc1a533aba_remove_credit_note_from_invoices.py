"""remove_credit_note_from_invoices

Revision ID: 51dc1a533aba
Revises: fix_heads_jan18_real
Create Date: 2026-01-18 16:34:05.391864

"""
from alembic import op
import sqlalchemy as sa


revision = '51dc1a533aba'
down_revision = 'fix_heads_jan18_real'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Remove credit_note references from invoices table
    # These are for vouchers/refunds, not invoice payments
    op.drop_constraint('invoices_credit_note_id_fkey', 'invoices', type_='foreignkey')
    op.drop_column('invoices', 'credit_note_id')
    op.drop_column('invoices', 'credit_note_amount')


def downgrade() -> None:
    # Add back credit_note columns
    op.add_column('invoices', sa.Column('credit_note_amount', sa.Numeric(precision=60, scale=2), nullable=False, server_default=sa.text('0')))
    op.add_column('invoices', sa.Column('credit_note_id', sa.Integer(), nullable=True))
    op.create_foreign_key('invoices_credit_note_id_fkey', 'invoices', 'customer_credit_notes', ['credit_note_id'], ['id'])
