"""Enhance expenses table with workflow, approval, payment, and accounting fields

Revision ID: c4d5e6f7g8h9
Revises: b3c4d5e6f7g8
Create Date: 2026-02-11 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'c4d5e6f7g8h9'
down_revision = 'b3c4d5e6f7g8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('expenses', sa.Column('expense_type', sa.String(50), nullable=True, server_default='operational'))
    op.add_column('expenses', sa.Column('expense_category', sa.String(100), nullable=True, server_default='miscellaneous'))
    op.add_column('expenses', sa.Column('expense_date', sa.Date(), nullable=True))
    op.add_column('expenses', sa.Column('vendor_name', sa.String(255), nullable=True))
    op.add_column('expenses', sa.Column('description', sa.Text(), nullable=True))
    op.add_column('expenses', sa.Column('receipt_number', sa.String(200), nullable=True))
    op.add_column('expenses', sa.Column('receipt_image', sa.String(500), nullable=True))
    op.add_column('expenses', sa.Column('invoice_attachment', sa.String(500), nullable=True))
    op.add_column('expenses', sa.Column('status', sa.String(30), nullable=True, server_default='pending'))
    op.add_column('expenses', sa.Column('submitted_by', sa.Integer(), nullable=True))
    op.add_column('expenses', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('expenses', sa.Column('approved_date', sa.TIMESTAMP(), nullable=True))
    op.add_column('expenses', sa.Column('rejection_reason', sa.Text(), nullable=True))
    op.add_column('expenses', sa.Column('payment_status', sa.String(30), nullable=True))
    op.add_column('expenses', sa.Column('payment_date', sa.Date(), nullable=True))
    op.add_column('expenses', sa.Column('payment_method', sa.String(50), nullable=True))
    op.add_column('expenses', sa.Column('payment_reference', sa.String(200), nullable=True))
    op.add_column('expenses', sa.Column('account_code', sa.String(100), nullable=True))
    op.add_column('expenses', sa.Column('cost_center', sa.String(100), nullable=True))
    op.add_column('expenses', sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now(), nullable=True))
    op.add_column('expenses', sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now(), nullable=True))

    # Backfill existing rows
    op.execute("UPDATE expenses SET expense_date = created_date WHERE expense_date IS NULL")
    op.execute("UPDATE expenses SET expense_category = expenses_method WHERE expense_category IS NULL")
    op.execute("UPDATE expenses SET status = 'pending' WHERE status IS NULL")


def downgrade() -> None:
    for col in ['updated_at', 'created_at', 'cost_center', 'account_code',
                'payment_reference', 'payment_method', 'payment_date', 'payment_status',
                'rejection_reason', 'approved_date', 'approved_by', 'submitted_by',
                'status', 'invoice_attachment', 'receipt_image', 'receipt_number',
                'description', 'vendor_name', 'expense_date', 'expense_category', 'expense_type']:
        op.drop_column('expenses', col)
