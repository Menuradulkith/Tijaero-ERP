"""Payroll processing workflow - enhance payroll tables and add payroll_batches

Revision ID: d5e6f7g8h9i0
Revises: c4d5e6f7g8h9
Create Date: 2026-02-15 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'd5e6f7g8h9i0'
down_revision = 'c4d5e6f7g8h9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Create payroll_batches table ---
    op.create_table(
        'payroll_batches',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('batch_no', sa.String(50), unique=True, nullable=False, index=True),
        sa.Column('payroll_month', sa.Integer(), nullable=False),
        sa.Column('payroll_year', sa.Integer(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('status', sa.String(30), nullable=False, server_default='draft'),
        sa.Column('total_employees', sa.Integer(), nullable=True, server_default='0'),
        sa.Column('total_gross_salary', sa.Numeric(60, 2), nullable=True, server_default='0'),
        sa.Column('total_deductions', sa.Numeric(60, 2), nullable=True, server_default='0'),
        sa.Column('total_net_salary', sa.Numeric(60, 2), nullable=True, server_default='0'),
        sa.Column('total_employer_epf', sa.Numeric(60, 2), nullable=True, server_default='0'),
        sa.Column('total_employer_etf', sa.Numeric(60, 2), nullable=True, server_default='0'),
        sa.Column('total_employer_cost', sa.Numeric(60, 2), nullable=True, server_default='0'),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('approved_by', sa.Integer(), nullable=True),
        sa.Column('approved_date', sa.TIMESTAMP(), nullable=True),
        sa.Column('salary_payment_date', sa.Date(), nullable=True),
        sa.Column('salary_payment_reference', sa.String(200), nullable=True),
        sa.Column('statutory_payment_date', sa.Date(), nullable=True),
        sa.Column('statutory_payment_reference', sa.String(200), nullable=True),
        sa.Column('completed_date', sa.TIMESTAMP(), nullable=True),
    )

    # --- Enhance employee_payroll table ---
    op.add_column('employee_payroll', sa.Column('payroll_month', sa.Integer(), nullable=True))
    op.add_column('employee_payroll', sa.Column('payroll_year', sa.Integer(), nullable=True))
    op.add_column('employee_payroll', sa.Column('payroll_batch_no', sa.String(100), nullable=True))
    op.add_column('employee_payroll', sa.Column('add_bonus', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('less_loan_repayment', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('less_other_deductions', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('gross_salary', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('total_deductions', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('net_salary', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('total_employer_cost', sa.Numeric(60, 2), nullable=True))
    op.add_column('employee_payroll', sa.Column('status', sa.String(30), nullable=True, server_default='draft'))
    op.add_column('employee_payroll', sa.Column('approved_by', sa.Integer(), nullable=True))
    op.add_column('employee_payroll', sa.Column('approved_date', sa.TIMESTAMP(), nullable=True))
    op.add_column('employee_payroll', sa.Column('payment_status', sa.String(30), nullable=True))
    op.add_column('employee_payroll', sa.Column('payment_date', sa.Date(), nullable=True))
    op.add_column('employee_payroll', sa.Column('payment_reference', sa.String(200), nullable=True))
    op.add_column('employee_payroll', sa.Column('payment_method', sa.String(50), nullable=True))
    op.add_column('employee_payroll', sa.Column('statutory_payment_status', sa.String(30), nullable=True))
    op.add_column('employee_payroll', sa.Column('statutory_payment_date', sa.Date(), nullable=True))
    op.add_column('employee_payroll', sa.Column('statutory_payment_reference', sa.String(200), nullable=True))
    op.add_column('employee_payroll', sa.Column('created_at', sa.TIMESTAMP(), nullable=True))
    op.add_column('employee_payroll', sa.Column('created_by', sa.Integer(), nullable=True))
    op.create_index('ix_employee_payroll_batch_no', 'employee_payroll', ['payroll_batch_no'])

    # --- Enhance employee_salary_profile table ---
    op.add_column('employee_salary_profile', sa.Column('designation', sa.String(200), nullable=True))
    op.add_column('employee_salary_profile', sa.Column('department', sa.String(200), nullable=True))
    op.add_column('employee_salary_profile', sa.Column('effective_from_date', sa.Date(), nullable=True))
    op.add_column('employee_salary_profile', sa.Column('benefits', sa.Text(), nullable=True))

    # --- Enhance salary_deductions table ---
    op.add_column('salary_deductions', sa.Column('deduction_period', sa.String(7), nullable=True))
    op.add_column('salary_deductions', sa.Column('epf_employee', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('etf_employee', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('stamp_duty', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('late_deductions', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('salary_advance_repayment', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('loan_repayment', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('other_deductions', sa.Numeric(60, 2), nullable=True))
    op.add_column('salary_deductions', sa.Column('remarks', sa.Text(), nullable=True))
    op.add_column('salary_deductions', sa.Column('created_by', sa.Integer(), nullable=True))
    op.add_column('salary_deductions', sa.Column('created_date', sa.TIMESTAMP(), nullable=True))


def downgrade() -> None:
    # --- salary_deductions ---
    for col in ['created_date', 'created_by', 'remarks', 'other_deductions',
                'loan_repayment', 'salary_advance_repayment', 'late_deductions',
                'stamp_duty', 'etf_employee', 'epf_employee', 'deduction_period']:
        op.drop_column('salary_deductions', col)

    # --- employee_salary_profile ---
    for col in ['benefits', 'effective_from_date', 'department', 'designation']:
        op.drop_column('employee_salary_profile', col)

    # --- employee_payroll ---
    op.drop_index('ix_employee_payroll_batch_no', 'employee_payroll')
    for col in ['created_by', 'created_at', 'statutory_payment_reference', 'statutory_payment_date',
                'statutory_payment_status', 'payment_method', 'payment_reference', 'payment_date',
                'payment_status', 'approved_date', 'approved_by', 'status',
                'total_employer_cost', 'net_salary', 'total_deductions', 'gross_salary',
                'less_other_deductions', 'less_loan_repayment', 'add_bonus',
                'payroll_batch_no', 'payroll_year', 'payroll_month']:
        op.drop_column('employee_payroll', col)

    # --- payroll_batches ---
    op.drop_table('payroll_batches')
