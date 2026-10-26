"""Document print templates and their version history

Revision ID: s105_document_templates
Revises: s104_cashbook_gl_driven
Create Date: 2026-10-24

Admins configure how printed documents look (logo, colours, texts, sections,
paper size, optionally custom HTML) per document type, company-wide or per
branch. Every save is snapshotted in document_template_versions.
"""
import sqlalchemy as sa
from alembic import op

revision = 's105_document_templates'
down_revision = 's104_cashbook_gl_driven'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "document_templates",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("document_type", sa.String(50), nullable=False),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column(
            "branch_code",
            sa.String(255),
            sa.ForeignKey("branches.branch_code", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("paper_size", sa.String(20), nullable=True),
        sa.Column("orientation", sa.String(10), nullable=False, server_default="portrait"),
        sa.Column("settings", sa.JSON(), nullable=False),
        sa.Column("custom_html", sa.Text(), nullable=True),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("updated_by", sa.Integer(), nullable=True),
    )
    op.create_index("ix_document_templates_id", "document_templates", ["id"])
    op.create_index("ix_document_templates_document_type", "document_templates", ["document_type"])
    op.create_index("ix_document_templates_branch_code", "document_templates", ["branch_code"])
    op.execute(
        "CREATE UNIQUE INDEX uq_document_templates_default "
        "ON document_templates (document_type, coalesce(branch_code, '')) "
        "WHERE is_default AND is_active"
    )

    op.create_table(
        "document_template_versions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "template_id",
            sa.Integer(),
            sa.ForeignKey("document_templates.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("template_id", "version", name="uq_document_template_version"),
    )
    op.create_index("ix_document_template_versions_id", "document_template_versions", ["id"])
    op.create_index(
        "ix_document_template_versions_template_id", "document_template_versions", ["template_id"]
    )


def downgrade() -> None:
    op.drop_table("document_template_versions")
    op.execute("DROP INDEX IF EXISTS uq_document_templates_default")
    op.drop_table("document_templates")
