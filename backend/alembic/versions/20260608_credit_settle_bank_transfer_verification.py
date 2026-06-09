"""Add bank transfer verification fields to customer_credits_settle_transaction

Revision ID: 20260608_cs_bt
Revises: 20260607_fix_ccs
Create Date: 2026-06-08

Adds status and bank_deposit_id columns to customer_credits_settle_transaction
to support bank transfer verification workflow for credit settlements,
matching the existing sales order bank transfer verification flow.
"""

# revision identifiers, used by Alembic.
revision = '20260608_cs_bt'
down_revision = '20260607_fix_ccs'
branch_labels = None
depends_on = None

from alembic import op
import sqlalchemy as sa


def upgrade() -> None:
    # Add status column with default 'completed' (existing records are all completed)
    op.add_column(
        'customer_credits_settle_transaction',
        sa.Column('status', sa.String(30), nullable=False, server_default='completed')
    )
    # Add bank_deposit_id FK to link to BankDeposits record
    op.add_column(
        'customer_credits_settle_transaction',
        sa.Column('bank_deposit_id', sa.Integer(), nullable=True)
    )
    op.create_foreign_key(
        'fk_ccst_bank_deposit_id',
        'customer_credits_settle_transaction',
        'bank_deposits',
        ['bank_deposit_id'],
        ['id']
    )


def downgrade() -> None:
    op.drop_constraint('fk_ccst_bank_deposit_id', 'customer_credits_settle_transaction', type_='foreignkey')
    op.drop_column('customer_credits_settle_transaction', 'bank_deposit_id')
    op.drop_column('customer_credits_settle_transaction', 'status')
