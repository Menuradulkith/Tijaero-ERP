"""Customer write-offs and the cheque register (finance blueprint phase C)

Revision ID: s118_write_offs_cheques
Revises: s117_payment_terms
Create Date: 2026-10-31

- write_off_limits (per user group) and customer_write_offs; account 5185
  Bad Debts & Write-offs; voucher types WOFF and CHQB.
- cheque_payments: status (received / deposited / cleared / bounced) and the
  links a bounce needs. Backfill:
    * sale cheques are linked to their auto-created deposit (same invoice_no,
      "Cheque Deposit - Sales Invoice"); confirmed deposit -> deposited;
    * settlement cheques were booked straight to the bank -> deposited, and
      linked to their settlement transaction (same invoice, cheque number, amount);
    * anything else stays received.
"""
import sqlalchemy as sa
from alembic import op

revision = 's118_write_offs_cheques'
down_revision = 's117_payment_terms'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_category,
                                       parent_account_id, is_active, is_system_account, normal_balance,
                                       description, created_at, updated_at)
        SELECT '5185', 'Bad Debts & Write-offs', 'Expense', 'Operating',
               (SELECT id FROM chart_of_accounts WHERE account_code = '5100'), true, true, 'Debit',
               'Customer balances written off as not collectable', now(), now()
        WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE account_code = '5185')
    """)

    op.create_table(
        'write_off_limits',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('group_id', sa.Integer(), sa.ForeignKey('auth_group.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('max_amount', sa.Numeric(18, 2), nullable=False, server_default='0'),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.CheckConstraint("max_amount >= 0", name='ck_write_off_limits_amount'),
    )
    op.create_index('ix_write_off_limits_id', 'write_off_limits', ['id'])

    op.create_table(
        'customer_write_offs',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('write_off_no', sa.String(50), nullable=False, unique=True),
        sa.Column('invoice_id', sa.Integer(), sa.ForeignKey('invoices.id'), nullable=False),
        sa.Column('customer_id', sa.Integer(), sa.ForeignKey('customers.id'), nullable=False),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('write_off_date', sa.Date(), nullable=False),
        sa.Column('amount', sa.Numeric(18, 2), nullable=False),
        sa.Column('reason', sa.String(30), nullable=False),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='posted'),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.Column('reversed_at', sa.TIMESTAMP(), nullable=True),
        sa.Column('reversed_by', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.CheckConstraint("amount > 0", name='ck_customer_write_offs_amount'),
        sa.CheckConstraint("status IN ('posted', 'reversed')", name='ck_customer_write_offs_status'),
    )
    op.create_index('ix_customer_write_offs_id', 'customer_write_offs', ['id'])
    op.create_index('ix_customer_write_offs_invoice_id', 'customer_write_offs', ['invoice_id'])
    op.create_index('ix_customer_write_offs_customer_id', 'customer_write_offs', ['customer_id'])

    op.add_column('cheque_payments', sa.Column('status', sa.String(20), nullable=False, server_default='received'))
    op.add_column('cheque_payments', sa.Column('bank_deposit_id', sa.Integer(), sa.ForeignKey('bank_deposits.id'), nullable=True))
    op.add_column('cheque_payments', sa.Column('settlement_transaction_id', sa.Integer(),
                                               sa.ForeignKey('customer_credits_settle_transaction.id'), nullable=True))
    op.add_column('cheque_payments', sa.Column('status_date', sa.Date(), nullable=True))
    op.add_column('cheque_payments', sa.Column('bounce_reason', sa.Text(), nullable=True))
    op.add_column('cheque_payments', sa.Column('bounce_journal_entry_id', sa.Integer(),
                                               sa.ForeignKey('journal_entries.id'), nullable=True))
    op.create_check_constraint('ck_cheque_payments_status', 'cheque_payments',
                               "status IN ('received', 'deposited', 'cleared', 'bounced')")

    op.execute("""
        UPDATE cheque_payments c
        SET bank_deposit_id = d.id
        FROM bank_deposits d
        WHERE c.payment_for = 'Sales Invoice' AND c.bank_deposit_id IS NULL
          AND d.payment_for = 'Cheque Deposit - Sales Invoice' AND d.invoice_no = c.invoice_no
          AND d.id = (SELECT min(d2.id) FROM bank_deposits d2
                      WHERE d2.payment_for = 'Cheque Deposit - Sales Invoice' AND d2.invoice_no = c.invoice_no)
    """)
    op.execute("""
        UPDATE cheque_payments c SET status = 'deposited', status_date = COALESCE(d.confirmed_date::date, c.deposit_date)
        FROM bank_deposits d
        WHERE d.id = c.bank_deposit_id AND d.verified = true
    """)
    op.execute("""
        UPDATE cheque_payments c
        SET status = 'deposited', status_date = c.deposit_date,
            settlement_transaction_id = (
                SELECT min(t.id) FROM customer_credits_settle_transaction t
                JOIN invoices i ON i.id = t.invoice_id
                WHERE i.invoice_no = c.invoice_no AND lower(t.payment_method) = 'cheque'
                  AND t.payment_amount = c.amount
                  AND COALESCE(t.payment_method_number, '') = COALESCE(c.cheque_number, '')
            )
        WHERE c.payment_for = 'Credit Settlement'
    """)

    op.execute("""
        INSERT INTO voucher_types (code, name, description, source_module, is_manual, is_active, created_at, updated_at)
        VALUES ('WOFF', 'Customer write-offs', 'Customer balances written off and their reversals.', 'finance', false, true, now(), now()),
               ('CHQB', 'Bounced cheques', 'Cheques returned unpaid: the amount is owed by the customer again.', 'finance', false, true, now(), now())
        ON CONFLICT (code) DO NOTHING
    """)


def downgrade() -> None:
    op.execute("DELETE FROM voucher_types WHERE code IN ('WOFF', 'CHQB')")
    op.drop_constraint('ck_cheque_payments_status', 'cheque_payments', type_='check')
    for col in ('bounce_journal_entry_id', 'bounce_reason', 'status_date', 'settlement_transaction_id',
                'bank_deposit_id', 'status'):
        op.drop_column('cheque_payments', col)
    op.drop_table('customer_write_offs')
    op.drop_table('write_off_limits')
