"""GL posting reliability: failures outbox + rounding account

Revision ID: 20260610_gl_reliability
Revises: 20260608_ccs_timestamp
Create Date: 2026-06-10 00:00:00.000000

This migration:
1. Creates the ``gl_posting_failures`` transactional-outbox table so that
   failed automatic GL postings are durably recorded and retryable instead of
   being silently swallowed.
2. Seeds a dedicated "Rounding Difference" expense account (5900) so that
   sub-cent rounding adjustments post to a real, auditable account rather than
   distorting an unrelated line.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "20260610_gl_reliability"
down_revision = "20260608_ccs_timestamp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── gl_posting_failures ────────────────────────────────────────────────
    op.create_table(
        "gl_posting_failures",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("reference_type", sa.String(50), nullable=False),
        sa.Column("reference_id", sa.Integer(), nullable=False),
        sa.Column("reference_no", sa.String(200), nullable=True),
        sa.Column("source_module", sa.String(50), nullable=False),
        sa.Column("transaction_type", sa.String(50), nullable=True),
        sa.Column("posting_marker", sa.String(50), nullable=True),
        sa.Column("entry_date", sa.Date(), nullable=True),
        sa.Column("branch_code", sa.String(200), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("payload", sa.Text(), nullable=True),
        sa.Column("error_code", sa.String(50), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("last_attempt_at", sa.TIMESTAMP(), server_default=sa.func.now()),
        sa.Column("resolved_at", sa.TIMESTAMP(), nullable=True),
        sa.Column("resolved_by", sa.Integer(), nullable=True),
        sa.Column(
            "resolved_je_id",
            sa.Integer(),
            sa.ForeignKey("journal_entries.id"),
            nullable=True,
        ),
        # AuditMixin columns
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.TIMESTAMP(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "idx_gl_failure_ref", "gl_posting_failures", ["reference_type", "reference_id"]
    )
    op.create_index("idx_gl_failure_status", "gl_posting_failures", ["status"])

    # ── Seed "Rounding Difference" account (idempotent) ────────────────────
    op.execute(
        """
        INSERT INTO chart_of_accounts
            (account_code, account_name, account_type, account_category,
             parent_account_id, is_active, is_system_account, normal_balance,
             description, created_at, updated_at)
        SELECT '5900', 'Rounding Difference', 'Expense', 'Other',
               NULL, true, true, 'Debit',
               'Sub-cent rounding adjustments from automatic GL postings',
               now(), now()
        WHERE NOT EXISTS (
            SELECT 1 FROM chart_of_accounts WHERE account_code = '5900'
        );
        """
    )


def downgrade() -> None:
    op.drop_index("idx_gl_failure_status", table_name="gl_posting_failures")
    op.drop_index("idx_gl_failure_ref", table_name="gl_posting_failures")
    op.drop_table("gl_posting_failures")
    op.execute("DELETE FROM chart_of_accounts WHERE account_code = '5900' AND is_system_account = true;")
