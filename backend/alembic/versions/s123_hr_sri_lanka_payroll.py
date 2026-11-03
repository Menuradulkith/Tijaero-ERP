"""HR for Sri Lanka: payroll settings, allowance lines (EPF-liable / taxable), overtime, loans,
effective-dated salary revisions, Shop & Office annual leave rule, lieu leave

Revision ID: s123_hr_sri_lanka_payroll
Revises: s122_supplier_credit_days_nullable
Create Date: 2026-11-02
"""
import sqlalchemy as sa
from alembic import op

revision = 's123_hr_sri_lanka_payroll'
down_revision = 's122_supplier_credit_days_nullable'
branch_labels = None
depends_on = None


def _audit_cols():
    return [
        sa.Column('created_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime, server_default=sa.func.now(), nullable=False),
        sa.Column('created_by', sa.Integer, nullable=True),
        sa.Column('updated_by', sa.Integer, nullable=True),
    ]


def upgrade() -> None:
    op.create_table(
        'hr_payroll_settings',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('epf_employee_rate', sa.Numeric(5, 2), nullable=False, server_default='8'),
        sa.Column('epf_employer_rate', sa.Numeric(5, 2), nullable=False, server_default='12'),
        sa.Column('etf_rate', sa.Numeric(5, 2), nullable=False, server_default='3'),
        sa.Column('pay_overtime', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('ot_multiplier', sa.Numeric(4, 2), nullable=False, server_default='1.5'),
        sa.Column('ot_divisor', sa.Integer, nullable=False, server_default='240'),
        sa.Column('deduct_late', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('stamp_duty_amount', sa.Numeric(10, 2), nullable=False, server_default='25'),
        sa.Column('stamp_duty_threshold', sa.Numeric(15, 2), nullable=False, server_default='25000'),
        sa.Column('gratuity_enabled', sa.Boolean, nullable=False, server_default='true'),
        sa.Column('employer_epf_no', sa.String(30), nullable=True),
        sa.Column('employer_tin', sa.String(30), nullable=True),
        *_audit_cols(),
    )
    op.execute("insert into hr_payroll_settings (id) values (1)")

    op.create_table(
        'hr_employee_loans',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('loan_no', sa.String(30), nullable=False, unique=True, index=True),
        sa.Column('employee_pk', sa.Integer, sa.ForeignKey('employees.id'), nullable=False, index=True),
        sa.Column('loan_type', sa.String(10), nullable=False, server_default='loan'),
        sa.Column('issue_date', sa.Date, nullable=False),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('installment_amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('installments', sa.Integer, nullable=False, server_default='1'),
        sa.Column('start_period', sa.String(7), nullable=False),
        sa.Column('payment_method', sa.String(20), nullable=False, server_default='bank_transfer'),
        sa.Column('status', sa.String(15), nullable=False, server_default='active', index=True),
        sa.Column('remarks', sa.Text, nullable=True),
        sa.CheckConstraint('amount > 0 and installment_amount > 0 and installments >= 1', name='ck_hr_loan_amounts'),
        *_audit_cols(),
    )
    op.create_table(
        'hr_loan_recoveries',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('loan_id', sa.Integer, sa.ForeignKey('hr_employee_loans.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('period', sa.String(7), nullable=False),
        sa.Column('amount', sa.Numeric(15, 2), nullable=False),
        sa.Column('payroll_id', sa.Integer, sa.ForeignKey('employee_payroll.id', ondelete='CASCADE'), nullable=True, index=True),
        sa.Column('payment_date', sa.Date, nullable=True),
        sa.Column('remarks', sa.Text, nullable=True),
        sa.CheckConstraint('amount > 0', name='ck_hr_loan_recovery_amount'),
        *_audit_cols(),
    )

    op.create_table(
        'hr_salary_revisions',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('employee_id', sa.Text, sa.ForeignKey('employees.employee_id'), nullable=False, index=True),
        sa.Column('effective_from', sa.Date, nullable=False),
        sa.Column('basic_salary', sa.Numeric(60, 2), nullable=False),
        sa.Column('allowances', sa.JSON, nullable=True),
        sa.Column('reason', sa.String(20), nullable=False, server_default='adjustment'),
        sa.Column('remarks', sa.Text, nullable=True),
        sa.UniqueConstraint('employee_id', 'effective_from', name='uq_hr_salary_revision'),
        *_audit_cols(),
    )

    op.add_column('employees', sa.Column('overtime_eligible', sa.Boolean, nullable=False, server_default='true'))
    op.add_column('employee_salary_profile', sa.Column('allowances', sa.JSON, nullable=True))
    for name, type_ in (('allowance_lines', sa.JSON), ('ot_hours', sa.Numeric(10, 2)), ('add_overtime', sa.Numeric(60, 2)),
                        ('nopay_days', sa.Numeric(6, 2)), ('less_nopay', sa.Numeric(60, 2)),
                        ('epf_earnings', sa.Numeric(60, 2)), ('taxable_income', sa.Numeric(60, 2))):
        op.add_column('employee_payroll', sa.Column(name, type_, nullable=True))
    op.add_column('hr_leave_types', sa.Column('entitlement_rule', sa.String(10), nullable=False, server_default='prorata'))

    # The two fixed allowance slots become allowance lines (taxable, not EPF-liable until HR says so)
    op.execute("""
        update employee_salary_profile set allowances = (
            select coalesce(json_agg(x), '[]'::json) from (
                select add_1_name as name, add_1_value as amount, false as epf_liable, true as taxable
                 where coalesce(add_1_value, 0) > 0
                union all
                select add_2_name, add_2_value, false, true where coalesce(add_2_value, 0) > 0
            ) x)
    """)
    # Today's profile becomes the first salary revision
    op.execute("""
        insert into hr_salary_revisions (employee_id, effective_from, basic_salary, allowances, reason, created_by)
        select p.employee_id, coalesce(p.effective_from_date, e.date_of_joining, p.created_at::date, current_date),
               p.basic_salary, p.allowances, 'joining', p.created_by
          from employee_salary_profile p join employees e on e.employee_id = p.employee_id
    """)

    op.execute("""
        update hr_leave_types set entitlement_rule = 'sl_annual',
               description = 'Shop & Office Act: none in the joining year; next year 14/10/7/4 days by the joining quarter; 14 days after that'
         where code = 'annual'
    """)
    op.execute("update hr_leave_types set entitlement_rule = 'full' where code = 'maternity'")
    op.execute("""
        insert into hr_leave_types (code, name, description, annual_entitlement, accrual, carry_forward_max, is_paid,
                                    allow_half_day, allow_negative_balance, max_consecutive_days, min_service_months,
                                    applicable_gender, document_required_after_days, count_holidays, active, entitlement_rule)
        select 'lieu', 'Lieu Leave', 'Earned by working on a holiday or weekly off; granted from Leave Balances',
               0, 'none', 0, true, true, false, null, 0, 'all', null, false, true, 'full'
         where not exists (select 1 from hr_leave_types where code = 'lieu')
    """)


def downgrade() -> None:
    op.execute("delete from hr_leave_types where code = 'lieu' and not exists (select 1 from leaves where lower(leave_type) = 'lieu')")
    op.drop_column('hr_leave_types', 'entitlement_rule')
    for name in ('allowance_lines', 'ot_hours', 'add_overtime', 'nopay_days', 'less_nopay', 'epf_earnings', 'taxable_income'):
        op.drop_column('employee_payroll', name)
    op.drop_column('employee_salary_profile', 'allowances')
    op.drop_column('employees', 'overtime_eligible')
    op.drop_table('hr_salary_revisions')
    op.drop_table('hr_loan_recoveries')
    op.drop_table('hr_employee_loans')
    op.drop_table('hr_payroll_settings')
