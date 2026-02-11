"""Scenario 33: Add manual JE approval workflow columns to journal_entries

Add submitted_by, submitted_at, approved_by, approved_at, rejection_reason
columns to support the manual journal entry approval workflow:
  draft → submitted → approved → posted → reversed

Revision ID: s33_manual_je_approval
Revises: h1i2j3k4l5m6
"""
from alembic import op
import sqlalchemy as sa


revision = "s33_manual_je_approval"
down_revision = "h1i2j3k4l5m6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add approval workflow columns to journal_entries
    columns_to_add = [
        ("submitted_by", sa.Integer(), True),
        ("submitted_at", sa.TIMESTAMP(), True),
        ("approved_by", sa.Integer(), True),
        ("approved_at", sa.TIMESTAMP(), True),
        ("rejection_reason", sa.Text(), True),
    ]

    conn = op.get_bind()
    inspector = sa.inspect(conn)
    existing_columns = [c["name"] for c in inspector.get_columns("journal_entries")]

    for col_name, col_type, nullable in columns_to_add:
        if col_name not in existing_columns:
            op.add_column("journal_entries", sa.Column(col_name, col_type, nullable=nullable))


def downgrade() -> None:
    for col_name in ["rejection_reason", "approved_at", "approved_by", "submitted_at", "submitted_by"]:
        try:
            op.drop_column("journal_entries", col_name)
        except Exception:
            pass
