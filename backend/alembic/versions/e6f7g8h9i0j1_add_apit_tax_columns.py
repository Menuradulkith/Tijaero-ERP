"""Add APIT (Advance Personal Income Tax) columns to payroll tables

Revision ID: e6f7g8h9i0j1
Revises: d5e6f7g8h9i0, 87d8f595d1c5
Create Date: 2026-02-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'e6f7g8h9i0j1'
down_revision = ('d5e6f7g8h9i0', '87d8f595d1c5')
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add APIT tax column to employee_payroll
    op.add_column('employee_payroll',
        sa.Column('less_apit', sa.Numeric(60, 2), nullable=True)
    )

    # Add total APIT column to payroll_batches
    op.add_column('payroll_batches',
        sa.Column('total_apit', sa.Numeric(60, 2), nullable=True, server_default='0')
    )


def downgrade() -> None:
    op.drop_column('payroll_batches', 'total_apit')
    op.drop_column('employee_payroll', 'less_apit')
