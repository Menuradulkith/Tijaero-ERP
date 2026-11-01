"""Tax codes, tax ledger and VAT settlements (finance blueprint phase B)

Revision ID: s115_tax_codes_and_vat_ledger
Revises: s114_posting_rules_voucher_types
Create Date: 2026-10-31

- tax_codes: VAT treatments (VAT standard rate, zero-rated, exempt), seeded.
- tax_transactions: one row per VAT line of an automatic posting (tax ledger).
  Existing sales VAT postings (2210 lines of posted sale / sale-return entries)
  are backfilled so the VAT return covers history.
- tax_settlements: VAT clearings into 2220 VAT due to tax authority.
- New leaf accounts: 1140 VAT Receivable (Input VAT), 2220 VAT Due to Tax Authority.
- purchase_invoices.tax_code; posting rules may split by tax code.
"""
import sqlalchemy as sa
from alembic import op

revision = 's115_tax_codes_and_vat_ledger'
down_revision = 's114_posting_rules_voucher_types'
branch_labels = None
depends_on = None


def _audit():
    return [
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
    ]


def upgrade() -> None:
    # ── accounts ─────────────────────────────────────────────────────────
    op.execute("""
        INSERT INTO chart_of_accounts (account_code, account_name, account_type, account_category,
                                       parent_account_id, is_active, is_system_account, normal_balance,
                                       description, created_at, updated_at)
        SELECT v.code, v.name, v.type, 'Tax', (SELECT id FROM chart_of_accounts WHERE account_code = v.parent),
               true, true, v.nb, v.descr, now(), now()
        FROM (VALUES
            ('1140', 'VAT Receivable (Input VAT)', 'Asset', '1100', 'Debit',
             'VAT paid on supplier invoices, to be claimed from the tax authority'),
            ('2220', 'VAT Due to Tax Authority', 'Liability', '2200', 'Credit',
             'Net VAT of settled periods, owed to (or refundable by) the tax authority')
        ) AS v(code, name, type, parent, nb, descr)
        WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.account_code = v.code)
    """)

    # ── tax codes ────────────────────────────────────────────────────────
    tax_codes = op.create_table(
        'tax_codes',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('code', sa.String(20), nullable=False, unique=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('rate', sa.Numeric(7, 3), nullable=False, server_default='0'),
        sa.Column('tax_type', sa.String(20), nullable=False, server_default='standard'),
        sa.Column('applies_to', sa.String(20), nullable=False, server_default='both'),
        sa.Column('is_default_sales', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_default_purchases', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        *_audit(),
        sa.CheckConstraint("tax_type IN ('standard', 'zero_rated', 'exempt')", name='ck_tax_codes_type'),
        sa.CheckConstraint("applies_to IN ('sales', 'purchases', 'both')", name='ck_tax_codes_applies_to'),
        sa.CheckConstraint("rate >= 0 AND rate <= 100", name='ck_tax_codes_rate'),
    )
    op.create_index('ix_tax_codes_id', 'tax_codes', ['id'])
    # Only one default per direction.
    op.create_index('uq_tax_codes_default_sales', 'tax_codes', ['is_default_sales'], unique=True,
                    postgresql_where=sa.text('is_default_sales'))
    op.create_index('uq_tax_codes_default_purchases', 'tax_codes', ['is_default_purchases'], unique=True,
                    postgresql_where=sa.text('is_default_purchases'))
    op.bulk_insert(tax_codes, [
        {"code": "VAT", "name": "VAT standard rate", "rate": 18, "tax_type": "standard", "applies_to": "both",
         "is_default_sales": True, "is_default_purchases": True, "is_active": True,
         "description": "Standard-rate VAT on local sales and purchases."},
        {"code": "ZERO", "name": "Zero-rated", "rate": 0, "tax_type": "zero_rated", "applies_to": "both",
         "is_default_sales": False, "is_default_purchases": False, "is_active": True,
         "description": "Taxable at 0%, e.g. exports. Reported on the VAT return."},
        {"code": "EXEMPT", "name": "Exempt", "rate": 0, "tax_type": "exempt", "applies_to": "both",
         "is_default_sales": False, "is_default_purchases": False, "is_active": True,
         "description": "Supplies outside VAT."},
    ])

    # ── settlements + ledger ─────────────────────────────────────────────
    op.create_table(
        'tax_settlements',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('settlement_no', sa.String(50), nullable=False, unique=True),
        sa.Column('date_to', sa.Date(), nullable=False),
        sa.Column('settlement_date', sa.Date(), nullable=False),
        sa.Column('output_tax', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('input_tax', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('net_tax', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        *_audit(),
    )
    op.create_index('ix_tax_settlements_id', 'tax_settlements', ['id'])

    op.create_table(
        'tax_transactions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('transaction_date', sa.Date(), nullable=False),
        sa.Column('fiscal_year', sa.Integer(), nullable=False),
        sa.Column('fiscal_period', sa.Integer(), nullable=False),
        sa.Column('direction', sa.String(10), nullable=False),
        sa.Column('tax_code', sa.String(20), nullable=False),
        sa.Column('tax_rate', sa.Numeric(7, 3), nullable=True),
        sa.Column('base_amount', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('tax_amount', sa.Numeric(60, 2), nullable=False, server_default='0'),
        sa.Column('account_id', sa.Integer(), sa.ForeignKey('chart_of_accounts.id'), nullable=False),
        sa.Column('reference_type', sa.String(50), nullable=True),
        sa.Column('reference_id', sa.Integer(), nullable=True),
        sa.Column('reference_no', sa.String(200), nullable=True),
        sa.Column('branch_code', sa.String(200), nullable=True),
        sa.Column('journal_entry_id', sa.Integer(), sa.ForeignKey('journal_entries.id'), nullable=False),
        sa.Column('settlement_id', sa.Integer(), sa.ForeignKey('tax_settlements.id'), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column('updated_at', sa.TIMESTAMP(), server_default=sa.func.now()),
        *_audit(),
        sa.CheckConstraint("direction IN ('output', 'input')", name='ck_tax_transactions_direction'),
    )
    op.create_index('ix_tax_transactions_id', 'tax_transactions', ['id'])
    op.create_index('idx_tax_txn_date', 'tax_transactions', ['transaction_date'])
    op.create_index('idx_tax_txn_je', 'tax_transactions', ['journal_entry_id'])
    op.create_index('idx_tax_txn_settlement', 'tax_transactions', ['settlement_id'])

    # Backfill: VAT lines of posted (not reversed) sales / sale-return entries.
    op.execute("""
        INSERT INTO tax_transactions (transaction_date, fiscal_year, fiscal_period, direction, tax_code,
                                      tax_rate, base_amount, tax_amount, account_id, reference_type,
                                      reference_id, reference_no, branch_code, journal_entry_id,
                                      created_at, updated_at)
        SELECT je.entry_date, je.fiscal_year, je.fiscal_period, 'output', 'VAT',
               CASE WHEN l.reference_type = 'Invoice' THEN inv.tax_rate
                    ELSE (SELECT i2.tax_rate FROM invoices i2 WHERE i2.id = sr.invoice_id) END,
               CASE
                   WHEN l.reference_type = 'Invoice' THEN COALESCE(inv.subtotal, 0)
                   ELSE -(COALESCE(sr.total_refund, 0) - COALESCE(sr.tax_refund, 0))
               END,
               l.credit_amount - l.debit_amount,
               l.account_id, l.reference_type, l.reference_id, l.reference_no, je.branch_code, je.id,
               now(), now()
        FROM journal_entry_lines l
        JOIN journal_entries je ON je.id = l.journal_entry_id
        JOIN chart_of_accounts a ON a.id = l.account_id AND a.account_code = '2210'
        LEFT JOIN invoices inv ON l.reference_type = 'Invoice' AND inv.id = l.reference_id
        LEFT JOIN sale_return sr ON l.reference_type = 'SaleReturn' AND sr.id = l.reference_id
        WHERE je.status = 'posted' AND je.entry_type = 'Auto'
          AND COALESCE(je.is_reversed, false) = false
          AND l.reference_type IN ('Invoice', 'SaleReturn')
          AND l.credit_amount - l.debit_amount <> 0
    """)

    op.add_column('purchase_invoices', sa.Column('tax_code', sa.String(20), nullable=True))

    op.execute("""
        INSERT INTO voucher_types (code, name, description, source_module, is_manual, is_active, created_at, updated_at)
        VALUES ('PINV', 'Supplier invoices', 'VAT and discounts on verified supplier invoices.', 'purchasing', false, true, now(), now()),
               ('VAT', 'VAT settlement', 'Output and input VAT cleared to the tax authority account.', 'finance', false, true, now(), now())
        ON CONFLICT (code) DO NOTHING
    """)

    op.drop_constraint('ck_posting_rules_control_type', 'posting_rules', type_='check')
    op.create_check_constraint(
        'ck_posting_rules_control_type', 'posting_rules',
        "control_type IN ('none', 'branch', 'expense_category', 'tax_code')",
    )


def downgrade() -> None:
    op.execute("DELETE FROM posting_rules WHERE control_type = 'tax_code'")
    op.drop_constraint('ck_posting_rules_control_type', 'posting_rules', type_='check')
    op.create_check_constraint(
        'ck_posting_rules_control_type', 'posting_rules',
        "control_type IN ('none', 'branch', 'expense_category')",
    )
    op.execute("DELETE FROM voucher_types WHERE code IN ('PINV', 'VAT')")
    op.drop_column('purchase_invoices', 'tax_code')
    op.drop_table('tax_transactions')
    op.drop_table('tax_settlements')
    op.drop_table('tax_codes')
    # 1140 / 2220 stay: they may carry postings by now.
