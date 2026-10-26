"""Report Center: shared saved reports and run history by report key

Revision ID: s106_report_center
Revises: s105_document_templates
Create Date: 2026-10-24

Saved reports reuse the `reports` table (report_type = report key, parameters =
JSON of parameters and view); `is_shared` makes one visible to everyone who can
run that report. Runs are logged in `report_executions` under their report key.
"""
import sqlalchemy as sa
from alembic import op

revision = 's106_report_center'
down_revision = 's105_document_templates'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("reports", sa.Column("is_shared", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_index("ix_reports_report_type", "reports", ["report_type"])
    op.add_column("report_executions", sa.Column("report_key", sa.String(100), nullable=True))
    op.create_index("ix_report_executions_report_key", "report_executions", ["report_key"])
    op.create_index("ix_report_executions_user_date", "report_executions", ["executed_by", "execution_date"])
    # A deleted saved report keeps its run history.
    op.drop_constraint("report_executions_report_id_fkey", "report_executions", type_="foreignkey")
    op.create_foreign_key(
        "report_executions_report_id_fkey", "report_executions", "reports",
        ["report_id"], ["id"], ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("report_executions_report_id_fkey", "report_executions", type_="foreignkey")
    op.create_foreign_key("report_executions_report_id_fkey", "report_executions", "reports", ["report_id"], ["id"])
    op.drop_index("ix_report_executions_user_date", table_name="report_executions")
    op.drop_index("ix_report_executions_report_key", table_name="report_executions")
    op.drop_column("report_executions", "report_key")
    op.drop_index("ix_reports_report_type", table_name="reports")
    op.drop_column("reports", "is_shared")
