"""GRN cancellation goes through approval: request columns on good_received_note

Revision ID: s131_grn_cancel_approval
Revises: s130_mfg_sri_lanka
Create Date: 2026-11-09
"""
import sqlalchemy as sa
from alembic import op

revision = 's131_grn_cancel_approval'
down_revision = 's130_mfg_sri_lanka'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('good_received_note', sa.Column('cancel_requested_by', sa.Integer(), nullable=True))
    op.add_column('good_received_note', sa.Column('cancel_requested_at', sa.TIMESTAMP(), nullable=True))
    op.add_column('good_received_note', sa.Column('cancel_rejection_remark', sa.Text(), nullable=True))
    op.drop_constraint('ck_good_received_note_status', 'good_received_note', type_='check')
    op.create_check_constraint(
        'ck_good_received_note_status', 'good_received_note',
        "status IN ('posted', 'cancel_pending', 'cancelled')",
    )


def downgrade() -> None:
    op.execute("UPDATE good_received_note SET status = 'posted' WHERE status = 'cancel_pending'")
    op.drop_constraint('ck_good_received_note_status', 'good_received_note', type_='check')
    op.create_check_constraint(
        'ck_good_received_note_status', 'good_received_note', "status IN ('posted', 'cancelled')"
    )
    op.drop_column('good_received_note', 'cancel_rejection_remark')
    op.drop_column('good_received_note', 'cancel_requested_at')
    op.drop_column('good_received_note', 'cancel_requested_by')
