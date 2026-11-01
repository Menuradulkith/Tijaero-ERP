"""Payment terms and stored invoice due dates (finance blueprint phase C)

Revision ID: s117_payment_terms
Revises: s116_bank_reconciliation
Create Date: 2026-10-31

- payment_terms, seeded with common terms.
- customers.payment_term_id / supplier.payment_term_id (optional; credit_days
  stays the fallback).
- invoices.due_date, backfilled for credit sales as invoice date + the
  customer's credit days (exactly what aging computed until now), so no
  invoice changes age.
"""
import sqlalchemy as sa
from alembic import op

revision = 's117_payment_terms'
down_revision = 's116_bank_reconciliation'
branch_labels = None
depends_on = None


def upgrade() -> None:
    terms = op.create_table(
        'payment_terms',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('days', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('end_of_month', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.CheckConstraint("days >= 0 AND days <= 3650", name='ck_payment_terms_days'),
    )
    op.create_index('ix_payment_terms_id', 'payment_terms', ['id'])
    op.bulk_insert(terms, [
        {"code": "DUE", "name": "Due on receipt", "days": 0, "end_of_month": False, "is_active": True,
         "description": "Payable as soon as the invoice is issued."},
        {"code": "NET7", "name": "Net 7 days", "days": 7, "end_of_month": False, "is_active": True, "description": None},
        {"code": "NET14", "name": "Net 14 days", "days": 14, "end_of_month": False, "is_active": True, "description": None},
        {"code": "NET30", "name": "Net 30 days", "days": 30, "end_of_month": False, "is_active": True, "description": None},
        {"code": "NET45", "name": "Net 45 days", "days": 45, "end_of_month": False, "is_active": True, "description": None},
        {"code": "NET60", "name": "Net 60 days", "days": 60, "end_of_month": False, "is_active": True, "description": None},
        {"code": "EOM", "name": "End of month", "days": 0, "end_of_month": True, "is_active": True,
         "description": "Due on the last day of the invoice's month."},
        {"code": "EOM30", "name": "30 days after month end", "days": 30, "end_of_month": True, "is_active": True,
         "description": "Due 30 days after the end of the invoice's month."},
    ])

    op.add_column('customers', sa.Column('payment_term_id', sa.Integer(), sa.ForeignKey('payment_terms.id'), nullable=True))
    op.add_column('supplier', sa.Column('payment_term_id', sa.Integer(), sa.ForeignKey('payment_terms.id'), nullable=True))
    op.add_column('invoices', sa.Column('due_date', sa.Date(), nullable=True))
    op.execute("""
        UPDATE invoices i
        SET due_date = i.created_date + COALESCE(c.credit_days, 0)
        FROM customers c
        WHERE c.id = i.customer_id AND COALESCE(i.credit_amount, 0) > 0 AND i.due_date IS NULL
    """)
    op.create_index('ix_invoices_due_date', 'invoices', ['due_date'])


def downgrade() -> None:
    op.drop_index('ix_invoices_due_date', table_name='invoices')
    op.drop_column('invoices', 'due_date')
    op.drop_column('supplier', 'payment_term_id')
    op.drop_column('customers', 'payment_term_id')
    op.drop_table('payment_terms')
