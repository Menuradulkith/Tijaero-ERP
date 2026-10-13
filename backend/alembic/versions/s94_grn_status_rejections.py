"""GRN status / cancellation, delivery note and rejected quantities

Revision ID: s94_grn_status_rejections
Revises: s93_transfer_return_lots
Create Date: 2026-10-11

- good_received_note.status ('posted' | 'cancelled'; existing rows are 'posted'),
  cancelled_at / cancelled_by / cancel_reason: a posted GRN is reversed by a
  cancellation (with reason) rather than edited or deleted.
- good_received_note.delivery_note_no: the supplier's delivery note reference
  (the supplier invoice is matched later, at purchase-invoice time).
- good_received_rejections: goods delivered but not accepted at receipt. They
  never enter stock and do not count towards the PO, which stays open.
"""
from alembic import op
import sqlalchemy as sa

revision = 's94_grn_status_rejections'
down_revision = 's93_transfer_return_lots'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('good_received_note', sa.Column('delivery_note_no', sa.String(200), nullable=True))
    op.add_column('good_received_note', sa.Column('status', sa.String(20), nullable=False, server_default='posted'))
    op.add_column('good_received_note', sa.Column('cancelled_at', sa.TIMESTAMP(), nullable=True))
    op.add_column('good_received_note', sa.Column('cancelled_by', sa.Integer(), nullable=True))
    op.add_column('good_received_note', sa.Column('cancel_reason', sa.Text(), nullable=True))
    op.create_index('ix_good_received_note_status', 'good_received_note', ['status'])
    op.create_check_constraint('ck_good_received_note_status', 'good_received_note', "status IN ('posted', 'cancelled')")

    op.create_table(
        'good_received_rejections',
        sa.Column('id', sa.Integer(), primary_key=True, index=True),
        sa.Column('good_received_note_id', sa.Integer(), sa.ForeignKey('good_received_note.id'), nullable=False, index=True),
        sa.Column('purchasing_order_items_id', sa.Integer(), sa.ForeignKey('purchasing_order_items.id'), nullable=False),
        sa.Column('quantity', sa.Integer(), nullable=False),
        sa.Column('reason', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.Column('created_by', sa.Integer(), nullable=True),
        sa.Column('updated_by', sa.Integer(), nullable=True),
        sa.CheckConstraint('quantity >= 1', name='ck_grn_rejections_quantity_positive'),
    )


def downgrade() -> None:
    op.drop_table('good_received_rejections')
    op.drop_constraint('ck_good_received_note_status', 'good_received_note', type_='check')
    op.drop_index('ix_good_received_note_status', table_name='good_received_note')
    op.drop_column('good_received_note', 'cancel_reason')
    op.drop_column('good_received_note', 'cancelled_by')
    op.drop_column('good_received_note', 'cancelled_at')
    op.drop_column('good_received_note', 'status')
    op.drop_column('good_received_note', 'delivery_note_no')
