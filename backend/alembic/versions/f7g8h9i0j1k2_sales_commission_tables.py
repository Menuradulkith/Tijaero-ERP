"""Add sales commission tables for Scenario 28A

Revision ID: f7g8h9i0j1k2
Revises: e6f7g8h9i0j1
Create Date: 2026-02-11 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'f7g8h9i0j1k2'
down_revision = 'e6f7g8h9i0j1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create monthly_branch_sales_summary table
    op.create_table(
        'monthly_branch_sales_summary',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('branch_code', sa.String(200), sa.ForeignKey('branches.branch_code'), nullable=False),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_month', sa.Integer(), nullable=False),
        sa.Column('month_name', sa.String(50), nullable=False),
        sa.Column('period_start_date', sa.Date(), nullable=False),
        sa.Column('period_end_date', sa.Date(), nullable=False),
        # Financials
        sa.Column('total_sales_revenue', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('total_sales_cost', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('total_sales_returns', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('total_discounts', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('net_sales_revenue', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('gross_profit', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('gross_profit_margin', sa.Numeric(10, 4), nullable=True),
        sa.Column('total_invoices', sa.Integer(), nullable=True, server_default='0'),
        # Workflow
        sa.Column('status', sa.String(30), nullable=False, server_default='draft'),
        sa.Column('finalized_by', sa.Integer(), sa.ForeignKey('accounts_user.id'), nullable=True),
        sa.Column('finalized_at', sa.TIMESTAMP(), nullable=True),
        # Timestamps
        sa.Column('created_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('updated_at', sa.TIMESTAMP(), nullable=True),
        # Unique constraint
        sa.UniqueConstraint('branch_code', 'fiscal_year', 'fiscal_month', name='monthly_branch_sales_unique'),
    )
    
    # Create index on monthly_branch_sales_summary
    op.create_index(
        'ix_monthly_sales_branch_period',
        'monthly_branch_sales_summary',
        ['branch_code', 'fiscal_year', 'fiscal_month']
    )

    # Create sales_officer_monthly_commissions table
    op.create_table(
        'sales_officer_monthly_commissions',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('monthly_sales_summary_id', sa.Integer(), 
                  sa.ForeignKey('monthly_branch_sales_summary.id', ondelete='CASCADE'), nullable=False),
        sa.Column('employee_id', sa.Integer(), sa.ForeignKey('employees.id'), nullable=False),
        sa.Column('branch_code', sa.String(200), sa.ForeignKey('branches.branch_code'), nullable=False),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_month', sa.Integer(), nullable=False),
        # Commission calculation
        sa.Column('branch_gross_profit', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('commission_percentage', sa.Numeric(10, 4), nullable=False, server_default='0'),
        sa.Column('total_commission_pool', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('total_branch_employees', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('individual_commission_amount', sa.Numeric(60, 2), nullable=False, server_default='0'),
        # Workflow
        sa.Column('status', sa.String(30), nullable=False, server_default='pending'),
        sa.Column('approved_by', sa.Integer(), sa.ForeignKey('accounts_user.id'), nullable=True),
        sa.Column('approved_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('paid_in_payroll_id', sa.Integer(), sa.ForeignKey('payroll_batches.id'), nullable=True),
        sa.Column('remarks', sa.Text(), nullable=True),
        # Timestamps
        sa.Column('created_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('updated_at', sa.TIMESTAMP(), nullable=True),
        # Unique constraint - one commission per employee per period
        sa.UniqueConstraint('employee_id', 'fiscal_year', 'fiscal_month', name='sales_commission_employee_period_unique'),
    )
    
    # Create indexes on sales_officer_monthly_commissions
    op.create_index(
        'ix_sales_commission_employee',
        'sales_officer_monthly_commissions',
        ['employee_id']
    )
    op.create_index(
        'ix_sales_commission_period',
        'sales_officer_monthly_commissions',
        ['fiscal_year', 'fiscal_month']
    )
    op.create_index(
        'ix_sales_commission_status',
        'sales_officer_monthly_commissions',
        ['status']
    )
    op.create_index(
        'ix_sales_commission_summary',
        'sales_officer_monthly_commissions',
        ['monthly_sales_summary_id']
    )
    
    # Add sales_commission column to employee_payroll for payroll integration
    op.add_column(
        'employee_payroll',
        sa.Column('add_sales_commission', sa.Numeric(60, 2), nullable=True, server_default='0')
    )


def downgrade() -> None:
    # Remove sales commission column from employee_payroll
    op.drop_column('employee_payroll', 'add_sales_commission')
    
    # Drop indexes
    op.drop_index('ix_sales_commission_summary', 'sales_officer_monthly_commissions')
    op.drop_index('ix_sales_commission_status', 'sales_officer_monthly_commissions')
    op.drop_index('ix_sales_commission_period', 'sales_officer_monthly_commissions')
    op.drop_index('ix_sales_commission_employee', 'sales_officer_monthly_commissions')
    op.drop_index('ix_monthly_sales_branch_period', 'monthly_branch_sales_summary')
    
    # Drop tables
    op.drop_table('sales_officer_monthly_commissions')
    op.drop_table('monthly_branch_sales_summary')
