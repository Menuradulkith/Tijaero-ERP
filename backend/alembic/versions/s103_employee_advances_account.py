"""Add asset account 1130 Employee Advances & Loans

Revision ID: s103_employee_advances_account
Revises: s102_misc_income_leaf
Create Date: 2026-10-24

Payroll used to expense salary advances (Dr 5110) and park advance / loan
repayments on liability 2140, which nothing ever cleared. Advances paid are now
an asset (Dr 1130) and repayments clear it (Cr 1130). Category "Employee
Advance" keeps it open to manual journals (loan payouts made outside payroll).
"""
from alembic import op
import sqlalchemy as sa

revision = 's103_employee_advances_account'
down_revision = 's102_misc_income_leaf'
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.execute(sa.text("SELECT 1 FROM chart_of_accounts WHERE account_code = '1130'")).first():
        return
    bind.execute(sa.text("""
        INSERT INTO chart_of_accounts
            (account_code, account_name, account_type, account_category, parent_account_id,
             is_active, is_system_account, normal_balance, description)
        SELECT '1130', 'Employee Advances & Loans', 'Asset', 'Employee Advance', p.id, TRUE, TRUE, 'Debit',
               'Salary advances and loans owed by employees, cleared by payroll repayments'
        FROM (SELECT (SELECT id FROM chart_of_accounts WHERE account_code = '1100') AS id) p
    """))


def downgrade() -> None:
    op.execute("""
        DELETE FROM chart_of_accounts c WHERE c.account_code = '1130'
        AND NOT EXISTS (SELECT 1 FROM general_ledger g WHERE g.account_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM journal_entry_lines l WHERE l.account_id = c.id)
    """)
