"""add_status_to_supplier_credits_settle

Revision ID: cb91b745ee27
Revises: add_supplier_payments
Create Date: 2026-01-17 08:24:19.526196

"""
from alembic import op
import sqlalchemy as sa


revision = 'cb91b745ee27'
down_revision = 'add_supplier_payments'
branch_labels = None
depends_on = None

def upgrade() -> None:
    # Add status, verified_by, and verified_date columns to supplier_credits_settle
    op.add_column('supplier_credits_settle', 
        sa.Column('status', sa.String(30), nullable=False, server_default='pending'))
    op.add_column('supplier_credits_settle', 
        sa.Column('verified_by', sa.Integer(), nullable=True))
    op.add_column('supplier_credits_settle', 
        sa.Column('verified_date', sa.TIMESTAMP(), nullable=True))

def downgrade() -> None:
    # Remove the added columns
    op.drop_column('supplier_credits_settle', 'verified_date')
    op.drop_column('supplier_credits_settle', 'verified_by')
    op.drop_column('supplier_credits_settle', 'status')
