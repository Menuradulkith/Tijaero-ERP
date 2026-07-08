"""Link supplier advance applications to purchase invoices

Historically a ``supplier_advance_application`` row could only point at a GRN
(``grn_id`` was NOT NULL). The purchase-invoice payment flow also consumes
supplier advances, but it did so silently — mutating advance balances without
recording an application row or posting GL. To give that flow the same audit
trail + GL treatment as the GRN flow, an advance application must be able to
reference a Purchase Invoice instead of a GRN.

This migration:
  * adds ``purchase_invoice_id`` (nullable FK -> purchase_invoices.id)
  * makes ``grn_id`` nullable

Exactly one of ``grn_id`` / ``purchase_invoice_id`` is populated per row.

Revision ID: s41_advance_application_invoice_link
Revises: s40_cheque_identifier_types
Create Date: 2026-07-07
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "s41_advance_application_invoice_link"
down_revision = "s40_cheque_identifier_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "supplier_advance_application",
        sa.Column("purchase_invoice_id", sa.Integer(), nullable=True),
    )
    op.create_index(
        "ix_supplier_advance_application_purchase_invoice_id",
        "supplier_advance_application",
        ["purchase_invoice_id"],
    )
    op.create_foreign_key(
        "fk_saa_purchase_invoice",
        "supplier_advance_application",
        "purchase_invoices",
        ["purchase_invoice_id"],
        ["id"],
    )
    op.alter_column(
        "supplier_advance_application",
        "grn_id",
        existing_type=sa.Integer(),
        nullable=True,
    )


def downgrade() -> None:
    # Restore NOT NULL on grn_id. Any invoice-only applications must be removed
    # first, otherwise the constraint cannot be re-applied.
    op.execute(
        "DELETE FROM supplier_advance_application "
        "WHERE grn_id IS NULL"
    )
    op.alter_column(
        "supplier_advance_application",
        "grn_id",
        existing_type=sa.Integer(),
        nullable=False,
    )
    op.drop_constraint(
        "fk_saa_purchase_invoice",
        "supplier_advance_application",
        type_="foreignkey",
    )
    op.drop_index(
        "ix_supplier_advance_application_purchase_invoice_id",
        table_name="supplier_advance_application",
    )
    op.drop_column("supplier_advance_application", "purchase_invoice_id")
