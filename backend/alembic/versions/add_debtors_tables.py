"""Add debtors management tables

Revision ID: add_debtors_tables
Revises: 
Create Date: 2024-02-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'add_debtors_tables'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create invoice_payments table
    op.create_table(
        'invoice_payments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('invoice_id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=60, scale=2), nullable=False),
        sa.Column('payment_date', sa.Date(), nullable=False),
        sa.Column('payment_method', sa.String(length=50), nullable=False),
        sa.Column('reference_no', sa.String(length=100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('branch_code', sa.String(length=200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indices for invoice_payments
    op.create_index('idx_invoice_payments_invoice_id', 'invoice_payments', ['invoice_id'], unique=False)
    op.create_index('idx_invoice_payments_customer_id', 'invoice_payments', ['customer_id'], unique=False)
    op.create_index('idx_invoice_payments_payment_date', 'invoice_payments', ['payment_date'], unique=False)
    op.create_index('idx_invoice_payments_branch_code', 'invoice_payments', ['branch_code'], unique=False)
    
    # Create customer_followups table
    op.create_table(
        'customer_followups',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('customer_id', sa.Integer(), nullable=False),
        sa.Column('followup_date', sa.Date(), nullable=False),
        sa.Column('followup_type', sa.String(length=50), nullable=False),
        sa.Column('notes', sa.Text(), nullable=False),
        sa.Column('amount_promised', sa.Numeric(precision=60, scale=2), nullable=True),
        sa.Column('promised_payment_date', sa.Date(), nullable=True),
        sa.Column('branch_code', sa.String(length=200), nullable=False),
        sa.Column('is_resolved', sa.Boolean(), nullable=True, server_default='false'),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['customer_id'], ['customers.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    
    # Create indices for customer_followups
    op.create_index('idx_customer_followups_customer_id', 'customer_followups', ['customer_id'], unique=False)
    op.create_index('idx_customer_followups_followup_date', 'customer_followups', ['followup_date'], unique=False)
    op.create_index('idx_customer_followups_branch_code', 'customer_followups', ['branch_code'], unique=False)


def downgrade() -> None:
    # Drop indices
    op.drop_index('idx_customer_followups_branch_code', table_name='customer_followups')
    op.drop_index('idx_customer_followups_followup_date', table_name='customer_followups')
    op.drop_index('idx_customer_followups_customer_id', table_name='customer_followups')
    
    op.drop_index('idx_invoice_payments_branch_code', table_name='invoice_payments')
    op.drop_index('idx_invoice_payments_payment_date', table_name='invoice_payments')
    op.drop_index('idx_invoice_payments_customer_id', table_name='invoice_payments')
    op.drop_index('idx_invoice_payments_invoice_id', table_name='invoice_payments')
    
    # Drop tables
    op.drop_table('customer_followups')
    op.drop_table('invoice_payments')
