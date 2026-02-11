"""Scenario 25: Petty Cash Management - Add fund columns and transactions table

Revision ID: s25_petty_cash_mgmt
Revises: s33_manual_je_approval
Create Date: 2026-02-11

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = "s25_petty_cash_mgmt"
down_revision = "s33_manual_je_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Add new columns to petty_cash (fund-level) ──
    op.add_column("petty_cash", sa.Column("petty_cash_no", sa.String(50), unique=True, nullable=True))
    op.add_column("petty_cash", sa.Column("opening_balance", sa.Numeric(60, 2), nullable=True, server_default="0"))
    op.add_column("petty_cash", sa.Column("current_balance", sa.Numeric(60, 2), nullable=True, server_default="0"))
    op.add_column("petty_cash", sa.Column("closing_balance", sa.Numeric(60, 2), nullable=True))
    op.add_column("petty_cash", sa.Column("opened_by", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=True))
    op.add_column("petty_cash", sa.Column("opened_date", sa.Date(), nullable=True))
    op.add_column("petty_cash", sa.Column("status", sa.String(30), server_default="active", nullable=True))
    op.add_column("petty_cash", sa.Column("closed_by", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=True))
    op.add_column("petty_cash", sa.Column("closed_date", sa.Date(), nullable=True))

    # Make transaction_type nullable (fund records won't have it)
    op.alter_column("petty_cash", "transaction_type", existing_type=sa.String(20), nullable=True)
    # Make amount nullable (fund records use opening_balance instead)
    op.alter_column("petty_cash", "amount", existing_type=sa.Numeric(60, 2), nullable=True)

    # ── Create petty_cash_transaction table ──
    op.create_table(
        "petty_cash_transaction",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("transaction_no", sa.String(50), unique=True, nullable=False),
        sa.Column("petty_cash_id", sa.Integer(), sa.ForeignKey("petty_cash.id"), nullable=False),
        sa.Column("transaction_type", sa.String(20), nullable=False),
        sa.Column("amount", sa.Numeric(60, 2), nullable=False),
        sa.Column("balance_after", sa.Numeric(60, 2), nullable=False),
        sa.Column("expense_type", sa.String(100), nullable=True),
        sa.Column("recipient_name", sa.String(255), nullable=True),
        sa.Column("purpose", sa.Text(), nullable=True),
        sa.Column("receipt_number", sa.String(200), nullable=True),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("recorded_by", sa.Integer(), sa.ForeignKey("accounts_user.id"), nullable=True),
        sa.Column("branch_code", sa.String(200), nullable=False),
        sa.Column("remarks", sa.Text(), nullable=True),
        sa.Column("created_date", sa.TIMESTAMP(), nullable=False),
    )
    op.create_index("ix_petty_cash_transaction_id", "petty_cash_transaction", ["id"])
    op.create_index("ix_pct_fund_id", "petty_cash_transaction", ["petty_cash_id"])
    op.create_index("ix_pct_txn_date", "petty_cash_transaction", ["transaction_date"])


def downgrade() -> None:
    op.drop_index("ix_pct_txn_date", table_name="petty_cash_transaction")
    op.drop_index("ix_pct_fund_id", table_name="petty_cash_transaction")
    op.drop_index("ix_petty_cash_transaction_id", table_name="petty_cash_transaction")
    op.drop_table("petty_cash_transaction")

    op.drop_column("petty_cash", "closed_date")
    op.drop_column("petty_cash", "closed_by")
    op.drop_column("petty_cash", "status")
    op.drop_column("petty_cash", "opened_date")
    op.drop_column("petty_cash", "opened_by")
    op.drop_column("petty_cash", "closing_balance")
    op.drop_column("petty_cash", "current_balance")
    op.drop_column("petty_cash", "opening_balance")
    op.drop_column("petty_cash", "petty_cash_no")

    op.alter_column("petty_cash", "transaction_type", existing_type=sa.String(20), nullable=False)
    op.alter_column("petty_cash", "amount", existing_type=sa.Numeric(60, 2), nullable=False)
