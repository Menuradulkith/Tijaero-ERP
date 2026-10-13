"""approvals.remark VARCHAR(255) -> TEXT

Revision ID: s92_approval_remark_text
Revises: s91_grn_items_quantity_batch
Create Date: 2026-10-11

Approval/reject/cancel remarks are accepted up to 500 characters by the API
schemas and the code appends text to them ('Order cancelled: ' + reason, the
credit warning), so 255 characters overflowed and surfaced as a 500.
"""
from alembic import op
import sqlalchemy as sa

revision = 's92_approval_remark_text'
down_revision = 's91_grn_items_quantity_batch'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        'approvals', 'remark',
        existing_type=sa.String(255), type_=sa.Text(), existing_nullable=True,
    )


def downgrade() -> None:
    # Truncate first so the narrowing cast cannot fail on long remarks.
    op.execute("UPDATE approvals SET remark = LEFT(remark, 255) WHERE char_length(remark) > 255")
    op.alter_column(
        'approvals', 'remark',
        existing_type=sa.Text(), type_=sa.String(255), existing_nullable=True,
    )
