"""Add Direct Debit, Letter of Credit, Credit Card, Digital Wallet fields

Revision ID: s65_supplier_payment_types
Revises: s64_supplier_bank_wire_details
Create Date: 2026-09-26

Adds the type-specific columns needed for supplier_payment_method.method_type
to support 4 new standing payment method types (direct_debit,
letter_of_credit, credit_card, digital_wallet), alongside the existing
cash/cheque/bank_transfer. See app.common.enums.SupplierPaymentMethodType.

Credit card fields deliberately never store the full card number — only
the last 4 digits (card_last4), per PCI-DSS.
"""
from alembic import op
import sqlalchemy as sa

revision = 's65_supplier_payment_types'
down_revision = 's64_supplier_bank_wire_details'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Direct Debit / ACH
    op.add_column('supplier_payment_method', sa.Column('mandate_reference', sa.String(100), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('mandate_date', sa.Date(), nullable=True))
    # Letter of Credit
    op.add_column('supplier_payment_method', sa.Column('lc_number', sa.String(100), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('issuing_bank_name', sa.String(255), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('advising_bank_name', sa.String(255), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('lc_amount', sa.Numeric(18, 2), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('lc_currency', sa.String(3), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('lc_type', sa.String(30), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('lc_issue_date', sa.Date(), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('lc_expiry_date', sa.Date(), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('latest_shipment_date', sa.Date(), nullable=True))
    # Credit Card
    op.add_column('supplier_payment_method', sa.Column('card_type', sa.String(20), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('card_last4', sa.String(4), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('card_expiry', sa.String(7), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('cardholder_name', sa.String(255), nullable=True))
    # Digital Wallet
    op.add_column('supplier_payment_method', sa.Column('wallet_provider', sa.String(50), nullable=True))
    op.add_column('supplier_payment_method', sa.Column('wallet_id', sa.String(255), nullable=True))


def downgrade() -> None:
    op.drop_column('supplier_payment_method', 'wallet_id')
    op.drop_column('supplier_payment_method', 'wallet_provider')
    op.drop_column('supplier_payment_method', 'cardholder_name')
    op.drop_column('supplier_payment_method', 'card_expiry')
    op.drop_column('supplier_payment_method', 'card_last4')
    op.drop_column('supplier_payment_method', 'card_type')
    op.drop_column('supplier_payment_method', 'latest_shipment_date')
    op.drop_column('supplier_payment_method', 'lc_expiry_date')
    op.drop_column('supplier_payment_method', 'lc_issue_date')
    op.drop_column('supplier_payment_method', 'lc_type')
    op.drop_column('supplier_payment_method', 'lc_currency')
    op.drop_column('supplier_payment_method', 'lc_amount')
    op.drop_column('supplier_payment_method', 'advising_bank_name')
    op.drop_column('supplier_payment_method', 'issuing_bank_name')
    op.drop_column('supplier_payment_method', 'lc_number')
    op.drop_column('supplier_payment_method', 'mandate_date')
    op.drop_column('supplier_payment_method', 'mandate_reference')
