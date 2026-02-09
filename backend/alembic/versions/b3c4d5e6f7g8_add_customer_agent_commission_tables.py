"""Add customer agent commission tables

Revision ID: b3c4d5e6f7g8
Revises: a1b2c3d4e5f6
Create Date: 2026-02-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'b3c4d5e6f7g8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Create customer_agent_commissions table
    op.create_table(
        'customer_agent_commissions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('invoice_id', sa.Integer(), nullable=False),
        sa.Column('customer_agent_id', sa.Integer(), nullable=False),
        sa.Column('represented_customer_id', sa.Integer(), nullable=False),
        sa.Column('invoice_amount', sa.Numeric(precision=60, scale=2), nullable=False),
        sa.Column('commission_type', sa.String(length=20), nullable=False),
        sa.Column('commission_rate', sa.Numeric(precision=5, scale=2), nullable=True),
        sa.Column('commission_amount', sa.Numeric(precision=60, scale=2), nullable=False),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='pending'),
        sa.Column('approved_by', sa.Integer(), nullable=True),
        sa.Column('approved_date', sa.TIMESTAMP(), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['invoice_id'], ['invoices.id'], ),
        sa.ForeignKeyConstraint(['customer_agent_id'], ['customers.id'], ),
        sa.ForeignKeyConstraint(['represented_customer_id'], ['customers.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_customer_agent_commissions_id'), 'customer_agent_commissions', ['id'], unique=False)
    op.create_index('ix_cac_agent_id', 'customer_agent_commissions', ['customer_agent_id'], unique=False)
    op.create_index('ix_cac_invoice_id', 'customer_agent_commissions', ['invoice_id'], unique=False)
    op.create_index('ix_cac_status', 'customer_agent_commissions', ['status'], unique=False)

    # 2. Create customer_agent_commission_payments table
    op.create_table(
        'customer_agent_commission_payments',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('payment_no', sa.String(length=200), nullable=False),
        sa.Column('customer_agent_id', sa.Integer(), nullable=False),
        sa.Column('payment_date', sa.Date(), nullable=False),
        sa.Column('payment_method', sa.String(length=30), nullable=False),
        sa.Column('payment_amount', sa.Numeric(precision=60, scale=2), nullable=False),
        sa.Column('reference_number', sa.String(length=300), nullable=True),
        sa.Column('bank_name', sa.String(length=255), nullable=True),
        sa.Column('branch_code', sa.String(length=200), nullable=False),
        sa.Column('remarks', sa.Text(), nullable=True),
        sa.Column('status', sa.String(length=30), nullable=False, server_default='pending'),
        sa.Column('verified_by', sa.Integer(), nullable=True),
        sa.Column('verified_date', sa.TIMESTAMP(), nullable=True),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['customer_agent_id'], ['customers.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('payment_no'),
    )
    op.create_index(op.f('ix_customer_agent_commission_payments_id'), 'customer_agent_commission_payments', ['id'], unique=False)
    op.create_index('ix_cacp_agent_id', 'customer_agent_commission_payments', ['customer_agent_id'], unique=False)
    op.create_index('ix_cacp_status', 'customer_agent_commission_payments', ['status'], unique=False)

    # 3. Create customer_agent_commission_payment_items table
    op.create_table(
        'customer_agent_commission_payment_items',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('payment_id', sa.Integer(), nullable=False),
        sa.Column('commission_id', sa.Integer(), nullable=False),
        sa.Column('paid_amount', sa.Numeric(precision=60, scale=2), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['payment_id'], ['customer_agent_commission_payments.id'], ),
        sa.ForeignKeyConstraint(['commission_id'], ['customer_agent_commissions.id'], ),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_customer_agent_commission_payment_items_id'), 'customer_agent_commission_payment_items', ['id'], unique=False)
    op.create_index('ix_cacpi_payment_id', 'customer_agent_commission_payment_items', ['payment_id'], unique=False)
    op.create_index('ix_cacpi_commission_id', 'customer_agent_commission_payment_items', ['commission_id'], unique=False)

    # 4. Add commission_rate column to customers table
    op.add_column('customers', sa.Column('commission_rate', sa.Numeric(precision=5, scale=2), nullable=True))


def downgrade() -> None:
    # Remove commission_rate from customers table
    op.drop_column('customers', 'commission_rate')

    op.drop_index('ix_cacpi_commission_id', table_name='customer_agent_commission_payment_items')
    op.drop_index('ix_cacpi_payment_id', table_name='customer_agent_commission_payment_items')
    op.drop_index(op.f('ix_customer_agent_commission_payment_items_id'), table_name='customer_agent_commission_payment_items')
    op.drop_table('customer_agent_commission_payment_items')

    op.drop_index('ix_cacp_status', table_name='customer_agent_commission_payments')
    op.drop_index('ix_cacp_agent_id', table_name='customer_agent_commission_payments')
    op.drop_index(op.f('ix_customer_agent_commission_payments_id'), table_name='customer_agent_commission_payments')
    op.drop_table('customer_agent_commission_payments')

    op.drop_index('ix_cac_status', table_name='customer_agent_commissions')
    op.drop_index('ix_cac_invoice_id', table_name='customer_agent_commissions')
    op.drop_index('ix_cac_agent_id', table_name='customer_agent_commissions')
    op.drop_index(op.f('ix_customer_agent_commissions_id'), table_name='customer_agent_commissions')
    op.drop_table('customer_agent_commissions')
